#!/usr/bin/env node

/**
 * check-agents-api-surface.mjs
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
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseExportedNames,
  loadExpectedSurface,
  DENIED_INTERNAL_NAMES,
  API_SURFACE_REPORT_PATH,
} from '../packages/agents/src/api/apiSurfaceParser.mjs';

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

const tempDir = mkdtempSync(join(tmpdir(), 'agents-api-surface-'));
let tempDirCleaned = false;

function cleanupTempDir() {
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

function createTempTsConfig() {
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
      // @types/node. Explicitly point typeRoots at the repo's node_modules
      // so `types: ['node']` resolves correctly.
      typeRoots: [join(REPO_ROOT, 'node_modules', '@types')],
      // The source tsconfig.json sets baseUrl to the agents package dir so
      // its paths mappings resolve relative to packages/agents. Overriding
      // rootDir to REPO_ROOT shifts the root but does NOT re-anchor baseUrl,
      // which would make TypeScript fall back to the temp tsconfig's
      // directory and break the relative path mappings.
      baseUrl: AGENTS_PACKAGE_DIR,
    },
    include: [
      join(AGENTS_PACKAGE_DIR, 'index.ts'),
      `${AGENTS_PACKAGE_DIR}/src/**/*.ts`,
      `${REPO_ROOT}/packages/core/src/types/wasm.d.ts`,
    ],
    exclude: [
      `${REPO_ROOT}/node_modules`,
      `${REPO_ROOT}/**/dist/**`,
      `${AGENTS_PACKAGE_DIR}/**/*.test.ts`,
      `${AGENTS_PACKAGE_DIR}/**/*.spec.ts`,
      `${AGENTS_PACKAGE_DIR}/src/api/__tests__/fixtures/**`,
      `${REPO_ROOT}/packages/*/src/**/*.test.ts`,
      `${REPO_ROOT}/packages/*/src/**/*.spec.ts`,
    ],
  };
  const tempConfigPath = join(tempDir, 'tsconfig.api-surface.json');
  writeFileSync(tempConfigPath, JSON.stringify(tempConfig, null, 2));
  return tempConfigPath;
}

function describeTscSpawnError(err) {
  if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    return 'tsc exceeded the maxBuffer limit (ERR_CHILD_PROCESS_STDIO_MAXBUFFER). ' +
      'This indicates runaway output, not a normal build failure.';
  }
  if (err.code === 'ENOENT') {
    if (err.stderr) console.error(err.stderr);
    const npxName = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    return `Failed to spawn tsc (ENOENT): '${npxName}' not found. ` +
      'Ensure Node.js/npx is installed and on PATH.';
  }
  if (err.signal) {
    return `tsc process terminated by signal ${err.signal}; declaration build did not complete.`;
  }
  if (err.code && err.status === undefined) {
    return `tsc spawn failed with system error code '${err.code}'` +
      (err.errno ? ` (errno ${err.errno})` : '') +
      (err.syscall ? ` syscall '${err.syscall}'` : '') +
      (err.path ? ` on '${err.path}'` : '') +
      `: ${err.message}`;
  }
  return null;
}

function runTscBuild(tempConfigPath) {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    execFileSync(npxCmd, ['tsc', '-p', tempConfigPath], {
      stdio: 'pipe',
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    const spawnErrorMsg = describeTscSpawnError(err);
    if (spawnErrorMsg) throw new Error(spawnErrorMsg);

    const exitCode = err.status !== undefined ? err.status : 1;
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    throw new Error(
      `tsc exited with code ${exitCode} — declaration build failed; ` +
        'cannot determine API surface.',
    );
  }
}

function buildDeclarations() {
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

function main() {
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

try {
  main();
} catch (err) {
  console.error(
    `\nAgents API-surface guard FAILED: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
