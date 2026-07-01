/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from 'node:process';
import fs from 'node:fs';
import * as pty from '@lydell/node-pty';
import stripAnsi from 'strip-ansi';
import { createDiagnosticsSink } from './diagnostics.js';
import { InteractiveRun } from './interactive-run.js';
import { getDefaultTimeout, poll, sanitizeTestName } from './util.js';
import {
  assertProviderConfig,
  buildExtraArgs,
  getCommandAndArgs,
  buildChildEnv,
  getProfileName,
} from './cli-args.js';
import {
  readAndParseTelemetryLog,
  extractToolLogsFromTelemetry,
  extractApiRequests,
  findMetric,
} from './telemetry-parsing.js';
import {
  parseToolLogsFromStdout,
  extractHookLogs,
} from './tool-log-parsing.js';
import {
  setupTestDirectory,
  writeSettingsFile,
  writeProfileFile,
} from './test-rig-setup.js';
import { stripTelemetryFromStdout } from './stdout-filter.js';
import {
  spawnRun,
  spawnRunWithTimeout,
  type RunContext,
} from './process-run.js';
import type { ParsedLog } from './types.js';

// Re-export public types and helpers so existing importers keep working.
export type {
  InteractiveRunOptions,
  InteractiveRunResult,
  ParsedLog,
  ToolLogEntry,
  HookLogEntry,
  TelemetryAttributes,
} from './types.js';
export { CommandRun } from './command-run.js';
export { InteractiveRun } from './interactive-run.js';
export {
  getDefaultTimeout,
  poll,
  sanitizeTestName,
  createToolCallErrorMessage,
  printDebugInfo,
  validateModelOutput,
} from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Entry is the published CLI dist build (packages/cli/dist/index.js): under Node
// the bun launcher re-execs into Bun, so this exercises the real runtime path
// instead of a standalone esbuild/bun bundle artifact.
const CLI_ENTRY_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages/cli/dist/index.js',
);

interface RunMethodOptions {
  args?: string | string[];
  stdin?: string;
  stdinDoesNotEnd?: boolean;
  yolo?: boolean;
}

/**
 * Test harness for integration/e2e CLI tests. Manages test directories,
 * spawns the CLI, parses telemetry, and provides polling helpers.
 */
export class TestRig {
  testDir: string | null = null;
  testName: string | undefined;
  _lastRunStdout: string | undefined;
  fakeResponsesPath: string | undefined;
  originalFakeResponsesPath: string | undefined;
  private _interactiveRuns: InteractiveRun[] = [];

  /**
   * Diagnostics sink bound to the current test directory. Recomputed on each
   * access so that setup() establishing a directory takes effect immediately.
   */
  private get _diagnostics(): ReturnType<typeof createDiagnosticsSink> {
    return createDiagnosticsSink(this.testDir);
  }

  /** Expose a structured diagnostic dump for helpers in other modules. */
  dumpDiagnostic(label: string, content: string): void {
    this._diagnostics.dump(label, content);
  }

  setup(
    testName: string,
    options: {
      settings?: Record<string, unknown>;
      fakeResponsesPath?: string;
    } = {},
  ) {
    this.testName = testName;
    const sanitizedName = sanitizeTestName(testName);
    const testDir = join(
      env['INTEGRATION_TEST_FILE_DIR'] as string,
      sanitizedName,
    );
    this.testDir = testDir;

    const dirConfig = setupTestDirectory(testDir, {
      fakeResponsesPath: options.fakeResponsesPath,
    });
    if (dirConfig.fakeResponsesPath !== undefined) {
      this.fakeResponsesPath = dirConfig.fakeResponsesPath;
      this.originalFakeResponsesPath = dirConfig.originalFakeResponsesPath;
    }

    writeSettingsFile(testDir, __dirname, options.settings);
    writeProfileFile(testDir);
  }

  createFile(fileName: string, content: string): string {
    const filePath = join(this.testDir as string, fileName);
    writeFileSync(filePath, content);
    return filePath;
  }

  mkdir(dir: string) {
    mkdirSync(join(this.testDir as string, dir), { recursive: true });
  }

