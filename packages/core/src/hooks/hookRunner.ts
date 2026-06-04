/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P08
 * @requirement:HOOK-061,HOOK-063,HOOK-064,HOOK-065,HOOK-066,HOOK-067a,HOOK-067b,HOOK-068,HOOK-069,HOOK-070
 * @pseudocode:analysis/pseudocode/02-hook-event-handler-flow.md
 */

import { spawn } from 'node:child_process';
import type { HookConfig, BeforeToolInput } from './types.js';
import { HookEventName } from './types.js';
import type {
  HookInput,
  HookOutput,
  HookExecutionResult,
  BeforeAgentInput,
  BeforeModelInput,
  BeforeModelOutput,
} from './types.js';
import type { LLMRequest } from './hookTranslator.js';
import { DebugLogger } from '../debug/index.js';
import type { Config } from '../config/config.js';
import { sanitizeEnvironment } from '../services/environmentSanitization.js';
import {
  escapeShellArg,
  getShellConfiguration,
  type ShellType,
} from '../utils/shell-utils.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:hooks:runner');

/**
 * Default timeout for hook execution (60 seconds)
 */
const DEFAULT_HOOK_TIMEOUT = 60000;

/**
 * Exit code constants for hook execution
 */
const EXIT_CODE_SUCCESS = 0;
const EXIT_CODE_BLOCKING_ERROR = 2;
const EXIT_CODE_NON_BLOCKING_ERROR = 1;

/**
 * Hook runner that executes command hooks
 */
export class HookRunner {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Execute a single hook
   */
  async executeHook(
    hookConfig: HookConfig,
    eventName: HookEventName,
    input: HookInput,
  ): Promise<HookExecutionResult> {
    const startTime = Date.now();

    try {
      return await this.executeCommandHook(
        hookConfig,
        eventName,
        input,
        startTime,
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string name/command should fall through to next option or 'unknown' */
      const hookId = hookConfig.name || hookConfig.command || 'unknown';
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      const errorMessage = `Hook execution failed for event '${eventName}' (hook: ${hookId}): ${error}`;
      debugLogger.warn(`Hook execution error (non-fatal): ${errorMessage}`);

      return {
        hookConfig,
        eventName,
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
        duration,
      };
    }
  }

  /**
   * Execute multiple hooks in parallel
   */
  async executeHooksParallel(
    hookConfigs: HookConfig[],
    eventName: HookEventName,
    input: HookInput,
  ): Promise<HookExecutionResult[]> {
    const promises = hookConfigs.map((config) =>
      this.executeHook(config, eventName, input),
    );

    return Promise.all(promises);
  }

  /**
   * Execute multiple hooks sequentially
   */
  async executeHooksSequential(
    hookConfigs: HookConfig[],
    eventName: HookEventName,
    input: HookInput,
  ): Promise<HookExecutionResult[]> {
    const results: HookExecutionResult[] = [];
    let currentInput = input;

    for (const config of hookConfigs) {
      const result = await this.executeHook(config, eventName, currentInput);
      results.push(result);

      // If the hook succeeded and has output, use it to modify the input for the next hook
      if (result.success && result.output) {
        currentInput = this.applyHookOutputToInput(
          currentInput,
          result.output,
          eventName,
        );
      }
    }

    return results;
  }

  /**
   * Apply hook output to modify input for the next hook in sequential execution
   */
  private applyHookOutputToInput(
    originalInput: HookInput,
    hookOutput: HookOutput,
    eventName: HookEventName,
  ): HookInput {
    // Create a copy of the original input
    const modifiedInput = { ...originalInput };

    // Apply modifications based on hook output and event type
    if (hookOutput.hookSpecificOutput) {
      switch (eventName) {
        case HookEventName.BeforeAgent:
          this.applyBeforeAgentOutput(modifiedInput, hookOutput);
          break;

        case HookEventName.BeforeModel:
          this.applyBeforeModelOutput(modifiedInput, hookOutput);
          break;

        case HookEventName.BeforeTool:
          this.applyBeforeToolOutput(modifiedInput, hookOutput);
          break;

        default:
          // For other events, no special input modification is needed
          break;
      }
    }

    return modifiedInput;
  }

  private applyBeforeAgentOutput(
    modifiedInput: HookInput,
    hookOutput: HookOutput,
  ): void {
    if (
      hookOutput.hookSpecificOutput &&
      'additionalContext' in hookOutput.hookSpecificOutput
    ) {
      const additionalContext =
        hookOutput.hookSpecificOutput['additionalContext'];
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (typeof additionalContext === 'string' && 'prompt' in modifiedInput) {
        (modifiedInput as BeforeAgentInput).prompt +=
          '\n\n' + additionalContext;
      }
    }
  }

  private applyBeforeModelOutput(
    modifiedInput: HookInput,
    hookOutput: HookOutput,
  ): void {
    if (
      hookOutput.hookSpecificOutput &&
      'llm_request' in hookOutput.hookSpecificOutput
    ) {
      const hookBeforeModelOutput = hookOutput as BeforeModelOutput;
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (
        hookBeforeModelOutput.hookSpecificOutput?.llm_request &&
        'llm_request' in modifiedInput
      ) {
        const currentRequest = (modifiedInput as BeforeModelInput).llm_request;
        const partialRequest =
          hookBeforeModelOutput.hookSpecificOutput.llm_request;
        (modifiedInput as BeforeModelInput).llm_request = {
          ...currentRequest,
          ...partialRequest,
        } as LLMRequest;
      }
    }
  }

  private applyBeforeToolOutput(
    modifiedInput: HookInput,
    hookOutput: HookOutput,
  ): void {
    if (
      hookOutput.hookSpecificOutput &&
      'tool_input' in hookOutput.hookSpecificOutput
    ) {
      const modifiedToolInput = hookOutput.hookSpecificOutput['tool_input'];
      // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      if (
        // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        modifiedToolInput !== null &&
        modifiedToolInput !== undefined &&
        typeof modifiedToolInput === 'object' &&
        !Array.isArray(modifiedToolInput) &&
        'tool_input' in modifiedInput
      ) {
        // Merge modified input with existing tool_input
        (modifiedInput as BeforeToolInput).tool_input = {
          ...(modifiedInput as BeforeToolInput).tool_input,
          ...(modifiedToolInput as Record<string, unknown>),
        };
      }
    }
  }

