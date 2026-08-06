#!/usr/bin/env node

/**
 * check-agents-api-surface.ts
 *
 * Standalone API-surface lint guard for the agents package public root.
 *
 * Builds the agents package declarations into an ISOLATED TEMP directory via a
 * temp tsconfig (mechanism B1a — extends the SOURCE-path
 * packages/agents/tsconfig.json, rootDir set to the REPO ROOT so dependency
 * source resolves without TS6059), parses the emitted declaration surface
 * (recursively resolving `export *` re-exports with .js-to-.d.ts specifier
 * normalization), and writes a JSON surface report to the already-gitignored
 * cache path node_modules/.cache/agents-api-surface/report.json.
 *
 * The script enforces two invariants:
 *   1. Denied internal names (AgentClient, CoreToolScheduler, AgenticLoop)
 *      must never appear on the public root surface.
 *   2. The parsed surface must match the checked-in snapshot
 *      (expected-root-surface.json) with no additions or removals.
 * To update the snapshot intentionally, edit expected-root-surface.json.
 *
 * Mechanism: B1a (preflight-confirmed — see
 * project-plans/issue2285/analysis/api-guard-mechanism.md section 1 and
 * preflight-results.md section 7). Source-path tsconfig resolution means no
 * dependency dist/ is required, so this guard is clean-CI safe in the
 * pre-build lint job.
 *
 * The tsc declaration-build timeout defaults to DEFAULT_BUILD_TIMEOUT_MS
 * (300000ms / 5 min). Override via the LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS
 * environment variable for slower CI runners; non-positive or non-finite
 * values fall back to the default (fail-closed).
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isRecord } from './utils/error-guards.ts';

import {
  parseExportedNames,
  loadExpectedSurface,
  DENIED_INTERNAL_NAMES,
  API_SURFACE_REPORT_PATH,
} from '../packages/agents/src/api/apiSurfaceParser.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const AGENTS_PACKAGE_DIR = join(REPO_ROOT, 'packages', 'agents');
const SOURCE_TSCONFIG = join(AGENTS_PACKAGE_DIR, 'tsconfig.json');
const SNAPSHOT_PATH = join(
  AGENTS_PACKAGE_DIR,
  'src',
  'api',
  '__tests__',
  'expected-root-surface.json',
);
const TYPE_ROOT_CANDIDATES = [
  join(AGENTS_PACKAGE_DIR, 'node_modules', '@types'),
  join(REPO_ROOT, 'node_modules', '@types'),
];

/**
 * Default tsc declaration-build timeout. Observed cold-build time in isolation
 * is ~5s, but the full monorepo test gate (`npm run test` running every
 * workspace's vitest suite) can starve a trailing workspace of CPU so badly
 * that this pretest's isolated `tsc` build takes well over a minute. 120s was
 * too tight for that tail latency and produced spurious "timed out" gate
 * failures that masked the real (passing) API-surface result.
 *
 * The default is deliberately generous (5 minutes): the build either completes
 * or, on a genuine hang, the fail-closed path below still surfaces the timeout
 * as a hard failure. Override via `LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS` for
 * slower CI runners or local constrained machines.
 */
export const DEFAULT_BUILD_TIMEOUT_MS = 300_000;

/**
 * Resolve the tsc build timeout, honoring an environment override. A
 * non-positive or non-finite value falls back to the default so a malformed
 * override can never silently disable the fail-closed timeout.
 *
 * Exported so tests can verify the resolution contract without spawning tsc.
 */
