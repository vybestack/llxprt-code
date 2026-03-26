/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from 'node:process';
import fs from 'node:fs';
import * as pty from '@lydell/node-pty';
import stripAnsi from 'strip-ansi';
import * as os from 'node:os';
import { LLXPRT_DIR } from '@vybestack/llxprt-code-core';

/**
 * Options for running a command with timeout support.
 */
export interface InteractiveRunOptions {
  /** Maximum time to wait for the command to complete (default: 30000ms) */
  timeout?: number;
  /** Time to wait after SIGTERM before sending SIGKILL (default: 5000ms) */
  gracefulKillTimeout?: number;
}

/**
 * Result of running a command.
 */
export interface InteractiveRunResult {
  /** The exit code of the process, or null if it was killed */
  exitCode: number | null;
  /** Standard output from the process */
  stdout: string;
  /** Standard error from the process */
  stderr: string;
  /** Whether the process timed out */
  timedOut: boolean;
  /** Whether the process was killed */
  killed: boolean;
}

/**
 * Command-based InteractiveRun for non-PTY process management.
 * Supports timeout, graceful kill escalation, and cross-platform handling.
 */
export class CommandRun {
  private _process: ChildProcess | null = null;
  private _stdout = '';
  private _stderr = '';
  private _exitCode: number | null = null;
  private _killed = false;
  private _timedOut = false;
  private _exited = false;

  /**
   * Get the process ID if running.
   */
  get pid(): number | undefined {
    return this._process?.pid;
  }

  /**
   * Get the exit code after process completes.
   */
  get exitCode(): number | null {
    return this._exitCode;
  }

  /**
   * Check if the process was killed.
   */
  get killed(): boolean {
    return this._killed;
  }

  /**
   * Run a command with optional timeout.
   */
  async run(
    command: string,
    args: string[],
    options?: InteractiveRunOptions,
  ): Promise<InteractiveRunResult> {
    const timeout = options?.timeout ?? 30000;
    const cwd = process.cwd();

    return new Promise((resolve, reject) => {
      this._process = spawn(command, args, {
        cwd,
        stdio: 'pipe',
      });

      this._process.stdout?.on('data', (data: Buffer) => {
        this._stdout += data.toString();
      });

      this._process.stderr?.on('data', (data: Buffer) => {
        this._stderr += data.toString();
      });

      this._process.on('error', (error) => {
        // Handle spawn failures with actionable error
        const err = new Error(
          `Failed to spawn '${command}': ${error.message} (errno: ${(error as NodeJS.ErrnoException).errno ?? 'unknown'})`,
        );
        reject(err);
      });

      this._process.on('close', (code) => {
        this._exited = true;
        this._exitCode = code;
        resolve({
          exitCode: this._exitCode,
          stdout: this._stdout,
          stderr: this._stderr,
          timedOut: this._timedOut,
          killed: this._killed,
        });
      });

      // Set up timeout
      const timer = setTimeout(() => {
        this._timedOut = true;
        this.kill(options?.gracefulKillTimeout ?? 5000).catch(() => {
          // Ignore kill errors on timeout
        });
      }, timeout);

      // Clean up timer on completion
      this._process.on('close', () => {
        clearTimeout(timer);
      });
    });
  }

  /**
   * Kill the process with graceful escalation.
   * First sends SIGTERM, then SIGKILL after timeout.
   * On Windows, uses taskkill with /T flag for process tree.
   */
  async kill(gracefulTimeout?: number): Promise<void> {
    if (this._exited || !this._process) {
      return;
    }

    const timeout = gracefulTimeout ?? 5000;
    this._killed = true;
    const pid = this._process.pid;

    if (pid === undefined) {
      return;
    }

    if (process.platform === 'win32') {
      // Windows: use taskkill with /T flag for process tree
      await this._killWindows(pid, timeout);
    } else {
      // Darwin/Linux: standard SIGTERM/SIGKILL
      await this._killUnix(pid, timeout);
    }
  }

  private async _killWindows(pid: number, _timeout: number): Promise<void> {
    try {
      // Use taskkill with /T to kill process tree
      execSync(`taskkill /pid ${pid} /T /F`, {
        timeout: 10000,
      });
    } catch (error) {
      // Check if process already exited (ESRCH equivalent on Windows)
      const err = error as NodeJS.ErrnoException;
      if (
        err.message?.includes('not found') ||
        err.message?.includes('no running instance')
      ) {
        // Process already exited - treat as success
        return;
      }
      // Permission denied or other error
      if (err.message?.includes('Access is denied')) {
        throw new Error(
          `Permission denied when trying to kill process ${pid}. Try running with elevated privileges.`,
        );
      }
      throw error;
    }
  }

  private async _killUnix(pid: number, timeout: number): Promise<void> {
    try {
      // Send SIGTERM first
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // ESRCH: no such process - already exited, no error
      if (err.code === 'ESRCH') {
        return;
      }
      // EPERM: permission denied
      if (err.code === 'EPERM') {
        throw new Error(
          `Permission denied when trying to kill process ${pid}. Try running with elevated privileges.`,
        );
      }
      throw error;
    }

    // Wait for graceful shutdown
    const startTime = Date.now();
    const exited = await new Promise<boolean>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this._exited) {
          clearInterval(checkInterval);
          resolve(true);
          return;
        }

