/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from 'node:process';
import { EOL } from 'node:os';
import fs from 'node:fs';
import * as pty from '@lydell/node-pty';
import * as os from 'node:os';
import stripAnsi from 'strip-ansi';
import { expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

function sanitizeTestName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-');
}

// Get timeout based on environment
function getDefaultTimeout() {
  if (env['CI']) return 60000; // 1 minute in CI
  if (env['LLXPRT_SANDBOX']) return 30000; // 30s in containers
  return 60000; // 60s locally
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

export class InteractiveRun {
  ptyProcess: pty.IPty;
  public output = '';

  constructor(ptyProcess: pty.IPty) {
    this.ptyProcess = ptyProcess;
    ptyProcess.onData((data) => {
      this.output += data;
      if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
        process.stdout.write(data);
      }
    });
  }

  // Note: Named expectText (not waitForText) to match upstream final state
  // This incorporates commit a73b8145 which renames waitFor* → expect*
  async expectText(text: string, timeout?: number) {
    if (!timeout) {
      timeout = getDefaultTimeout();
    }
    const found = await poll(
      () => stripAnsi(this.output).toLowerCase().includes(text.toLowerCase()),
      timeout,
      200,
    );
    expect(found, `Did not find expected text: "${text}"`).toBe(true);
  }

  async expectAnyText(texts: string[], timeout?: number) {
    if (!timeout) {
      timeout = getDefaultTimeout();
    }
    const lowered = texts.map((text) => text.toLowerCase());
    const found = await poll(
      () => {
        const output = stripAnsi(this.output).toLowerCase();
        return lowered.some((text) => output.includes(text));
      },
      timeout,
      200,
    );
    if (!found) {
      console.error('Interactive output snapshot (last 2000 chars):');
      console.error(stripAnsi(this.output).slice(-2000));
    }
    expect(
      found,
      `Did not find expected text: ${texts.map((text) => `"${text}"`).join(' or ')}`,
    ).toBe(true);
  }

  // Simulates typing a string one character at a time to avoid paste detection.
  async type(text: string) {
    const delay = 5;
    for (const char of text) {
      this.ptyProcess.write(char);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Types an entire string at once, necessary for some things like commands
  // but may run into paste detection issues for larger strings.
  async sendText(text: string) {
    this.ptyProcess.write(text);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  async kill() {
    this.ptyProcess.kill();
  }

  // Note: Named expectExit (not waitForExit) to match upstream final state
  // This incorporates commit a73b8145 which renames waitFor* → expect*
  expectExit(): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`Test timed out: process did not exit within a minute.`),
          ),
        60000,
      );
      this.ptyProcess.onExit(({ exitCode }) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
  }
}

export class TestRig {
  bundlePath: string;
  testDir: string | null;
  testName?: string;
  _lastRunStdout?: string;
  _interactiveOutput: string = '';

  constructor() {
    this.bundlePath = join(__dirname, '..', 'bundle/llxprt.js');
    this.testDir = null;

    // Bundle path is set
  }

  setup(
    testName: string,
    options: { settings?: Record<string, unknown> } = {},
  ) {
    this.testName = testName;
    const sanitizedName = sanitizeTestName(testName);
    this.testDir = join(env['INTEGRATION_TEST_FILE_DIR']!, sanitizedName);
    mkdirSync(this.testDir, { recursive: true });

    // Create a settings file to point the CLI to the local collector
    const llxprtDir = join(this.testDir, '.llxprt');
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
        disableAutoUpdate: true,
      },
      ui: {
        theme: 'Green Screen',
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

  run(
    promptOrOptions:
      | string
      | {
          prompt?: string;
          stdin?: string;
          stdinDoesNotEnd?: boolean;
          yolo?: boolean;
        },
    ...args: string[]
  ): Promise<string> {
    // Add provider and model flags from environment - FAIL FAST if not configured
    const provider = env['LLXPRT_DEFAULT_PROVIDER'];
    const model = env['LLXPRT_DEFAULT_MODEL'];
    const baseUrl = env['OPENAI_BASE_URL'];
    const apiKey = env['OPENAI_API_KEY'];
    const keyFile =
      env['OPENAI_API_KEYFILE'] ?? env['LLXPRT_TEST_PROFILE_KEYFILE'];

    // Debug: Log environment variables in CI
    if (env['CI'] === 'true' || env['VERBOSE'] === 'true') {
      console.log('[TestRig] Environment variables:', {
        provider,
        model,
        baseUrl: baseUrl ? `${baseUrl.substring(0, 30)}...` : 'UNDEFINED',
        hasApiKey: !!apiKey,
      });
    }

    // Fail fast if required configuration is missing
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

    // Determine yolo mode: default true unless explicitly set to false
    const yolo =
      typeof promptOrOptions === 'string' || promptOrOptions.yolo !== false;

    // Build command args array directly instead of parsing a string
    // This avoids Windows-specific command line parsing issues
    const commandArgs = [
      'node',
      this.bundlePath,
      ...(yolo ? ['--yolo'] : []),
      '--ide-mode',
      'disable',
      '--provider',
      provider,
      '--model',
      model,
    ];

    const prompts: string[] = [];

    // Add baseurl if using openai provider
    if (provider === 'openai' && baseUrl) {
      commandArgs.push('--baseurl', baseUrl);
    }

    // Add API key if available
    if (apiKey) {
      commandArgs.push('--key', apiKey);
    } else if (keyFile) {
      commandArgs.push('--keyfile', keyFile);
    }

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
      },
    };

