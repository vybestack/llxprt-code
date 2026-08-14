/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs LLxprt with the JSC memory probe attached.
 *
 *   npm run mem:profile -- [memprofile options] -- [llxprt args...]
 *
 * It is scripts/start.ts plus a `--preload scripts/memory/probe-preload.ts`.
 * LLxprt runs exactly as it normally does in dev; the probe samples the JSC
 * heap alongside it and writes to a run directory. When the session exits
 * normally, the growth report is printed automatically; report rendering
 * failures are reported but never replace the child's exit status. Snapshots
 * are OFF by default (opt-in with --snapshots) and stay off even when the
 * parent environment already carries LLXPRT_MEM_SNAPSHOT=1: the child env is
 * set explicitly.
 *
 * ARGUMENT BOUNDARY
 * Everything before `--` (if present) must be a recognized memprofile option;
 * anything unrecognized there fails fast with usage help. Everything after
 * `--` is passed through to LLxprt untouched.
 */

import { spawn } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import process from 'node:process';
import {
  devLocalStorageFile,
  prepareDevNodeOptions,
} from '../lib/node-options.ts';
import {
  LATEST_POINTER_NAME,
  MEMPROFILE_DIR_NAME,
  SAMPLES_FILE_NAME,
} from './paths.ts';
import { ensureSecureDir, FILE_MODE, secureFile } from './perms.ts';
import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_SNAPSHOT_HEAP_MB,
  MAX_INTERVAL_MS,
  MAX_SNAPSHOT_HEAP_MB_LIMIT,
} from './probe.ts';
import { renderReport } from './report.ts';
import { parseSamples } from './sample.ts';

interface PackageJson {
  readonly version: string;
}

export class LauncherParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LauncherParseError';
  }
}

export interface LauncherOptions {
  readonly snapshots: boolean;
  readonly intervalMs: number;
  readonly maxHeapMb: number;
  readonly runDir: string;
  readonly help: boolean;
  readonly passthrough: readonly string[];
}

const USAGE = `Usage: npm run mem:profile -- [options] -- [llxprt args...]

  --snapshots          arm heap snapshots (off by default; see guard below)
  --interval <ms>      sampling interval, default 15000 (max 86400000)
  --max-heap-mb <n>    snapshot guard, default ${DEFAULT_MAX_SNAPSHOT_HEAP_MB}
  --dir <path>         run directory, default .memprofile/<timestamp>
  -h, --help           print this help
  --                   everything after this is passed to LLxprt unchanged

Unrecognized options before -- are rejected; put LLxprt arguments after --.
Snapshots are synchronous, block the target, and can consume substantially
more transient memory than the live heap. The guard refuses above
--max-heap-mb. Do not snapshot a process that has already blown out.

While a session runs:  npm run mem:request         (sample now)
                       npm run mem:request -- --heap (snapshot, needs --snapshots)
After a session:       npm run mem:report`;

function expectOptionValue(
  argv: readonly string[],
  index: number,
  name: string,
): string {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new LauncherParseError(`missing value for ${name}`);
  }
  if (value.length === 0 || value.startsWith('-')) {
    throw new LauncherParseError(
      `invalid value for ${name}: ${value} (expected a non-flag value)`,
    );
  }
  return value;
}

function parsePositiveIntOption(
  argv: readonly string[],
  index: number,
  name: string,
  max: number,
): number {
  const raw = expectOptionValue(argv, index, name);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new LauncherParseError(
      `invalid value for ${name}: ${raw} (expected a positive integer)`,
    );
  }
  if (value > max) {
    throw new LauncherParseError(
      `invalid value for ${name}: ${raw} (must be <= ${max})`,
    );
  }
  return value;
}

/**
 * Parses launcher argv. Everything before `--` must be recognized: an unknown
 * option, a missing option value, a flag-shaped value, or a nonpositive /
 * nonfinite / non-integer / over-bounds number fails fast. Everything after
 * `--` is passthrough. Exported so argument handling is testable.
 */
