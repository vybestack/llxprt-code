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
 * **Important**: every executed file is discovered by walking the filesystem
 * from roots declared in `scripts/bun-test-roots.ts`. A root declares the
 * directories to scan and the execution settings (preload, tsconfig, timeout,
 * retries, globalSetup). There is no allowlist: a newly added test file is
 * picked up automatically and can never be silently dropped.
 *
 * Usage:
 *   bun scripts/run_bun_tests.ts [options]
 *
 * Options:
 *   --workspace <name>    Only run tests for the named root (--root is an alias)
 *   --tsconfig <path>     Path to tsconfig override (passed via --tsconfig-override)
 *   --timeout <ms>        Per-test timeout in milliseconds (defaults to 30000)
 *   --junit <path>        Write a JUnit XML report to this path after the run
 *   --json-report <path>  Write a Vitest-compatible JSON report (per-test results)
 *   --dry-run             List files that would be run without executing them
 */

import {
  statSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveBunTestFiles, type BunTestFile } from './bun-test-roots.js';
import { DEFAULT_PER_TEST_TIMEOUT_MS } from './lib/bun-test-policy.js';
import {
  buildVitestJsonReport,
  parseJUnitXml,
  type VitestJsonReport,
  type JUnitTestSuites,
  type JUnitTestSuite,
} from './bun-junit-to-json-report.js';

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

export interface FileTestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly stdout: string;
  /**
   * Where this file's child process was told to write its JUnit XML, when a
   * JSON report was requested. Retained so the report writer can tell "this
   * file produced no output" apart from "this file's suites are present under
   * some other name" — Bun names suites after `describe` blocks, not files.
   */
  readonly junitOutfile?: string;
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
 * Regex that matches Bun's "Ran N tests" completion summary line, printed
 * after every finished test run regardless of pass/fail count.
 */
const RAN_TESTS_PATTERN = /\bRan \d+ tests?\b/;

/**
 * Detects whether the child process output contains a completed Bun summary.
 *
 * Bun prints both a failure count and a "Ran N tests" line after every
 * finished run. A signaled process is accepted only when both lines prove
 * the full run completed with zero failures; either line alone is ambiguous.
 * Their absence means execution was partial when the process was killed, so
 * remaining tests must not be reported green.
 */
function outputShowsCompleteSummary(stdout?: string, stderr?: string): boolean {
  const combined = `${stdout ?? ''}\n${stderr ?? ''}`;
  return ZERO_FAIL_PATTERN.test(combined) && RAN_TESTS_PATTERN.test(combined);
}

/**
 * Returns true when the spawned child process completed successfully.
 * Bun's SyncSubprocess.exitCode is `null` when the process was terminated
 * by a signal rather than exiting voluntarily, so we also treat a null
 * exitCode as a failure — UNLESS the output shows a completed zero-failure Bun
 * summary (tests passed but the process didn't exit cleanly, e.g. due to
 * lingering handles). A timed-out or signaled process that only printed partial output
 * (some "(pass)" lines without the final summary) must NOT be accepted as
 * success, because partial execution silently skips the remaining tests.
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
  return outputShowsCompleteSummary(child.stdout, child.stderr);
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
  jsonReport: string | null;
  /** Glob patterns whose matching files are removed from the resolved set. */
  exclude: string[];
  /** Bare path arguments narrowing the run to matching files. */
  filters: string[];
  /** Regex forwarded to Bun as `--test-name-pattern`. */
  testNamePattern: string | null;
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
    // Shared with the workspace runners (issue #3139): the two paths both run
    // in CI, and a shard that used a tighter bound than the workspace runner
    // failed work the workspace runner would have let finish.
    timeout: DEFAULT_PER_TEST_TIMEOUT_MS,
    dryRun: false,
    junit: null,
    jsonReport: null,
    exclude: [],
    filters: [],
    testNamePattern: null,
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
      case '--json-report':
        options.jsonReport = readOptionValue(argv, i++, arg);
        break;
      case '--exclude':
        options.exclude.push(readOptionValue(argv, i++, arg));
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
      case '--testNamePattern':
        options.testNamePattern = readOptionValue(argv, i++, arg);
        break;
      default: {
        // `--exclude=<glob>` / `--testNamePattern=<regex>` (the forms the e2e
        // workflow uses) as well as their space-separated spellings, matching
        // how Vitest accepted them.
        const inlineExclude = /^--exclude=(.+)$/.exec(arg);
        if (inlineExclude) {
          options.exclude.push(inlineExclude[1]);
          break;
        }
        const inlineNamePattern = /^--testNamePattern=(.+)$/.exec(arg);
        if (inlineNamePattern) {
          options.testNamePattern = inlineNamePattern[1];
          break;
        }
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        // A bare path narrows the run to matching files, as it did under
        // Vitest.
        options.filters.push(arg);
        break;
      }
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
 * Shape of a root `globalSetup` module. Both hooks are optional so a root
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
 * Builds the full spawn args for a single Bun test file. The root entry
 * may override the tsconfig and the per-test timeout, and may declare any
 * number of preload scripts (the Bun-native equivalent of Vitest's
 * `setupFiles`).
 */
