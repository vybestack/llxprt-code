/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun-backed root test orchestration script.
 *
 * Mirrors `npm run test --workspaces --if-present` (plus `test:scripts`)
 * using Bun as the orchestration runtime. This is the single canonical entry
 * point for the complete suite.
 *
 * Why this exists (issue #2463):
 *   Bun's `bun run <script>` does not invoke npm lifecycle hooks
 *   (pretest/posttest) the way `npm run <script>` does, so the agents
 *   API-surface guard would be silently skipped. This script runs pretest
 *   hooks explicitly before each workspace's test phase.
 *
 *   Each workspace's `test` script decides its own runner. Migrated
 *   workspaces invoke `scripts/run_bun_tests.ts`, which executes Bun's native
 *   test runner with one isolated process per file; the remaining workspaces
 *   still run under Vitest while their migration completes (issue #2578).
 *
 * Usage:
 *   bun scripts/test.ts                    # run all workspace + script tests
 *   bun scripts/test.ts --workspace core   # run only the core workspace
 *   bun scripts/test.ts --shard cli        # run the "cli" CI shard (-s works too)
 *   bun scripts/test.ts --skip-scripts     # skip script harness tests
 *   bun scripts/test.ts --skip-pretest     # skip pretest hooks
 *   bun scripts/test.ts --continue-on-error # don't stop on first failure
 *
 * Or via package.json:
 *   npm run test:bun
 *   bun run test:bun
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { propertyValue } from './utils/error-guards.ts';
import {
  TEST_SHARDS,
  SCRIPTS_SHARD_NAME,
  expandShard,
  findShard,
} from './test-shards.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceInfo {
  name: string;
  relativePath: string;
  absolutePath: string;
  hasTest: boolean;
  hasPretest: boolean;
  testScript: string | undefined;
  pretestScript: string | undefined;
}

export interface TestOptions {
  workspaceFilter: string | undefined;
  /** CI shard name (e.g. "cli", "scripts"). Expands to its workspaces. */
  shardFilter: string | undefined;
  skipScripts: boolean;
  skipPretest: boolean;
  continueOnError: boolean;
}

export type CommandRunner = (
  command: string,
  cwd: string,
  env?: NodeJS.ProcessEnv,
) => { success: boolean; exitCode: number };

export interface TestPhaseResult {
  workspace: string;
  phase: 'pretest' | 'test' | 'scripts';
  success: boolean;
  exitCode: number;
  durationMs: number;
}

export interface TestSummary {
  results: TestPhaseResult[];
  totalWorkspaces: number;
  passed: number;
  failed: number;
  skipped: number;
  skippedWorkspaces: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Workspace discovery
// ---------------------------------------------------------------------------

interface PackageJson {
  name?: string;
  workspaces?: string[];
  scripts?: Record<string, string>;
}

function readPackageJson(filePath: string): PackageJson {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Failed to read package.json at ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    return JSON.parse(raw) as PackageJson;
  } catch (error) {
    throw new Error(
      `Failed to parse package.json at ${filePath} (invalid JSON): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function discoverWorkspaces(rootDir: string): WorkspaceInfo[] {
  const rootPkg = readPackageJson(join(rootDir, 'package.json'));
  const workspaceGlobs = rootPkg.workspaces ?? [];

  const results: WorkspaceInfo[] = [];

  for (const glob of workspaceGlobs) {
    const relativePath = glob;
    const absolutePath = resolve(rootDir, relativePath);
    const pkgJsonPath = join(absolutePath, 'package.json');

    if (!existsSync(pkgJsonPath)) {
      continue;
    }

    const pkg = readPackageJson(pkgJsonPath);
    const scripts = pkg.scripts ?? {};

    results.push({
      name: pkg.name ?? relativePath,
      relativePath,
      absolutePath,
      hasTest: 'test' in scripts,
      hasPretest: 'pretest' in scripts,
      testScript: scripts.test,
      pretestScript: scripts.pretest,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv: readonly string[]): TestOptions {
  const options: TestOptions = {
    workspaceFilter: undefined,
    shardFilter: undefined,
    skipScripts: false,
    skipPretest: false,
    continueOnError: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--workspace' || arg === '-w') {
      i++;
      if (i < argv.length) {
        options.workspaceFilter = argv[i];
      } else {
        throw new Error('--workspace requires a value');
      }
    } else if (arg === '--shard' || arg === '-s') {
      i++;
      if (i < argv.length) {
        options.shardFilter = argv[i];
      } else {
        throw new Error('--shard requires a value');
      }
    } else if (arg === '--skip-scripts') {
      options.skipScripts = true;
    } else if (arg === '--skip-pretest') {
      options.skipPretest = true;
    } else if (arg === '--continue-on-error' || arg === '-c') {
      options.continueOnError = true;
    } else {
      console.warn(`Warning: unknown argument "${arg}" — ignoring`);
    }

    i++;
  }

  return options;
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

function extractExitCode(error: unknown): number {
  return (propertyValue(error, 'status') as number | undefined) ?? 1;
}

// Mirrors `npm run` semantics: commands from package.json scripts are
// executed through a shell. This relies on repository trust — package.json
// files are part of the trusted source tree, just as they are for npm.
export const defaultRunner: CommandRunner = (
  command,
  cwd,
  env = process.env,
) => {
  try {
    execSync(command, { cwd, stdio: 'inherit', env });
    return { success: true, exitCode: 0 };
  } catch (error) {
    return { success: false, exitCode: extractExitCode(error) };
  }
};

function createRunnerWithPATH(rootDir: string): CommandRunner {
  const nodeModulesBin = join(rootDir, 'node_modules', '.bin');
  const existingPath = process.env.PATH;
  // Avoid trailing delimiter when PATH is unset (trailing ':' adds CWD on Unix)
  const pathEnv = existingPath
    ? `${nodeModulesBin}${delimiter}${existingPath}`
    : nodeModulesBin;

  return (command, cwd, env = process.env) =>
    defaultRunner(command, cwd, { ...env, PATH: pathEnv });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

// The release-install smoke test (issue #2603) takes ~175–195s because it
// packs a CLI tarball and runs three npm installs, far beyond the budget the
// rest of the script harness needs. It therefore lives in its own Bun-native
// root with a much larger timeout (issue #2780).
/**
 * Bun-native roots owned by the scripts shard, in execution order.
 *
 * These belong to no workspace, so nothing else would run them. Exported as
 * the single source of truth: `scripts/tests/bun-manifest-root-ownership.bun.test.ts`
 * reads this list to prove every manifest root has exactly one executor, and
 * the root `test:scripts` script delegates here rather than restating it.
 */
export const SCRIPTS_SHARD_ROOTS: readonly string[] = [
  'scripts-tests',
  'scripts-tests-slow',
  'test-setup',
];

export function scriptsRootCommand(root: string): string {
  return `bun scripts/run_bun_tests.ts --root ${root}`;
}

const SCRIPTS_TEST_DIRECTORY = 'scripts/tests';

function matchesFilter(workspace: WorkspaceInfo, filter: string): boolean {
  if (workspace.relativePath === filter || workspace.name === filter) {
    return true;
  }

  const lastSegment = workspace.relativePath.split('/').pop() ?? '';
  if (lastSegment === filter) {
    return true;
  }

  const nameLastSegment = workspace.name.split('/').pop() ?? workspace.name;
  if (nameLastSegment === filter) {
    return true;
  }

  return false;
}

function runPhase(
  workspaceName: string,
  phase: 'pretest' | 'test' | 'scripts',
  command: string,
  cwd: string,
  runner: CommandRunner,
): TestPhaseResult {
  const start = Date.now();
  let result: { success: boolean; exitCode: number };
  try {
    result = runner(command, cwd);
  } catch (error) {
    result = { success: false, exitCode: extractExitCode(error) };
  }
  const durationMs = Date.now() - start;

  return {
    workspace: workspaceName,
    phase,
    success: result.success,
    exitCode: result.exitCode,
    durationMs,
  };
}

/**
 * Resolves the effective workspace set and whether the script harness should
 * run, based on the shard/workspace filter options.
 *
 * - If `shardFilter` is set, it takes precedence over `workspaceFilter`. The
 *   scripts shard runs no workspaces and runs only the script harness; any
 *   other shard expands to its workspace ids and does NOT run the script
 *   harness (that is the scripts shard's job).
 * - Otherwise, if `workspaceFilter` is set, it is applied as before and the
 *   script harness runs (preserving the legacy `--workspace` behavior).
 * - Otherwise (no filter), all workspaces and the script harness run.
 *
 * Throws if the shard name is unknown (delegating to `expandShard`) so a typo
 * cannot silently run nothing.
 */
function resolveShardOrFilter(
  options: TestOptions,
  allWorkspaces: WorkspaceInfo[],
): { workspaces: WorkspaceInfo[]; runScriptsPhase: boolean } {
  const { shardFilter, workspaceFilter } = options;

  if (shardFilter !== undefined) {
    // Validate the shard exists against the canonical map.
    if (!findShard(TEST_SHARDS, shardFilter)) {
      throw new Error(
        `Unknown shard "${shardFilter}". Known shards: ${TEST_SHARDS.map((s) => s.name).join(', ')}.`,
      );
    }
    if (shardFilter === SCRIPTS_SHARD_NAME) {
      return { workspaces: [], runScriptsPhase: true };
    }
    const ids = expandShard(TEST_SHARDS, shardFilter);
    const matched = allWorkspaces.filter((ws) =>
      ids.some((id) => matchesFilter(ws, id)),
    );
    return { workspaces: matched, runScriptsPhase: false };
  }

  const workspaces = workspaceFilter
    ? allWorkspaces.filter((ws) => matchesFilter(ws, workspaceFilter))
    : allWorkspaces;
  return { workspaces, runScriptsPhase: true };
}

export function orchestrateTests(
  rootDir: string,
  options: TestOptions,
  runner: CommandRunner = createRunnerWithPATH(rootDir),
): TestSummary {
  const results: TestPhaseResult[] = [];
  const startTime = Date.now();

  const allWorkspaces = discoverWorkspaces(rootDir);

  // Resolve the effective workspace set and whether scripts should run.
  // A shard filter overrides the loose --workspace filter: it expands to the
  // shard's workspaces and ensures the script harness only runs in the
  // dedicated scripts shard (issue #2707).
  const resolved = resolveShardOrFilter(options, allWorkspaces);
  const workspaces = resolved.workspaces;
  // Scripts run only when: no shard is selected (full/filtered local run), or
  // the scripts shard is explicitly selected. Individual workspace shards do
  // not also run the full script harness — that is the scripts shard's job.
  const runScriptsPhase = resolved.runScriptsPhase;

  const failedWorkspaces = new Set<string>();
  const skippedWorkspaces: string[] = [];

  for (const workspace of workspaces) {
    if (failedWorkspaces.size > 0) {
      // A prior workspace failed in fail-fast mode; record this workspace
      // as skipped so it appears in the summary output.
      skippedWorkspaces.push(workspace.name);
      continue;
    }

    const shouldRunPretest = workspace.hasPretest && !options.skipPretest;
    const pretestPassed = runPretestPhase(
      workspace,
      shouldRunPretest,
      runner,
      results,
    );

    const skipTest = shouldRunPretest && !pretestPassed;
    const shouldRunTest = workspace.hasTest && !skipTest;

    if (skipTest && !options.continueOnError) {
      // Pretest failed in fail-fast mode: the workspace has failed
      // (recorded via its pretest TestPhaseResult), not skipped.
      failedWorkspaces.add(workspace.name);
    }

    if (shouldRunTest) {
      const testResult = runPhase(
        workspace.name,
        'test',
        workspace.testScript!,
        workspace.absolutePath,
        runner,
      );
      results.push(testResult);

      if (!testResult.success && !options.continueOnError) {
        failedWorkspaces.add(workspace.name);
      }
    } else if (!shouldRunPretest) {
      // Workspace has neither a test nor a pretest script — nothing to run.
      // Record it as skipped so passed + failed + skipped stays consistent
      // with totalWorkspaces.
      skippedWorkspaces.push(workspace.name);
    }
  }

  // Skip script tests if any workspace phase failed, regardless of
  // continue-on-error mode. Checking results (not failedWorkspaces)
  // catches failures in both fail-fast and continue-on-error modes.
  const anyPhaseFailed = results.some((r) => !r.success);
  if (!anyPhaseFailed && runScriptsPhase) {
    runScriptTests(rootDir, options, runner, results);
  }

  return buildSummary(
    results,
    workspaces.length,
    Date.now() - startTime,
    skippedWorkspaces,
  );
}

function runPretestPhase(
  workspace: WorkspaceInfo,
  shouldRun: boolean,
  runner: CommandRunner,
  results: TestPhaseResult[],
): boolean {
  if (!shouldRun) {
    return true;
  }
  const pretestResult = runPhase(
    workspace.name,
    'pretest',
    workspace.pretestScript!,
    workspace.absolutePath,
    runner,
  );
  results.push(pretestResult);
  return pretestResult.success;
}

function runScriptTests(
  rootDir: string,
  options: TestOptions,
  runner: CommandRunner,
  results: TestPhaseResult[],
): void {
  if (options.skipScripts) {
    return;
  }
  if (!existsSync(join(rootDir, SCRIPTS_TEST_DIRECTORY))) {
    return;
  }
  // Each root runs as its own invocation so a root with a much larger budget
  // (the release-install smoke, issue #2780) cannot weaken the timeout that
  // catches hangs in the rest of the harness. Fail-fast between roots.
  for (const root of SCRIPTS_SHARD_ROOTS) {
    const result = runPhase(
      'scripts',
      'scripts',
      scriptsRootCommand(root),
      rootDir,
      runner,
    );
    results.push(result);
    if (!result.success) {
      return;
    }
  }
}

function buildSummary(
  results: TestPhaseResult[],
  totalWorkspaces: number,
  durationMs: number,
  skippedWorkspaces: string[],
): TestSummary {
  // Compute workspace-level outcomes so the summary counts are consistent
  // with totalWorkspaces. Each workspace can produce multiple phase results
  // (pretest + test); a workspace passes only if ALL its phases pass.
  const workspaceOutcomes = new Map<string, boolean>();
  for (const result of results) {
    if (result.phase === 'scripts') {
      continue;
    }
    const current = workspaceOutcomes.get(result.workspace);
    workspaceOutcomes.set(
      result.workspace,
      (current ?? true) && result.success,
    );
  }

  let passed = 0;
  let failed = 0;
  for (const success of workspaceOutcomes.values()) {
    if (success) {
      passed++;
    } else {
      failed++;
    }
  }

  return {
    results,
    totalWorkspaces,
    passed,
    failed,
    skipped: skippedWorkspaces.length,
    skippedWorkspaces,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Summary formatting
// ---------------------------------------------------------------------------

export function formatSummary(summary: TestSummary): string {
  const lines: string[] = [];
  const durationLabel = formatDuration(summary.durationMs);

  lines.push('');
  lines.push('─────────────────────────────────────────────');
  lines.push('  Test Orchestration Summary');
  lines.push('─────────────────────────────────────────────');

  for (const result of summary.results) {
    const status = result.success ? 'PASS' : 'FAIL';
    const duration = formatDuration(result.durationMs);
    const phaseLabel = result.phase.padEnd(8);
    lines.push(
      `  ${status}  ${phaseLabel}  ${result.workspace}  (${duration})`,
    );
  }

  if (summary.skippedWorkspaces.length > 0) {
    lines.push('  Skipped:');
    for (const name of summary.skippedWorkspaces) {
      lines.push(`    - ${name}`);
    }
  }

  lines.push('─────────────────────────────────────────────');
  lines.push(
    `  Workspaces: ${summary.totalWorkspaces}  ` +
      `Passed: ${summary.passed}  Failed: ${summary.failed}  ` +
      `Skipped: ${summary.skipped}  ` +
      `Duration: ${durationLabel}`,
  );

  if (summary.failed > 0) {
    lines.push('  Result: FAILED');
  } else {
    lines.push('  Result: PASSED');
  }

  lines.push('─────────────────────────────────────────────');
  lines.push('');

  return lines.join('\n');
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function main(): void {
  try {
    const rootDir = resolve(__dirname, '..');
    const options = parseArgs(process.argv.slice(2));

    console.log('Running Bun-backed test orchestration...');
    if (options.shardFilter) {
      console.log(`  Shard: ${options.shardFilter}`);
      if (options.workspaceFilter) {
        console.log(
          `  Note: --workspace "${options.workspaceFilter}" ignored (--shard takes precedence)`,
        );
      }
    } else if (options.workspaceFilter) {
      console.log(`  Filter: ${options.workspaceFilter}`);
    }
    if (options.skipScripts) {
      console.log('  Skipping script harness tests');
    }
    if (options.skipPretest) {
      console.log('  Skipping pretest hooks');
    }
    console.log('');

    const summary = orchestrateTests(rootDir, options);
    console.log(formatSummary(summary));

    // Fail on any failed phase, including the script harness. The summary's
    // `failed` count only tallies workspace outcomes (pretest/test); the
    // scripts phase is tracked separately in `results`, so a scripts-only
    // failure (e.g. the dedicated scripts shard) must be checked here.
    // `anyPhaseFailed` already covers `summary.failed > 0` (a failed
    // workspace produces a failed phase result), so it is the sole check.
    const anyPhaseFailed = summary.results.some((r) => !r.success);
    if (anyPhaseFailed) {
      process.exit(1);
    }
  } catch (error) {
    console.error(
      `Fatal error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

// Run main when executed directly (not when imported)
const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main();
}
