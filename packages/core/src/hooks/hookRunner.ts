/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P08
 * @requirement:HOOK-061,HOOK-063,HOOK-064,HOOK-065,HOOK-066,HOOK-067a,HOOK-067b,HOOK-068,HOOK-069,HOOK-070
 * @pseudocode:analysis/pseudocode/02-hook-event-handler-flow.md
 */

import { spawn } from 'node:child_process';
import { createExitGuard } from '../services/shellExitGuard.js';
import {
  killProcessWithEscalation,
  reapProcessGroup,
} from '../services/shellProcessKill.js';
import type { HookConfig } from './types.js';
import { HookEventName } from './types.js';
import type {
  HookInput,
  HookOutput,
  HookExecutionResult,
  BeforeAgentInput,
  BeforeModelInput,
  BeforeModelOutput,
  BeforeToolInput,
} from './types.js';
import { mergeHookLLMRequest } from './hookTranslator.js';
import { DebugLogger } from '../debug/index.js';
import type { HookProcessConfiguration } from './hook-configuration.js';
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

function resolveHookId(hookConfig: HookConfig): string {
  if (hookConfig.name) {
    return hookConfig.name;
  }
  if (hookConfig.command) {
    return hookConfig.command;
  }
  return 'unknown';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function defaultErrorMessage(exitCode: number): string {
  return `Hook exited with code ${exitCode} without an error message`;
}

function buildPowerShellExitCodeWrapper(encodedCommand: string): string {
  return (
    '& { ' +
    `$hookCommand = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedCommand}')); ` +
    '$global:LASTEXITCODE = 0; ' +
    '$global:__LLXPRT_HOOK_SUCCEEDED = $false; ' +
    '$global:__LLXPRT_HOOK_EXIT_CODE = 0; ' +
    '$hookScript = [ScriptBlock]::Create($hookCommand + [Environment]::NewLine + ' +
    "'$global:__LLXPRT_HOOK_SUCCEEDED = $?; $global:__LLXPRT_HOOK_EXIT_CODE = $LASTEXITCODE'); " +
    '& $hookScript; ' +
    'if ($global:__LLXPRT_HOOK_SUCCEEDED) { exit 0 }; ' +
    'if ($global:__LLXPRT_HOOK_EXIT_CODE -ne 0) { exit $global:__LLXPRT_HOOK_EXIT_CODE }; ' +
    'exit 1 ' +
    '}'
  );
}

/**
 * Hook runner that executes command hooks
 */
export class HookRunner {
  constructor(
    private readonly configuration: HookProcessConfiguration,
    private readonly isTrustedFolder: () => boolean,
    private readonly projectSignal: () => AbortSignal,
  ) {}

  /**
   * Execute a single hook
   */
  async executeHook(
    hookConfig: HookConfig,
    eventName: HookEventName,
    input: HookInput,
    signal?: AbortSignal,
  ): Promise<HookExecutionResult> {
    const startTime = Date.now();

    try {
      return await this.executeCommandHook(
        hookConfig,
        eventName,
        input,
        startTime,
        signal,
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      const hookId = resolveHookId(hookConfig);
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
    signal?: AbortSignal,
  ): Promise<HookExecutionResult[]> {
    const promises = hookConfigs.map((config) =>
      this.executeHook(config, eventName, input, signal),
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
    signal?: AbortSignal,
  ): Promise<HookExecutionResult[]> {
    const results: HookExecutionResult[] = [];
    let currentInput = input;

    for (const config of hookConfigs) {
      const result = await this.executeHook(
        config,
        eventName,
        currentInput,
        signal,
      );
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
      !hookOutput.hookSpecificOutput ||
      !('additionalContext' in hookOutput.hookSpecificOutput)
    ) {
      return;
    }
    const additionalContext =
      hookOutput.hookSpecificOutput['additionalContext'];
    if (typeof additionalContext === 'string' && 'prompt' in modifiedInput) {
      (modifiedInput as BeforeAgentInput).prompt += '\n\n' + additionalContext;
    }
  }

  private applyBeforeModelOutput(
    modifiedInput: HookInput,
    hookOutput: HookOutput,
  ): void {
    if (
      !hookOutput.hookSpecificOutput ||
      !('llm_request' in hookOutput.hookSpecificOutput)
    ) {
      return;
    }
    const hookBeforeModelOutput = hookOutput as BeforeModelOutput;
    if (
      hookBeforeModelOutput.hookSpecificOutput?.llm_request &&
      'llm_request' in modifiedInput
    ) {
      const currentRequest = (modifiedInput as BeforeModelInput).llm_request;
      // v2 merge semantics: contents/tools replace when arrays, model
      // overrides when string, settings shallow-merge; wrong-typed or absent
      // fields leave the target value untouched.
      (modifiedInput as BeforeModelInput).llm_request = mergeHookLLMRequest(
        currentRequest,
        hookBeforeModelOutput.hookSpecificOutput.llm_request,
      );
    }
  }

  private applyBeforeToolOutput(
    modifiedInput: HookInput,
    hookOutput: HookOutput,
  ): void {
    if (
      !hookOutput.hookSpecificOutput ||
      !('tool_input' in hookOutput.hookSpecificOutput)
    ) {
      return;
    }
    const modifiedToolInput = hookOutput.hookSpecificOutput['tool_input'];
    if (isPlainObject(modifiedToolInput) && 'tool_input' in modifiedInput) {
      const beforeToolInput = modifiedInput as BeforeToolInput;
      beforeToolInput.tool_input = {
        ...beforeToolInput.tool_input,
        ...modifiedToolInput,
      };
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
    signal?: AbortSignal,
  ): Promise<HookExecutionResult> {
    signal?.throwIfAborted();
    // Secondary security check - block project hooks in untrusted folders
    const { ConfigSource } = await import('./hookRegistry.js');
    if (hookConfig.source === ConfigSource.Project && !this.isTrustedFolder()) {
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

    if (hookConfig.source === ConfigSource.Project) {
      signal =
        signal === undefined
          ? this.projectSignal()
          : AbortSignal.any([signal, this.projectSignal()]);
      signal.throwIfAborted();
    }
    const timeout = hookConfig.timeout ?? DEFAULT_HOOK_TIMEOUT;

    return this.runHookProcess(
      hookConfig,
      eventName,
      input,
      startTime,
      timeout,
      signal,
    );
  }

  private runHookProcess(
    hookConfig: HookConfig,
    eventName: HookEventName,
    input: HookInput,
    startTime: number,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<HookExecutionResult> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      if (!hookConfig.command) {
        resolve(this.missingCommandResult(hookConfig, eventName, startTime));
        return;
      }
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let processError: Error | undefined;
      let cancellationReason: Error | undefined;
      let termination: Promise<void> | undefined;
      const child = this.spawnHookProcess(hookConfig, input);
      const exited = this.observeExit(child);
      const terminate = (): void => {
        termination ??= this.terminateProcess(child, exited);
        void termination.catch(reject);
      };
      const abort = (): void => {
        cancellationReason =
          signal?.reason instanceof Error
            ? signal.reason
            : new Error(String(signal?.reason));
        terminate();
      };
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeout);
      this.writeToStdin(child, input);
      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      child.on('error', (error) => {
        processError = error;
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        void this.completeProcess(
          hookConfig,
          eventName,
          startTime,
          timeout,
          {
            stdout,
            stderr,
            timedOut,
            processError,
            cancellationReason,
            exitCode,
          },
          termination,
        ).then(resolve, reject);
      });
    });
  }

  private async terminateProcess(
    child: ReturnType<typeof spawn>,
    exited: ReturnType<typeof createExitGuard>,
  ): Promise<void> {
    await killProcessWithEscalation(
      child.pid,
      process.platform === 'win32',
      () => {
        child.kill('SIGKILL');
      },
      exited,
    );
    if (
      process.platform !== 'win32' &&
      child.pid !== undefined &&
      !(await reapProcessGroup(child.pid))
    )
      throw new Error(`Hook process group ${child.pid} survived termination`);
  }

  private observeExit(
    child: ReturnType<typeof spawn>,
  ): ReturnType<typeof createExitGuard> {
    const exited = createExitGuard();
    child.on('exit', () => exited.markExited());
    return exited;
  }

  private async completeProcess(
    hookConfig: HookConfig,
    eventName: HookEventName,
    startTime: number,
    timeout: number,
    output: {
      readonly stdout: string;
      readonly stderr: string;
      readonly timedOut: boolean;
      readonly processError: Error | undefined;
      readonly cancellationReason: Error | undefined;
      readonly exitCode: number | null;
    },
    termination: Promise<void> | undefined,
  ): Promise<HookExecutionResult> {
    await termination;
    const {
      stdout,
      stderr,
      processError,
      cancellationReason,
      timedOut,
      exitCode,
    } = output;
    const error = cancellationReason ?? processError;
    if (error !== undefined)
      return this.errorResult(
        hookConfig,
        eventName,
        error,
        stdout,
        stderr,
        startTime,
      );
    const duration = Date.now() - startTime;
    if (timedOut)
      return this.timeoutResult(
        hookConfig,
        eventName,
        timeout,
        stdout,
        stderr,
        duration,
      );
    return this.buildExitResult(
      hookConfig,
      eventName,
      exitCode,
      stdout,
      stderr,
      duration,
    );
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
    const sanitizationConfig = this.configuration.sanitization;
    const env = {
      ...sanitizeEnvironment(
        this.configuration.environment,
        sanitizationConfig,
      ),
      LLXPRT_PROJECT_DIR: input.cwd,
    };

    const encodedCommand = Buffer.from(command, 'utf8').toString('base64');
    const shellCommand =
      shellConfig.shell === 'powershell'
        ? buildPowerShellExitCodeWrapper(encodedCommand)
        : command;

    // SECURITY: Use explicit shell executable with shell: false
    // This prevents Node's shell interpretation layer
    return spawn(
      shellConfig.executable,
      [...shellConfig.argsPrefix, shellCommand],
      {
        env,
        cwd: input.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        shell: false, // CRITICAL: must be false to prevent injection
        // Prevents child from inheriting parent's console screen buffer on
        // Windows (sets CREATE_NO_WINDOW). PowerShell Console API writes
        // would otherwise bypass the pipes and corrupt the terminal UI. Issue #2548
        windowsHide: process.platform === 'win32' ? true : undefined,
      },
    );
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
    } else if (exitCode !== EXIT_CODE_SUCCESS) {
      return this.convertNonZeroExitToHookOutput(
        stderr.trim(),
        effectiveErrorExitCode,
      );
    }
    return undefined;
  }

  /**
   * A blocking exit code is authoritative on its own, so it must deny even
   * when the hook wrote no message. Other non-zero exits stay silent unless
   * the hook explained itself on stderr, so they cannot inject a decision.
   */
  private convertNonZeroExitToHookOutput(
    stderr: string,
    effectiveErrorExitCode: number,
  ): HookOutput | undefined {
    if (stderr) {
      return this.convertPlainTextToHookOutput(stderr, effectiveErrorExitCode);
    }
    if (effectiveErrorExitCode === EXIT_CODE_BLOCKING_ERROR) {
      return this.convertPlainTextToHookOutput(
        defaultErrorMessage(effectiveErrorExitCode),
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
