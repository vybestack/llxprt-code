/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolResult,
} from './tools.js';
import type { Config } from '../config/config.js';
import {
  SubagentOrchestrator,
  type SubagentLaunchRequest,
} from '../core/subagentOrchestrator.js';
import {
  ContextState,
  SubagentTerminateMode,
  type OutputObject,
  type SubAgentScope,
} from '../core/subagent.js';
import type { SubagentSchedulerFactory } from '../core/subagentScheduler.js';
import type { SubagentManager } from '../config/subagentManager.js';
import type { ProfileManager } from '../config/profileManager.js';
import { ToolErrorType } from './tool-error.js';
import { DEFAULT_AGENT_ID } from '../core/turn.js';
import type { ToolRegistry } from './tool-registry.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';

const taskLogger = new DebugLogger('llxprt:task');

// Tool timeout settings (Issue #1049)
const DEFAULT_TASK_TIMEOUT_SECONDS = 900;
const MAX_TASK_TIMEOUT_SECONDS = 1800;

export interface TaskToolParams {
  subagent_name?: string;
  subagentName?: string;
  goal_prompt?: string;
  goalPrompt?: string;
  behaviour_prompts?: string[];
  behavior_prompts?: string[];
  behaviourPrompts?: string[];
  behaviorPrompts?: string[];
  tool_whitelist?: string[];
  toolWhitelist?: string[];
  output_spec?: Record<string, string>;
  outputSpec?: Record<string, string>;
  context?: Record<string, unknown>;
  context_vars?: Record<string, unknown>;
  contextVars?: Record<string, unknown>;
  timeout_seconds?: number;
  async?: boolean;
}

interface TaskToolInvocationParams {
  subagentName: string;
  goalPrompt: string;
  behaviourPrompts: string[];
  toolWhitelist?: string[];
  outputSpec?: Record<string, string>;
  context: Record<string, unknown>;
  async: boolean;
}

export interface TaskToolDependencies {
  orchestratorFactory?: () => SubagentOrchestrator;
  profileManager?: ProfileManager;
  subagentManager?: SubagentManager;
  schedulerFactoryProvider?: () => SubagentSchedulerFactory | undefined;
  isInteractiveEnvironment?: () => boolean;
  getAsyncTaskManager?: () => AsyncTaskManager | undefined;
}

interface TaskToolInvocationDeps {
  createOrchestrator: () => SubagentOrchestrator;
  getToolRegistry?: () => ToolRegistry | undefined;
  getSchedulerFactory?: () => SubagentSchedulerFactory | undefined;
  isInteractiveEnvironment?: () => boolean;
  getAsyncTaskManager?: () => AsyncTaskManager | undefined;
}

/**
 * Formats a human readable summary for successful subagent execution.
 */
function formatSuccessDisplay(
  subagentName: string,
  agentId: string,
  output: OutputObject,
): string {
  const emittedVars = Object.entries(output.emitted_vars ?? {});
  const finalMessageSection = output.final_message
    ? `Final message:\n${output.final_message}`
    : 'Final message: _(none)_';
  const emittedSection =
    emittedVars.length === 0
      ? 'Emitted variables: _(none)_'
      : `Emitted variables:\n${emittedVars
          .map(([key, value]) => `- **${key}**: ${value}`)
          .join('\n')}`;

  return [
    `Subagent **${subagentName}** (\`${agentId}\`) completed with status \`${output.terminate_reason}\`.`,
    finalMessageSection,
    emittedSection,
  ].join('\n\n');
}

/**
 * Summarizes the subagent output as JSON for inclusion in tool history.
 */
function formatSuccessContent(agentId: string, output: OutputObject): string {
  const payload: Record<string, unknown> = {
    agent_id: agentId,
    terminate_reason: output.terminate_reason,
    emitted_vars: output.emitted_vars ?? {},
  };

  if (output.final_message !== undefined) {
    payload.final_message = output.final_message;
  }

  return JSON.stringify(payload, null, 2);
}

