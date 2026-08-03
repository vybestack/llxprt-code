/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs native Bun test files in isolated processes.
 *
 * Bun's module mocks are process-wide, unlike Vitest's per-file module graph.
 * A fresh process per file preserves the isolation expected by the existing
 * workspace suites while still executing every test with Bun's native runner.
 *
 * **Important**: every executed file comes from a root declared in
 * `scripts/bun-test-manifest.ts`. A root either curates an explicit `files`
 * list (used while a workspace is only partly migrated, where Bun's
 * module-lifecycle differences still block some files) or declares `include`
 * globs (used once a root is fully migrated, so a newly added test file runs
 * automatically and cannot be silently dropped).
 *
 * Usage:
 *   bun scripts/run_bun_tests.ts [options]
 *
 * Options:
 *   --workspace <name>    Only run tests for the named root (--root is an alias)
 *   --tsconfig <path>     Path to tsconfig override (passed via --tsconfig-override)
 *   --timeout <ms>        Per-test timeout in milliseconds (defaults to 30000)
 *   --junit <path>        Write a JUnit XML report to this path after the run
 *   --dry-run             List files that would be run without executing them
 */

import { statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  resolveBunNativeTestFiles,
  type BunTestFile,
} from './bun-test-manifest.js';

/**
 * Detects and kills stale orphaned `bun test` processes (PPID=1) before
 * starting a new run. When a parent test runner is killed (e.g. by OOM),
 * child `bun test` processes reparent to PID 1 and keep spinning
 * indefinitely — consuming CPU and memory. This guard prevents that
 * accumulation by reaping orphans at the start of every run.
 *
 * Exposed as a standalone function for testability.
 */
function isOrphanedTestProcess(
  ppid: number,
  pid: number,
  comm: string,
  ownPid: number,
): boolean {
  if (ppid !== 1 || pid === ownPid) return false;
  const runtime = comm.includes('bun') || comm.includes('node');
  const isTest = comm.includes('test') || comm.includes('spec');
  return runtime && isTest;
}

export function reapStaleBunTestProcesses(
  spawnSync: (cmd: readonly string[]) => { stdout: string | null },
  kill: (pid: number, signal: string) => void,
  ownPid: number,
  stderr?: (line: string) => void,
): number {
  let output: string;
  try {
    output = spawnSync(['ps', '-eo', 'pid=,ppid=,args=']).stdout ?? '';
  } catch {
    return 0;
  }

  let killed = 0;
  for (const line of output.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[0] ?? '', 10);
    const ppid = parseInt(parts[1] ?? '', 10);
    const comm = parts.slice(2).join(' ');
    if (
      Number.isFinite(pid) &&
      Number.isFinite(ppid) &&
      isOrphanedTestProcess(ppid, pid, comm, ownPid)
    ) {
      try {
        kill(pid, 'SIGTERM');
        killed++;
      } catch {
        // Process may have already exited
      }
    }
  }

  if (killed > 0 && stderr) {
    stderr(
      `[run_bun_tests] Reaped ${killed} stale orphaned test process(es) (PPID=1) before run.`,
    );
  }
  return killed;
}

/**
 * Bun SyncSubprocess shape for the fields used in diagnostics.  The full
 * interface includes stdout/stderr buffers and resourceUsage, but only the
 * exit-related fields matter here.
 *
 * exitCode is null when the process was terminated by a signal rather than
 * exiting voluntarily.
 */
export interface ChildExitInfo {
  readonly exitCode: number | null;
  readonly signalCode?: string | null;
  readonly stdout?: string;
  readonly stderr?: string;
}

/**
 * Per-file process timeout. Some test files leave lingering handles (e.g.
 * pending AbortControllers, SettingsService file watchers) that prevent
 * Bun's process from exiting even after all tests pass. A generous timeout
 * lets slow files complete while catching genuine hangs.
 */
const PER_FILE_PROCESS_TIMEOUT_MS = 120_000;