  sync() {
    // 'sync' is Unix-specific, skip on Windows.
    if (process.platform !== 'win32') {
      execSync('sync', { cwd: this.testDir as string });
    }
  }

  /**
   * The command and args to use to invoke LLxprt CLI. Allows switching between
   * the dist entry (run under Node, relaunching into Bun via the launcher) and
   * the installed 'llxprt' binary.
   */
  private _getCommandAndArgs(extraInitialArgs: string[] = []): {
    command: string;
    initialArgs: string[];
  } {
    return getCommandAndArgs(CLI_ENTRY_PATH, extraInitialArgs);
  }

  async run(options: RunMethodOptions): Promise<string> {
    assertProviderConfig(this.fakeResponsesPath);

    const yolo = options.yolo !== false;
    const extraArgs = buildExtraArgs(this.fakeResponsesPath, yolo);
    const { command, initialArgs } = this._getCommandAndArgs(extraArgs);
    const commandArgs = [...initialArgs];

    appendUserArgs(commandArgs, options.args);
    appendProfileFlag(commandArgs);

    const childEnv = buildChildEnv(
      this.testDir as string,
      this.fakeResponsesPath,
    );
    const isJsonOutput =
      commandArgs.includes('--output-format') && commandArgs.includes('json');

    const ctx: RunContext = {
      command,
      commandArgs,
      testDir: this.testDir as string,
      childEnv,
    };

    const transform = (stdout: string): string => {
      this._lastRunStdout = stdout;
      if (env['LLXPRT_SANDBOX'] === 'podman') {
        return stripTelemetryFromStdout(stdout);
      }
      return stdout;
    };

    return spawnRunWithTimeout(
      ctx,
      options,
      isJsonOutput,
      transform,
      getDefaultTimeout() * 4,
    );
  }

  async runCommand(
    args: string[],
    options: { stdin?: string } = {},
  ): Promise<string> {
    const { command, initialArgs } = this._getCommandAndArgs();
    const commandArgs = [...initialArgs, ...args];

    const ctx: RunContext = {
      command,
      commandArgs,
      testDir: this.testDir as string,
    };

    return spawnRun(ctx, { stdin: options.stdin }, false, (stdout) => {
      this._lastRunStdout = stdout;
      return stdout;
    });
  }

