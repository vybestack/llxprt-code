/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskExecutionPolicy } from '@vybestack/llxprt-code-core/session/session-settings-policies.js';
import type { ToolGovernance } from '@vybestack/llxprt-code-tools';
import type { TaskLaunchOwner } from '../session/task-launch-owner.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type IToolMessageBus,
  type LiveOutputUpdate,
  type ToolResult,
} from '@vybestack/llxprt-code-tools';
import {
  requireEffectiveTimeoutSeconds,
  type TimeoutResolution,
} from '@vybestack/llxprt-code-tools/utils/timeoutResolution.js';
import type { AgentDisplayCallbacks } from '../api/agent.js';
import type {
  ChildTaskRun,
  SubagentOrchestrator,
} from '../core/subagentOrchestrator.js';
import { type SubagentLaunchRequest } from '../core/subagentOrchestrator.js';
import {
  TASK_TIMEOUT_DEFAULT_SETTING,
  TASK_TIMEOUT_MAX_SETTING,
  createAbortState,
  createTimeoutControllers,
  isAbortError as isAbortErrorHelper,
  isTimeoutError as isTimeoutErrorHelper,
  type TimeoutControllers,
} from './taskAbortHelpers.js';
import { executeAsyncTask } from './taskAsyncExecution.js';
import { startTaskHeartbeat, type TaskHeartbeat } from './taskHeartbeat.js';
import {
  attachTimeoutMetadata,
  createCancelledResult,
  createErrorResult,
  createTimeoutResult,
  formatSuccessContent,
  formatSuccessDisplay,
} from './taskResultHelpers.js';
import { taskToolSchema } from './taskSchema.js';
import { setupTaskStreaming } from './taskStreaming.js';
import {
  buildGovernedToolWhitelist,
  filterExcludedFromWhitelist,
  normalizeTaskParams,
  validateCanonicalTaskParamSpellings,
  validateTaskParamValues,
  type TaskToolInvocationParams,
} from './taskToolGovernance.js';

const taskLogger = new DebugLogger('llxprt:task');

export interface TaskToolParams {
  subagent_name?: string;
  goal_prompt?: string;
  behaviour_prompts?: string[];
  tool_whitelist?: string[];
  expected_outputs?: Record<string, string>;
  context?: Record<string, unknown>;
  timeout_seconds?: number;
  grace_period_seconds?: number;
  max_turns?: number;
  async?: boolean;
}

export interface TaskToolDependencies {
  readonly launchChild: SubagentOrchestrator['launch'];
  readonly readTaskPolicy: () => TaskExecutionPolicy;
  readonly readGovernance: () => ToolGovernance;
  readonly toolRegistry?: ToolSelection;
  readonly messageBus: MessageBus;
  readonly openChildDisplay?: () => AgentDisplayCallbacks;
  readonly isInteractiveEnvironment?: () => boolean;
  readonly taskLaunchOwner?: TaskLaunchOwner;
}
function launchRequestName(
  launchResult: Awaited<ReturnType<SubagentOrchestrator['launch']>>,
): string {
  return launchResult.config.name;
}

interface TaskToolInvocationDeps {
  readTaskPolicy: () => TaskExecutionPolicy;
  readGovernance: () => ToolGovernance;
  launchChild: SubagentOrchestrator['launch'];
  getToolRegistry?: () => ToolSelection | undefined;
  openChildDisplay?: () => AgentDisplayCallbacks;
  isInteractiveEnvironment?: () => boolean;
  taskLaunchOwner?: TaskLaunchOwner;
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
    messageBus: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  override getDescription(): string {
    return `Run subagent '${this.normalized.subagentName}' to accomplish: ${this.normalized.goalPrompt}`;
  }