class TaskToolInvocation extends BaseToolInvocation<
  TaskToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: TaskToolParams,
    private readonly normalized: TaskToolInvocationParams,
    private readonly deps: TaskToolInvocationDeps,
  ) {
    super(params);
  }

  override getDescription(): string {
    return `Run subagent '${this.normalized.subagentName}' to accomplish: ${this.normalized.goalPrompt}`;
  }

  private createLaunchRequest(timeoutMs?: number): SubagentLaunchRequest {
    const { subagentName, behaviourPrompts, toolWhitelist, outputSpec } =
      this.normalized;

    const launchRequest: SubagentLaunchRequest = {
      name: subagentName,
    };

    if (timeoutMs !== undefined) {
      launchRequest.runConfig = {
        max_time_minutes: timeoutMs / 60_000,
      };
    }

    if (behaviourPrompts.length > 0) {
      launchRequest.behaviourPrompts = behaviourPrompts;
    }

    let effectiveWhitelist = toolWhitelist;
    if (!effectiveWhitelist || effectiveWhitelist.length === 0) {
      const registry = this.deps.getToolRegistry?.();
      if (registry) {
        const excluded = new Set([
          'task',
          'Task',
          'list_subagents',
          'ListSubagents',
        ]);
        effectiveWhitelist = registry
          .getEnabledTools()
          .map((tool) => tool.name)
          .filter((name) => !!name && !excluded.has(name))
          .filter((name, index, array) => array.indexOf(name) === index);
      }
    }

    if (effectiveWhitelist && effectiveWhitelist.length > 0) {
      const whitelistSet = new Set(
        effectiveWhitelist.filter((name): name is string => Boolean(name)),
      );
      launchRequest.toolConfig = {
        tools: Array.from(whitelistSet),
      };
    }

    taskLogger.debug(() => {
      const summary =
        launchRequest.toolConfig &&
        launchRequest.toolConfig.tools &&
        launchRequest.toolConfig.tools.length > 0
          ? `${launchRequest.toolConfig.tools.length} tools`
          : 'no tools provided';
      return `Prepared launch request for '${subagentName}': toolConfig=${summary}`;
    });

    if (outputSpec && Object.keys(outputSpec).length > 0) {
      launchRequest.outputConfig = {
        outputs: outputSpec,
      };
    }

    return launchRequest;
  }

  override async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    if (this.normalized.async) {
      return this.executeAsync(signal, updateOutput);
    }

    const {
      timeoutMs,
      timeoutSeconds,
      timeoutController,
      timeoutId,
      onUserAbort,
    } = this.createTimeoutControllers(signal);

    if (signal.aborted) {
      onUserAbort();
      signal.removeEventListener('abort', onUserAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      return this.createCancelledResult(
        'Task execution aborted before launch.',
      );
    }

    let orchestrator: SubagentOrchestrator;
    try {
      orchestrator = this.deps.createOrchestrator();
    } catch (error) {
      taskLogger.warn(
        () =>
          `Failed to create orchestrator for '${this.normalized.subagentName}': ${error instanceof Error ? error.message : String(error)}`,
      );
      signal.removeEventListener('abort', onUserAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      return this.createErrorResult(
        error,
        'Task tool could not initialize subagent orchestrator.',
      );
    }

    const launchRequest = this.createLaunchRequest(timeoutMs);
    taskLogger.debug(() => `Launching subagent '${launchRequest.name}'`);

    let launchResult:
      | Awaited<ReturnType<SubagentOrchestrator['launch']>>
      | undefined;
    let aborted = false;
    const abortHandler = () => {
      if (aborted) {
        return;
      }
      aborted = true;
      taskLogger.warn(
        () => `Cancellation requested for subagent '${launchRequest.name}'`,
      );
      try {
        const candidate = launchResult?.scope as
          | { cancel?: (reason?: string) => void }
          | undefined;
        candidate?.cancel?.('User aborted task execution.');
      } catch (error) {
        taskLogger.warn(
          () =>
            `Error while cancelling subagent '${launchRequest.name}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    const removeAbortHandler = () => {
      signal.removeEventListener('abort', abortHandler);
    };
    signal.addEventListener('abort', abortHandler, { once: true });
    if (signal.aborted) {
      abortHandler();
      removeAbortHandler();
      signal.removeEventListener('abort', onUserAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      return this.createCancelledResult(
        'Task execution aborted before launch.',
      );
    }

    try {
      launchResult = await orchestrator.launch(
        launchRequest,
        timeoutController.signal,
      );
    } catch (error) {
      removeAbortHandler();
      signal.removeEventListener('abort', onUserAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (this.isTimeoutError(signal, timeoutController, error)) {
        return this.createTimeoutResult(
          timeoutSeconds,
          launchResult?.scope?.output,
        );
      }
      if (this.isAbortError(error) || aborted || signal.aborted) {
        return this.createCancelledResult('Task aborted during launch.');
      }
      taskLogger.warn(
        () =>
          `Launch failure for '${launchRequest.name}': ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.createErrorResult(
        error,
        `Unable to launch subagent '${this.normalized.subagentName}'.`,
      );
    }

    const { scope, agentId, dispose } = launchResult;
    taskLogger.debug(
      () => `Subagent '${launchRequest.name}' started with agentId=${agentId}`,
    );
    const contextState = this.buildContextState();

    const teardown = async () => {
      removeAbortHandler();
      signal.removeEventListener('abort', onUserAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      try {
        await dispose();
      } catch {
        // Swallow dispose errors to avoid masking primary error.
      }
    };

    if (signal.aborted || aborted) {
      await teardown();
      return this.createCancelledResult(
        'Task aborted during launch.',
        agentId,
        scope.output,
      );
    }

    let xmlOutputOpen = false;
    const emitClosingSubagentTag = () => {
      if (!xmlOutputOpen || !updateOutput) {
        return;
      }
      updateOutput(
        `</subagent name="${launchRequest.name}" id="${agentId}">\n`,
      );
      xmlOutputOpen = false;
    };

    if (updateOutput) {
      // Send opening XML tag to identify the subagent
      updateOutput(`<subagent name="${launchRequest.name}" id="${agentId}">\n`);
      xmlOutputOpen = true;

      const existingHandler = scope.onMessage;
      // Ensure each streamed chunk renders on its own line in TTY/CLI UIs.
      // - Normalize CR/CRLF to LF
      // - Append a trailing newline if missing
      const normalizeForStreaming = (text: string): string => {
        if (!text) {
          return '';
        }
        const lf = text.replace(/\r\n?/g, '\n');
        return lf.endsWith('\n') ? lf : lf + '\n';
      };
      scope.onMessage = (message: string) => {
        const cleaned = normalizeForStreaming(message);
        if (cleaned.trim().length > 0) {
          updateOutput(cleaned);
        }
        // Preserve any existing handler behavior
        existingHandler?.(message);
      };
    }

    try {
      const environmentInteractive =
        this.deps.isInteractiveEnvironment?.() ?? true;
      const shouldRunInteractive = environmentInteractive;

      if (shouldRunInteractive && typeof scope.runInteractive === 'function') {
        const schedulerFactory = this.deps.getSchedulerFactory?.();
        const interactiveOptions = schedulerFactory
          ? { schedulerFactory }
          : undefined;
        await scope.runInteractive(contextState, interactiveOptions);
      } else {
        await scope.runNonInteractive(contextState);
      }
      if (aborted) {
        await teardown();
        taskLogger.warn(
          () => `Subagent '${launchRequest.name}' aborted before completion`,
        );
        return this.createCancelledResult(
          'Task execution aborted before completion.',
          agentId,
          scope.output,
        );
      }
      if (this.isTimeoutError(signal, timeoutController)) {
        await teardown();
        return this.createTimeoutResult(timeoutSeconds, scope.output);
      }
      const output = scope.output ?? {
        terminate_reason: SubagentTerminateMode.ERROR,
        emitted_vars: {},
      };
      taskLogger.debug(
        () =>
          `Subagent '${launchRequest.name}' finished with reason=${output.terminate_reason} emittedKeys=${Object.keys(output.emitted_vars ?? {}).join(', ')}`,
      );
      const llmContent = formatSuccessContent(agentId, output);
      const returnDisplay = formatSuccessDisplay(
        this.normalized.subagentName,
        agentId,
        output,
      );
      await teardown();
      return {
        llmContent,
        returnDisplay,
        metadata: {
          agentId,
          terminateReason: output.terminate_reason,
          emittedVars: output.emitted_vars ?? {},
          ...(output.final_message
            ? { finalMessage: output.final_message }
            : {}),
        },
      };
    } catch (error) {
      if (this.isTimeoutError(signal, timeoutController, error)) {
        await teardown();
        return this.createTimeoutResult(timeoutSeconds, scope.output, agentId);
      }
      if (this.isAbortError(error) || aborted || signal.aborted) {
        await teardown();
        return this.createCancelledResult(
          'Task execution aborted before completion.',
          agentId,
          scope.output,
        );
      }
      const result = this.createErrorResult(
        error,
        `Subagent '${this.normalized.subagentName}' failed during execution.`,
        agentId,
      );
      await teardown();
      taskLogger.warn(
        () =>
          `Subagent '${launchRequest.name}' execution error: ${result.error?.message ?? 'unknown'}`,
      );
      return result;
    } finally {
      emitClosingSubagentTag();
    }
  }

  private isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const result = (error as { name?: string }).name === 'AbortError';
    return result;
  }

  private buildContextState(): ContextState {
    const context = new ContextState();
    context.set('task_goal', this.normalized.goalPrompt);
    context.set('task_name', this.normalized.subagentName);
    for (const [key, value] of Object.entries(this.normalized.context)) {
      context.set(key, value);
    }
    context.set('task_behaviour_prompts', [
      ...this.normalized.behaviourPrompts,
    ]);
    return context;
  }

  private createErrorResult(
    error: unknown,
    fallbackMessage: string,
    agentId?: string,
  ): ToolResult {
    const detail =
      error instanceof Error && error.message ? error.message : null;
    const displayMessage = detail
      ? `${fallbackMessage}\nDetails: ${detail}`
      : fallbackMessage;
    const message = detail ?? fallbackMessage;
    taskLogger.warn(() => `Task tool error: ${displayMessage}`);
    return {
      llmContent: displayMessage,
      returnDisplay: displayMessage,
      metadata: agentId
        ? {
            agentId,
            error: message,
          }
        : undefined,
      error: {
        message,
        type: ToolErrorType.UNHANDLED_EXCEPTION,
      },
    };
  }

  private createCancelledResult(
    message: string,
    agentId?: string,
    output?: OutputObject,
  ): ToolResult {
    taskLogger.warn(
      () =>
        `Task tool cancelled for agentId=${agentId ?? DEFAULT_AGENT_ID}: ${message}`,
    );
    return {
      llmContent: message,
      returnDisplay: message,
      metadata: {
        agentId: agentId ?? DEFAULT_AGENT_ID,
        terminateReason: output?.terminate_reason,
        emittedVars: output?.emitted_vars ?? {},
        ...(output?.final_message
          ? { finalMessage: output.final_message }
          : {}),
        cancelled: true,
      },
      error: {
        message,
        type: ToolErrorType.EXECUTION_FAILED,
      },
    };
  }

  private createTimeoutControllers(signal: AbortSignal): {
    timeoutMs?: number;
    timeoutSeconds?: number;
    timeoutController: AbortController;
    timeoutId: ReturnType<typeof setTimeout> | null;
    onUserAbort: () => void;
  } {
    const settings = this.config.getEphemeralSettings?.() ?? {};
    const defaultTimeoutSeconds =
      (settings['task-default-timeout-seconds'] as number | undefined) ??
      DEFAULT_TASK_TIMEOUT_SECONDS;
    const maxTimeoutSeconds =
      (settings['task-max-timeout-seconds'] as number | undefined) ??
      MAX_TASK_TIMEOUT_SECONDS;

    const timeoutSeconds = this.resolveTimeoutSeconds(
      this.params.timeout_seconds,
      defaultTimeoutSeconds,
      maxTimeoutSeconds,
    );
    // Convert seconds to milliseconds for setTimeout
    const timeoutMs =
      timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000;
    const timeoutController = new AbortController();
    const timeoutId =
      timeoutMs === undefined
        ? null
        : setTimeout(() => timeoutController.abort(), timeoutMs);

    const onUserAbort = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutController.abort();
    };

    signal.addEventListener('abort', onUserAbort, { once: true });

    return {
      timeoutMs,
      timeoutSeconds,
      timeoutController,
      timeoutId,
      onUserAbort,
    };
  }

  private resolveTimeoutSeconds(
    requestedTimeoutSeconds: number | undefined,
    defaultTimeoutSeconds: number,
    maxTimeoutSeconds: number,
  ): number | undefined {
    if (requestedTimeoutSeconds === -1 || defaultTimeoutSeconds === -1) {
      return undefined;
    }

    const effectiveTimeout = requestedTimeoutSeconds ?? defaultTimeoutSeconds;
    if (maxTimeoutSeconds === -1) {
      return effectiveTimeout;
    }

    if (effectiveTimeout > maxTimeoutSeconds) {
      return maxTimeoutSeconds;
    }

    return effectiveTimeout;
  }

  private isTimeoutError(
    signal: AbortSignal,
    timeoutController: AbortController,
    error?: unknown,
  ): boolean {
    if (!timeoutController.signal.aborted || signal.aborted) {
      return false;
    }
    if (!error) {
      return true;
    }
    return this.isAbortError(error);
  }

  private createTimeoutResult(
    timeoutSeconds: number | undefined,
    output?: OutputObject,
    agentId?: string,
  ): ToolResult {
    const message = `Task timed out after ${timeoutSeconds ?? DEFAULT_TASK_TIMEOUT_SECONDS}s (timeout_seconds).`;
    return {
      llmContent: message,
      returnDisplay: message,
      metadata: {
        agentId: agentId ?? DEFAULT_AGENT_ID,
        terminateReason: output?.terminate_reason,
        emittedVars: output?.emitted_vars ?? {},
        ...(output?.final_message
          ? { finalMessage: output.final_message }
          : {}),
        timedOut: true,
      },
      error: {
        message,
        type: ToolErrorType.TIMEOUT,
      },
    };
  }

  /**
   * @plan PLAN-20260130-ASYNCTASK.P11
   *
   * Note: Async tasks are designed to run independently in the background.
   * Unlike foreground task execution, they do NOT wire cancellation or timeout
   * to the parent agent's signal. This is an intentional design choice to allow
   * async tasks to continue running even if the foreground agent is interrupted.
   */
  private async executeAsync(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    // Get AsyncTaskManager
    const asyncTaskManager = this.deps.getAsyncTaskManager?.();
    if (asyncTaskManager === undefined) {
      return {
        llmContent: 'Async mode requires AsyncTaskManager to be configured.',
        returnDisplay: 'Error: Async mode not available.',
        error: {
          message: 'AsyncTaskManager not configured',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    // Step 1: Create orchestrator (same as sync)
    let orchestrator: SubagentOrchestrator;
    try {
      orchestrator = this.deps.createOrchestrator();
    } catch (error) {
      return this.createErrorResult(
        error,
        'Failed to create orchestrator for async task.',
      );
    }

    // Step 2: Atomically reserve an async slot before launching
    const bookingId = asyncTaskManager.tryReserveAsyncSlot();
    if (!bookingId) {
      const canLaunch = asyncTaskManager.canLaunchAsync();
      return {
        llmContent: canLaunch.reason ?? 'Cannot launch async task.',
        returnDisplay: canLaunch.reason ?? 'Async task limit reached.',
        error: {
          message: canLaunch.reason ?? 'Limit reached',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    // Step 3: Set up async task infrastructure
    let launchResult: Awaited<ReturnType<SubagentOrchestrator['launch']>>;
    let agentId: string | undefined;
    let scope: SubAgentScope;
    let contextState: ContextState;
    let dispose: (() => Promise<void>) | undefined;
    const asyncAbortController = new AbortController();
    let timeoutId: NodeJS.Timeout | null = null;
    let taskRegistered = false;

    try {
      // Create launch request (no timeout for launch itself)
      const launchRequest = this.createLaunchRequest(undefined);

      // Launch subagent — pass undefined instead of the foreground signal so
      // the scope is NOT wired to the foreground lifecycle (Ctrl+C, turn end).
      // Async tasks manage their own lifecycle via asyncAbortController.
      launchResult = await orchestrator.launch(launchRequest, undefined);
      agentId = launchResult.agentId;
      scope = launchResult.scope;
      dispose = launchResult.dispose;
      contextState = this.buildContextState();

      // Set up timeout for async task (but don't wire to parent signal)
      const settings = this.config.getEphemeralSettings?.() ?? {};
      const defaultTimeoutSeconds =
        (settings['task-default-timeout-seconds'] as number | undefined) ??
        DEFAULT_TASK_TIMEOUT_SECONDS;
      const maxTimeoutSeconds =
        (settings['task-max-timeout-seconds'] as number | undefined) ??
        MAX_TASK_TIMEOUT_SECONDS;

      const timeoutSeconds = this.resolveTimeoutSeconds(
        this.params.timeout_seconds,
        defaultTimeoutSeconds,
        maxTimeoutSeconds,
      );
      const timeoutMs =
        timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000;
      timeoutId =
        timeoutMs === undefined
          ? null
          : setTimeout(() => asyncAbortController.abort(), timeoutMs);

      // Register with AsyncTaskManager consuming the booking ID
      asyncTaskManager.registerTask(
        {
          id: agentId,
          subagentName: this.normalized.subagentName,
          goalPrompt: this.normalized.goalPrompt,
          abortController: asyncAbortController,
        },
        bookingId,
      );

      taskRegistered = true;
    } catch (error) {
      // If any setup step fails, make sure to clean up the reservation
      if (!taskRegistered && bookingId) {
        asyncTaskManager.cancelReservation(bookingId);
      }

      // Clean up any created resources
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (dispose) {
        dispose();
      }

      return this.createErrorResult(
        error,
        `Failed to launch async subagent '${this.normalized.subagentName}'.`,
      );
    }

    // Set up message streaming (same as sync)
    let asyncXmlOutputOpen = false;
    const emitAsyncClosingSubagentTag = () => {
      if (!asyncXmlOutputOpen || !updateOutput) {
        return;
      }
      updateOutput(
        `</subagent name="${this.normalized.subagentName}" id="${agentId}">\n`,
      );
      asyncXmlOutputOpen = false;
    };

    if (updateOutput) {
      // Send opening XML tag to identify the subagent
      // Use normalized.subagentName since launchRequest is scoped to inner try block
      updateOutput(
        `<subagent name="${this.normalized.subagentName}" id="${agentId}">\n`,
      );
      asyncXmlOutputOpen = true;

      const existingHandler = scope.onMessage;
      const normalizeForStreaming = (text: string): string => {
        if (!text) {
          return '';
        }
        const lf = text.replace(/\r\n?/g, '\n');
        return lf.endsWith('\n') ? lf : lf + '\n';
      };
      scope.onMessage = (message: string) => {
        const cleaned = normalizeForStreaming(message);
        if (cleaned.trim().length > 0) {
          updateOutput(cleaned);
        }
        existingHandler?.(message);
      };
    }

    // DO NOT await this - execute in background
    this.executeInBackground(
      scope,
      contextState,
      agentId,
      asyncTaskManager,
      dispose,
      asyncAbortController.signal,
      timeoutId,
      emitAsyncClosingSubagentTag,
    );

    // Return immediately with launch status
    return {
      llmContent:
        `Async task launched: subagent '${this.normalized.subagentName}' (ID: ${agentId}). ` +
        `Task is running in background. Use 'check_async_tasks' to monitor progress.`,
      returnDisplay: `Async task started: **${this.normalized.subagentName}** (\`${agentId}\`)`,

      metadata: {
        agentId,
        async: true,
        status: 'running',
      },
    };
  }

  /**
   * @plan PLAN-20260130-ASYNCTASK.P11
   *
   * Execute async task in background using the SAME execution path as sync tasks.
   * The only difference is the foreground agent doesn't wait for completion.
   * - Interactive environment → runInteractive() with shared scheduler (tool calls show in UI)
   * - Non-interactive environment → runNonInteractive()
   */
  private executeInBackground(
    scope: SubAgentScope,
    contextState: ContextState,
    agentId: string,
    asyncTaskManager: AsyncTaskManager,
    dispose: () => Promise<void>,
    signal: AbortSignal,
    timeoutId: ReturnType<typeof setTimeout> | null,
    emitClosingSubagentTag?: () => void,
  ): void {
    // Use IIFE to avoid returning promise
    (async () => {
      try {
        // Use the SAME execution path as sync tasks:
        // - Interactive environment → runInteractive() (tool calls go through shared scheduler/UI)
        // - Non-interactive environment → runNonInteractive()
        const environmentInteractive =
          this.deps.isInteractiveEnvironment?.() ?? true;

        if (
          environmentInteractive &&
          typeof scope.runInteractive === 'function'
        ) {
          const schedulerFactory = this.deps.getSchedulerFactory?.();
          const interactiveOptions = schedulerFactory
            ? { schedulerFactory }
            : undefined;
          await scope.runInteractive(contextState, interactiveOptions);
        } else {
          await scope.runNonInteractive(contextState);
        }

        // Check if aborted (by cancelTask or timeout)
        if (signal.aborted) {
          // If cancelTask was called, status is already 'cancelled'.
          // If timeout fired, status is still 'running' — record as failed
          // so the task doesn't permanently occupy a concurrency slot.
          const task = asyncTaskManager.getTask(agentId);
          if (task?.status === 'running') {
            asyncTaskManager.failTask(agentId, 'Async task timed out');
          }
          return;
        }

        // Get output
        const output = scope.output ?? {
          terminate_reason: SubagentTerminateMode.ERROR,
          emitted_vars: {},
        };

        // Update AsyncTaskManager
        asyncTaskManager.completeTask(agentId, output);
      } catch (error) {
        // Update AsyncTaskManager with failure
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        asyncTaskManager.failTask(agentId, errorMessage);
      } finally {
        emitClosingSubagentTag?.();

        // Clear timeout
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }

        // Always dispose
        try {
          await dispose();
        } catch {
          // Swallow dispose errors
        }
      }
    })();
  }
}

/**
 * Task tool that launches subagents via SubagentOrchestrator.
 *
 * @plan PLAN-20251029-SUBAGENTIC
 * @requirement REQ-SUBAGENTIC-001, REQ-SUBAGENTIC-002
 */
export class TaskTool extends BaseDeclarativeTool<TaskToolParams, ToolResult> {
  static readonly Name = 'task';

  constructor(
    private readonly config: Config,
    private readonly dependencies: TaskToolDependencies = {},
  ) {
    super(
      TaskTool.Name,
      'Task',
      `Launches a named subagent, streams its progress, and returns the emitted variables upon completion. The subagent runs in an isolated runtime and is disposed after it finishes.`,
      Kind.Think,
      {
        type: 'object',
        additionalProperties: false,
        required: ['subagent_name', 'goal_prompt'],
        properties: {
          subagent_name: {
            type: 'string',
            description:
              'Name of the registered subagent to launch (as defined in ~/.llxprt/subagents).',
          },
          goal_prompt: {
            type: 'string',
            description:
              'Primary goal or prompt to pass to the subagent. Included as the first behavioural prompt.',
          },
          behaviour_prompts: {
            type: 'array',
            description:
              'Additional behavioural prompts to append after the goal prompt.',
            items: { type: 'string' },
          },
          tool_whitelist: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Restrict the subagent to this explicit list of tools. Tool names must match the registry.',
          },
          output_spec: {
            type: 'object',
            description:
              'Expected output variables the subagent must emit before completing.',
            additionalProperties: { type: 'string' },
          },
          timeout_seconds: {
            type: 'number',
            description:
              'Optional timeout in seconds for the task execution (-1 for unlimited).',
          },
          async: {
            type: 'boolean',
            description:
              'If true, launch subagent in background and return immediately. Default: false.',
          },
          context: {
            type: 'object',
            description:
              'Optional key/value pairs exposed to the subagent via the execution context.',
            additionalProperties: true,
          },
        },
      },
      true,
      true,
    );
  }

  protected override validateToolParamValues(
    params: TaskToolParams,
  ): string | null {
    const subagentName =
      params.subagent_name ?? params.subagentName ?? params.subagentName;
    if (!subagentName || subagentName.trim().length === 0) {
      return 'Task tool requires a subagent_name.';
    }

    const goalPrompt =
      params.goal_prompt ?? params.goalPrompt ?? params.goalPrompt;
    if (!goalPrompt || goalPrompt.trim().length === 0) {
      return 'Task tool requires a goal_prompt describing the assignment.';
    }

    return null;
  }

  protected createInvocation(params: TaskToolParams): TaskToolInvocation {
    const normalized = this.normalizeParams(params);
    return new TaskToolInvocation(this.config, params, normalized, {
      createOrchestrator: () => this.ensureOrchestrator(),
      getToolRegistry:
        typeof this.config.getToolRegistry === 'function'
          ? () => this.config.getToolRegistry()
          : undefined,
      getSchedulerFactory: this.dependencies.schedulerFactoryProvider,
      isInteractiveEnvironment:
        this.dependencies.isInteractiveEnvironment ??
        (() => this.config.isInteractive()),
      getAsyncTaskManager: this.dependencies.getAsyncTaskManager,
    });
  }

  private normalizeParams(params: TaskToolParams): TaskToolInvocationParams {
    const subagentName = (
      params.subagent_name ??
      params.subagentName ??
      ''
    ).trim();
    const goalPrompt = (params.goal_prompt ?? params.goalPrompt ?? '').trim();

    const behaviourPrompts = [
      goalPrompt,
      ...(params.behaviour_prompts ??
        params.behavior_prompts ??
        params.behaviourPrompts ??
        params.behaviorPrompts ??
        []),
    ]
      .map((prompt) => prompt?.trim())
      .filter((prompt): prompt is string => Boolean(prompt))
      .filter((prompt, index, array) => array.indexOf(prompt) === index);

    const toolWhitelist = (params.tool_whitelist ?? params.toolWhitelist ?? [])
      .map((tool) => tool?.trim())
      .filter((tool): tool is string => Boolean(tool));

    const outputSpec = params.output_spec ?? params.outputSpec ?? undefined;

    const context =
      params.context ?? params.context_vars ?? params.contextVars ?? {};

    return {
      subagentName,
      goalPrompt,
      behaviourPrompts,
      toolWhitelist: toolWhitelist.length > 0 ? toolWhitelist : undefined,
      outputSpec,
      context,
      async: params.async ?? false,
    };
  }

  private ensureOrchestrator(): SubagentOrchestrator {
    if (this.dependencies.orchestratorFactory) {
      return this.dependencies.orchestratorFactory();
    }

    const configWithManagers = this.config as Config & {
      getProfileManager?: () => ProfileManager | undefined;
      getSubagentManager?: () => SubagentManager | undefined;
    };

    const profileManager =
      this.dependencies.profileManager ??
      configWithManagers.getProfileManager?.();
    const subagentManager =
      this.dependencies.subagentManager ??
      configWithManagers.getSubagentManager?.();

    if (!profileManager || !subagentManager) {
      throw new Error(
        'Task tool requires profile and subagent managers to be configured.',
      );
    }

    return new SubagentOrchestrator({
      subagentManager,
      profileManager,
      foregroundConfig: this.config,
    });
  }
}