  /**
   * Execute a command hook
   */
  private async executeCommandHook(
    hookConfig: HookConfig,
    eventName: HookEventName,
    input: HookInput,
    startTime: number,
  ): Promise<HookExecutionResult> {
    // Secondary security check - block project hooks in untrusted folders
    const { ConfigSource } = await import('./hookRegistry.js');
    if (
      hookConfig.source === ConfigSource.Project &&
      !this.config.isTrustedFolder()
    ) {
      const errorMessage = 'Project hook blocked - folder not trusted';
      debugLogger.warn(errorMessage);
      return {
        hookConfig,
        eventName,
        success: false,
        error: new Error(errorMessage),
        duration: Date.now() - startTime,
      };
    }

    const timeout = hookConfig.timeout ?? DEFAULT_HOOK_TIMEOUT;

    return this.runHookProcess(
      hookConfig,
      eventName,
      input,
      startTime,
      timeout,
    );
  }

  private runHookProcess(
    hookConfig: HookConfig,
    eventName: HookEventName,
    input: HookInput,
    startTime: number,
    timeout: number,
  ): Promise<HookExecutionResult> {
    return new Promise((resolve) => {
      if (!hookConfig.command) {
        resolve(this.missingCommandResult(hookConfig, eventName, startTime));
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = this.spawnHookProcess(hookConfig, input);

      const timeoutHandle = this.setupKillTimeout(child, timeout, () => {
        timedOut = true;
      });

      this.writeToStdin(child, input);

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Hook output crosses plugin process boundaries despite declared types.
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Hook output crosses plugin process boundaries despite declared types.
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (exitCode) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;
        if (timedOut) {
          resolve(
            this.timeoutResult(
              hookConfig,
              eventName,
              timeout,
              stdout,
              stderr,
              duration,
            ),
          );
          return;
        }
        resolve(
          this.buildExitResult(
            hookConfig,
            eventName,
            exitCode,
            stdout,
            stderr,
            duration,
          ),
        );
      });

      child.on('error', (error) => {
        clearTimeout(timeoutHandle);
        resolve(
          this.errorResult(
            hookConfig,
            eventName,
            error,
            stdout,
            stderr,
            startTime,
          ),
        );
      });
    });
  }

  private missingCommandResult(
    hookConfig: HookConfig,
    eventName: HookEventName,
    startTime: number,
  ): HookExecutionResult {
    const errorMessage = 'Command hook missing command';
    debugLogger.warn(`Hook configuration error (non-fatal): ${errorMessage}`);
    return {
      hookConfig,
      eventName,
      success: false,
      error: new Error(errorMessage),
      duration: Date.now() - startTime,
    };
  }

  private setupKillTimeout(
    child: ReturnType<typeof spawn>,
    timeout: number,
    onTimeout: () => void,
  ): NodeJS.Timeout {
    return setTimeout(() => {
      onTimeout();
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, timeout);
  }

  private timeoutResult(
    hookConfig: HookConfig,
    eventName: HookEventName,
    timeout: number,
    stdout: string,
    stderr: string,
    duration: number,
  ): HookExecutionResult {
    return {
      hookConfig,
      eventName,
      success: false,
      error: new Error(`Hook timed out after ${timeout}ms`),
      stdout,
      stderr,
      duration,
    };
  }

  private errorResult(
    hookConfig: HookConfig,
    eventName: HookEventName,
    error: Error,
    stdout: string,
    stderr: string,
    startTime: number,
  ): HookExecutionResult {
    return {
      hookConfig,
      eventName,
      success: false,
      error,
      stdout,
      stderr,
      duration: Date.now() - startTime,
    };
  }

  private writeToStdin(
    child: ReturnType<typeof spawn>,
    input: HookInput,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- child.stdin type is Writable | null but TypeScript may narrow incorrectly based on spawn options
    if (child.stdin != null) {
      child.stdin.on('error', (err: NodeJS.ErrnoException) => {
        // Ignore EPIPE errors which happen when the child process closes stdin early
        if (err.code !== 'EPIPE') {
          debugLogger.debug(`Hook stdin error: ${err}`);
        }
      });
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
    }
  }

  private buildExitResult(
    hookConfig: HookConfig,
    eventName: HookEventName,
    exitCode: number | null,
    stdout: string,
    stderr: string,
    duration: number,
  ): HookExecutionResult {
    const effectiveErrorExitCode =
      exitCode !== null && exitCode !== 0 && !Number.isNaN(exitCode)
        ? exitCode
        : EXIT_CODE_NON_BLOCKING_ERROR;
    const effectiveResultExitCode =
      exitCode !== null && exitCode !== 0 && !Number.isNaN(exitCode)
        ? exitCode
        : EXIT_CODE_SUCCESS;

    const output = this.parseHookOutput(
      exitCode,
      stdout,
      stderr,
      effectiveErrorExitCode,
    );

    return {
      hookConfig,
      eventName,
      success: exitCode === EXIT_CODE_SUCCESS,
      output,
      stdout,
      stderr,
      exitCode: effectiveResultExitCode,
      duration,
    };
  }

  private spawnHookProcess(
    hookConfig: HookConfig,
    input: HookInput,
  ): ReturnType<typeof spawn> {
    // SECURITY: Get platform-specific shell configuration
    const shellConfig = getShellConfiguration();

    // SECURITY: Expand command with escaped variables
    const command = this.expandCommand(
      hookConfig.command,
      input,
      shellConfig.shell,
    );

    // Set up environment variables
    const sanitizationConfig = this.config.getSanitizationConfig();
    const env = {
      ...sanitizeEnvironment(
        process.env,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: undefined sanitizationConfig should default to config object
        sanitizationConfig || {
          enableEnvironmentVariableRedaction: false,
          allowedEnvironmentVariables: [],
          blockedEnvironmentVariables: [],
        },
      ),
      LLXPRT_PROJECT_DIR: input.cwd,
    };

    // SECURITY: Use explicit shell executable with shell: false
    // This prevents Node's shell interpretation layer
    return spawn(shellConfig.executable, [...shellConfig.argsPrefix, command], {
      env,
      cwd: input.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false, // CRITICAL: must be false to prevent injection
    });
  }

  private parseHookOutput(
    exitCode: number | null,
    stdout: string,
    stderr: string,
    effectiveErrorExitCode: number,
  ): HookOutput | undefined {
    if (exitCode === EXIT_CODE_SUCCESS && stdout.trim()) {
      try {
        let parsed = JSON.parse(stdout.trim());
        if (typeof parsed === 'string') {
          // If the output is a string, parse it in case
          // it's double-encoded JSON string.
          parsed = JSON.parse(parsed);
        }
        if (parsed !== null && parsed !== undefined) {
          return parsed as HookOutput;
        }
      } catch {
        // Not JSON, convert plain text to structured output
        return this.convertPlainTextToHookOutput(stdout.trim(), exitCode);
      }
    } else if (exitCode !== EXIT_CODE_SUCCESS && stderr.trim()) {
      // Convert error output to structured format
      return this.convertPlainTextToHookOutput(
        stderr.trim(),
        effectiveErrorExitCode,
      );
    }
    return undefined;
  }

  /**
   * Expand command with environment variables and input context
   *
   * SECURITY: All variable values are escaped before substitution to prevent injection
   */
  private expandCommand(
    command: string,
    input: HookInput,
    shellType: ShellType,
  ): string {
    debugLogger.debug(`Expanding hook command: ${command} (cwd: ${input.cwd})`);

    // SECURITY: Escape the cwd value to prevent shell injection
    const escapedCwd = escapeShellArg(input.cwd, shellType);

    return command.replace(/\$LLXPRT_PROJECT_DIR/g, () => escapedCwd);
  }

  /**
   * Convert plain text output to structured HookOutput
   */
  private convertPlainTextToHookOutput(
    text: string,
    exitCode: number,
  ): HookOutput {
    if (exitCode === EXIT_CODE_SUCCESS) {
      // Success - treat as system message or additional context
      return {
        decision: 'allow',
        systemMessage: text,
      };
    } else if (exitCode === EXIT_CODE_BLOCKING_ERROR) {
      // Blocking error
      return {
        decision: 'deny',
        reason: text,
      };
    }
    // Non-blocking error (EXIT_CODE_NON_BLOCKING_ERROR or any other code)
    return {
      decision: 'allow',
      systemMessage: `Warning: ${text}`,
    };
  }
}
