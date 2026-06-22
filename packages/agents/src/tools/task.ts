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
} from '@vybestack/llxprt-code-tools';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  SubagentOrchestrator,
  type SubagentLaunchRequest,
} from '../core/subagentOrchestrator.js';
import type { SubAgentScope } from '../core/subagent.js';
import { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { SubagentSchedulerFactory } from '../core/subagentScheduler.js';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  createAbortState,
  createTimeoutControllers,
  isAbortError as isAbortErrorHelper,
  isTimeoutError as isTimeoutErrorHelper,
} from './taskAbortHelpers.js';
import {
  buildGovernedToolWhitelist,
  filterExcludedFromWhitelist,
  normalizeTaskParams,
  type TaskToolInvocationParams,
} from './taskToolGovernance.js';
import {
  createCancelledResult,
  createErrorResult,
  createTimeoutResult,
  formatSuccessContent,
  formatSuccessDisplay,
} from './taskResultHelpers.js';
import {
  executeAsyncTask,
  normalizeSubagentStreamingText,
} from './taskAsyncExecution.js';

const taskLogger = new DebugLogger('llxprt:task');

/**
 * Boundary-validates a config accessor whose static type declares it required
 * but whose runtime value may be absent (partial mocks / lightweight configs).
 * Uses `typeof === 'function'` so the guard is real without tripping
 * `@typescript-eslint/no-unnecessary-condition`.
 */
function resolveOptionalConfigMethod<T>(
  config: Config,
  methodName: 'getProfileManager' | 'getSubagentManager',
): T | undefined {
  const fn = (config as unknown as Record<string, unknown>)[methodName];
  return typeof fn === 'function'
    ? (fn as (this: Config) => T).call(config)
    : undefined;
}

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
  grace_period_seconds?: number;
  max_turns?: number;
  async?: boolean;
}

export interface TaskToolDependencies {
  orchestratorFactory?: () => SubagentOrchestrator;
  profileManager?: ProfileManager;
  subagentManager?: SubagentManager;
  schedulerFactoryProvider?: () => SubagentSchedulerFactory | undefined;
  isInteractiveEnvironment?: () => boolean;
  getAsyncTaskManager?: () => AsyncTaskManager | undefined;
}
function launchRequestName(
  launchResult: Awaited<ReturnType<SubagentOrchestrator['launch']>>,
): string {
  return launchResult.config.name;
}