  readFile(fileName: string): string {
    const filePath = join(this.testDir as string, fileName);
    const content = readFileSync(filePath, 'utf-8');
    if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
      this._diagnostics.dump(`FILE: ${filePath}`, content);
    }
    return content;
  }

  async cleanup() {
    await killInteractiveRuns(this._interactiveRuns, this._diagnostics);
    this._interactiveRuns = [];

    if (
      process.env['REGENERATE_MODEL_GOLDENS'] === 'true' &&
      this.fakeResponsesPath !== undefined &&
      this.originalFakeResponsesPath !== undefined
    ) {
      fs.copyFileSync(this.fakeResponsesPath, this.originalFakeResponsesPath);
    }
    if (this.testDir !== null && !env['KEEP_OUTPUT']) {
      try {
        fs.rmSync(this.testDir, { recursive: true, force: true });
      } catch (error) {
        this._diagnostics.warn('Cleanup warning:', (error as Error).message);
      }
    }
  }

  async waitForTelemetryReady() {
    const logFilePath = join(this.testDir as string, 'telemetry.log');

    await poll(
      () => {
        if (!fs.existsSync(logFilePath)) {
          return false;
        }
        try {
          const content = readFileSync(logFilePath, 'utf-8');
          return content.includes('"scopeMetrics"');
        } catch {
          return false;
        }
      },
      2000,
      100,
    );
  }

  async waitForTelemetryEvent(eventName: string, timeout?: number) {
    const effectiveTimeout = timeout ?? getDefaultTimeout();
    await this.waitForTelemetryReady();

    return poll(
      () => {
        const logs = this._readAndParseTelemetryLog();
        return logs.some(
          (logData) =>
            logData.attributes !== undefined &&
            logData.attributes['event.name'] === `llxprt_code.${eventName}`,
        );
      },
      effectiveTimeout,
      100,
    );
  }

  async waitForToolCall(
    toolName: string,
    timeout?: number,
    matchArgs?: (args: string) => boolean,
  ) {
    const effectiveTimeout = timeout ?? getDefaultTimeout();
    await this.waitForTelemetryReady();

    return poll(
      () => {
        const toolLogs = this.readToolLogs();
        return toolLogs.some(
          (log) =>
            log.toolRequest.name === toolName &&
            (matchArgs?.call(this, log.toolRequest.args) ?? true),
        );
      },
      effectiveTimeout,
      100,
    );
  }

  async expectToolCallSuccess(
    toolNames: string[],
    timeout?: number,
    matchArgs?: (args: string) => boolean,
  ) {
    const effectiveTimeout = timeout ?? getDefaultTimeout();
    await this.waitForTelemetryReady();

    const success = await poll(
      () => {
        const toolLogs = this.readToolLogs();
        return toolNames.some((name) =>
          toolLogs.some(
            (log) =>
              log.toolRequest.name === name &&
              log.toolRequest.success &&
              (matchArgs?.call(this, log.toolRequest.args) ?? true),
          ),
        );
      },
      effectiveTimeout,
      100,
    );

    expect(success).toBe(true);
    if (!success) {
      throw new Error(
        `Expected to find successful toolCalls for ${JSON.stringify(toolNames)}`,
      );
    }
  }

  async waitForAnyToolCall(toolNames: string[], timeout?: number) {
    const effectiveTimeout = timeout ?? getDefaultTimeout();
    await this.waitForTelemetryReady();

    return poll(
      () => {
        const toolLogs = this.readToolLogs();
        return toolNames.some((name) =>
          toolLogs.some((log) => log.toolRequest.name === name),
        );
      },
      effectiveTimeout,
      100,
    );
  }

  _parseToolLogsFromStdout(stdout: string) {
    return parseToolLogsFromStdout(stdout);
  }

  private _readAndParseTelemetryLog(): ParsedLog[] {
    if (this.testDir === null) {
      return [];
    }
    return readAndParseTelemetryLog(this.testDir, this._diagnostics);
  }

  readToolLogs() {
    if (env['LLXPRT_SANDBOX'] === 'podman') {
      const fromStdout = tryReadPodmanToolLogs(
        this.testDir as string,
        this._lastRunStdout,
      );
      if (fromStdout !== undefined) {
        return fromStdout;
      }
    }

    const parsedLogs = this._readAndParseTelemetryLog();
    return extractToolLogsFromTelemetry(parsedLogs);
  }

  readAllApiRequest(): ParsedLog[] {
    const logs = this._readAndParseTelemetryLog();
    return extractApiRequests(logs);
  }

  readLastApiRequest(): ParsedLog | null {
    const logs = this._readAndParseTelemetryLog();
    const apiRequests = extractApiRequests(logs);
    return apiRequests.pop() ?? null;
  }

  async waitForMetric(metricName: string, timeout?: number) {
    await this.waitForTelemetryReady();

    const fullName = metricName.startsWith('llxprt_code.')
      ? metricName
      : `llxprt_code.${metricName}`;

    return poll(
      () => findMetric(this._readAndParseTelemetryLog(), fullName) !== null,
      timeout ?? getDefaultTimeout(),
      100,
    );
  }

  readMetric(metricName: string): Record<string, unknown> | null {
    return findMetric(
      this._readAndParseTelemetryLog(),
      `llxprt_code.${metricName}`,
    );
  }

  async runInteractive(options?: {
    args?: string | string[];
    yolo?: boolean;
  }): Promise<InteractiveRun> {
    assertProviderConfig(this.fakeResponsesPath);

    const yolo = options?.yolo !== false;
    const extraArgs = buildExtraArgs(this.fakeResponsesPath, yolo);
    const { command, initialArgs } = this._getCommandAndArgs(extraArgs);
    const commandArgs = [...initialArgs];

    appendInteractiveArgs(commandArgs, options?.args);
    appendProfileFlag(commandArgs);

    const childEnv = buildChildEnv(
      this.testDir as string,
      this.fakeResponsesPath,
    );

    const ptyOptions: pty.IPtyForkOptions = {
      name: 'xterm-color',
      cols: 80,
      rows: 80,
      cwd: this.testDir as string,
      env: childEnv,
    };

    const executable = command === 'node' ? process.execPath : command;
    const ptyProcess = pty.spawn(executable, commandArgs, ptyOptions);

    const run = new InteractiveRun(ptyProcess, this._diagnostics);
    this._interactiveRuns.push(run);

    return waitForInteractiveReady(run);
  }

  readHookLogs() {
    const parsedLogs = this._readAndParseTelemetryLog();
    return extractHookLogs(parsedLogs);
  }

  async pollCommand(
    commandFn: () => Promise<void>,
    predicateFn: () => boolean,
    timeout: number = 30000,
    interval: number = 1000,
  ) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      await commandFn();
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (predicateFn()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`pollCommand timed out after ${timeout}ms`);
  }
}