/**
 * Safely decodes a Bun.spawnSync output buffer, handling null values
 * that occur when the child produces no output or is killed early.
 */
function decodeOutput(
  output: string | Buffer | Uint8Array | null | undefined,
): string {
  if (!output) return '';
  return typeof output === 'string' ? output : new TextDecoder().decode(output);
}

interface FileTestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly stdout: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates a minimal JUnit XML report at the given path. Each test file
 * becomes a testsuite with a single testcase representing the per-file
 * pass/fail outcome. Consumed by CI integrations (dorny/test-reporter).
 */
export function writeJUnitReport(
  outputPath: string,
  files: readonly FileTestResult[],
): void {
  const NL = String.fromCharCode(10);
  const failCount = files.filter((f) => !f.passed).length;
  const suites = files
    .map((f) => {
      const safeName = escapeXml(f.name);
      const failAttr = f.passed ? '0' : '1';
      const tag = f.passed
        ? '<testcase classname="' +
          safeName +
          '" name="bun-test (passed)" time="0" />'
        : '<testcase classname="' +
          safeName +
          '" name="bun-test (failed)" time="0"><failure message="failed" /></testcase>';
      return [
        '    <testsuite name="' +
          safeName +
          '" tests="1" failures="' +
          failAttr +
          '" errors="0" skipped="0" time="0">',
        '      ' + tag,
        '    </testsuite>',
      ].join(NL);
    })
    .join(NL);
  const header = '<?xml version="1.0" encoding="UTF-8" ?>';
  const open =
    '<testsuites name="bun tests" tests="' +
    files.length +
    '" failures="' +
    failCount +
    '" errors="0" time="0">';
  writeFileSync(
    outputPath,
    [header, open, suites, '</testsuites>'].join(NL) + NL,
    'utf-8',
  );
}

/**
 * Regex that matches Bun's "0 fail" summary line, which appears in stdout
 * when all tests pass. Used to detect "tests passed but process didn't
 * exit" scenarios.
 */
const ZERO_FAIL_PATTERN = /\b0 fail\b/;

/**
 * Detects "tests passed but process didn't exit" by checking output for
 * passing test lines without any failures. Bun's test runner writes test
 * results to stderr, so both streams are combined for analysis. Some test
 * files leave lingering handles (e.g. credential proxy Unix sockets) that
 * prevent Bun's process from exiting even after all tests pass. The summary
 * line ("0 fail") may not be printed in that case, so we also check for
 * "(pass)" without "(fail)".
 */
function outputShowsTestsPassed(stdout?: string, stderr?: string): boolean {
  const combined = `${stdout ?? ''}\n${stderr ?? ''}`;
  if (ZERO_FAIL_PATTERN.test(combined)) return true;
  const hasPass = /\(pass\)/.test(combined);
  const hasFail = /\(fail\)/.test(combined);
  return hasPass && !hasFail;
}

/**
 * Returns true when the spawned child process completed successfully.
 * Bun's SyncSubprocess.exitCode is `null` when the process was terminated
 * by a signal rather than exiting voluntarily, so we also treat a null
 * exitCode as a failure — UNLESS the output shows "0 fail" (tests passed
 * but the process didn't exit cleanly, e.g. due to lingering handles).
 */
export function isChildSuccess(child: ChildExitInfo): boolean {
  if (child.exitCode === 0) {
    return true;
  }
  const killedByTimeout =
    child.signalCode === 'SIGTERM' || child.signalCode === 'SIGKILL';
  if (!killedByTimeout) {
    return false;
  }
  return outputShowsTestsPassed(child.stdout, child.stderr);
}

/**
 * Produces a human-readable suffix for a failed child diagnostic line.
 * When the process was killed by a signal, the signal name is included;
 * otherwise the numeric exit code is reported.
 */