export function parseLauncherArgs(
  argv: readonly string[],
  defaultRunDir: string,
): LauncherOptions {
  let help = false;
  let snapshots = false;
  let intervalMs: number | undefined;
  let maxHeapMb: number | undefined;
  let explicitDir: string | undefined;

  // `--` is the LLxprt passthrough boundary: options before it, LLxprt
  // arguments after it, untouched.
  const boundary = argv.indexOf('--');
  const own = boundary === -1 ? argv : argv.slice(0, boundary);
  const passthrough = boundary === -1 ? [] : argv.slice(boundary + 1);

  let i = 0;
  while (i < own.length) {
    const arg = own[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
      i += 1;
    } else if (arg === '--snapshots') {
      snapshots = true;
      i += 1;
    } else if (arg === '--interval') {
      intervalMs = parsePositiveIntOption(own, i, arg, MAX_INTERVAL_MS);
      i += 2;
    } else if (arg === '--max-heap-mb') {
      maxHeapMb = parsePositiveIntOption(
        own,
        i,
        arg,
        MAX_SNAPSHOT_HEAP_MB_LIMIT,
      );
      i += 2;
    } else if (arg === '--dir') {
      explicitDir = expectOptionValue(own, i, arg);
      i += 2;
    } else {
      throw new LauncherParseError(
        `unknown option: ${arg}. Put LLxprt arguments after --, not before it.`,
      );
    }
  }

  return {
    snapshots,
    intervalMs: intervalMs ?? DEFAULT_INTERVAL_MS,
    maxHeapMb: maxHeapMb ?? DEFAULT_MAX_SNAPSHOT_HEAP_MB,
    runDir: resolve(explicitDir ?? defaultRunDir),
    help,
    passthrough,
  };
}

export function buildLauncherEnv(
  base: NodeJS.ProcessEnv,
  options: LauncherOptions,
  pkgVersion: string,
): NodeJS.ProcessEnv {
  return {
    ...base,
    CLI_VERSION: pkgVersion,
    DEV: 'true',
    // Exactly one launcher-owned --localstorage-file: inherited variants
    // (flag/value, '='-attached, bare) are stripped first, then one value is
    // appended.
    NODE_OPTIONS: prepareDevNodeOptions(
      base['NODE_OPTIONS'],
      devLocalStorageFile(),
    ),
    LLXPRT_MEM_DIR: options.runDir,
    LLXPRT_MEM_INTERVAL_MS: String(options.intervalMs),
    LLXPRT_MEM_MAX_HEAP_MB: String(options.maxHeapMb),
    // Explicit on both branches: an inherited LLXPRT_MEM_SNAPSHOT=1 from the
    // parent cannot re-arm snapshots the user did not ask for.
    LLXPRT_MEM_SNAPSHOT: options.snapshots ? '1' : '0',
  };
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..');
const memprofileRoot = join(repoRoot, MEMPROFILE_DIR_NAME);

function defaultRunDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(memprofileRoot, stamp);
}

function readPkgVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
  ) as PackageJson;
  return pkg.version;
}

/**
 * Reads the current `latest` pointer under `memRoot`, or undefined when it is
 * absent or unreadable. Best-effort by design: pointer retirement must never
 * mask the child's exit status.
 */
function readLatestPointer(memRoot: string): string | undefined {
  try {
    return readFileSync(join(memRoot, LATEST_POINTER_NAME), 'utf8').trim();
  } catch {
    return undefined;
  }
}

/** Tightens the `latest` pointer to owner-only when it still names our run. */
export function tightenLatestPointer(memRoot: string, runDir: string): void {
  try {
    if (readLatestPointer(memRoot) === runDir) {
      secureFile(join(memRoot, LATEST_POINTER_NAME));
    }
  } catch (error) {
    process.stderr.write(
      `memprofile: could not tighten ${LATEST_POINTER_NAME}: ${message(error)}\n`,
    );
  }
}

/** Deletes the `latest` pointer when it still names our (failed) run. */
export function deleteLatestPointer(memRoot: string, runDir: string): void {
  try {
    if (readLatestPointer(memRoot) === runDir) {
      rmSync(join(memRoot, LATEST_POINTER_NAME), { force: true });
    }
  } catch (error) {
    process.stderr.write(
      `memprofile: could not remove ${LATEST_POINTER_NAME}: ${message(error)}\n`,
    );
  }
}

/**
 * Publishes the `latest` pointer with a same-directory temp file and an atomic
 * rename so a concurrent reader never observes a partial pointer.
 */