interface TaskToolInvocationDeps {
  createOrchestrator: () => SubagentOrchestrator;
  getToolRegistry?: () => ToolRegistry | undefined;
  getSchedulerFactory?: () => SubagentSchedulerFactory | undefined;
  isInteractiveEnvironment?: () => boolean;
  getAsyncTaskManager?: () => AsyncTaskManager | undefined;
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
    messageBus: MessageBus,
  ) {
    super(params, messageBus);
  }

  override getDescription(): string {
    return `Run subagent '${this.normalized.subagentName}' to accomplish: ${this.normalized.goalPrompt}`;
  }

  private buildGovernedToolWhitelist(
    candidateTools: string[] | undefined,
    registry: ToolRegistry,
  ): string[] | undefined {
    return buildGovernedToolWhitelist(candidateTools, registry, this.config);
  }

  private filterExcludedFromWhitelist(
    candidateTools: string[] | undefined,
  ): string[] | undefined {
    return filterExcludedFromWhitelist(candidateTools);
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

    if (this.params.grace_period_seconds !== undefined) {
      launchRequest.runConfig = {
        max_time_minutes:
          launchRequest.runConfig?.max_time_minutes ?? Number.POSITIVE_INFINITY,
        grace_period_seconds: this.params.grace_period_seconds,
      };
    }

    if (this.normalized.maxTurns !== undefined) {
      launchRequest.runConfig = {
        max_time_minutes:
          launchRequest.runConfig?.max_time_minutes ?? Number.POSITIVE_INFINITY,
        ...(launchRequest.runConfig?.grace_period_seconds !== undefined
          ? {
              grace_period_seconds:
                launchRequest.runConfig.grace_period_seconds,
            }
          : {}),
        max_turns: this.normalized.maxTurns,
      };
    }

    if (behaviourPrompts.length > 0) {
      launchRequest.behaviourPrompts = behaviourPrompts;
    }

    const registry = this.deps.getToolRegistry?.();
    let effectiveWhitelist = toolWhitelist;
    const hasExplicitWhitelist =
      Array.isArray(this.params.tool_whitelist) ||
      Array.isArray(this.params.toolWhitelist);

    // Issue #2069: no explicit whitelist must preserve omitted toolConfig so
    // the subagent runtime/profile default tools apply. Do NOT synthesize a
    // whitelist from the parent registry regardless of registry availability.
    if (hasExplicitWhitelist) {
      if (registry && effectiveWhitelist && effectiveWhitelist.length > 0) {
        effectiveWhitelist = this.buildGovernedToolWhitelist(
          effectiveWhitelist,
          registry,
        );
      } else {
        // No registry available: still filter excluded tools (task/list_subagents)
        // so they can never be exposed to a subagent runtime. Non-excluded entries
        // pass through unchanged (no registry validation possible).
        effectiveWhitelist =
          this.filterExcludedFromWhitelist(effectiveWhitelist);
      }
    }

    if (effectiveWhitelist && effectiveWhitelist.length > 0) {
      const whitelistSet = new Set(
        effectiveWhitelist.filter((name): name is string => Boolean(name)),
      );
      launchRequest.toolConfig = {
        tools: Array.from(whitelistSet),
      };
    } else if (hasExplicitWhitelist) {
      // Explicit empty or fully-filtered-to-zero whitelist must remain fail-closed.
      // toolConfig: { tools: [] } tells the runtime to expose no normal tools.
      // Omitting toolConfig entirely (the else case) means runtime/profile defaults.
      launchRequest.toolConfig = { tools: [] };
    }

    taskLogger.debug(() => {
      const summary =
        launchRequest.toolConfig?.tools &&
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
    } = createTimeoutControllers(
      this.config,
      signal,
      this.params.timeout_seconds,
    );

    if (signal.aborted) {
      onUserAbort();
      signal.removeEventListener('abort', onUserAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      return createCancelledResult('Task execution aborted before launch.');
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
      return createErrorResult(
        error,
        'Task tool could not initialize subagent orchestrator.',
      );
    }

    const launchRequest = this.createLaunchRequest(timeoutMs);
    taskLogger.debug(() => `Launching subagent '${launchRequest.name}'`);

    const abortResult = await this.launchSubagent(
      orchestrator,
      launchRequest,
      signal,
      timeoutController,
      timeoutSeconds,
      onUserAbort,
      timeoutId,
      updateOutput,
    );

    return abortResult;
  }

  private async launchSubagent(
    orchestrator: SubagentOrchestrator,
    launchRequest: SubagentLaunchRequest,
    signal: AbortSignal,
    timeoutController: AbortController,
    timeoutSeconds: number | undefined,
    onUserAbort: () => void,
    timeoutId: ReturnType<typeof setTimeout> | null,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const abortState = this.createAbortState(launchRequest, signal);

    signal.addEventListener('abort', abortState.abortHandler, { once: true });

    if (signal.aborted) {
      abortState.abortHandler();
      abortState.removeAbortHandler();
      signal.removeEventListener('abort', onUserAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      return createCancelledResult('Task execution aborted before launch.');
    }

    const launchResult = await this.attemptLaunch(
      orchestrator,
      launchRequest,
      signal,
      timeoutController,
      timeoutSeconds,
      onUserAbort,
      timeoutId,
      abortState,
    );

    if (launchResult === null) {
      if (this.lastLaunchError !== undefined) {
        const error = this.lastLaunchError;
        this.lastLaunchError = undefined;
        return createErrorResult(
          error,
          `Unable to launch subagent '${this.normalized.subagentName}'.`,
        );
      }
      if (abortState.aborted.timedOut) {
        return createTimeoutResult(timeoutSeconds);
      }
      return createCancelledResult('Task aborted during launch.');
    }

    return this.runSubagentExecution(
      launchResult,
      signal,
      timeoutController,
      timeoutSeconds,
      onUserAbort,
      timeoutId,
      abortState,
      updateOutput,
    );
  }

  private createAbortState(
    launchRequest: SubagentLaunchRequest,
    signal: AbortSignal,
  ) {
    return createAbortState(launchRequest, signal);
  }

  private async attemptLaunch(
    orchestrator: SubagentOrchestrator,
    launchRequest: SubagentLaunchRequest,
    signal: AbortSignal,
    timeoutController: AbortController,
    timeoutSeconds: number | undefined,
    onUserAbort: () => void,
    timeoutId: ReturnType<typeof setTimeout> | null,
    abortState: {
      aborted: { aborted: boolean; timedOut: boolean };
      abortHandler: () => void;
      removeAbortHandler: () => void;
      setLaunchResult: (
        result: Awaited<ReturnType<SubagentOrchestrator['launch']>>,
      ) => void;
    },
  ): Promise<Awaited<ReturnType<SubagentOrchestrator['launch']>> | null> {
    let launchResult:
      | Awaited<ReturnType<SubagentOrchestrator['launch']>>
      | undefined;
    try {
      launchResult = await orchestrator.launch(
        launchRequest,
        timeoutController.signal,
      );
      abortState.setLaunchResult(launchResult);
      if (signal.aborted) {
        const scopeCandidate = launchResult.scope as
          | { cancel?: (reason?: string) => void }
          | undefined;
        scopeCandidate?.cancel?.('User aborted task execution.');
      }
      return launchResult;
    } catch (error) {
      abortState.removeAbortHandler();
      signal.removeEventListener('abort', onUserAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (
        isTimeoutErrorHelper(
          signal,
          timeoutController,
          isAbortErrorHelper,
          error,
        )
      ) {
        abortState.aborted.timedOut = true;
        return null;
      }

      if (
        isAbortErrorHelper(error) ||
        abortState.aborted.aborted ||
        signal.aborted
      ) {
        return null;
      }
      taskLogger.warn(
        () =>
          `Launch failure for '${launchRequest.name}': ${error instanceof Error ? error.message : String(error)}`,
      );
      this.lastLaunchError = error;
      return null;
    }
  }

  private lastLaunchError: unknown = undefined;

  private async runSubagentExecution(
    launchResult: Awaited<ReturnType<SubagentOrchestrator['launch']>>,
    signal: AbortSignal,
    timeoutController: AbortController,
    timeoutSeconds: number | undefined,
    onUserAbort: () => void,
    timeoutId: ReturnType<typeof setTimeout> | null,
    abortState: {
      aborted: { aborted: boolean; timedOut: boolean };
      abortHandler: () => void;
      removeAbortHandler: () => void;
      setLaunchResult: (
        result: Awaited<ReturnType<SubagentOrchestrator['launch']>>,
      ) => void;
    },
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const { scope, agentId, dispose } = launchResult;
    taskLogger.debug(
      () =>
        `Subagent '${launchRequestName(launchResult)}' started with agentId=${agentId}`,
    );
    const contextState = this.buildContextState();

    const teardown = this.buildTeardown(
      dispose,
      abortState.removeAbortHandler,
      signal,
      onUserAbort,
      timeoutId,
    );

    if (signal.aborted || abortState.aborted.aborted) {
      await teardown();
      return createCancelledResult(
        'Task aborted during launch.',
        agentId,
        scope.output,
      );
    }

    const { emitClosingSubagentTag } = this.setupStreaming(
      launchResult,
      agentId,
      scope,
      updateOutput,
    );

    try {
      await this.runSubagent(scope, contextState);

      return await this.handleExecutionResult(
        scope,
        agentId,
        signal,
        timeoutController,
        timeoutSeconds,
        teardown,
        abortState.aborted,
      );
    } catch (error) {
      return await this.handleExecutionError(
        error,
        signal,
        timeoutController,
        timeoutSeconds,
        agentId,
        scope,
        teardown,
        abortState.aborted,
      );
    } finally {
      emitClosingSubagentTag();
    }
  }

  private buildTeardown(
    dispose: () => Promise<void>,
    removeAbortHandler: () => void,
    signal: AbortSignal,
    onUserAbort: () => void,
    timeoutId: ReturnType<typeof setTimeout> | null,
  ): () => Promise<void> {
    return async () => {
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
  }

  private setupStreaming(
    launchResult: Awaited<ReturnType<SubagentOrchestrator['launch']>>,
    agentId: string,
    scope: SubAgentScope,
    updateOutput?: (output: string) => void,
  ): { emitClosingSubagentTag: () => void } {
    const subagentName =
      launchRequestName(launchResult) || this.normalized.subagentName;
    let xmlOutputOpen = false;
    const emitClosingSubagentTag = () => {
      if (!xmlOutputOpen || !updateOutput) {
        return;
      }
      updateOutput(`</subagent name="${subagentName}" id="${agentId}">\n`);
      xmlOutputOpen = false;
    };

    if (updateOutput) {
      updateOutput(`<subagent name="${subagentName}" id="${agentId}">\n`);
      xmlOutputOpen = true;

      const existingHandler = scope.onMessage;
      scope.onMessage = (message: string) => {
        const cleaned = normalizeSubagentStreamingText(message);
        if (cleaned.trim().length > 0) {
          updateOutput(cleaned);
        }
        existingHandler?.(message);
      };
    }

    return { emitClosingSubagentTag };
  }

  private async runSubagent(
    scope: SubAgentScope,
    contextState: ContextState,
  ): Promise<void> {
    const environmentInteractive =
      this.deps.isInteractiveEnvironment?.() ?? true;

    if (environmentInteractive && typeof scope.runInteractive === 'function') {
      const schedulerFactory = this.deps.getSchedulerFactory?.();
      const interactiveOptions = schedulerFactory
        ? { schedulerFactory }
        : undefined;
      await scope.runInteractive(contextState, interactiveOptions);
    } else {
      await scope.runNonInteractive(contextState);
    }
  }

  private async handleExecutionError(
    error: unknown,
    signal: AbortSignal,
    timeoutController: AbortController,
    timeoutSeconds: number | undefined,
    agentId: string,
    scope: SubAgentScope,
    teardown: () => Promise<void>,
    abortedState: { aborted: boolean; timedOut: boolean },
  ): Promise<ToolResult> {
    if (
      isTimeoutErrorHelper(signal, timeoutController, isAbortErrorHelper, error)
    ) {
      await teardown();
      return createTimeoutResult(timeoutSeconds, scope.output, agentId);
    }

    if (isAbortErrorHelper(error) || abortedState.aborted || signal.aborted) {
      await teardown();
      return createCancelledResult(
        'Task execution aborted before completion.',
        agentId,
        scope.output,
      );
    }
    const result = createErrorResult(
      error,
      `Subagent '${this.normalized.subagentName}' failed during execution.`,
      agentId,
    );
    await teardown();
    taskLogger.warn(
      () => `Subagent execution error: ${result.error?.message ?? 'unknown'}`,
    );
    return result;
  }

  private async handleExecutionResult(
    scope: SubAgentScope,
    agentId: string,
    signal: AbortSignal,
    timeoutController: AbortController,
    timeoutSeconds: number | undefined,
    teardown: () => Promise<void>,
    abortedState: { aborted: boolean; timedOut: boolean },
  ): Promise<ToolResult> {
    if (abortedState.aborted) {
      await teardown();
      taskLogger.warn(() => `Subagent aborted before completion`);
      return createCancelledResult(
        'Task execution aborted before completion.',
        agentId,
        scope.output,
      );
    }
    if (isTimeoutErrorHelper(signal, timeoutController, isAbortErrorHelper)) {
      await teardown();
      return createTimeoutResult(timeoutSeconds, scope.output);
    }
    const output = scope.output;
    taskLogger.debug(
      () =>
        `Subagent finished with reason=${output.terminate_reason} emittedKeys=${Object.keys(output.emitted_vars).join(', ')}`,
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
        emittedVars: output.emitted_vars,
        ...(output.final_message ? { finalMessage: output.final_message } : {}),
      },
    };
  }

  private buildContextState(): ContextState {
    const context = new ContextState();
    context.set('task_goal', this.normalized.goalPrompt);
    context.set('task_name', this.normalized.subagentName);

    const sessionId = this.config.getSessionId();
    if (sessionId.length > 0) {
      context.set('sessionId', sessionId);
    }

    for (const [key, value] of Object.entries(this.normalized.context)) {
      context.set(key, value);
    }
    context.set('task_behaviour_prompts', [
      ...this.normalized.behaviourPrompts,
    ]);
    return context;
  }
  private async executeAsync(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    return executeAsyncTask(
      {
        config: this.config,
        normalized: this.normalized,
        params: this.params,
        createOrchestrator: () => this.deps.createOrchestrator(),
        getAsyncTaskManager: this.deps.getAsyncTaskManager,
        isInteractiveEnvironment: this.deps.isInteractiveEnvironment,
        getSchedulerFactory: this.deps.getSchedulerFactory,
        buildLaunchRequest: () => this.createLaunchRequest(),
        buildContextState: () => this.buildContextState(),
      },
      signal,
      updateOutput,
    );
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
          grace_period_seconds: {
            type: 'number',
            description:
              'Optional grace period in seconds for recovery after a termination condition (TIMEOUT, MAX_TURNS, or protocol violation). Falls back to 60s if not specified or invalid.',
          },
          max_turns: {
            type: 'number',
            description:
              'Optional maximum number of turns for the subagent. Overrides the subagent profile and parent agent defaults when set.',
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

    if (params.max_turns !== undefined) {
      const maxTurns = params.max_turns;
      if (
        !Number.isFinite(maxTurns) ||
        !Number.isInteger(maxTurns) ||
        (maxTurns !== -1 && maxTurns < 1)
      ) {
        return 'Task tool max_turns must be a positive integer or -1 for unlimited.';
      }
    }

    return null;
  }

  protected createInvocation(
    params: TaskToolParams,
    messageBus: MessageBus,
  ): TaskToolInvocation {
    const normalized = this.normalizeParams(params);
    return new TaskToolInvocation(
      this.config,
      params,
      normalized,
      {
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
      },
      messageBus,
    );
  }

  private normalizeParams(params: TaskToolParams): TaskToolInvocationParams {
    return normalizeTaskParams(params);
  }

  private ensureOrchestrator(): SubagentOrchestrator {
    if (this.dependencies.orchestratorFactory) {
      return this.dependencies.orchestratorFactory();
    }

    const profileManager =
      this.dependencies.profileManager ??
      resolveOptionalConfigMethod(this.config, 'getProfileManager');
    const subagentManager =
      this.dependencies.subagentManager ??
      resolveOptionalConfigMethod(this.config, 'getSubagentManager');

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