export function resolveBuildTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.LLXPRT_API_SURFACE_BUILD_TIMEOUT_MS;
  if (raw === undefined || raw === '') {
    return DEFAULT_BUILD_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BUILD_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

const tempDir = mkdtempSync(join(tmpdir(), 'agents-api-surface-'));
let tempDirCleaned = false;

function getTypeRoots(): string[] {
  const seen = new Set();
  const existingTypeRoots = TYPE_ROOT_CANDIDATES.filter((typeRoot) => {
    if (seen.has(typeRoot)) {
      return false;
    }
    seen.add(typeRoot);
    return existsSync(typeRoot);
  });

  return existingTypeRoots.length > 0
    ? existingTypeRoots
    : [join(REPO_ROOT, 'node_modules', '@types')];
}

function normalizePathForTsConfig(p: string): string {
  return p.replace(/\\/g, '/');
}

function cleanupTempDir(): void {
  if (tempDirCleaned) {
    return;
  }
  tempDirCleaned = true;
  rmSync(tempDir, { recursive: true, force: true });
}

// process.on('exit') fires only on normal termination, not on SIGINT/SIGTERM.
// Register explicit signal handlers so a Ctrl-C or kill during the (slow)
// declaration build does not leak the temp dir on disk.
process.on('exit', cleanupTempDir);
process.on('SIGINT', () => {
  cleanupTempDir();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanupTempDir();
  process.exit(143);
});

function createTempTsConfig(): string {
  const repoRootGlob = normalizePathForTsConfig(REPO_ROOT);
  const agentsPackageGlob = normalizePathForTsConfig(AGENTS_PACKAGE_DIR);
  const tempConfig = {
    extends: SOURCE_TSCONFIG,
    compilerOptions: {
      rootDir: REPO_ROOT,
      outDir: tempDir,
      declaration: true,
      noEmit: false,
      noEmitOnError: true,
      composite: false,
      incremental: false,
      skipLibCheck: true,
      types: ['node'],
      // The temp config lives in a temp dir, so TypeScript's default
      // typeRoots resolution (relative to the config file) cannot find
      // @types/node. Mirror package-first, repo-root fallback lookup so
      // `types: ['node']` resolves correctly across workspace install shapes.
      typeRoots: getTypeRoots(),
      // The source tsconfig.json sets baseUrl to the agents package dir so
      // its paths mappings resolve relative to packages/agents. Overriding
      // rootDir to REPO_ROOT shifts the root but does NOT re-anchor baseUrl,
      // which would make TypeScript fall back to the temp tsconfig's
      // directory and break the relative path mappings.
      baseUrl: AGENTS_PACKAGE_DIR,
    },
    // `files` entries are not filtered by `exclude`, which is why Bun's
    // declarations go here rather than in `include`: they live under
    // node_modules, and `exclude` deliberately drops that whole tree.
    //
    // This config replaces (rather than extends) the source tsconfig's file
    // list, so the `bun:test` declarations the source config pulls in have to
    // be re-added. The agents test helpers import the workspace's test API
    // facade, which is typed against `bun:test`; without this the declaration
    // build cannot resolve that module and the surface cannot be determined.
    files: [`${REPO_ROOT}/node_modules/bun-types/test.d.ts`].map(
      normalizePathForTsConfig,
    ),
    include: [
      normalizePathForTsConfig(join(AGENTS_PACKAGE_DIR, 'index.ts')),
      `${agentsPackageGlob}/src/**/*.ts`,
      `${repoRootGlob}/packages/core/src/types/wasm.d.ts`,
    ],
    exclude: [
      `${repoRootGlob}/node_modules`,
      `${repoRootGlob}/**/dist/**`,
      `${agentsPackageGlob}/**/*.test.ts`,
      `${agentsPackageGlob}/**/*.spec.ts`,
      `${agentsPackageGlob}/src/api/__tests__/fixtures/**`,
      `${repoRootGlob}/packages/*/src/**/*.test.ts`,
      `${repoRootGlob}/packages/*/src/**/*.spec.ts`,
    ],
  };
  const tempConfigPath = join(tempDir, 'tsconfig.api-surface.json');
  writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2));
  return tempConfigPath;
}

/**
 * Classify a tsc spawn error into a human-readable message. Returns null for
 * ordinary non-zero exits (which `runTscBuild` reports separately).
 *
 * Exported for unit testing the classification contract directly, without
 * needing to spawn a real tsc process. `timeoutMs` is threaded in so the
 * timeout message reflects the actually-configured budget rather than a stale
 * hardcoded value.
 */
export function describeTscSpawnError(
  err: unknown,
  timeoutMs = DEFAULT_BUILD_TIMEOUT_MS,
): string | null {
  if (!isRecord(err)) {
    return null;
  }
  const e = err;
  if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    if (e.stdout) console.log(e.stdout);
    if (e.stderr) console.error(e.stderr);
    return (
      'tsc exceeded the maxBuffer limit (ERR_CHILD_PROCESS_STDIO_MAXBUFFER). ' +
      'This indicates runaway output, not a normal build failure.'
    );
  }
  if (e.code === 'ENOENT') {
    if (e.stderr) console.error(e.stderr);
    return (
      `Failed to spawn TypeScript with Node at '${process.execPath}' (ENOENT). ` +
      'Ensure the current Node.js executable still exists and is runnable.'
    );
  }
  if (e.signal === 'SIGTERM' && e.status == null) {
    if (e.stdout) console.log(e.stdout);
    if (e.stderr) console.error(e.stderr);
    return `tsc declaration build timed out after ${timeoutMs}ms; API-surface check did not complete.`;
  }
  if (e.signal) {
    return `tsc process terminated by signal ${e.signal}; declaration build did not complete.`;
  }
  if (e.code && e.status == null) {
    const message = String(e.message);
    return (
      `tsc spawn failed with system error code '${e.code}'` +
      (e.errno ? ` (errno ${e.errno})` : '') +
      (e.syscall ? ` syscall '${e.syscall}'` : '') +
      (e.path ? ` on '${e.path}'` : '') +
      `: ${message}`
    );
  }
  return null;
}