export function formatFailureDiagnostic(child: ChildExitInfo): string {
  if (child.signalCode !== null && child.signalCode !== undefined) {
    return ` (signal: ${child.signalCode})`;
  }
  if (child.exitCode !== null && child.exitCode !== 0) {
    return ` (exit code: ${child.exitCode})`;
  }
  if (child.exitCode === null) {
    // exitCode is null (killed by signal) but no signalCode was recorded
    return ' (exit code: null)';
  }
  // exitCode is 0 with no signal: success, nothing to report
  return '';
}

interface CliOptions {
  workspace: string | null;
  tsconfig: string | null;
  timeout: number;
  dryRun: boolean;
  junit: string | null;
}

function readOptionValue(
  argv: string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

export function resolveTsconfigOverride(
  configuredPath: string,
  invocationDirectory: string,
): string {
  const absolutePath = resolve(invocationDirectory, configuredPath);
  try {
    if (statSync(absolutePath).isFile()) {
      return absolutePath;
    }
  } catch {
    // The common missing and inaccessible cases share the same contract.
  }
  throw new Error(`Tsconfig override is not a file: ${absolutePath}`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    workspace: null,
    tsconfig: null,
    timeout: 30_000,
    dryRun: false,
    junit: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--workspace':
      case '--root':
      case '-w':
        options.workspace = readOptionValue(argv, i++, arg);
        break;
      case '--tsconfig':
        options.tsconfig = readOptionValue(argv, i++, arg);
        break;
      case '--junit':
        options.junit = readOptionValue(argv, i++, arg);
        break;
      case '--timeout': {
        const value = readOptionValue(argv, i++, arg);
        const timeout = Number(value);
        if (
          !Number.isFinite(timeout) ||
          timeout <= 0 ||
          !Number.isInteger(timeout)
        ) {
          throw new Error(`Invalid --timeout value: ${value}`);
        }
        options.timeout = timeout;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

export interface BunTestSpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: 'inherit';
  readonly stdout: 'pipe' | 'inherit';
  readonly stderr: 'pipe' | 'inherit';
  readonly timeout?: number;
}

/**
 * Shape of a manifest `globalSetup` module. Both hooks are optional so a root
 * can declare setup-only or teardown-only behaviour.
 */
export interface BunGlobalSetupModule {
  readonly setup?: () => void | Promise<void>;
  readonly teardown?: () => void | Promise<void>;
}

export interface BunTestRunnerDependencies {
  readonly repoRoot: string;
  readonly invocationDirectory: string;
  readonly executable: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly resolveFiles: (
    repoRoot: string,
    workspace?: string,
  ) => readonly BunTestFile[];
  readonly resolveTsconfig: (
    configuredPath: string,
    invocationDirectory: string,
  ) => string;
  readonly spawn: (
    command: readonly string[],
    options: BunTestSpawnOptions,
  ) => ChildExitInfo;
  readonly loadGlobalSetup: (path: string) => Promise<BunGlobalSetupModule>;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

/**
 * Builds the full spawn args for a single Bun test file. The manifest entry
 * may override the tsconfig and the per-test timeout, and may declare any
 * number of preload scripts (the Bun-native equivalent of Vitest's
 * `setupFiles`).
 */
export function buildSpawnArgs(
  executable: string,
  entry: BunTestFile,
  cliTsconfigOverride: string | null,
  cliTimeout: number,
): readonly string[] {
  const args = [executable, 'test'];
  const tsconfig = entry.tsconfig ?? cliTsconfigOverride;
  if (tsconfig) {
    args.push('--tsconfig-override', tsconfig);
  }
  args.push(
    '--max-concurrency',
    '1',
    '--timeout',
    String(entry.timeout ?? cliTimeout),
  );
  for (const preload of entry.preloads) {
    args.push('--preload', preload);
  }
  args.push(entry.file);
  return args;
}

/**
 * Per-file process timeout, scaled so a file whose per-test timeout exceeds
 * the default process budget is not killed while a legitimately slow test is
 * still running. E2E roots declare `timeout: 300000`, which alone can exceed
 * `PER_FILE_PROCESS_TIMEOUT_MS`.
 */
export function processTimeoutFor(testTimeoutMs: number): number {
  return Math.max(PER_FILE_PROCESS_TIMEOUT_MS, testTimeoutMs * 2);
}

function spawnTestFileOnce(
  entry: BunTestFile,
  cliTsconfigOverride: string | null,
  cliTimeout: number,
  dependencies: BunTestRunnerDependencies,
): { passed: boolean; stdout: string; diagnostic: string } {
  try {
    const child = dependencies.spawn(
      buildSpawnArgs(
        dependencies.executable,
        entry,
        cliTsconfigOverride,
        cliTimeout,
      ),
      {
        cwd: entry.cwd,
        env: dependencies.environment,
        stdin: 'inherit',
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: processTimeoutFor(entry.timeout ?? cliTimeout),
      },
    );
    return {
      passed: isChildSuccess(child),
      stdout: child.stdout ?? '',
      diagnostic: formatFailureDiagnostic(child),
    };
  } catch (error: unknown) {
    const diagnostic =
      error instanceof Error
        ? (error.stack ?? error.toString())
        : String(error);
    return { passed: false, stdout: '', diagnostic: `\n${diagnostic}` };
  }
}

function runSingleTestFile(
  entry: BunTestFile,
  cliTsconfigOverride: string | null,
  cliTimeout: number,
  dependencies: BunTestRunnerDependencies,
): FileTestResult {
  const relativeName = entry.file.replace(entry.cwd + '/', '');
  const attempts = (entry.retries ?? 0) + 1;
  let last = { passed: false, stdout: '', diagnostic: '' };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = spawnTestFileOnce(
      entry,
      cliTsconfigOverride,
      cliTimeout,
      dependencies,
    );
    if (last.passed) {
      break;
    }
    if (attempt < attempts) {
      dependencies.stderr(
        `Native Bun test failed (attempt ${attempt}/${attempts}), retrying: ${entry.file}${last.diagnostic}`,
      );
    }
  }
  if (!last.passed) {
    dependencies.stderr(
      `Native Bun test failed: ${entry.file}${last.diagnostic}`,
    );
  }
  return { name: relativeName, passed: last.passed, stdout: last.stdout };
}

/**
 * Collects the distinct global-setup modules declared by the selected files,
 * preserving manifest order so setup runs in a deterministic sequence.
 */
export function collectGlobalSetups(
  files: readonly BunTestFile[],
): readonly string[] {
  const seen = new Set<string>();
  for (const { globalSetup } of files) {
    if (globalSetup !== undefined) {
      seen.add(globalSetup);
    }
  }
  return [...seen];
}

export async function runBunTests(
  argv: string[],
  dependencies: BunTestRunnerDependencies,
): Promise<number> {
  const options = parseArgs(argv);
  const tsconfigOverride = options.tsconfig
    ? dependencies.resolveTsconfig(
        options.tsconfig,
        dependencies.invocationDirectory,
      )
    : null;
  const files = dependencies.resolveFiles(
    dependencies.repoRoot,
    options.workspace ?? undefined,
  );

  if (files.length === 0) {
    const scope = options.workspace
      ? `workspace "${options.workspace}"`
      : 'any workspace';
    dependencies.stderr(`No native Bun test files found for ${scope}.`);
    dependencies.stderr(
      'Roots must be declared in scripts/bun-test-manifest.ts.',
    );
    return 1;
  }

  if (options.dryRun) {
    dependencies.stdout(`Dry run: ${files.length} files would be executed:`);
    for (const entry of files) {
      dependencies.stdout(`  [${entry.cwd}] ${entry.file}`);
    }
    return 0;
  }

  dependencies.stdout(
    `Running ${files.length} native Bun test files in isolated processes`,
  );

  // Global setup mutates process.env in this process; every spawned test
  // process inherits it, which is exactly the contract Vitest's globalSetup
  // provided for the evals and integration-test roots.
  const setups = collectGlobalSetups(files);
  const started: string[] = [];
  let testResults: FileTestResult[] = [];
  try {
    for (const setup of setups) {
      const module = await dependencies.loadGlobalSetup(setup);
      started.push(setup);
      await module.setup?.();
    }
    testResults = files.map((entry) =>
      runSingleTestFile(entry, tsconfigOverride, options.timeout, dependencies),
    );
  } finally {
    for (const setup of started.reverse()) {
      try {
        const module = await dependencies.loadGlobalSetup(setup);
        await module.teardown?.();
      } catch (error: unknown) {
        dependencies.stderr(
          `Global teardown failed for ${setup}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  const passed = testResults.filter((r) => r.passed).length;
  const failed = testResults.length - passed;

  dependencies.stdout(
    `Passed ${passed}/${files.length} isolated native Bun test files` +
      (failed > 0 ? ` (${failed} failed)` : ''),
  );

  if (options.junit) {
    const junitPath = resolve(dependencies.invocationDirectory, options.junit);
    writeJUnitReport(junitPath, testResults);
    dependencies.stdout(`JUnit report written to ${junitPath}`);
  }

  return failed > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, '..');

  // Reap any stale orphaned test processes from previous runs before starting.
  // This prevents orphaned bun test processes from accumulating when parent
  // runners are killed (e.g. by OOM). See issue #2909.
  reapStaleBunTestProcesses(
    (cmd) => {
      const result = Bun.spawnSync({
        cmd: [...cmd],
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 5_000,
      });
      return { stdout: decodeOutput(result.stdout) };
    },
    (pid, signal) => process.kill(pid, signal),
    process.pid,
    console.error,
  );

  // Register signal handlers so that Ctrl-C or CI cancellation exits promptly.
  // Since Bun.spawnSync blocks the event loop, these handlers only fire
  // between files (not during a running child), so they cannot kill an
  // in-flight child. For SIGKILL (OOM), the pre-run reaping guard above
  // is the protection mechanism.
  let terminating = false;
  const signalExitCodes: Record<string, number> = {
    SIGTERM: 143,
    SIGINT: 130,
    SIGHUP: 129,
  };
  const handleSignal = (signal: string): void => {
    if (terminating) return;
    terminating = true;
    console.error(`[run_bun_tests] Received ${signal}, exiting.`);
    process.exit(signalExitCodes[signal] ?? 130);
  };
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGHUP', () => handleSignal('SIGHUP'));

  process.exitCode = await runBunTests(process.argv.slice(2), {
    repoRoot,
    invocationDirectory: process.cwd(),
    executable: process.execPath,
    environment: process.env,
    resolveFiles: resolveBunNativeTestFiles,
    resolveTsconfig: resolveTsconfigOverride,
    loadGlobalSetup: async (path) =>
      (await import(pathToFileURL(path).href)) as BunGlobalSetupModule,
    spawn: (command, options) => {
      const result = Bun.spawnSync([...command], options);
      const stdoutText = decodeOutput(result.stdout);
      if (stdoutText) {
        process.stdout.write(stdoutText);
      }
      const stderrText = decodeOutput(result.stderr);
      if (stderrText) {
        process.stderr.write(stderrText);
      }
      return {
        exitCode: result.exitCode,
        signalCode: result.signalCode,
        stdout: stdoutText,
        stderr: stderrText,
      };
    },
    stdout: console.log,
    stderr: console.error,
  });
}

/**
 * Determines whether the current module was invoked as the main entry point
 * (i.e. `process.argv[1]` resolves to this module's URL). Uses pathToFileURL
 * for portable cross-platform comparison that correctly handles spaces and
 * special characters in the script path — a raw string comparison against
 * `import.meta.url` would fail on paths containing spaces.
 */
export function isMainModule(
  argv1: string | undefined,
  moduleUrl: string,
): boolean {
  return argv1 !== undefined && moduleUrl === pathToFileURL(argv1).href;
}

const isMain = isMainModule(process.argv[1], import.meta.url);
if (isMain) {
  await main();
}
