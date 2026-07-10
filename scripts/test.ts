/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun-backed root test orchestration script.
 *
 * Mirrors `npm run test --workspaces --if-present` (plus `test:scripts`)
 * using Bun as the orchestration runtime. Each workspace's tests still run
 * under Vitest — not Bun's native test runner — preserving per-package
 * vitest.config.ts, setup files, coverage, and reporters.
 *
 * Why this exists (issue #2463):
 *   `bun test` (Bun's native test runner) cannot run these tests because they
 *   rely on Vitest-specific APIs (vi.stubEnv, vi.unstubAllEnvs, vi.mocked,
 *   vi.setSystemTime, it.runIf, etc.) and per-package vitest configuration.
 *   Additionally, Bun's `bun run <script>` does not invoke npm lifecycle
 *   hooks (pretest/posttest) the way `npm run <script>` does, so the agents
 *   API-surface guard would be silently skipped.
 *
 *   This script addresses both failure modes by design:
 *   - Tests run under Vitest (the "compatibility setup" acceptance criterion),
 *     so all Vitest helper APIs are available.
 *   - Pretest hooks are run explicitly before each workspace's test phase.
 *
 * Usage:
 *   bun scripts/test.ts                    # run all workspace + script tests
 *   bun scripts/test.ts --workspace core   # run only the core workspace
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
    execSync(command, {
      cwd,
      stdio: 'inherit',
      env,
    });
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

const SCRIPTS_TEST_COMMAND =
  'vitest run --config ./scripts/tests/vitest.config.ts';
const SCRIPTS_TEST_CONFIG = 'scripts/tests/vitest.config.ts';

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

export function orchestrateTests(
  rootDir: string,
  options: TestOptions,
  runner: CommandRunner = createRunnerWithPATH(rootDir),
): TestSummary {
  const results: TestPhaseResult[] = [];
  const startTime = Date.now();

  const allWorkspaces = discoverWorkspaces(rootDir);

  const { workspaceFilter } = options;
  const workspaces = workspaceFilter
    ? allWorkspaces.filter((ws) => matchesFilter(ws, workspaceFilter))
    : allWorkspaces;

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
  if (!anyPhaseFailed) {
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
  const scriptConfigPath = join(rootDir, SCRIPTS_TEST_CONFIG);
  if (!existsSync(scriptConfigPath)) {
    return;
  }
  const scriptResult = runPhase(
    'scripts',
    'scripts',
    SCRIPTS_TEST_COMMAND,
    rootDir,
    runner,
  );
  results.push(scriptResult);
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
    if (options.workspaceFilter) {
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

    if (summary.failed > 0) {
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
