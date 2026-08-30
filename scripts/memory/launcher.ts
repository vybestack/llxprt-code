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

import { spawn, type StdioOptions } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isSourceMemoryEntrypoint } from './entrypoint.ts';
import { resolveInstalledMemprofileRoot } from './runtime-paths.ts';
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

export const SOURCE_LAUNCHER_USAGE = `Usage: npm run mem:profile -- [options] -- [llxprt args...]

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

export const INSTALLED_LAUNCHER_USAGE = `Usage: llxprt --memprofile [options] [llxprt args...]

  --snapshots          arm heap snapshots (off by default; see guard below)
  --interval <ms>      sampling interval, default 15000 (max 86400000)
  --max-heap-mb <n>    snapshot guard, default ${DEFAULT_MAX_SNAPSHOT_HEAP_MB}
  --dir <path>         run directory override
  -h, --help           print this help
  --                   everything after this is passed to LLxprt unchanged

Snapshots are synchronous, block the target, and can consume substantially
more transient memory than the live heap. The guard refuses above
--max-heap-mb. Do not snapshot a process that has already blown out.

While a session runs:  llxprt memprofile request
                       llxprt memprofile request --heap
After a session:       llxprt memprofile report`;

export interface LauncherRuntime {
  readonly usage: string;
  readonly entryPath: string;
  readonly preloadPath: string;
  readonly cwd: string;
  readonly packageVersion: string;
  readonly memprofileRoot: string;
  readonly developmentEnvironment: boolean;
  readonly sourcePrivacyWarning: boolean;
}

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
  developmentEnvironment = true,
): NodeJS.ProcessEnv {
  const profiling = {
    CLI_VERSION: pkgVersion,
    LLXPRT_MEM_DIR: options.runDir,
    LLXPRT_MEM_INTERVAL_MS: String(options.intervalMs),
    LLXPRT_MEM_MAX_HEAP_MB: String(options.maxHeapMb),
    LLXPRT_MEM_SNAPSHOT: options.snapshots ? '1' : '0',
  };
  if (!developmentEnvironment) {
    return { ...base, ...profiling };
  }
  return {
    ...base,
    DEV: 'true',
    NODE_OPTIONS: prepareDevNodeOptions(
      base['NODE_OPTIONS'],
      devLocalStorageFile(),
    ),
    ...profiling,
  };
}

const sourceScriptDir = dirname(fileURLToPath(import.meta.url));
const sourceRepoRoot = join(sourceScriptDir, '..', '..');

function readPkgVersion(repoRoot: string): string {
  const parsed: unknown = JSON.parse(
    readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
  );
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    typeof parsed.version !== 'string'
  ) {
    throw new Error(
      `Invalid package version in ${join(repoRoot, 'package.json')}`,
    );
  }
  return parsed.version;
}

export function createSourceLauncherRuntime(): LauncherRuntime {
  return {
    usage: SOURCE_LAUNCHER_USAGE,
    entryPath: join(sourceRepoRoot, 'packages/cli/index.ts'),
    preloadPath: join(sourceScriptDir, 'probe-preload.ts'),
    cwd: sourceRepoRoot,
    packageVersion: readPkgVersion(sourceRepoRoot),
    memprofileRoot: join(sourceRepoRoot, MEMPROFILE_DIR_NAME),
    developmentEnvironment: true,
    sourcePrivacyWarning: true,
  };
}

export function createInstalledLauncherRuntime(
  entryUrl: string,
  packageVersion: string | undefined,
  cwd: string = process.cwd(),
  memprofileRoot: string = resolveInstalledMemprofileRoot(),
): LauncherRuntime {
  if (packageVersion === undefined || packageVersion.length === 0) {
    throw new Error('The installed memprofile launcher is missing CLI_VERSION');
  }
  const bundleDir = dirname(fileURLToPath(entryUrl));
  return {
    usage: INSTALLED_LAUNCHER_USAGE,
    entryPath: join(bundleDir, 'llxprt.js'),
    preloadPath: join(bundleDir, 'memprofile-preload.js'),
    cwd,
    packageVersion,
    memprofileRoot,
    developmentEnvironment: false,
    sourcePrivacyWarning: false,
  };
}

function defaultRunDir(memprofileRoot: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(memprofileRoot, stamp);
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
  sourcePrivacyWarning = true,
): boolean {
  const inside = runDir === memRoot || runDir.startsWith(memRoot + sep);
  if (!inside) {
    const locationWarning = sourcePrivacyWarning
      ? '  potentially credentials. .memprofile/ is git-ignored; this location\n' +
        '  is NOT, so an accidental "git add" can commit sensitive artifacts.\n' +
        '  Keep this path out of any repository or add it to .gitignore.\n\n'
      : '  potentially credentials and prior input. This override is outside\n' +
        '  LLxprt user data. Do not commit or upload profiling artifacts.\n\n';
    process.stdout.write(
      `memprofile: WARNING: run directory is outside ${memRoot}.\n` +
        '  Samples and heap snapshots contain full prompts, tool output, and\n' +
        locationWarning,
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

const CAPABILITY_FD_ENV = 'LLXPRT_CAPABILITY_FD';
const CAPABILITY_FD_NUMBER = 3;
const SIGNAL_BRIDGE_ENV = 'LLXPRT_INTERNAL_MEMPROFILE_SIGNAL_BRIDGE';
const SHARED_GROUP_SIGNALS: readonly NodeJS.Signals[] = [
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
];
const ISOLATED_GROUP_SIGNALS: readonly NodeJS.Signals[] = [
  ...SHARED_GROUP_SIGNALS,
  'SIGQUIT',
  'SIGTSTP',
  'SIGCONT',
  'SIGWINCH',
];

export interface LauncherSignalPolicy {
  readonly forwardedSignals: readonly NodeJS.Signals[];
  readonly ignoredSignals: readonly NodeJS.Signals[];
  readonly stopOnSuspend: boolean;
}

export function selectLauncherSignalPolicy(
  platform: NodeJS.Platform,
  installedSignalBridge: boolean,
): LauncherSignalPolicy {
  if (!installedSignalBridge) {
    return {
      forwardedSignals: SHARED_GROUP_SIGNALS,
      ignoredSignals: [],
      stopOnSuspend: false,
    };
  }
  if (platform === 'win32') {
    return {
      forwardedSignals: ['SIGTERM', 'SIGHUP'],
      ignoredSignals: ['SIGINT'],
      stopOnSuspend: false,
    };
  }
  return {
    forwardedSignals: ISOLATED_GROUP_SIGNALS,
    ignoredSignals: [],
    stopOnSuspend: true,
  };
}

function childStdio(): {
  readonly stdio: StdioOptions;
  readonly forwardsCapability: boolean;
} {
  const marker = process.env[CAPABILITY_FD_ENV];
  if (marker === undefined || marker === '') {
    return { stdio: 'inherit', forwardsCapability: false };
  }
  if (marker !== String(CAPABILITY_FD_NUMBER)) {
    throw new Error(
      `${CAPABILITY_FD_ENV} must be ${CAPABILITY_FD_NUMBER}, received ${marker}`,
    );
  }
  return {
    stdio: ['inherit', 'inherit', 'inherit', CAPABILITY_FD_NUMBER],
    forwardsCapability: true,
  };
}

function removeSignalHandlers(
  signals: readonly NodeJS.Signals[],
  forward: (signal: NodeJS.Signals) => void,
): void {
  for (const signal of signals) {
    process.off(signal, forward);
  }
}

function superviseChild(
  child: ReturnType<typeof spawn>,
  options: LauncherOptions,
  runtime: LauncherRuntime,
  signalPolicy: LauncherSignalPolicy,
): void {
  const forward = (signal: NodeJS.Signals): void => {
    let delivered = false;
    try {
      delivered = child.kill(signal);
    } catch {
      // The child may have exited between signal delivery and forwarding.
    }
    if (signalPolicy.stopOnSuspend && signal === 'SIGTSTP' && delivered) {
      process.kill(process.pid, 'SIGSTOP');
    }
  };
  const ignore = (): void => undefined;
  for (const signal of signalPolicy.forwardedSignals) {
    process.on(signal, forward);
  }
  for (const signal of signalPolicy.ignoredSignals) {
    process.on(signal, ignore);
  }

  child.on('error', (error) => {
    removeSignalHandlers(signalPolicy.forwardedSignals, forward);
    removeSignalHandlers(signalPolicy.ignoredSignals, ignore);
    process.stderr.write(
      `memprofile: failed to spawn: ${error.message}\n` +
        'memprofile: LLxprt did not start; removing the latest pointer so\n' +
        'requests are not queued into a dead run.\n',
    );
    deleteLatestPointer(runtime.memprofileRoot, options.runDir);
    process.exit(1);
  });
  child.on('close', (code, signal) => {
    removeSignalHandlers(signalPolicy.forwardedSignals, forward);
    removeSignalHandlers(signalPolicy.ignoredSignals, ignore);
    try {
      renderExitReport(options.runDir);
    } catch (error) {
      process.stderr.write(
        `memprofile: failed to render the exit report: ${message(error)}\n`,
      );
    }
    tightenLatestPointer(runtime.memprofileRoot, options.runDir);
    if (signal !== null) {
      process.kill(process.pid, signal);
    } else {
      process.exit(launcherExitCode(code));
    }
  });
}

function consumeInstalledSignalBridge(): boolean {
  const installedSignalBridge = process.env[SIGNAL_BRIDGE_ENV] === '1';
  delete process.env[SIGNAL_BRIDGE_ENV];
  return installedSignalBridge;
}

export function runLauncher(runtime: LauncherRuntime): void {
  const installedSignalBridge = consumeInstalledSignalBridge();
  const signalPolicy = selectLauncherSignalPolicy(
    process.platform,
    installedSignalBridge,
  );

  let options: LauncherOptions;
  try {
    options = parseLauncherArgs(
      process.argv.slice(2),
      defaultRunDir(runtime.memprofileRoot),
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n${runtime.usage}\n`,
    );
    process.exit(2);
  }
  if (options.help) {
    process.stdout.write(`${runtime.usage}\n`);
    process.exit(0);
  }
  warnIfRunDirOutsideMemprofile(
    options.runDir,
    runtime.memprofileRoot,
    runtime.sourcePrivacyWarning,
  );
  try {
    ensureSecureDir(options.runDir);
    ensureSecureDir(join(options.runDir, 'requests'));
    ensureSecureDir(runtime.memprofileRoot);
    publishLatestPointer(runtime.memprofileRoot, options.runDir);
  } catch (error) {
    process.stderr.write(
      `memprofile: failed to prepare the run directory: ${message(error)}\n`,
    );
    process.exit(1);
  }
  announce(options);

  let child: ReturnType<typeof spawn>;
  try {
    const env = buildLauncherEnv(
      process.env,
      options,
      runtime.packageVersion,
      runtime.developmentEnvironment,
    );
    const { stdio, forwardsCapability } = childStdio();
    child = spawn(
      process.execPath,
      [
        '--preload',
        runtime.preloadPath,
        runtime.entryPath,
        ...options.passthrough,
      ],
      { stdio, env, cwd: runtime.cwd },
    );
    superviseChild(child, options, runtime, signalPolicy);
    if (forwardsCapability) {
      closeSync(CAPABILITY_FD_NUMBER);
      delete process.env[CAPABILITY_FD_ENV];
    }
  } catch (error) {
    process.stderr.write(
      `memprofile: failed to start LLxprt: ${message(error)}\n`,
    );
    deleteLatestPointer(runtime.memprofileRoot, options.runDir);
    process.exit(1);
  }
  try {
    writeFileSync(join(options.runDir, 'pid'), String(child.pid ?? ''), {
      mode: FILE_MODE,
    });
  } catch (error) {
    process.stderr.write(
      `memprofile: could not record the child pid: ${message(error)}\n`,
    );
  }
}

if (isSourceMemoryEntrypoint(import.meta.url)) {
  runLauncher(createSourceLauncherRuntime());
}