function resolveTypeScriptCli(): string {
  try {
    return createRequire(import.meta.url).resolve('typescript/bin/tsc');
  } catch (err) {
    const detail = err instanceof Error ? `: ${err.message}` : '';
    throw new Error(
      'Could not resolve the repository TypeScript CLI. Run "npm install" to install the local typescript dependency' +
        detail,
    );
  }
}

function runTscBuild(tempConfigPath: string): void {
  const typeScriptCli = resolveTypeScriptCli();
  const timeoutMs = resolveBuildTimeoutMs();
  try {
    execFileSync(process.execPath, [typeScriptCli, '-p', tempConfigPath], {
      stdio: 'pipe',
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: timeoutMs,
    });
  } catch (err: unknown) {
    const spawnErrorMsg = describeTscSpawnError(err, timeoutMs);
    if (spawnErrorMsg) throw new Error(spawnErrorMsg);
    if (!isRecord(err)) {
      throw err;
    }
    const e = err;
    const exitCode = e.status !== undefined ? e.status : 1;
    if (e.stdout) console.log(e.stdout);
    if (e.stderr) console.error(e.stderr);
    throw new Error(
      `tsc exited with code ${exitCode} — declaration build failed; ` +
        'cannot determine API surface.',
    );
  }
}

function buildDeclarations(): { rootDeclPath: string } {
  const tempConfigPath = createTempTsConfig();
  runTscBuild(tempConfigPath);

  const rootDeclPath = join(tempDir, 'packages', 'agents', 'index.d.ts');
  if (!existsSync(rootDeclPath)) {
    throw new Error(
      `agents index.d.ts not emitted at ${rootDeclPath}. ` +
        'Declaration emission failed — the temp build did not produce the root barrel declaration.',
    );
  }
  return { rootDeclPath };
}

function main(): void {
  console.log(
    'Building agents declarations via isolated temp tsconfig (B1a)...',
  );
  const { rootDeclPath } = buildDeclarations();
  console.log('Declaration emission complete (tsc exit 0).');

  console.log(`Parsing declaration surface from ${rootDeclPath}...`);
  const exportedNames = parseExportedNames(rootDeclPath);
  const sortedNames = [...exportedNames].sort();
  console.log(
    `Parsed ${sortedNames.length} exported names (recursive export-star resolution).`,
  );

  console.log(`Writing surface report to ${API_SURFACE_REPORT_PATH}...`);
  mkdirSync(dirname(API_SURFACE_REPORT_PATH), { recursive: true });
  writeFileSync(
    API_SURFACE_REPORT_PATH,
    JSON.stringify(sortedNames, null, 2) + '\n',
    'utf8',
  );

  let failed = false;

  // Hard guard: denied internal names must never appear on the public root
  // surface.
  const leaked = sortedNames.filter((name) => DENIED_INTERNAL_NAMES.has(name));
  if (leaked.length > 0) {
    failed = true;
    console.error(
      `FAIL: denied internal names leaked onto public root surface (${leaked.length}):`,
    );
    for (const name of leaked) {
      console.error(`  ! ${name}`);
    }
  }

  console.log(`Comparing against snapshot ${SNAPSHOT_PATH}...`);
  const expected = loadExpectedSurface(SNAPSHOT_PATH);
  const actual = new Set(sortedNames);
  const added = [...actual].filter((name) => !expected.has(name));
  const removed = [...expected].filter((name) => !actual.has(name));

  if (added.length > 0) {
    failed = true;
    console.error(
      `FAIL: unexpected new root exports (${added.length}); update expected-root-surface.json intentionally or remove the exports:`,
    );
    for (const name of added.sort()) {
      console.error(`  + ${name}`);
    }
  }
  if (removed.length > 0) {
    failed = true;
    console.error(
      `FAIL: previously-exported root names now missing (${removed.length}); update expected-root-surface.json intentionally:`,
    );
    for (const name of removed.sort()) {
      console.error(`  - ${name}`);
    }
  }

  if (failed) {
    console.error('\nAgents API-surface guard FAILED (snapshot drift).');
    process.exit(1);
  }

  console.log('PASS: agents API-surface report matches expected snapshot.');
  process.exit(0);
}

// Only run the guard when executed directly (bun scripts/check-...ts), not
// when imported (e.g. by unit tests of resolveBuildTimeoutMs /
// describeTscSpawnError). This is the standard ESM entry-point guard.
const isDirectEntry =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectEntry) {
  try {
    main();
  } catch (err) {
    console.error(
      `\nAgents API-surface guard FAILED: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}