export function publishLatestPointer(memRoot: string, runDir: string): void {
  const final = join(memRoot, LATEST_POINTER_NAME);
  const temp = join(
    memRoot,
    `${LATEST_POINTER_NAME}.${process.pid.toString(36)}.${Date.now().toString(36)}.tmp`,
  );
  writeFileSync(temp, runDir, { mode: FILE_MODE });
  renameSync(temp, final);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function announce(options: LauncherOptions): void {
  process.stdout.write(`memprofile: run dir ${options.runDir}\n`);
  process.stdout.write(
    `memprofile: sampling every ${options.intervalMs}ms, snapshots ${
      options.snapshots ? `ARMED (guard ${options.maxHeapMb} MB)` : 'off'
    }\n`,
  );
  process.stdout.write(
    'memprofile: report prints automatically when LLxprt exits.\n\n',
  );
}

/**
 * Prominent warning when the run directory is outside the git-ignored
 * .memprofile tree. The location is still honored — there are legitimate
 * reasons to profile to an external path — but the user must know that
 * samples and snapshots contain sensitive content and are NOT ignored there.
 */
export function warnIfRunDirOutsideMemprofile(
  runDir: string,
  memRoot: string,
): boolean {
  const inside = runDir === memRoot || runDir.startsWith(memRoot + sep);
  if (!inside) {
    process.stdout.write(
      `memprofile: WARNING: run directory is outside ${memRoot}.\n` +
        '  Samples and heap snapshots contain full prompts, tool output, and\n' +
        '  potentially credentials. .memprofile/ is git-ignored; this location\n' +
        '  is NOT, so an accidental "git add" can commit sensitive artifacts.\n' +
        '  Keep this path out of any repository or add it to .gitignore.\n\n',
    );
  }
  return inside;
}

function renderExitReport(runDir: string): void {
  const samplesPath = join(runDir, SAMPLES_FILE_NAME);
  if (!existsSync(samplesPath)) {
    process.stdout.write('\nmemprofile: no samples recorded.\n');
    return;
  }
  process.stdout.write('\nmemprofile: session exited. Report:\n\n');
  const samples = parseSamples(readFileSync(samplesPath, 'utf8'));
  process.stdout.write(`${renderReport(samples)}\n`);
}

/**
 * Maps a child's close code to the launcher's exit status.
 *
 * A signal-terminated child reports code === null; exiting 0 there would tell
 * callers and CI the run succeeded. Exit nonzero instead — portably, without
 * signal numbers or POSIX-only APIs (Windows emulates signal kills with a
 * nonzero exit code, which flows through the `code` branch).
 */
export function launcherExitCode(code: number | null): number {
  return code ?? 1;
}

function main(): void {
  let options: LauncherOptions;
  try {
    options = parseLauncherArgs(process.argv.slice(2), defaultRunDir());
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`,
    );
    process.exit(2);
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  warnIfRunDirOutsideMemprofile(options.runDir, memprofileRoot);
  try {
    ensureSecureDir(options.runDir);
    ensureSecureDir(join(options.runDir, 'requests'));
    ensureSecureDir(memprofileRoot);
    publishLatestPointer(memprofileRoot, options.runDir);
  } catch (error) {
    // Setup filesystem failures are actionable launcher errors: report and
    // exit nonzero without spawning the child.
    process.stderr.write(
      `memprofile: failed to prepare the run directory: ${message(error)}\n`,
    );
    process.exit(1);
  }
  announce(options);

  let child: ReturnType<typeof spawn>;
  try {
    const entry = join(repoRoot, 'packages/cli/index.ts');
    const probe = join(scriptDir, 'probe-preload.ts');
    const env = buildLauncherEnv(process.env, options, readPkgVersion());
    child = spawn(
      process.execPath,
      ['--preload', probe, entry, ...options.passthrough],
      { stdio: 'inherit', env, cwd: repoRoot },
    );
  } catch (error) {
    process.stderr.write(
      `memprofile: failed to start LLxprt: ${message(error)}\n`,
    );
    deleteLatestPointer(memprofileRoot, options.runDir);
    process.exit(1);
  }
  writeFileSync(join(options.runDir, 'pid'), String(child.pid ?? ''), {
    mode: FILE_MODE,
  });

  child.on('error', (error) => {
    process.stderr.write(
      `memprofile: failed to spawn: ${error.message}\n` +
        'memprofile: LLxprt did not start; removing the latest pointer so\n' +
        'requests are not queued into a dead run.\n',
    );
    deleteLatestPointer(memprofileRoot, options.runDir);
    process.exit(1);
  });
  child.on('close', (code) => {
    try {
      renderExitReport(options.runDir);
    } catch (error) {
      // The report must never replace the child's own exit status.
      process.stderr.write(
        `memprofile: failed to render the exit report: ${message(error)}\n`,
      );
    }
    tightenLatestPointer(memprofileRoot, options.runDir);
    process.exit(launcherExitCode(code));
  });
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