        // Check if process still exists
        try {
          process.kill(pid, 0); // Signal 0 = check if process exists
        } catch {
          // Process no longer exists
          clearInterval(checkInterval);
          resolve(true);
          return;
        }

        if (Date.now() - startTime >= timeout) {
          clearInterval(checkInterval);
          resolve(false);
        }
      }, 100);
    });

    // If still running after timeout, send SIGKILL
    if (!exited) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        // ESRCH is fine - process already exited
        if (err.code !== 'ESRCH') {
          throw error;
        }
      }
    }
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(__dirname, '..', '..', '..', 'bundle/llxprt.js');

// Get timeout based on environment
export function getDefaultTimeout() {
  if (env['CI']) return 60000; // 1 minute in CI
  if (env['LLXPRT_SANDBOX']) return 30000; // 30s in containers
  return 15000; // 15s locally
}

export async function poll(
  predicate: () => boolean,
  timeout: number,
  interval: number,
): Promise<boolean> {
  const startTime = Date.now();
  let attempts = 0;
  while (Date.now() - startTime < timeout) {
    attempts++;
    const result = predicate();
    if (env['VERBOSE'] === 'true' && attempts % 5 === 0) {
      console.log(
        `Poll attempt ${attempts}: ${result ? 'success' : 'waiting...'}`,
      );
    }
    if (result) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  if (env['VERBOSE'] === 'true') {
    console.log(`Poll timed out after ${attempts} attempts`);
  }
  return false;
}

export function sanitizeTestName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-');
}

// Helper to create detailed error messages
export function createToolCallErrorMessage(
  expectedTools: string | string[],
  foundTools: string[],
  result: string,
) {
  const expectedStr = Array.isArray(expectedTools)
    ? expectedTools.join(' or ')
    : expectedTools;
  return (
    `Expected to find ${expectedStr} tool call(s). ` +
    `Found: ${foundTools.length > 0 ? foundTools.join(', ') : 'none'}. ` +
    `Output preview: ${result ? result.substring(0, 200) + '...' : 'no output'}`
  );
}

// Helper to print debug information when tests fail
export function printDebugInfo(
  rig: TestRig,
  result: string,
  context: Record<string, unknown> = {},
) {
  console.error('Test failed - Debug info:');
  console.error('Result length:', result.length);
  console.error('Result (first 500 chars):', result.substring(0, 500));
  console.error(
    'Result (last 500 chars):',
    result.substring(result.length - 500),
  );

  // Print any additional context provided
  Object.entries(context).forEach(([key, value]) => {
    console.error(`${key}:`, value);
  });

  // Check what tools were actually called
  const allTools = rig.readToolLogs();
  console.error(
    'All tool calls found:',
    allTools.map((t) => t.toolRequest.name),
  );

  return allTools;
}

// Helper to validate model output and warn about unexpected content
export function validateModelOutput(
  result: string,
  expectedContent: string | (string | RegExp)[] | null = null,
  testName = '',
) {
  // First, check if there's any output at all (this should fail the test if missing)
  if (!result || result.trim().length === 0) {
    throw new Error('Expected LLM to return some output');
  }

  // If expectedContent is provided, check for it and warn if missing
  if (expectedContent) {
    const contents = Array.isArray(expectedContent)
      ? expectedContent
      : [expectedContent];
    const missingContent = contents.filter((content) => {
      if (typeof content === 'string') {
        return !result.toLowerCase().includes(content.toLowerCase());
      } else if (content instanceof RegExp) {
        return !content.test(result);
      }
      return false;
    });

    if (missingContent.length > 0) {
      console.warn(
        `Warning: LLM did not include expected content in response: ${missingContent.join(
          ', ',
        )}.`,
        'This is not ideal but not a test failure.',
      );
      console.warn(
        'The tool was called successfully, which is the main requirement.',
      );
      console.warn('Expected content:', expectedContent);
      console.warn('Actual output:', result);
      return false;
    } else if (env['VERBOSE'] === 'true') {
      console.log(`${testName}: Model output validated successfully.`);
    }
    return true;
  }

  return true;
}

interface ParsedLog {
  attributes?: {
    'event.name'?: string;
    function_name?: string;
    function_args?: string;
    success?: boolean;
    duration_ms?: number;
    request_text?: string;
    hook_event_name?: string;
    hook_name?: string;
    hook_input?: Record<string, unknown>;
    hook_output?: Record<string, unknown>;
    exit_code?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
  };
  scopeMetrics?: {
    metrics: {
      descriptor: {
        name: string;
      };
    }[];
  }[];
}

export class InteractiveRun {
  ptyProcess: pty.IPty;
  public output = '';
  private _exited = false;
  private _exitCode: number | null = null;
  private _killed = false;