  private buildGovernedToolWhitelist(
    candidateTools: string[] | undefined,
    registry: ToolSelection,
  ): string[] | undefined {
    return buildGovernedToolWhitelist(
      candidateTools,
      registry,
      this.deps.readGovernance(),
    );
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
    const hasExplicitWhitelist = Array.isArray(this.params.tool_whitelist);

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
    updateOutput?: (update: LiveOutputUpdate) => void,
  ): Promise<ToolResult> {
    if (this.normalized.async) {
      return this.executeAsync(signal, updateOutput);
    }

    const controllers = createTimeoutControllers(
      this.deps.readTaskPolicy(),
      signal,
      this.params.timeout_seconds,
    );
    const result = await this.runForeground(signal, updateOutput, controllers);
    return attachTimeoutMetadata(result, controllers.resolution, {
      defaultSetting: TASK_TIMEOUT_DEFAULT_SETTING,
      maxSetting: TASK_TIMEOUT_MAX_SETTING,
    });
  }

  private async runForeground(
    signal: AbortSignal,
    updateOutput: ((update: LiveOutputUpdate) => void) | undefined,
    controllers: TimeoutControllers,
  ): Promise<ToolResult> {
    const { timeoutMs, timeoutController, timeoutId, onUserAbort } =
      controllers;

    if (signal.aborted) {
      onUserAbort();
      signal.removeEventListener('abort', onUserAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      return createCancelledResult('Task execution aborted before launch.');
    }

    const launchRequest = this.createLaunchRequest(timeoutMs);
    taskLogger.debug(() => `Launching subagent '${launchRequest.name}'`);

    return this.launchSubagent(
      this.deps.launchChild,
      launchRequest,
      signal,
      timeoutController,
      controllers.resolution,
      onUserAbort,
      timeoutId,
      updateOutput,
    );
  }

  private async launchSubagent(
    launchChild: SubagentOrchestrator['launch'],
    launchRequest: SubagentLaunchRequest,
    signal: AbortSignal,
    timeoutController: AbortController,
    resolution: TimeoutResolution,
    onUserAbort: () => void,
    timeoutId: ReturnType<typeof setTimeout> | null,
    updateOutput?: (update: LiveOutputUpdate) => void,
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
      launchChild,
      launchRequest,
      signal,
      timeoutController,
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
        return createTimeoutResult(requireEffectiveTimeoutSeconds(resolution));
      }
      return createCancelledResult('Task aborted during launch.');
    }

    return this.runSubagentExecution(
      launchResult,
      signal,
      timeoutController,
      resolution,
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
    launchChild: SubagentOrchestrator['launch'],
    launchRequest: SubagentLaunchRequest,
    signal: AbortSignal,
    timeoutController: AbortController,
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
      launchResult = await launchChild(launchRequest, timeoutController.signal);
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
    resolution: TimeoutResolution,
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
    updateOutput?: (update: LiveOutputUpdate) => void,
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

    const { emitClosingSubagentTag, heartbeat } = this.setupStreaming(
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
        resolution,
        teardown,
        abortState.aborted,
      );
    } catch (error) {
      return await this.handleExecutionError(
        error,
        signal,
        timeoutController,
        resolution,
        agentId,
        scope,
        teardown,
        abortState.aborted,
      );
    } finally {
      heartbeat.stop();
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
    scope: ChildTaskRun,
    updateOutput?: (update: LiveOutputUpdate) => void,
  ): { emitClosingSubagentTag: () => void; heartbeat: TaskHeartbeat } {
    const subagentName =
      launchRequestName(launchResult) || this.normalized.subagentName;
    return setupTaskStreaming(
      subagentName,
      agentId,
      scope,
      updateOutput,
      startTaskHeartbeat,
    );
  }

  private async runSubagent(
    scope: ChildTaskRun,
    contextState: ContextState,
  ): Promise<void> {
    const environmentInteractive =
      this.deps.isInteractiveEnvironment?.() ?? true;

    if (environmentInteractive && typeof scope.runInteractive === 'function') {
      const interactiveOptions = {
        displayCallbacks: this.deps.openChildDisplay?.(),
      };
      await scope.runInteractive(contextState, interactiveOptions);
    } else {
      await scope.runNonInteractive(contextState);
    }
  }