/**
 * Append user-supplied args (string prompt or arg array) to the command list.
 */
function appendUserArgs(
  commandArgs: string[],
  args: RunMethodOptions['args'],
): void {
  if (args === undefined) {
    return;
  }
  if (Array.isArray(args)) {
    commandArgs.push(...args);
  } else {
    commandArgs.push('--prompt', args);
  }
}

/**
 * Append the `--profile-load` flag when a test profile is configured.
 */
function appendProfileFlag(commandArgs: string[]): void {
  const profileName = getProfileName();
  if (profileName === undefined) {
    return;
  }
  const ideFlagIndex = commandArgs.indexOf('--ide-mode');
  const insertionIndex = ideFlagIndex >= 0 ? ideFlagIndex : commandArgs.length;
  commandArgs.splice(insertionIndex, 0, '--profile-load', profileName);
}

/**
 * Append args for the interactive (non-prompt) run path.
 */
function appendInteractiveArgs(
  commandArgs: string[],
  args: string | string[] | undefined,
): void {
  if (args === undefined) {
    return;
  }
  if (Array.isArray(args)) {
    commandArgs.push(...args);
  } else {
    commandArgs.push(args);
  }
}

/**
 * Kill any still-running interactive sessions, logging failures.
 */
async function killInteractiveRuns(
  runs: InteractiveRun[],
  diagnostics: ReturnType<typeof createDiagnosticsSink>,
): Promise<void> {
  for (const run of runs) {
    if (!run.exited) {
      try {
        await run.kill();
      } catch (error) {
        diagnostics.warn(
          'Failed to kill interactive run during cleanup:',
          error,
        );
      }
    }
  }
}

/**
 * Wait for the interactive session to reach its main screen.
 */
async function waitForInteractiveReady(
  run: InteractiveRun,
): Promise<InteractiveRun> {
  const promptReadyText = '  Type your message or @path/to/file';
  const tipsReadyText = 'Tips for getting started:';

  const isReady = await poll(
    () => {
      const normalizedOutput = stripAnsi(run.output).toLowerCase();
      return (
        normalizedOutput.includes(promptReadyText.toLowerCase()) ||
        normalizedOutput.includes(tipsReadyText.toLowerCase())
      );
    },
    30000,
    200,
  );

  expect(isReady).toBe(true);
  return run;
}

/**
 * Try to read tool logs from Podman stdout, returning undefined to signal that
 * the caller should fall back to the telemetry file.
 */
function tryReadPodmanToolLogs(
  testDir: string,
  lastRunStdout: string | undefined,
): ReturnType<typeof parseToolLogsFromStdout> | undefined {
  const logFilePath = join(testDir, 'telemetry.log');

  if (fs.existsSync(logFilePath)) {
    try {
      const content = readFileSync(logFilePath, 'utf-8');
      if (content.length > 0 && content.includes('"event.name"')) {
        return undefined; // Use normal file parsing.
      }
    } catch {
      // Fall through to stdout parsing.
    }
  }

  if (lastRunStdout !== undefined) {
    return parseToolLogsFromStdout(lastRunStdout);
  }
  return undefined;
}