    const promptIsStdin =
      typeof promptOrOptions === 'object' &&
      promptOrOptions !== null &&
      promptOrOptions.stdin;

    const promptUsesStdinFlag =
      typeof promptOrOptions === 'object' &&
      promptOrOptions !== null &&
      promptOrOptions.stdin &&
      promptOrOptions.prompt;

    if (typeof promptOrOptions === 'string') {
      prompts.push(promptOrOptions);
    } else if (
      typeof promptOrOptions === 'object' &&
      promptOrOptions !== null
    ) {
      if (promptOrOptions.prompt) {
        prompts.push(promptOrOptions.prompt);
      }
      if (promptOrOptions.stdin) {
        execOptions.input = promptOrOptions.stdin;
      }
    }

    const promptValue = prompts.join(' ');

    if (promptValue) {
      if (promptUsesStdinFlag) {
        commandArgs.push('--prompt', promptValue);
      } else if (!promptIsStdin) {
        commandArgs.push('--prompt', promptValue);
      }
    }

    // Add any additional args
    commandArgs.push(...args);

    if (env['LLXPRT_TEST_PROFILE']?.trim()) {
      const profileName = env['LLXPRT_TEST_PROFILE'].trim();
      // Keep 'node' and bundlePath at the front; insert flags after them.
      commandArgs.splice(2, 0, '--profile-load', profileName);
    }

    const node = commandArgs.shift() as string;
    const isJsonOutput =
      (commandArgs.includes('--output-format') &&
        commandArgs[commandArgs.indexOf('--output-format') + 1] === 'json') ||
      commandArgs.some((arg) => arg.startsWith('--output-format=json'));

    // Debug: Log command being executed in CI
    if (env['CI'] === 'true' || env['VERBOSE'] === 'true') {
      console.log('[TestRig] Spawning command:', {
        node,
        args: commandArgs,
        hasBaseUrl: commandArgs.includes('--baseurl'),
        baseUrlIndex: commandArgs.indexOf('--baseurl'),
      });
    }

    const child = spawn(node, commandArgs as string[], {
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

    if (
      typeof promptOrOptions === 'object' &&
      !promptOrOptions.stdinDoesNotEnd
    ) {
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
      // Add timeout for Windows when stdin doesn't end
      let timeoutId: NodeJS.Timeout | null = null;
      if (
        typeof promptOrOptions === 'object' &&
        promptOrOptions.stdinDoesNotEnd &&
        process.platform === 'win32'
      ) {
        // On Windows, force terminate after 2 seconds if process doesn't exit
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          // If SIGTERM doesn't work on Windows, try SIGKILL
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 500);
        }, 2000);
      }

