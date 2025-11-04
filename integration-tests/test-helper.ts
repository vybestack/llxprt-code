/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync, spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { env } from 'process';
import { EOL } from 'os';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function sanitizeTestName(name: string) {
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
      return false;
    } else if (process.env.VERBOSE === 'true') {
      console.log(`${testName}: Model output validated successfully.`);
    }
    return true;
  }

  return true;
}

export class TestRig {
  bundlePath: string;
  testDir: string | null;
  testName?: string;
  _lastRunStdout?: string;

  constructor() {
    this.bundlePath = join(__dirname, '..', 'bundle/llxprt.js');
    this.testDir = null;

    // Bundle path is set
  }

  // Get timeout based on environment
  getDefaultTimeout() {
    if (env.CI) return 60000; // 1 minute in CI
    if (env.GEMINI_SANDBOX) return 30000; // 30s in containers
    return 15000; // 15s locally
  }

  setup(
    testName: string,
    options: { settings?: Record<string, unknown> } = {},
  ) {
    this.testName = testName;
    const sanitizedName = sanitizeTestName(testName);
    this.testDir = join(env.INTEGRATION_TEST_FILE_DIR!, sanitizedName);
    mkdirSync(this.testDir, { recursive: true });

    // Create a settings file to point the CLI to the local collector
    const llxprtDir = join(this.testDir, '.llxprt');
    mkdirSync(llxprtDir, { recursive: true });
    // In sandbox mode, use an absolute path for telemetry inside the container
    // The container mounts the test directory at the same path as the host
    const telemetryPath = join(this.testDir, 'telemetry.log'); // Always use test directory for telemetry

    const settings = {
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
      sandbox: env.GEMINI_SANDBOX !== 'false' ? env.GEMINI_SANDBOX : false,
      selectedAuthType: 'provider', // Use provider-based auth (API keys)
      provider: env.LLXPRT_DEFAULT_PROVIDER, // No default - must be set explicitly
      debug: true, // Enable debug logging
      ...options.settings, // Allow tests to override/add settings
    };
    writeFileSync(
      join(llxprtDir, 'settings.json'),
      JSON.stringify(settings, null, 2),
    );

    const profileName = env.LLXPRT_TEST_PROFILE?.trim();
    if (profileName) {
      const profilesDir = join(llxprtDir, 'profiles');
      mkdirSync(profilesDir, { recursive: true });

      const profileProvider =
        env.LLXPRT_DEFAULT_PROVIDER && env.LLXPRT_DEFAULT_PROVIDER.trim().length
          ? env.LLXPRT_DEFAULT_PROVIDER
          : 'openai';
      const profileModel =
        env.LLXPRT_DEFAULT_MODEL && env.LLXPRT_DEFAULT_MODEL.trim().length
          ? env.LLXPRT_DEFAULT_MODEL
          : 'gpt-4o-mini';

      const ephemeralEntries: Array<[string, unknown]> = [];
      if (env.OPENAI_BASE_URL && env.OPENAI_BASE_URL.trim().length > 0) {
        ephemeralEntries.push(['base-url', env.OPENAI_BASE_URL]);
      }
      if (env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim().length > 0) {
        ephemeralEntries.push(['auth-key', env.OPENAI_API_KEY]);
      }
      if (env.LLXPRT_TEST_PROFILE_KEYFILE) {
        ephemeralEntries.push([
          'auth-keyfile',
          env.LLXPRT_TEST_PROFILE_KEYFILE,
        ]);
      }
      if (env.LLXPRT_CONTEXT_LIMIT) {
        const parsedLimit = Number(env.LLXPRT_CONTEXT_LIMIT);
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
      | { prompt?: string; stdin?: string; stdinDoesNotEnd?: boolean },
    ...args: string[]
  ): Promise<string> {
    // Add provider and model flags from environment - FAIL FAST if not configured
    const provider = env.LLXPRT_DEFAULT_PROVIDER;
    const model = env.LLXPRT_DEFAULT_MODEL;
    const baseUrl = env.OPENAI_BASE_URL;
    const apiKey = env.OPENAI_API_KEY;

    // Debug: Log environment variables in CI
    if (env.CI === 'true' || env.VERBOSE === 'true') {
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
    if (provider === 'openai' && !apiKey) {
      throw new Error(
        'OPENAI_API_KEY environment variable is required for OpenAI provider but not set',
      );
    }

    // Build command args array directly instead of parsing a string
    // This avoids Windows-specific command line parsing issues
    const commandArgs = [
      'node',
      this.bundlePath,
      '--yolo',
      '--ide-mode',
      'disable',
      '--provider',
      provider,
      '--model',
      model,
    ];

    // Add baseurl if using openai provider
    if (provider === 'openai' && baseUrl) {
      commandArgs.push('--baseurl', baseUrl);
    }

    // Add API key if available
    // Add API key if available
    if (apiKey) {
      commandArgs.push('--key', apiKey);
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
      },
    };

    if (typeof promptOrOptions === 'string') {
      commandArgs.push('--prompt', promptOrOptions);
    } else if (
      typeof promptOrOptions === 'object' &&
      promptOrOptions !== null
    ) {
      if (promptOrOptions.prompt) {
        commandArgs.push('--prompt', promptOrOptions.prompt);
      }
      if (promptOrOptions.stdin) {
        execOptions.input = promptOrOptions.stdin;
      }
    }

    // Add any additional args
    commandArgs.push(...args);

    if (env.LLXPRT_TEST_PROFILE?.trim()) {
      commandArgs.push('--profile-load', env.LLXPRT_TEST_PROFILE.trim());
    }

    const node = commandArgs.shift() as string;

    // Debug: Log command being executed in CI
    if (env.CI === 'true' || env.VERBOSE === 'true') {
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
      if (env.KEEP_OUTPUT === 'true' || env.VERBOSE === 'true') {
        process.stdout.write(data);
      }
    });

    child.stderr!.on('data', (data: Buffer) => {
      stderr += data;
      if (env.KEEP_OUTPUT === 'true' || env.VERBOSE === 'true') {
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
          if (env.GEMINI_SANDBOX === 'podman') {
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
    if (env.KEEP_OUTPUT === 'true' || env.VERBOSE === 'true') {
      console.log(`--- FILE: ${filePath} ---`);
      console.log(content);
      console.log(`--- END FILE: ${filePath} ---`);
    }
    return content;
  }

  async cleanup() {
    // Clean up test directory
    if (this.testDir && !env.KEEP_OUTPUT) {
      try {
        if (process.platform === 'win32') {
          // On Windows, use fs.rmSync which handles permissions better
          fs.rmSync(this.testDir, { recursive: true, force: true });
        } else {
          execSync(`rm -rf ${this.testDir}`);
        }
      } catch (error) {
        // Ignore cleanup errors
        if (env.VERBOSE === 'true') {
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
    await this.poll(
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
      timeout = this.getDefaultTimeout();
    }

    await this.waitForTelemetryReady();

    return this.poll(
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

  async waitForToolCall(toolName: string, timeout?: number) {
    // Use environment-specific timeout
    if (!timeout) {
      timeout = this.getDefaultTimeout();
    }

    // Wait for telemetry to be ready before polling for tool calls
    await this.waitForTelemetryReady();

    return this.poll(
      () => {
        const toolLogs = this.readToolLogs();
        return toolLogs.some((log) => log.toolRequest.name === toolName);
      },
      timeout,
      100,
    );
  }

  async waitForAnyToolCall(toolNames: string[], timeout?: number) {
    // Use environment-specific timeout
    if (!timeout) {
      timeout = this.getDefaultTimeout();
    }

    // Wait for telemetry to be ready before polling for tool calls
    await this.waitForTelemetryReady();

    return this.poll(
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

  async poll(
    predicate: () => boolean,
    timeout: number,
    interval: number,
  ): Promise<boolean> {
    const startTime = Date.now();
    let attempts = 0;
    while (Date.now() - startTime < timeout) {
      attempts++;
      const result = predicate();
      if (env.VERBOSE === 'true' && attempts % 5 === 0) {
        console.log(
          `Poll attempt ${attempts}: ${result ? 'success' : 'waiting...'}`,
        );
      }
      if (result) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    if (env.VERBOSE === 'true') {
      console.log(`Poll timed out after ${attempts} attempts`);
    }
    return false;
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
    if (env.GEMINI_SANDBOX === 'podman') {
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
      if (process.env.VERBOSE === 'true') {
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
        if (env.VERBOSE === 'true') {
          console.error('Failed to parse telemetry object:', e);
        }
      }
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
}