  constructor(ptyProcess: pty.IPty) {
    this.ptyProcess = ptyProcess;
    ptyProcess.onData((data) => {
      this.output += data;
      if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
        process.stdout.write(data);
      }
    });
    ptyProcess.onExit(({ exitCode }) => {
      this._exited = true;
      this._exitCode = exitCode;
    });
  }

  /**
   * Get the process ID of the PTY process.
   */
  get pid(): number | undefined {
    return this.ptyProcess.pid;
  }

  /**
   * Get the exit code after the process exits.
   */
  get exitCode(): number | null {
    return this._exitCode;
  }

  /**
   * Check if the process was killed.
   */
  get killed(): boolean {
    return this._killed;
  }

  async expectText(text: string, timeout?: number) {
    if (!timeout) {
      timeout = getDefaultTimeout();
    }
    await poll(
      () => stripAnsi(this.output).toLowerCase().includes(text.toLowerCase()),
      timeout,
      200,
    );
    expect(stripAnsi(this.output).toLowerCase()).toContain(text.toLowerCase());
  }

  // This types slowly to make sure command is correct, but only work for short
  // commands that are not multi-line, use sendKeys to type long prompts
  async type(text: string) {
    let typedSoFar = '';
    for (const char of text) {
      this.ptyProcess.write(char);
      typedSoFar += char;

      // Wait for the typed sequence so far to be echoed back.
      const found = await poll(
        () => stripAnsi(this.output).includes(typedSoFar),
        5000, // 5s timeout per character (generous for CI)
        10, // check frequently
      );

      if (!found) {
        throw new Error(
          `Timed out waiting for typed text to appear in output: "${typedSoFar}".\nStripped output:\n${stripAnsi(
            this.output,
          )}`,
        );
      }
    }
  }

  // Types an entire string at once, necessary for some things like commands
  // but may run into paste detection issues for larger strings.
  async sendText(text: string) {
    this.ptyProcess.write(text);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  // Simulates typing a string one character at a time to avoid paste detection.
  async sendKeys(text: string) {
    const delay = 5;
    for (const char of text) {
      this.ptyProcess.write(char);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * Kill the process with graceful escalation.
   * First sends SIGTERM, then SIGKILL after gracePeriodMs.
   * On Windows, uses taskkill with /T flag for process tree.
   * @param gracePeriodMs - Time to wait after SIGTERM before SIGKILL (default: 5000ms)
   */
  async kill(gracePeriodMs = 5000): Promise<void> {
    if (this._exited) return;
    this._killed = true;

    if (process.platform === 'win32') {
      await this._killWindows(gracePeriodMs);
    } else {
      await this._killUnix(gracePeriodMs);
    }
  }

  private async _killWindows(_gracePeriodMs: number): Promise<void> {
    try {
      // Windows: use taskkill with /T flag for process tree
      const pid = this.ptyProcess.pid;
      execSync(`taskkill /pid ${pid} /T /F`, { timeout: 10000 });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // Process may already be dead — ignore
      if (
        !err.message?.includes('not found') &&
        !err.message?.includes('no running instance')
      ) {
        // Log but don't throw for cleanup
        if (env['VERBOSE'] === 'true') {
          console.warn('Failed to kill PTY process:', err.message);
        }
      }
    }
  }

  private async _killUnix(gracePeriodMs: number): Promise<void> {
    try {
      this.ptyProcess.kill('SIGTERM');
      const exited = await poll(() => this._exited, gracePeriodMs, 100);
      if (!exited) {
        this.ptyProcess.kill('SIGKILL');
      }
    } catch {
      // Process may already be dead — ignore
    }
  }

  expectExit(timeout?: number): Promise<number> {
    const effectiveTimeout = timeout ?? getDefaultTimeout();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `Test timed out: process did not exit within ${effectiveTimeout}ms.`,
            ),
          ),
        effectiveTimeout,
      );
      this.ptyProcess.onExit(({ exitCode }) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
  }
}

export class TestRig {
  testDir: string | null = null;
  testName?: string;
  _lastRunStdout?: string;
  // Path to the copied fake responses file for this test.
  fakeResponsesPath?: string;
  // Original fake responses file path for rewriting goldens in record mode.
  originalFakeResponsesPath?: string;
  private _interactiveRuns: InteractiveRun[] = [];