  private async handleExecutionError(
    error: unknown,
    signal: AbortSignal,
    timeoutController: AbortController,
    resolution: TimeoutResolution,
    agentId: string,
    scope: ChildTaskRun,
    teardown: () => Promise<void>,
    abortedState: { aborted: boolean; timedOut: boolean },
  ): Promise<ToolResult> {
    if (
      isTimeoutErrorHelper(signal, timeoutController, isAbortErrorHelper, error)
    ) {
      await teardown();
      return createTimeoutResult(
        requireEffectiveTimeoutSeconds(resolution),
        scope.output,
        agentId,
      );
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
    scope: ChildTaskRun,
    agentId: string,
    signal: AbortSignal,
    timeoutController: AbortController,
    resolution: TimeoutResolution,
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
      return createTimeoutResult(
        requireEffectiveTimeoutSeconds(resolution),
        scope.output,
        agentId,
      );
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
    updateOutput?: (update: LiveOutputUpdate) => void,
  ): Promise<ToolResult> {
    return executeAsyncTask(
      {
        config: this.config,
        readTaskPolicy: this.deps.readTaskPolicy,
        normalized: this.normalized,
        params: this.params,
        launchChild: this.deps.launchChild,
        taskLaunchOwner: this.deps.taskLaunchOwner,
        isInteractiveEnvironment: this.deps.isInteractiveEnvironment,
        openChildDisplay: this.deps.openChildDisplay,
        buildLaunchRequest: (timeoutMs?: number) =>
          this.createLaunchRequest(timeoutMs),
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

  private readonly config: Config;
  private readonly dependencies: TaskToolDependencies;

  constructor(config: Config, dependencies: TaskToolDependencies);
  constructor(
    config: Config,
    dependencies:
      | (Omit<TaskToolDependencies, 'messageBus'> & {
          messageBus: MessageBus | null | undefined;
        })
      | null
      | undefined,
  ) {
    const messageBus = dependencies?.messageBus;
    if (messageBus === undefined || messageBus === null) {
      throw new Error(
        'TaskTool requires a concrete session/runtime MessageBus.',
      );
    }
    super(
      TaskTool.Name,
      'Task',
      `Launches a named subagent, streams its progress, and returns the emitted variables upon completion. The subagent runs in an isolated runtime and is disposed after it finishes.`,
      Kind.Think,
      taskToolSchema,
      true,
      true,
      messageBus,
    );
    this.config = config;
    if (dependencies?.launchChild === undefined)
      throw new Error('Task tool requires a bound child launch operation.');
    this.dependencies = { ...dependencies, messageBus };
  }

  withChildDisplay(
    openChildDisplay: () => AgentDisplayCallbacks,
    taskLaunchOwner?: TaskLaunchOwner,
  ): TaskTool {
    return new TaskTool(this.config, {
      ...this.dependencies,
      openChildDisplay,
      taskLaunchOwner,
    });
  }

  override validateToolParams(params: TaskToolParams): string | null {
    const spellingError = validateCanonicalTaskParamSpellings(params);
    if (spellingError !== null) {
      return spellingError;
    }
    return super.validateToolParams(params);
  }

  protected override validateToolParamValues(
    params: TaskToolParams,
  ): string | null {
    return validateTaskParamValues(params);
  }

  protected createInvocation(
    params: TaskToolParams,
    toolMessageBus?: IToolMessageBus,
  ): TaskToolInvocation {
    if (toolMessageBus === undefined) {
      throw new Error(
        'TaskTool requires a concrete session/runtime MessageBus to build an invocation.',
      );
    }
    const normalized = this.normalizeParams(params);
    return new TaskToolInvocation(
      this.config,
      params,
      normalized,
      {
        launchChild: this.dependencies.launchChild,
        readTaskPolicy: this.dependencies.readTaskPolicy,
        readGovernance: this.dependencies.readGovernance,
        getToolRegistry: () => this.dependencies.toolRegistry,
        openChildDisplay: this.dependencies.openChildDisplay,
        isInteractiveEnvironment:
          this.dependencies.isInteractiveEnvironment ??
          (() => this.config.isInteractive()),
        taskLaunchOwner: this.dependencies.taskLaunchOwner,
      },
      toolMessageBus,
    );
  }

  private normalizeParams(params: TaskToolParams): TaskToolInvocationParams {
    return normalizeTaskParams(params);
  }
}