export function buildSpawnArgs(
  executable: string,
  entry: BunTestFile,
  cliTsconfigOverride: string | null,
  cliTimeout: number,
  junitOutfile?: string,
  testNamePattern?: string | null,
): readonly string[] {
  const args = [executable, 'test'];
  if (testNamePattern) {
    args.push('--test-name-pattern', testNamePattern);
  }
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
  if (junitOutfile) {
    args.push('--reporter=junit', `--reporter-outfile=${junitOutfile}`);
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

/** CLI options that apply to every file in a run. */
export interface RunWideOptions {
  readonly tsconfig: string | null;
  readonly timeout: number;
  readonly testNamePattern: string | null;
}

function spawnTestFileOnce(
  entry: BunTestFile,
  run: RunWideOptions,
  dependencies: BunTestRunnerDependencies,
  junitOutfile?: string,
): { passed: boolean; stdout: string; diagnostic: string; junitPath?: string } {
  try {
    const child = dependencies.spawn(
      buildSpawnArgs(
        dependencies.executable,
        entry,
        run.tsconfig,
        run.timeout,
        junitOutfile,
        run.testNamePattern,
      ),
      {
        cwd: entry.cwd,
        env: dependencies.environment,
        stdin: 'inherit',
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: processTimeoutFor(entry.timeout ?? run.timeout),
      },
    );
    return {
      passed: isChildSuccess(child),
      stdout: child.stdout ?? '',
      diagnostic: formatFailureDiagnostic(child),
      junitPath: junitOutfile,
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
  run: RunWideOptions,
  dependencies: BunTestRunnerDependencies,
  junitOutfile?: string,
): FileTestResult {
  const relativeName = entry.file.replace(entry.cwd + '/', '');
  const attempts = (entry.retries ?? 0) + 1;
  let last = { passed: false, stdout: '', diagnostic: '' };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = spawnTestFileOnce(entry, run, dependencies, junitOutfile);
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
  return {
    name: relativeName,
    passed: last.passed,
    stdout: last.stdout,
    junitOutfile,
  };
}

/**
 * Collects the distinct global-setup modules declared by the selected files,
 * preserving root order so setup runs in a deterministic sequence.
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

/**
 * Removes files matching any `--exclude` glob, mirroring the flag the e2e
 * workflow passes through to skip individual E2E specs per sandbox mode.
 * Patterns are matched against the absolute path, so the leading `**` the
 * workflow uses behaves as it did under Vitest.
 */
export function applyExclusions(
  files: readonly BunTestFile[],
  patterns: readonly string[],
): readonly BunTestFile[] {
  if (patterns.length === 0) {
    return files;
  }
  const globs = patterns.map((pattern) => new Bun.Glob(pattern));
  return files.filter((entry) => !globs.some((glob) => glob.match(entry.file)));
}

/**
 * Narrows the run to files whose path contains one of the bare path arguments,
 * the substring semantics Vitest gave positional filters.
 */
export function applyFilters(
  files: readonly BunTestFile[],
  filters: readonly string[],
): readonly BunTestFile[] {
  if (filters.length === 0) {
    return files;
  }
  return files.filter((entry) =>
    filters.some((filter) => entry.file.includes(filter)),
  );
}

export async function runBunTests(
  argv: string[],
  dependencies: BunTestRunnerDependencies,
): Promise<number> {
  const options = parseArgs(argv);
  const tsconfigOverride = resolveTsconfig(options, dependencies);
  const files = applyFilters(
    applyExclusions(
      dependencies.resolveFiles(
        dependencies.repoRoot,
        options.workspace ?? undefined,
      ),
      options.exclude,
    ),
    options.filters,
  );

  if (files.length === 0) {
    const scope = options.workspace
      ? `workspace "${options.workspace}"`
      : 'any workspace';
    dependencies.stderr(`No native Bun test files found for ${scope}.`);
    dependencies.stderr('Roots must be declared in scripts/bun-test-roots.ts.');
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

  const junitTempDir = createJunitTempDir(options, dependencies);
  const setups = collectGlobalSetups(files);
  const started: string[] = [];
  let testResults: FileTestResult[] = [];
  let teardownFailures = 0;
  try {
    for (const setup of setups) {
      const module = await dependencies.loadGlobalSetup(setup);
      started.push(setup);
      await module.setup?.();
    }
    testResults = runAllFiles(
      files,
      tsconfigOverride,
      options,
      dependencies,
      junitTempDir,
    );
  } finally {
    teardownFailures = await teardownSetups(started, dependencies);
  }

  reportResults(testResults, dependencies);

  writeReports(options, testResults, junitTempDir, dependencies);

  const passed = testResults.filter((r) => r.passed).length;
  const failed = testResults.length - passed;
  // A global teardown that throws means the root's cleanup contract was
  // violated (e.g. an eval run's temp storage survived). Vitest fails the run
  // in that case, so reporting success here would leak the failure.
  return failed > 0 || teardownFailures > 0 ? 1 : 0;
}

function resolveTsconfig(
  options: CliOptions,
  dependencies: BunTestRunnerDependencies,
): string | null {
  return options.tsconfig
    ? dependencies.resolveTsconfig(
        options.tsconfig,
        dependencies.invocationDirectory,
      )
    : null;
}

function createJunitTempDir(
  options: CliOptions,
  dependencies: BunTestRunnerDependencies,
): string | null {
  if (!options.jsonReport) return null;
  return mkdtempSync(
    join(resolve(dependencies.invocationDirectory, '.'), 'bun-junit-'),
  );
}

function runAllFiles(
  files: readonly BunTestFile[],
  tsconfigOverride: string | null,
  options: CliOptions,
  dependencies: BunTestRunnerDependencies,
  junitTempDir: string | null,
): FileTestResult[] {
  const run: RunWideOptions = {
    tsconfig: tsconfigOverride,
    timeout: options.timeout,
    testNamePattern: options.testNamePattern,
  };
  const results: FileTestResult[] = [];
  for (const entry of files) {
    results.push(
      runSingleTestFile(
        entry,
        run,
        dependencies,
        junitTempDir !== null
          ? join(junitTempDir, `${results.length}.xml`)
          : undefined,
      ),
    );
  }
  return results;
}

/**
 * Runs every started root's teardown in reverse order and returns how many
 * threw.
 *
 * A throwing teardown must not stop the remaining ones — leaking another
 * root's temp directories would compound the problem — but it also must not be
 * swallowed, so the count is surfaced to the caller for the exit code.
 */
async function teardownSetups(
  started: string[],
  dependencies: BunTestRunnerDependencies,
): Promise<number> {
  let failures = 0;
  for (const setup of started.reverse()) {
    try {
      const module = await dependencies.loadGlobalSetup(setup);
      await module.teardown?.();
    } catch (error: unknown) {
      failures++;
      dependencies.stderr(
        `Global teardown failed for ${setup}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return failures;
}

function reportResults(
  testResults: readonly FileTestResult[],
  dependencies: BunTestRunnerDependencies,
): void {
  const passed = testResults.filter((r) => r.passed).length;
  const failed = testResults.length - passed;
  dependencies.stdout(
    `Passed ${passed}/${testResults.length} isolated native Bun test files` +
      (failed > 0 ? ` (${failed} failed)` : ''),
  );
}

function writeReports(
  options: CliOptions,
  testResults: readonly FileTestResult[],
  junitTempDir: string | null,
  dependencies: BunTestRunnerDependencies,
): void {
  if (options.junit) {
    const junitPath = resolve(dependencies.invocationDirectory, options.junit);
    writeJUnitReport(junitPath, testResults);
    dependencies.stdout(`JUnit report written to ${junitPath}`);
  }

  if (options.jsonReport && junitTempDir !== null) {
    const jsonReportPath = resolve(
      dependencies.invocationDirectory,
      options.jsonReport,
    );
    writeVitestJsonReport(
      jsonReportPath,
      junitTempDir,
      testResults,
      dependencies,
    );
    dependencies.stdout(`JSON report written to ${jsonReportPath}`);
    rmSync(junitTempDir, { recursive: true, force: true });
  }
}

/**
 * Builds a stand-in suite for a file that failed without leaving usable JUnit
 * output (a hard crash, an OOM kill, or malformed XML).
 *
 * Without this the file would simply be absent from the merged report, and
 * `success` — computed from the testcases that *are* present — could read
 * `true` for a run that actually failed. Representing the failure explicitly
 * keeps the artifact consistent with the runner's exit code.
 */
export function syntheticFailureSuite(name: string): JUnitTestSuite {
  return {
    name,
    tests: 1,
    failures: 1,
    errors: 0,
    skipped: 0,
    testCases: [
      {
        classname: name,
        name: 'bun-test (no JUnit output)',
        time: null,
        status: 'failed',
        failureMessage:
          'The test file failed and produced no usable JUnit output; it may have crashed or been killed.',
      },
    ],
  };
}

/**
 * Merges each executed file's JUnit suites, substituting a synthesized failure
 * for any failed file that produced no usable output.
 *
 * Reconciliation is per file, not per suite name: Bun names suites after
 * `describe` blocks, so a file's name never appears in the parsed output and a
 * name-based check would misreport every failure.
 *
 * `parseInto` appends a file's suites and returns how many it added.
 */
export function reconcileSuites(
  testResults: readonly FileTestResult[],
  parseInto: (path: string, into: JUnitTestSuite[]) => number,
): JUnitTestSuite[] {
  const allSuites: JUnitTestSuite[] = [];
  for (const result of testResults) {
    const added =
      result.junitOutfile === undefined
        ? 0
        : parseInto(result.junitOutfile, allSuites);
    if (added === 0 && !result.passed) {
      allSuites.push(syntheticFailureSuite(result.name));
    }
  }
  return allSuites;
}

/**
 * Reads all JUnit XML files from a temporary directory, merges them into a
 * single Vitest-compatible JSON report, and writes it to the given path.
 *
 * A failed file that left no usable JUnit output is represented by a
 * synthesized failing suite rather than being dropped, so the report can never
 * be green while omitting a failure.
 */
function writeVitestJsonReport(
  outputPath: string,
  junitTempDir: string,
  testResults: readonly FileTestResult[],
  dependencies: BunTestRunnerDependencies,
): void {
  const allSuites = reconcileSuites(testResults, (path, into) =>
    processJUnitFile(path, into, dependencies),
  );
  // Any XML not claimed by a result would otherwise be dropped silently;
  // surface it rather than shipping a quietly incomplete report.
  const claimed = new Set(
    testResults
      .map((result) => result.junitOutfile)
      .filter((path): path is string => path !== undefined),
  );
  for (const entry of readdirSync(junitTempDir)) {
    if (!entry.endsWith('.xml')) continue;
    const path = join(junitTempDir, entry);
    if (!claimed.has(path)) {
      throw new Error(
        `JUnit output ${path} does not correspond to any executed test file`,
      );
    }
  }
  const mergedJunit: JUnitTestSuites = {
    name: 'bun tests',
    tests: 0,
    failures: 0,
    errors: 0,
    suites: allSuites,
  };
  const report: VitestJsonReport = buildVitestJsonReport(mergedJunit);
  const NL = String.fromCharCode(10);
  // Vitest creates the reporter's output directory; match that so callers do
  // not have to pre-create it.
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + NL, 'utf-8');
}

function processJUnitFile(
  xmlPath: string,
  allSuites: JUnitTestSuite[],
  dependencies: BunTestRunnerDependencies,
): number {
  try {
    const xml = readFileSync(xmlPath, 'utf-8');
    if (xml.trim().length === 0) return 0;
    const parsed = parseJUnitXml(xml);
    allSuites.push(...parsed.suites);
    return parsed.suites.length;
  } catch (error: unknown) {
    dependencies.stderr(
      `Failed to parse JUnit XML ${xmlPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 0;
  }
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
    resolveFiles: resolveBunTestFiles,
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