  setup(
    testName: string,
    options: {
      settings?: Record<string, unknown>;
      fakeResponsesPath?: string;
    } = {},
  ) {
    this.testName = testName;
    const sanitizedName = sanitizeTestName(testName);
    this.testDir = join(env['INTEGRATION_TEST_FILE_DIR']!, sanitizedName);
    mkdirSync(this.testDir, { recursive: true });
    if (options.fakeResponsesPath) {
      this.fakeResponsesPath = join(this.testDir, 'fake-responses.json');
      this.originalFakeResponsesPath = options.fakeResponsesPath;
      if (process.env['REGENERATE_MODEL_GOLDENS'] !== 'true') {
        fs.copyFileSync(options.fakeResponsesPath, this.fakeResponsesPath);
      }
    }

    // Create a settings file to point the CLI to the local collector
    const llxprtDir = join(this.testDir, LLXPRT_DIR);
    mkdirSync(llxprtDir, { recursive: true });
    // In sandbox mode, use an absolute path for telemetry inside the container
    // The container mounts the test directory at the same path as the host
    const telemetryPath = join(this.testDir, 'telemetry.log'); // Always use test directory for telemetry

    const settingsOverrides = (options.settings ?? {}) as Record<
      string,
      unknown
    >;
    const { ui: uiOverridesRaw, ...settingsOverridesWithoutUi } =
      settingsOverrides;
    const uiOverrides =
      uiOverridesRaw && typeof uiOverridesRaw === 'object'
        ? (uiOverridesRaw as Record<string, unknown>)
        : undefined;

    const settings = {
      general: {
        // Nightly releases sometimes becomes out of sync with local code and
        // triggers auto-update, which causes tests to fail.
        enableAutoUpdate: false,
      },
      ui: {
        theme: 'Green Screen',
        useAlternateBuffer: true,
        ...uiOverrides,
      },
      telemetry: {
        enabled: true,
        target: 'local',
        otlpEndpoint: '',
        outfile: telemetryPath,
      },
      promptService: {
        // In bundled environment, prompts are in the bundle directory
        baseDir: fs.existsSync(join(__dirname, '..', 'bundle'))
          ? join(__dirname, '..', 'bundle')
          : join(
              __dirname,
              '..',
              'packages',
              'core',
              'src',
              'prompt-config',
              'defaults',
            ),
      },
      sandbox:
        env['LLXPRT_SANDBOX'] !== 'false' ? env['LLXPRT_SANDBOX'] : false,
      provider: env['LLXPRT_DEFAULT_PROVIDER'], // No default - must be set explicitly
      debug: true, // Enable debug logging
      // Don't show the IDE connection dialog when running from VsCode
      ide: { enabled: false, hasSeenNudge: true },
      ...settingsOverridesWithoutUi, // Allow tests to override/add settings
    };
    writeFileSync(
      join(llxprtDir, 'settings.json'),
      JSON.stringify(settings, null, 2),
    );

    const profileName = env['LLXPRT_TEST_PROFILE']?.trim();
    if (profileName) {
      const profilesDir = join(llxprtDir, 'profiles');
      mkdirSync(profilesDir, { recursive: true });

      const profileProvider =
        env['LLXPRT_DEFAULT_PROVIDER'] &&
        env['LLXPRT_DEFAULT_PROVIDER'].trim().length
          ? env['LLXPRT_DEFAULT_PROVIDER']
          : 'openai';
      const profileModel =
        env['LLXPRT_DEFAULT_MODEL'] && env['LLXPRT_DEFAULT_MODEL'].trim().length
          ? env['LLXPRT_DEFAULT_MODEL']
          : 'gpt-4o-mini';

      const ephemeralEntries: Array<[string, unknown]> = [];
      if (env['OPENAI_BASE_URL'] && env['OPENAI_BASE_URL'].trim().length > 0) {
        ephemeralEntries.push(['base-url', env['OPENAI_BASE_URL']]);
      }
      if (env['OPENAI_API_KEY'] && env['OPENAI_API_KEY'].trim().length > 0) {
        ephemeralEntries.push(['auth-key', env['OPENAI_API_KEY']]);
      }
      if (env['LLXPRT_TEST_PROFILE_KEYFILE']) {
        ephemeralEntries.push([
          'auth-keyfile',
          env['LLXPRT_TEST_PROFILE_KEYFILE'],
        ]);
      }
      if (env['LLXPRT_CONTEXT_LIMIT']) {
        const parsedLimit = Number(env['LLXPRT_CONTEXT_LIMIT']);
        if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
          ephemeralEntries.push(['context-limit', parsedLimit]);
        }
      }

      const profile = {
        version: 1,
        provider: profileProvider,
        model: profileModel,
        modelParams: {},
        ephemeralSettings: Object.fromEntries(
          ephemeralEntries.filter(([, value]) => value !== undefined),
        ),
      };

      writeFileSync(
        join(profilesDir, `${profileName}.json`),
        JSON.stringify(profile, null, 2),
      );
    }
  }

  createFile(fileName: string, content: string) {
    const filePath = join(this.testDir!, fileName);
    writeFileSync(filePath, content);
    return filePath;
  }

  mkdir(dir: string) {
    mkdirSync(join(this.testDir!, dir), { recursive: true });
  }

  sync() {
    // ensure file system is done before spawning
    // 'sync' is Unix-specific, skip on Windows
    if (process.platform !== 'win32') {
      execSync('sync', { cwd: this.testDir! });
    }
  }

  /**
   * The command and args to use to invoke LLxprt CLI. Allows us to switch
   * between using the bundled llxprt.js (the default) and using the installed
   * 'llxprt' (used to verify npm bundles).
   */
  private _getCommandAndArgs(extraInitialArgs: string[] = []): {
    command: string;
    initialArgs: string[];
  } {
    const isNpmReleaseTest =
      env['INTEGRATION_TEST_USE_INSTALLED_LLXPRT'] === 'true';
    const command = isNpmReleaseTest ? 'llxprt' : 'node';
    const initialArgs = isNpmReleaseTest
      ? extraInitialArgs
      : [BUNDLE_PATH, ...extraInitialArgs];
    return { command, initialArgs };
  }

  run(options: {
    args?: string | string[];
    stdin?: string;
    stdinDoesNotEnd?: boolean;
    yolo?: boolean;
  }): Promise<string> {
    // Add provider and model flags from environment - FAIL FAST if not configured
    const provider = env['LLXPRT_DEFAULT_PROVIDER'];
    const model = env['LLXPRT_DEFAULT_MODEL'];
    const baseUrl = env['OPENAI_BASE_URL'];
    const apiKey = env['OPENAI_API_KEY'];
    const keyFile =
      env['OPENAI_API_KEYFILE'] ?? env['LLXPRT_TEST_PROFILE_KEYFILE'];

    // Fail fast if required configuration is missing (unless using fake responses)
    if (!this.fakeResponsesPath) {
      if (!provider) {
        throw new Error(
          'LLXPRT_DEFAULT_PROVIDER environment variable is required but not set',
        );
      }
      if (!model) {
        throw new Error(
          'LLXPRT_DEFAULT_MODEL environment variable is required but not set',
        );
      }
      if (!apiKey && !keyFile) {
        throw new Error(
          'Either OPENAI_API_KEY or OPENAI_API_KEYFILE/LLXPRT_TEST_PROFILE_KEYFILE environment variable is required but not set',
        );
      }
    }

    const yolo = options.yolo !== false;
    const extraArgs: string[] = [
      ...(yolo ? ['--yolo'] : []),
      '--ide-mode',
      'disable',
    ];

    // When using fake responses, FakeProvider is activated via LLXPRT_FAKE_RESPONSES
    // env var in the child process. Pass --provider fake so the bootstrap's
    // switchActiveProvider('fake') is a no-op (provider already active).
    // No --key is needed since FakeProvider doesn't require authentication.
    if (this.fakeResponsesPath) {
      extraArgs.push('--provider', 'fake', '--model', 'fake-model');
    } else {
      extraArgs.push('--provider', provider!);
      extraArgs.push('--model', model!);

      // Add baseurl if using openai provider
      if (provider === 'openai' && baseUrl) {
        extraArgs.push('--baseurl', baseUrl);
      }

      // Add API key if available
      if (apiKey) {
        extraArgs.push('--key', apiKey);
      } else if (keyFile) {
        extraArgs.push('--keyfile', keyFile);
      }
    }

    const { command, initialArgs } = this._getCommandAndArgs(extraArgs);
    const commandArgs = [...initialArgs];

    // Filter out TERM_PROGRAM to prevent IDE detection
    const filteredEnv = Object.entries(process.env).reduce(
      (acc, [key, value]) => {
        if (key !== 'TERM_PROGRAM' && key !== 'TERM_PROGRAM_VERSION') {
          acc[key] = value;
        }
        return acc;
      },
      {} as NodeJS.ProcessEnv,
    );

    const execOptions: {
      cwd: string;
      encoding: 'utf-8';
      input?: string;
      env: NodeJS.ProcessEnv;
    } = {
      cwd: this.testDir!,
      encoding: 'utf-8',
      env: {
        ...filteredEnv,
        // Ensure browser launch is suppressed in tests
        NO_BROWSER: 'true',
        LLXPRT_NO_BROWSER_AUTH: 'true',
        CI: 'true',
        LLXPRT_SANDBOX: 'false',
        // When fakeResponsesPath is set, tell CLI to use FakeProvider
        ...(this.fakeResponsesPath
          ? { LLXPRT_FAKE_RESPONSES: this.fakeResponsesPath }
          : {}),
      },
    };

    if (options.args) {
      if (Array.isArray(options.args)) {
        commandArgs.push(...options.args);
      } else {
        commandArgs.push('--prompt', options.args);
      }
    }

    if (options.stdin) {
      execOptions.input = options.stdin;
    }

    if (env['LLXPRT_TEST_PROFILE']?.trim()) {
      const profileName = env['LLXPRT_TEST_PROFILE'].trim();
      // Insert profile-load flags after the initial args (node, bundle path)
      commandArgs.splice(2, 0, '--profile-load', profileName);
    }

    const child = spawn(command, commandArgs, {
      cwd: this.testDir!,
      stdio: 'pipe',
      env: execOptions.env,
    });

    let stdout = '';
    let stderr = '';

    // Handle stdin if provided
    if (execOptions.input) {
      child.stdin!.write(execOptions.input);
    }

    if (!options.stdinDoesNotEnd) {
      child.stdin!.end();
    }

    child.stdout!.on('data', (data: Buffer) => {
      stdout += data;
      if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
        process.stdout.write(data);
      }
    });

    child.stderr!.on('data', (data: Buffer) => {
      stderr += data;
      if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
        process.stderr.write(data);
      }
    });

    const processPromise = new Promise<string>((resolve, reject) => {
      child.on('close', (code: number) => {
        if (code === 0) {
          // Store the raw stdout for Podman telemetry parsing
          this._lastRunStdout = stdout;

          // Filter out telemetry output when running with Podman
          // Podman seems to output telemetry to stdout even when writing to file
          let result = stdout;
          if (env['LLXPRT_SANDBOX'] === 'podman') {
            // Remove telemetry JSON objects from output
            // They are multi-line JSON objects that start with { and contain telemetry fields
            const lines = result.split(os.EOL);
            const filteredLines = [];
            let inTelemetryObject = false;
            let braceDepth = 0;

            for (const line of lines) {
              if (!inTelemetryObject && line.trim() === '{') {
                // Check if this might be start of telemetry object
                inTelemetryObject = true;
                braceDepth = 1;
              } else if (inTelemetryObject) {
                // Count braces to track nesting
                for (const char of line) {
                  if (char === '{') braceDepth++;
                  else if (char === '}') braceDepth--;
                }

                // Check if we've closed all braces
                if (braceDepth === 0) {
                  inTelemetryObject = false;
                  // Skip this line (the closing brace)
                  continue;
                }
              } else {
                // Not in telemetry object, keep the line
                filteredLines.push(line);
              }
            }

            result = filteredLines.join('\n');
          }

          // Check if this is a JSON output test - if so, don't include stderr
          // as it would corrupt the JSON
          const isJsonOutput =
            commandArgs.includes('--output-format') &&
            commandArgs.includes('json');

          // If we have stderr output and it's not a JSON test, include that also
          if (stderr && !isJsonOutput) {
            result += `\n\nStdErr:\n${stderr}`;
          }

          resolve(result);
        } else {
          reject(new Error(`Process exited with code ${code}:\n${stderr}`));
        }
      });
    });

    const timeoutMs = getDefaultTimeout() * 4;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`TestRig.run() timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([processPromise, timeoutPromise]);
  }

  runCommand(
    args: string[],
    options: { stdin?: string } = {},
  ): Promise<string> {
    const { command, initialArgs } = this._getCommandAndArgs();
    const commandArgs = [...initialArgs, ...args];

    const child = spawn(command, commandArgs, {
      cwd: this.testDir!,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    if (options.stdin) {
      child.stdin!.write(options.stdin);
      child.stdin!.end();
    }

    child.stdout!.on('data', (data: Buffer) => {
      stdout += data;
      if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
        process.stdout.write(data);
      }
    });

    child.stderr!.on('data', (data: Buffer) => {
      stderr += data;
      if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
        process.stderr.write(data);
      }
    });

    const promise = new Promise<string>((resolve, reject) => {
      child.on('close', (code: number) => {
        if (code === 0) {
          this._lastRunStdout = stdout;
          let result = stdout;
          if (stderr) {
            result += `\n\nStdErr:\n${stderr}`;
          }
          resolve(result);
        } else {
          reject(new Error(`Process exited with code ${code}:\n${stderr}`));
        }
      });
    });

    return promise;
  }

  readFile(fileName: string) {
    const filePath = join(this.testDir!, fileName);
    const content = readFileSync(filePath, 'utf-8');
    if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
      console.log(`--- FILE: ${filePath} ---`);
      console.log(content);
      console.log(`--- END FILE: ${filePath} ---`);
    }
    return content;
  }

  async cleanup() {
    // Kill any interactive runs that are still active
    for (const run of this._interactiveRuns) {
      if (!run['_exited']) {
        try {
          await run.kill();
        } catch (error) {
          if (env['VERBOSE'] === 'true') {
            console.warn(
              'Failed to kill interactive run during cleanup:',
              error,
            );
          }
        }
      }
    }
    this._interactiveRuns = [];

    if (
      process.env['REGENERATE_MODEL_GOLDENS'] === 'true' &&
      this.fakeResponsesPath
    ) {
      fs.copyFileSync(this.fakeResponsesPath, this.originalFakeResponsesPath!);
    }
    // Clean up test directory
    if (this.testDir && !env['KEEP_OUTPUT']) {
      try {
        fs.rmSync(this.testDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
        if (env['VERBOSE'] === 'true') {
          console.warn('Cleanup warning:', (error as Error).message);
        }
      }
    }
  }

  async waitForTelemetryReady() {
    // Telemetry is always written to the test directory
    const logFilePath = join(this.testDir!, 'telemetry.log');

    if (!logFilePath) return;

    // Wait for telemetry file to exist and have content
    await poll(
      () => {
        if (!fs.existsSync(logFilePath)) return false;
        try {
          const content = readFileSync(logFilePath, 'utf-8');
          // Check if file has meaningful content (at least one complete JSON object)
          return content.includes('"scopeMetrics"');
        } catch {
          return false;
        }
      },
      2000, // 2 seconds max - reduced since telemetry should flush on exit now
      100, // check every 100ms
    );
  }

  async waitForTelemetryEvent(eventName: string, timeout?: number) {
    if (!timeout) {
      timeout = getDefaultTimeout();
    }

    await this.waitForTelemetryReady();

    return poll(
      () => {
        const logs = this._readAndParseTelemetryLog();
        return logs.some(
          (logData) =>
            logData.attributes &&
            logData.attributes['event.name'] === `llxprt_code.${eventName}`,
        );
      },
      timeout,
      100,
    );
  }

  async waitForToolCall(
    toolName: string,
    timeout?: number,
    matchArgs?: (args: string) => boolean,
  ) {
    // Use environment-specific timeout
    if (!timeout) {
      timeout = getDefaultTimeout();
    }

    // Wait for telemetry to be ready before polling for tool calls
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
      timeout,
      100,
    );
  }

  async expectToolCallSuccess(
    toolNames: string[],
    timeout?: number,
    matchArgs?: (args: string) => boolean,
  ) {
    // Use environment-specific timeout
    if (!timeout) {
      timeout = getDefaultTimeout();
    }

    // Wait for telemetry to be ready before polling for tool calls
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
      timeout,
      100,
    );

    expect(
      success,
      `Expected to find successful toolCalls for ${JSON.stringify(toolNames)}`,
    ).toBe(true);
  }

  async waitForAnyToolCall(toolNames: string[], timeout?: number) {
    // Use environment-specific timeout
    if (!timeout) {
      timeout = getDefaultTimeout();
    }

    // Wait for telemetry to be ready before polling for tool calls
    await this.waitForTelemetryReady();

    return poll(
      () => {
        const toolLogs = this.readToolLogs();
        return toolNames.some((name) =>
          toolLogs.some((log) => log.toolRequest.name === name),
        );
      },
      timeout,
      100,
    );
  }

  _parseToolLogsFromStdout(stdout: string) {
    const logs: {
      timestamp: number;
      toolRequest: {
        name: string;
        args: string;
        success: boolean;
        duration_ms: number;
      };
    }[] = [];

    // The console output from Podman is JavaScript object notation, not JSON
    // Look for tool call events in the output
    // Updated regex to handle tool names with hyphens and underscores
    // Uses [^']* instead of .*? to avoid polynomial backtracking (CodeQL CWE-1333)
    const toolCallPattern =
      /body:\s*'Tool call:\s*([\w-]+)\.[^']*Success:\s*(\w+)\.[^']*Duration:\s*(\d+)ms\.'/g;
    const matches = [...stdout.matchAll(toolCallPattern)];

    for (const match of matches) {
      const toolName = match[1];
      const success = match[2] === 'true';
      const duration = parseInt(match[3], 10);

      // Try to find function_args nearby
      const matchIndex = match.index || 0;
      const contextStart = Math.max(0, matchIndex - 500);
      const contextEnd = Math.min(stdout.length, matchIndex + 500);
      const context = stdout.substring(contextStart, contextEnd);

      // Look for function_args in the context
      let args = '{}';
      const argsMatch = context.match(/function_args:\s*'([^']+)'/);
      if (argsMatch) {
        args = argsMatch[1];
      }

      // Also try to find function_name to double-check
      // Updated regex to handle tool names with hyphens and underscores
      const nameMatch = context.match(/function_name:\s*'([\w-]+)'/);
      const actualToolName = nameMatch ? nameMatch[1] : toolName;

      logs.push({
        timestamp: Date.now(),
        toolRequest: {
          name: actualToolName,
          args: args,
          success: success,
          duration_ms: duration,
        },
      });
    }

    // If no matches found with the simple pattern, try the JSON parsing approach
    // in case the format changes
    if (logs.length === 0) {
      const lines = stdout.split(os.EOL);
      let currentObject = '';
      let inObject = false;
      let braceDepth = 0;

      for (const line of lines) {
        if (!inObject && line.trim() === '{') {
          inObject = true;
          braceDepth = 1;
          currentObject = line + '\n';
        } else if (inObject) {
          currentObject += line + '\n';

          // Count braces
          for (const char of line) {
            if (char === '{') braceDepth++;
            else if (char === '}') braceDepth--;
          }

          // If we've closed all braces, try to parse the object
          if (braceDepth === 0) {
            inObject = false;
            try {
              const obj = JSON.parse(currentObject);

              // Check for tool call in different formats
              if (
                obj.body &&
                obj.body.includes('Tool call:') &&
                obj.attributes
              ) {
                const bodyMatch = obj.body.match(/Tool call: (\w+)\./);
                if (bodyMatch) {
                  logs.push({
                    timestamp: obj.timestamp || Date.now(),
                    toolRequest: {
                      name: bodyMatch[1],
                      args: obj.attributes.function_args || '{}',
                      success: obj.attributes.success !== false,
                      duration_ms: obj.attributes.duration_ms || 0,
                    },
                  });
                }
              } else if (
                obj.attributes &&
                obj.attributes['event.name'] === 'llxprt_code.tool_call'
              ) {
                logs.push({
                  timestamp: obj.attributes['event.timestamp'],
                  toolRequest: {
                    name: obj.attributes.function_name,
                    args: obj.attributes.function_args,
                    success: obj.attributes.success,
                    duration_ms: obj.attributes.duration_ms,
                  },
                });
              }
            } catch {
              // Not valid JSON
            }
            currentObject = '';
          }
        }
      }
    }

    return logs;
  }

  private _readAndParseTelemetryLog(): ParsedLog[] {
    // Telemetry is always written to the test directory
    const logFilePath = join(this.testDir!, 'telemetry.log');

    if (!logFilePath || !fs.existsSync(logFilePath)) {
      return [];
    }

    const content = readFileSync(logFilePath, 'utf-8');

    // Split the content into individual JSON objects
    // They are separated by "}\n{"
    const jsonObjects = content
      .split(/}\n{/)
      .map((obj, index, array) => {
        // Add back the braces we removed during split
        if (index > 0) obj = '{' + obj;
        if (index < array.length - 1) obj = obj + '}';
        return obj.trim();
      })
      .filter((obj) => obj);

    const logs: ParsedLog[] = [];

    for (const jsonStr of jsonObjects) {
      try {
        const logData = JSON.parse(jsonStr);
        logs.push(logData);
      } catch (e) {
        // Skip objects that aren't valid JSON
        if (env['VERBOSE'] === 'true') {
          console.error('Failed to parse telemetry object:', e);
        }
      }
    }

    return logs;
  }

  readToolLogs() {
    // For Podman, first check if telemetry file exists and has content
    // If not, fall back to parsing from stdout
    if (env['LLXPRT_SANDBOX'] === 'podman') {
      // Try reading from file first
      const logFilePath = join(this.testDir!, 'telemetry.log');

      if (fs.existsSync(logFilePath)) {
        try {
          const content = readFileSync(logFilePath, 'utf-8');
          if (content && content.includes('"event.name"')) {
            // File has content, use normal file parsing
            // Continue to the normal file parsing logic below
          } else if (this._lastRunStdout) {
            // File exists but is empty or doesn't have events, parse from stdout
            return this._parseToolLogsFromStdout(this._lastRunStdout);
          }
        } catch {
          // Error reading file, fall back to stdout
          if (this._lastRunStdout) {
            return this._parseToolLogsFromStdout(this._lastRunStdout);
          }
        }
      } else if (this._lastRunStdout) {
        // No file exists, parse from stdout
        return this._parseToolLogsFromStdout(this._lastRunStdout);
      }
    }

    const parsedLogs = this._readAndParseTelemetryLog();
    const logs: {
      toolRequest: {
        name: string;
        args: string;
        success: boolean;
        duration_ms: number;
      };
    }[] = [];

    for (const logData of parsedLogs) {
      // Look for tool call logs
      if (
        logData.attributes &&
        logData.attributes['event.name'] === 'llxprt_code.tool_call'
      ) {
        const toolName = logData.attributes.function_name!;
        logs.push({
          toolRequest: {
            name: toolName,
            args: logData.attributes.function_args ?? '{}',
            success: logData.attributes.success ?? false,
            duration_ms: logData.attributes.duration_ms ?? 0,
          },
        });
      }
    }

    return logs;
  }

  readAllApiRequest(): ParsedLog[] {
    const logs = this._readAndParseTelemetryLog();
    const apiRequests = logs.filter(
      (logData) =>
        logData.attributes &&
        logData.attributes['event.name'] === 'llxprt_code.api_request',
    );
    return apiRequests;
  }

  readLastApiRequest(): ParsedLog | null {
    const logs = this._readAndParseTelemetryLog();
    const apiRequests = logs.filter(
      (logData) =>
        logData.attributes &&
        logData.attributes['event.name'] === 'llxprt_code.api_request',
    );
    return apiRequests.pop() || null;
  }

  async waitForMetric(metricName: string, timeout?: number) {
    await this.waitForTelemetryReady();

    const fullName = metricName.startsWith('llxprt_code.')
      ? metricName
      : `llxprt_code.${metricName}`;

    return poll(
      () => {
        const logs = this._readAndParseTelemetryLog();
        for (const logData of logs) {
          if (logData.scopeMetrics) {
            for (const scopeMetric of logData.scopeMetrics) {
              for (const metric of scopeMetric.metrics) {
                if (metric.descriptor.name === fullName) {
                  return true;
                }
              }
            }
          }
        }
        return false;
      },
      timeout ?? getDefaultTimeout(),
      100,
    );
  }

  readMetric(metricName: string): Record<string, unknown> | null {
    const logs = this._readAndParseTelemetryLog();
    for (const logData of logs) {
      if (logData.scopeMetrics) {
        for (const scopeMetric of logData.scopeMetrics) {
          for (const metric of scopeMetric.metrics) {
            if (metric.descriptor.name === `llxprt_code.${metricName}`) {
              return metric;
            }
          }
        }
      }
    }
    return null;
  }

  async runInteractive(options?: {
    args?: string | string[];
    yolo?: boolean;
  }): Promise<InteractiveRun> {
    const yolo = options?.yolo !== false;
    const { command, initialArgs } = this._getCommandAndArgs(
      yolo ? ['--yolo'] : [],
    );
    const commandArgs = [...initialArgs];

    if (options?.args) {
      if (Array.isArray(options.args)) {
        commandArgs.push(...options.args);
      } else {
        commandArgs.push(options.args);
      }
    }

    // Filter out TERM_PROGRAM to prevent IDE detection
    const filteredEnv = Object.entries(process.env).reduce(
      (acc, [key, value]) => {
        if (
          value !== undefined &&
          key !== 'TERM_PROGRAM' &&
          key !== 'TERM_PROGRAM_VERSION'
        ) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, string>,
    );

    const ptyOptions: pty.IPtyForkOptions = {
      name: 'xterm-color',
      cols: 80,
      rows: 80,
      cwd: this.testDir!,
      env: filteredEnv,
    };

    const executable = command === 'node' ? process.execPath : command;
    const ptyProcess = pty.spawn(executable, commandArgs, ptyOptions);

    const run = new InteractiveRun(ptyProcess);
    this._interactiveRuns.push(run);
    // Wait for the app to be ready
    await run.expectText('  Type your message or @path/to/file', 30000);
    return run;
  }

  readHookLogs() {
    const parsedLogs = this._readAndParseTelemetryLog();
    const logs: {
      hookCall: {
        hook_event_name: string;
        hook_name: string;
        hook_input: Record<string, unknown>;
        hook_output: Record<string, unknown>;
        exit_code: number;
        stdout: string;
        stderr: string;
        duration_ms: number;
        success: boolean;
        error: string;
      };
    }[] = [];

    for (const logData of parsedLogs) {
      // Look for tool call logs
      if (
        logData.attributes &&
        logData.attributes['event.name'] === 'llxprt_code.hook_call'
      ) {
        logs.push({
          hookCall: {
            hook_event_name: logData.attributes.hook_event_name ?? '',
            hook_name: logData.attributes.hook_name ?? '',
            hook_input: logData.attributes.hook_input ?? {},
            hook_output: logData.attributes.hook_output ?? {},
            exit_code: logData.attributes.exit_code ?? 0,
            stdout: logData.attributes.stdout ?? '',
            stderr: logData.attributes.stderr ?? '',
            duration_ms: logData.attributes.duration_ms ?? 0,
            success: logData.attributes.success ?? false,
            error: logData.attributes.error ?? '',
          },
        });
      }
    }

    return logs;
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
      // Give it a moment to process
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (predicateFn()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`pollCommand timed out after ${timeout}ms`);
  }
}