      child.on('close', (code: number | null) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // On Windows, when we forcefully kill a process, code might be null
        // Treat this as exit code 1 for consistency with Unix behavior
        if (process.platform === 'win32' && code === null) {
          code = 1;
        }

        if (code === 0) {
          // Store the raw stdout for Podman telemetry parsing
          this._lastRunStdout = stdout;

          // Filter out telemetry output when running with Podman
          // Podman seems to output telemetry to stdout even when writing to file
          let result = stdout;
          if (env['LLXPRT_SANDBOX'] === 'podman') {
            // Remove telemetry JSON objects from output
            // They are multi-line JSON objects that start with { and contain telemetry fields
            const lines = result.split(EOL);
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
          // If we have stderr output, include that also
          if (stderr && !isJsonOutput) {
            result += `\n\nStdErr:\n${stderr}`;
          }

          resolve(result);
        } else {
          const trimmedStdout = stdout.trimEnd();
          const trimmedStderr = stderr.trimEnd();
          let message = `Process exited with code ${code}.`;
          if (trimmedStdout) {
            message += `\n\nStdOut:\n${trimmedStdout}`;
          }
          if (trimmedStderr) {
            message += `\n\nStdErr:\n${trimmedStderr}`;
          }
          reject(new Error(message));
        }
      });
    });

    return promise;
  }

  /**
   * Runs a CLI command (non-interactive) and returns the output.
   * Used for extension commands like install, list, update, uninstall.
   */
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
            result += `

StdErr:
${stderr}`;
          }
          resolve(result);
        } else {
          reject(
            new Error(`Process exited with code ${code}:
${stderr}`),
          );
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
          return content.includes('"event.name"');
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
        const logFilePath = join(this.testDir!, 'telemetry.log');

        if (!logFilePath || !fs.existsSync(logFilePath)) {
          return false;
        }

        const content = readFileSync(logFilePath, 'utf-8');
        const jsonObjects = content
          .split(/}\n{/)
          .map((obj, index, array) => {
            // Add back the braces we removed during split
            if (index > 0) obj = '{' + obj;
            if (index < array.length - 1) obj = obj + '}';
            return obj.trim();
          })
          .filter((obj) => obj);

        for (const jsonStr of jsonObjects) {
          try {
            const logData = JSON.parse(jsonStr);
            if (
              logData.attributes &&
              logData.attributes['event.name'] === `llxprt_code.${eventName}`
            ) {
              return true;
            }
          } catch {
            // ignore
          }
        }
        return false;
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

  async expectToolCallSuccess(
    toolNames: string | string[],
    timeout?: number,
  ): Promise<void> {
    if (!timeout) {
      timeout = getDefaultTimeout();
    }

    const names = Array.isArray(toolNames) ? toolNames : [toolNames];

    await this.waitForTelemetryReady();

    const found = await poll(
      () => {
        const toolLogs = this.readToolLogs();
        return toolLogs.some(
          (log) =>
            names.includes(log.toolRequest.name) &&
            log.toolRequest.success === true,
        );
      },
      timeout,
      100,
    );

    expect(
      found,
      `Expected successful tool call for: ${names.join(', ')}`,
    ).toBe(true);
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

    // First, try to parse the simple VERBOSE format: [TELEMETRY] logToolCall: <name>
    // This is emitted when telemetry SDK is not initialized (common in E2E tests)
    const simplePattern = /\[TELEMETRY\] logToolCall: ([\w_-]+)/g;
    const simpleMatches = [...stdout.matchAll(simplePattern)];

    for (const match of simpleMatches) {
      const toolName = match[1];
      const matchIndex = match.index || 0;

      // Look for error message immediately following this tool call
      // Pattern: "Error executing tool <name>: Error: <message>"
      const afterMatch = stdout.substring(
        matchIndex,
        Math.min(stdout.length, matchIndex + 500),
      );
      const errorPattern = new RegExp(
        `Error executing tool ${toolName}:.*Error:`,
      );
      const hasError = errorPattern.test(afterMatch);

      logs.push({
        timestamp: Date.now(),
        toolRequest: {
          name: toolName,
          args: '{}',
          success: !hasError,
          duration_ms: 0,
        },
      });
    }

    // If we found logs with the simple pattern, return them
    if (logs.length > 0) {
      return logs;
    }

    // The console output from Podman is JavaScript object notation, not JSON
    // Look for tool call events in the output
    // Updated regex to handle tool names with hyphens and underscores
    const toolCallPattern =
      /body:\s*'Tool call:\s*([\w-]+)\..*?Success:\s*(\w+)\..*?Duration:\s*(\d+)ms\.'/g;
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
      const lines = stdout.split(EOL);
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

    // Telemetry is always written to the test directory
    const logFilePath = join(this.testDir!, 'telemetry.log');

    if (!logFilePath) {
      // Don't warn in CI/test environments, it's expected
      if (process.env['VERBOSE'] === 'true') {
        console.warn(`TELEMETRY_LOG_FILE environment variable not set`);
      }
      return [];
    }

    // Check if file exists, if not return empty array (file might not be created yet)
    if (!fs.existsSync(logFilePath)) {
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

    const logs: {
      toolRequest: {
        name: string;
        args: string;
        success: boolean;
        duration_ms: number;
      };
    }[] = [];

    for (const jsonStr of jsonObjects) {
      try {
        const logData = JSON.parse(jsonStr);
        // Look for tool call logs
        if (
          logData.attributes &&
          logData.attributes['event.name'] === 'llxprt_code.tool_call'
        ) {
          const toolName = logData.attributes.function_name;
          logs.push({
            toolRequest: {
              name: toolName,
              args: logData.attributes.function_args,
              success: logData.attributes.success,
              duration_ms: logData.attributes.duration_ms,
            },
          });
        }
      } catch (e) {
        // Skip objects that aren't valid JSON
        if (env['VERBOSE'] === 'true') {
          console.error('Failed to parse telemetry object:', e);
        }
      }
    }

    // If no logs found in telemetry file, try parsing from stdout/stderr
    // This happens when the telemetry SDK is not initialized (common in E2E tests)
    if (logs.length === 0 && this._lastRunStdout) {
      return this._parseToolLogsFromStdout(this._lastRunStdout);
    }

    return logs;
  }

  readLastApiRequest(): Record<string, unknown> | null {
    // Telemetry is always written to the test directory
    const logFilePath = join(this.testDir!, 'telemetry.log');

    if (!logFilePath || !fs.existsSync(logFilePath)) {
      return null;
    }

    const content = readFileSync(logFilePath, 'utf-8');
    const jsonObjects = content
      .split(/}\n{/)
      .map((obj, index, array) => {
        if (index > 0) obj = '{' + obj;
        if (index < array.length - 1) obj = obj + '}';
        return obj.trim();
      })
      .filter((obj) => obj);

    let lastApiRequest = null;

    for (const jsonStr of jsonObjects) {
      try {
        const logData = JSON.parse(jsonStr);
        if (
          logData.attributes &&
          logData.attributes['event.name'] === 'llxprt_code.api_request'
        ) {
          lastApiRequest = logData;
        }
      } catch {
        // ignore
      }
    }
    return lastApiRequest;
  }

  private _getCommandAndArgs(extraInitialArgs: string[] = []): {
    command: string;
    initialArgs: string[];
  } {
    const command = 'node';
    const initialArgs = [this.bundlePath, ...extraInitialArgs];
    return { command, initialArgs };
  }

  async waitForText(text: string, timeout?: number) {
    if (!timeout) {
      timeout = getDefaultTimeout();
    }
    const found = await poll(
      () =>
        stripAnsi(this._interactiveOutput)
          .toLowerCase()
          .includes(text.toLowerCase()),
      timeout,
      200,
    );
    expect(found, `Did not find expected text: "${text}"`).toBe(true);
  }

  async runInteractive(...args: string[]): Promise<InteractiveRun> {
    const { command, initialArgs } = this._getCommandAndArgs([
      '--yolo',
      ...args,
    ]);
    const isWindows = os.platform() === 'win32';

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

    const options: pty.IPtyForkOptions = {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: this.testDir!,
      env: {
        ...filteredEnv,
        // Keep interactive tests deterministic:
        // - Avoid auto-opening theme selection dialog
        // - Avoid launching browsers during auth flows
        NO_COLOR: 'true',
        NO_BROWSER: 'true',
        LLXPRT_NO_BROWSER_AUTH: 'true',
        CI: 'true',
        LLXPRT_DEFAULT_PROVIDER: env['LLXPRT_DEFAULT_PROVIDER'],
        LLXPRT_DEFAULT_MODEL: env['LLXPRT_DEFAULT_MODEL'],
        OPENAI_API_KEY: env['OPENAI_API_KEY'],
        OPENAI_API_KEYFILE: env['OPENAI_API_KEYFILE'],
        LLXPRT_TEST_PROFILE_KEYFILE: env['LLXPRT_TEST_PROFILE_KEYFILE'],
        OPENAI_BASE_URL: env['OPENAI_BASE_URL'],
        LLXPRT_SANDBOX: 'false',
      },
    };

    if (isWindows) {
      // node-pty on Windows requires a shell to be specified when using winpty.
      options.shell = process.env.COMSPEC || 'cmd.exe';
    }

    const ptyProcess = pty.spawn(command, initialArgs, options);

    const run = new InteractiveRun(ptyProcess);
    // Wait for the app to be ready (input prompt rendered).
    await run.expectAnyText(
      [
        'Type your message or @path/to/file',
        'Type your message, @path/to/file or +path/to/file',
        'Create LLXPRT.md files to customize your interactions',
        'Create GEMINI.md files to customize your interactions',
      ],
      60000,
    );
    return run;
  }
}
