import {
  runInteractiveIteration,
  buildSubagentInitialMessages,
} from './subagent-interactive-iteration.js';
import type { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ProviderRetryOperations } from '@vybestack/llxprt-code-core/runtime/contracts/ProviderRetryOperations.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { AggregateDisposeError } from '../api/disposeErrors.js';
import type { ChildAgentScope } from './subagentOrchestrator.js';
import { consumeInteractiveTurnOutput } from './subagent-interactive-output.js';

/**
 * @plan PLAN-20251028-STATELESS6.P08
 * @requirement REQ-STAT6-001.1, REQ-STAT6-003.1
 * @pseudocode agent-runtime-context.md lines 92-101
 */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { iContentFromBlocks } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import { assembleSchedulerOwner } from '../session/assembleSchedulerOwner.js';
import {
  executeToolCall,
  type ToolExecutionConfig,
} from './nonInteractiveToolExecutor.js';
import { Turn, type ToolCallRequestInfo } from './turn.js';

import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { type EmojiFilter } from '@vybestack/llxprt-code-core/filters/EmojiFilter.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import type {
  AgentRuntimeContext,
  ReadonlySettingsSnapshot,
  ToolRegistryView,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { Storage } from '@vybestack/llxprt-code-settings/storage/Storage.js';
import { LocalTodoStore } from '@vybestack/llxprt-code-tools';
import { type ChatSession } from './chatSession.js';
import { type CompletedToolCall } from './coreToolScheduler.js';
import { isToolNameRestricted } from './hookToolRestrictions.js';
import { providerNameOrDefault } from './subagentAdmissionForwarding.js';
import {
  checkInteractiveGoal,
  handleExecutionError,
  initInteractiveScheduler,
  type ExecutionLoopContext,
} from './subagentExecution.js';
import { executeNonInteractiveRun } from './subagentNonInteractive.js';
import {
  buildRuntimeFunctionDeclarations,
  createChatObject,
  createEmojiFilter,
  createToolExecutionConfig,
  filterToolsAgainstRuntime,
  getScopeLocalFuncDefs,
} from './subagentRuntimeSetup.js';
import type { SubagentExecutionOptions } from './subagentScheduler.js';
import {
  buildPartsFromCompletedCalls,
  buildTodoCompletionPrompt,
  buildToolUnavailableMessage,
  classifyToolCompletions,
  finalizeOutput,
  handleEmitValueCall,
  processFunctionCalls,
  recordFatalToolError,
  recordSuccessfulToolExecution,
  resolveToolName,
  type InteractiveToolMarker,
  type NonInteractiveToolExecutionResult,
} from './subagentToolProcessing.js';
import { SCOPE_LOCAL_EMIT_TOOL_NAME } from './toolGovernance.js';

// --- Internal imports from subagentTypes.ts (used within this file) ---
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import {
  SubagentTerminateMode,
  type EnvironmentContextLoader,
  type ModelConfig,
  type OutputConfig,
  type OutputObject,
  type PromptConfig,
  type RunConfig,
  type ToolConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';

/**
 * Represents the scope and execution environment for a subagent.
 * This class orchestrates the subagent's lifecycle, managing its chat interactions,
 * runtime context, and the collection of its outputs.
 *
 * @plan PLAN-20251028-STATELESS6.P08
 * @requirement REQ-STAT6-001.1, REQ-STAT6-001.2, REQ-STAT6-003.1, REQ-STAT6-003.2
 * @pseudocode agent-runtime-context.md line 93 (step 007.1)
 */
export interface SubAgentDependencies {
  createTurn?: (
    chat: ChatSession,
    promptId: string,
    agentId: string,
    providerName: string,
    hookOwner?: HookExecutionOwner,
  ) => Pick<Turn, 'run' | 'pendingToolCalls'>;
}

export interface SubAgentLaunchInput {
  readonly name: string;
  readonly prompt: PromptConfig;
  readonly model: ModelConfig;
  readonly run: RunConfig;
  readonly toolConfig: ToolConfig | undefined;
  readonly outputConfig: OutputConfig | undefined;
  readonly parentSignal: AbortSignal | undefined;
}

export interface SubAgentRuntimeInput {
  readonly admittedRuntime: AgentRuntimeContext;
  readonly contentGenerator: ContentGenerator;
  readonly telemetry: RootTelemetry;
  readonly toolRegistry: ToolSelection;
  readonly toolsView: ToolRegistryView;
  readonly settingsSnapshot: ReadonlySettingsSnapshot | undefined;
  readonly foregroundConfig: Config;
}

export interface SubAgentOperationPorts {
  readonly instructions: InstructionReadOperations;
  readonly workspacePaths: WorkspacePathOperations;
  readonly readMcpInstructions: () => string | undefined;
  readonly messageBus: MessageBus;
  readonly loadEnvironmentContext: EnvironmentContextLoader;
  readonly readApprovalMode: () => ApprovalMode;
  readonly admitModelParameters: () => AdmittedModelParameters;
  readonly providerFiles: object | undefined;
  readonly hooks: HookExecutionOwner;
  readonly tryBucketFailover: ProviderRetryOperations['tryBucketFailover'];
  readonly readCurrentBucket: ProviderRetryOperations['readCurrentBucket'];
  readonly dependencies: SubAgentDependencies;
}

export type SubAgentScopeFactory = typeof SubAgentScope.create;

export class SubAgentScope implements ChildAgentScope {
  output: OutputObject = {
    terminate_reason: SubagentTerminateMode.ERROR,
    emitted_vars: {},
  };
  private readonly subagentId: string;
  private readonly logger = new DebugLogger('llxprt:subagent');
  private readonly textToolParser = new GemmaToolCallParser();
  private activeAbortController: AbortController | null = null;
  private readonly parentAbortSignal?: AbortSignal;
  private parentAbortCleanup?: () => void;

  /** Emoji filter instance for subagent output */
  private readonly emojiFilter?: EmojiFilter;

  /** Optional callback for streaming text messages during execution */
  onMessage?: (message: string) => void;
  /** Discards current-attempt derived output; already published progress is historical. */
  onOutputReset?: () => void;

  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private activeRun: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;
  private closed = false;

  /** @plan PLAN-20251028-STATELESS6.P08, PLAN-20260303-MESSAGEBUS.P01 */
  private constructor(
    readonly name: string,
    private readonly runtimeContext: AgentRuntimeContext,
    private readonly modelConfig: ModelConfig,
    private readonly runConfig: RunConfig,
    private readonly promptConfig: PromptConfig,
    private readonly contentGenerator: ContentGenerator,
    private readonly toolExecutorContext: ToolExecutionConfig,
    private readonly environmentContextLoader: EnvironmentContextLoader,
    private readonly config: Config,
    private readonly workspacePaths: WorkspacePathOperations,
    private readonly readMcpInstructions: () => string | undefined,
    private readonly instructions: InstructionReadOperations,
    private readonly providerFileLifecycle: object | undefined,
    private readonly tryBucketFailover: ProviderRetryOperations['tryBucketFailover'],
    private readonly readCurrentBucket: ProviderRetryOperations['readCurrentBucket'],
    private readonly messageBus: MessageBus,
    private readonly toolConfig: ToolConfig | undefined,
    private readonly outputConfig: OutputConfig | undefined,
    settingsSnapshot: ReadonlySettingsSnapshot | undefined,
    parentAbortSignal: AbortSignal | undefined,
    private readonly dependencies: SubAgentDependencies,
    private readonly admitModelParameters: () => AdmittedModelParameters,
    private readonly hookOwner: HookExecutionOwner,
  ) {
    const randomPart = Math.random().toString(36).slice(2, 8);
    this.subagentId = `${this.name}-${randomPart}`;
    this.parentAbortSignal = parentAbortSignal;

    // Initialize emoji filter based on subagent and foreground settings
    this.emojiFilter = createEmojiFilter(settingsSnapshot);
  }

  /**
   * Returns the unique agent identifier assigned to this subagent scope.
   */
  getAgentId(): string {
    return this.subagentId;
  }

  /**
   * Creates and validates a new SubAgentScope instance.
   *
   * @plan PLAN-20251028-STATELESS6.P08
   * @requirement REQ-STAT6-001.1, REQ-STAT6-003.1, REQ-STAT6-003.2
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
   * @requirement REQ-D01-001.1
   */
  static async create(
    launch: SubAgentLaunchInput,
    runtime: SubAgentRuntimeInput,
    operations: SubAgentOperationPorts,
  ): Promise<ChildAgentScope> {
    const { admittedRuntime, toolsView } = runtime;
    const toolConfig =
      launch.toolConfig === undefined
        ? undefined
        : await filterToolsAgainstRuntime({
            toolConfig: launch.toolConfig,
            toolsView,
          });

    return new SubAgentScope(
      launch.name,
      Object.freeze({ ...admittedRuntime, tools: toolsView }),
      launch.model,
      launch.run,
      launch.prompt,
      runtime.contentGenerator,
      createToolExecutionConfig(
        runtime.telemetry,
        () => admittedRuntime.readToolExecutionPolicy(),
        () => admittedRuntime.state.sessionId,
        runtime.toolRegistry,
        runtime.settingsSnapshot,
        toolConfig,
        operations.readApprovalMode,
      ),
      operations.loadEnvironmentContext,
      runtime.foregroundConfig,
      operations.workspacePaths,
      operations.readMcpInstructions,
      operations.instructions,
      operations.providerFiles,
      operations.tryBucketFailover,
      operations.readCurrentBucket,
      operations.messageBus,
      toolConfig,
      launch.outputConfig,
      runtime.settingsSnapshot,
      launch.parentSignal,
      operations.dependencies,
      operations.admitModelParameters,
      operations.hooks,
    );
  }

  private bindParentSignal(abortController: AbortController): void {
    if (!this.parentAbortSignal) {
      return;
    }
    if (this.parentAbortCleanup) {
      this.parentAbortCleanup();
    }
    const relayAbort = () => abortController.abort();
    if (this.parentAbortSignal.aborted) {
      relayAbort();
      return;
    }
    this.parentAbortSignal.addEventListener('abort', relayAbort, {
      once: true,
    });
    this.parentAbortCleanup = () => {
      this.parentAbortSignal?.removeEventListener('abort', relayAbort);
    };
  }

  private armTimeout(abortController: AbortController): void {
    if (!Number.isFinite(this.runConfig.max_time_minutes)) {
      return;
    }
    const timeoutMs = this.runConfig.max_time_minutes * 60 * 1000;
    if (timeoutMs <= 0) {
      if (!abortController.signal.aborted) {
        this.output.terminate_reason = SubagentTerminateMode.TIMEOUT;
        abortController.abort(createAbortError());
      }
      return;
    }
    this.clearTimeoutHandle();
    this.timeoutHandle = setTimeout(() => {
      if (abortController.signal.aborted === true) {
        return;
      }
      this.output.terminate_reason = SubagentTerminateMode.TIMEOUT;
      abortController.abort(createAbortError());
    }, timeoutMs);
  }

  private clearTimeoutHandle(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private async prepareRun(context: ContextState) {
    const chat = await createChatObject(
      {
        promptConfig: this.promptConfig,
        modelConfig: this.modelConfig,
        outputConfig: this.outputConfig,
        toolConfig: this.toolConfig,
        runtimeContext: this.runtimeContext,
        contentGenerator: this.contentGenerator,
        environmentContextLoader: this.environmentContextLoader,
        foregroundConfig: this.config,
        workspaceDirectories: () => this.workspacePaths.directories(),
        readMcpInstructions: this.readMcpInstructions,
        instructions: this.instructions,
        context,
      },
      this.providerFileLifecycle,
      this.tryBucketFailover,
      this.readCurrentBucket,
    );
    if (!chat) {
      this.output.terminate_reason = SubagentTerminateMode.ERROR;
      return null;
    }
    const abortController = new AbortController();
    this.activeAbortController = abortController;
    this.bindParentSignal(abortController);
    const functionDeclarations = buildRuntimeFunctionDeclarations(
      this.runtimeContext.tools,
      this.toolConfig,
    );
    if (this.outputConfig?.outputs) {
      functionDeclarations.push(...getScopeLocalFuncDefs(this.outputConfig));
    }
    this.armTimeout(abortController);
    return { chat, abortController, functionDeclarations };
  }

  /**
   * Executes the subagent in interactive mode by routing tool calls through the
   * shared CoreToolScheduler. Tests may supply a custom schedulerFactory to
   * observe scheduling behaviour without touching the real scheduler.
   */
  runInteractive(
    context: ContextState,
    options?: SubagentExecutionOptions,
  ): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error('Subagent scope is disposed'));
    return this.trackRun(() => this.runInteractiveOwned(context, options));
  }

  private async runInteractiveOwned(
    context: ContextState,
    options?: SubagentExecutionOptions,
  ): Promise<void> {
    const modelParameters = this.admitModelParameters();
    const setup = await this.prepareRun(context);
    if (!setup) return;
    const { chat, abortController } = setup;
    let schedulerDispose: () => Promise<void> = async () => {};
    const executionErrors: unknown[] = [];

    const execCtx = this.buildExecCtx();
    const startTime = Date.now();
    let turnCounter = 0;
    let currentMessages = buildSubagentInitialMessages(context);

    try {
      const { scheduler, schedulerDispose: releaseScheduler } =
        await this.initScheduler(options);
      schedulerDispose = releaseScheduler;

      let keepRunning = true;
      while (keepRunning) {
        const iteration = await runInteractiveIteration(
          turnCounter,
          startTime,
          execCtx,
          abortController.signal,
          {
            runTurn: () =>
              this.runInteractiveTurn(
                chat,
                currentMessages,
                abortController,
                turnCounter,
                execCtx,
                modelParameters,
              ),
            processTools: (calls) =>
              this.handleInteractiveToolCalls(
                calls,
                scheduler,
                chat,
                abortController,
                execCtx,
              ),
            checkGoal: (nextTurn, currentTurn) =>
              checkInteractiveGoal(
                execCtx,
                startTime,
                nextTurn,
                currentTurn,
                () => this.readTodoCompletionPrompt(),
              ),
          },
        );
        if (iteration.action === 'abort') {
          return;
        }
        if (iteration.action === 'stop') {
          keepRunning = false;
        } else {
          currentMessages = iteration.messages;
          turnCounter = iteration.turnCounter;
        }
      }
      finalizeOutput(this.output);
    } catch (error) {
      executionErrors.push(error);
      if (this.output.terminate_reason !== SubagentTerminateMode.TIMEOUT) {
        handleExecutionError(error, execCtx);
      }
      finalizeOutput(this.output);
      throw error;
    } finally {
      await this.cleanupInteractive(schedulerDispose, executionErrors);
    }
  }

  /**
   * Discriminated result for a single interactive loop iteration.
   * Extracting the loop body keeps the caller loop to a single control
   * branch (no break/continue) and avoids the always-truthy while(true).
   */
  private async initScheduler(options: SubagentExecutionOptions | undefined) {
    const messageBus = this.messageBus;
    const registry = this.toolExecutorContext.getToolRegistry();
    if (registry === undefined) throw new Error('Missing child tool selection');
    return initInteractiveScheduler(options, {
      createSchedulerOwner: (callbacks) =>
        assembleSchedulerOwner(this.subagentId, {
          telemetry: this.toolExecutorContext.telemetry,
          config: this.config,
          messageBus,
          toolRegistry: registry,
          readApprovalMode: this.toolExecutorContext.readApprovalMode,
          getToolGovernance: () => this.toolExecutorContext.readGovernance(),
          readExecutionPolicy: () =>
            this.toolExecutorContext.readExecutionPolicy(),
          toolContextInteractiveMode: true,
          ...callbacks,
        }),
      onMessage: this.onMessage,
      messageBus: this.messageBus,
      subagentId: this.subagentId,
      logger: this.logger,
    });
  }

  private async runInteractiveTurn(
    chat: ChatSession,
    currentMessages: IContent[],
    abortController: AbortController,
    turnIndex: number,
    execCtx: ExecutionLoopContext,
    modelParameters?: AdmittedModelParameters,
  ) {
    const currentTurn = turnIndex;
    const promptId = `${this.runtimeContext.state.sessionId}#${this.subagentId}#${currentTurn}`;
    // Persisted subagent runtime state may carry a nullish provider
    // despite the declared-required type; validate at the boundary.
    const providerName = providerNameOrDefault(
      this.runtimeContext.state.provider,
    );
    const turn = this.dependencies.createTurn
      ? this.dependencies.createTurn(
          chat,
          promptId,
          this.subagentId,
          providerName,
          this.hookOwner,
        )
      : new Turn(
          chat,
          promptId,
          this.subagentId,
          providerName,
          undefined,
          this.hookOwner,
        );
    const blocks = currentMessages[0]?.blocks ?? [];

    const output = await consumeInteractiveTurnOutput(
      turn.run(blocks, abortController.signal, modelParameters),
      abortController.signal,
      execCtx,
    );
    return {
      responseParts: [...turn.pendingToolCalls],
      currentTurn,
      ...output,
    };
  }

  private partitionInteractiveToolRequests(
    toolRequests: ToolCallRequestInfo[],
  ): {
    manualBlocks: ContentBlock[];
    schedulerRequests: ToolCallRequestInfo[];
    requestMarkers: InteractiveToolMarker[];
  } {
    const manualBlocks: ContentBlock[] = [];
    const schedulerRequests: ToolCallRequestInfo[] = [];
    const requestMarkers: InteractiveToolMarker[] = [];

    for (const request of toolRequests) {
      const hookRestrictedAllowedTools = request.hookRestrictedAllowedTools;
      if (isToolNameRestricted(request.name, hookRestrictedAllowedTools)) {
        requestMarkers.push({ status: 'error-nonfatal' });
        continue;
      }
      if (request.name === SCOPE_LOCAL_EMIT_TOOL_NAME) {
        const blocks = handleEmitValueCall(request, {
          output: this.output,
          onMessage: this.onMessage,
          subagentId: this.subagentId,
          logger: this.logger,
        });
        manualBlocks.push(...blocks);
        requestMarkers.push({
          status: blocks.some(
            (block) => block.type === 'tool_response' && !block.error,
          )
            ? 'success'
            : 'error-nonfatal',
        });
      } else {
        requestMarkers.push({ callId: request.callId });
        schedulerRequests.push(request);
      }
    }

    return { manualBlocks, schedulerRequests, requestMarkers };
  }

  private async handleInteractiveToolCalls(
    toolRequests: ToolCallRequestInfo[],
    scheduler: {
      schedule: (
        req: ToolCallRequestInfo | ToolCallRequestInfo[],
        signal: AbortSignal,
        hookOwner?: HookExecutionOwner,
      ) => Promise<void> | void;
      awaitCompletedCalls: (
        signal?: AbortSignal,
      ) => Promise<CompletedToolCall[]>;
    },
    chat: ChatSession,
    abortController: AbortController,
    execCtx: ExecutionLoopContext,
  ): Promise<IContent[] | null> {
    if (toolRequests.length === 0) return null;

    const { manualBlocks, schedulerRequests, requestMarkers } =
      this.partitionInteractiveToolRequests(toolRequests);

    let responseBlocks: ContentBlock[] = [...manualBlocks];
    let completedCalls: CompletedToolCall[] = [];

    if (schedulerRequests.length > 0) {
      const completionPromise = scheduler.awaitCompletedCalls(
        abortController.signal,
      );
      // Prevent unhandled rejection if both schedule() and
      // completionPromise reject on the same abort signal.
      completionPromise.catch(() => {});
      await scheduler.schedule(
        schedulerRequests,
        abortController.signal,
        this.hookOwner,
      );
      completedCalls = await completionPromise;
      try {
        chat.recordCompletedToolCalls(this.modelConfig.model, completedCalls);
      } catch (error) {
        this.logger.debug(
          () =>
            `Subagent ${this.subagentId} recordCompletedToolCalls best-effort persistence failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      }

      responseBlocks = responseBlocks.concat(
        buildPartsFromCompletedCalls(completedCalls, {
          onMessage: this.onMessage,
          subagentId: this.subagentId,
          logger: this.logger,
        }),
      );
    }
    // Manual emit successes are re-derived from markers in request order.
    const { recovered, fatalCall } = classifyToolCompletions(
      requestMarkers,
      completedCalls,
    );
    if (recovered) {
      recordSuccessfulToolExecution(execCtx.output);
    }
    this.appendFatalToolDiagnostic(fatalCall, responseBlocks, execCtx);

    if (responseBlocks.length === 0) {
      if (manualBlocks.length === 0 && schedulerRequests.length === 0) {
        return null;
      }
      responseBlocks.push({
        type: 'text',
        text: 'All tool calls failed. Please analyze the errors and try an alternative approach.',
      });
    }

    return [iContentFromBlocks(responseBlocks, 'tool')];
  }

  private appendFatalToolDiagnostic(
    fatalCall: CompletedToolCall | undefined,
    responseBlocks: ContentBlock[],
    execCtx: ExecutionLoopContext,
  ): void {
    if (fatalCall) {
      const fatalMessage = buildToolUnavailableMessage(
        fatalCall.request.name,
        fatalCall.response.resultDisplay,
        fatalCall.response.error,
      );
      recordFatalToolError(execCtx.output, fatalMessage);
      this.logger.warn(
        () =>
          `Subagent ${this.subagentId} cannot use tool '${fatalCall.request.name}': ${fatalMessage}`,
      );
      // buildPartsFromCompletedCalls already forwarded the paired response;
      // this branch adds only the availability diagnostic.
      responseBlocks.push({ type: 'text', text: fatalMessage });
      execCtx.output.final_message = fatalMessage;
    }
  }

  private async cleanupInteractive(
    schedulerDispose: () => Promise<void>,
    executionErrors: readonly unknown[],
  ): Promise<void> {
    const cleanupErrors: unknown[] = [];
    const cleanups: ReadonlyArray<() => void | Promise<void>> = [
      () => this.clearTimeoutHandle(),
      schedulerDispose,
      () => this.parentAbortCleanup?.(),
    ];
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    this.parentAbortCleanup = undefined;
    this.activeAbortController = null;
    if (cleanupErrors.length > 0) {
      throw new AggregateDisposeError([...executionErrors, ...cleanupErrors]);
    }
  }

  /**
   * Runs the subagent in a non-interactive mode.
   *
   * @plan PLAN-20251028-STATELESS6.P08
   * @requirement REQ-STAT6-001.1
   */
  runNonInteractive(context: ContextState): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error('Subagent scope is disposed'));
    return this.trackRun(() => this.runNonInteractiveOwned(context));
  }

  private async runNonInteractiveOwned(context: ContextState): Promise<void> {
    const modelParameters = Object.freeze({ ...this.admitModelParameters() });
    const setup = await this.prepareRun(context);
    if (!setup) return;
    const { chat, abortController, functionDeclarations } = setup;
    await executeNonInteractiveRun(
      functionDeclarations,
      abortController,
      buildSubagentInitialMessages(context),
      Date.now(),
      this.buildExecCtx(),
      {
        output: this.output,
        subagentId: this.subagentId,
        name: this.name,
        sessionId: this.runtimeContext.state.sessionId,
        logger: this.logger,
        runConfig: this.runConfig,
        ...(this.outputConfig === undefined
          ? {}
          : { outputConfig: this.outputConfig }),
        modelParameters,
        streamTimeoutPolicy: chat.getStreamTimeoutPolicy(),
        imagePayloadBudgetBytes: this.config.getImagePayloadBudgetBytes(),
        streamModel: (message, tools, signal, promptId, parameters) =>
          chat.sendMessageStream(
            {
              message,
              modelParameters: parameters,
              hookOwner: this.hookOwner,
              config: { abortSignal: signal, tools },
            },
            promptId,
          ),
        executeToolCalls: (calls, controller, promptId, allowedToolNames) =>
          processFunctionCalls(
            calls,
            controller,
            promptId,
            {
              output: this.output,
              ...(this.outputConfig === undefined
                ? {}
                : { outputConfig: this.outputConfig }),
              subagentId: this.subagentId,
              logger: this.logger,
              imagePayloadBudgetBytes: this.config.getImagePayloadBudgetBytes(),
              executeToolCall: (request, signal) =>
                this.executeNonInteractiveToolCall(request, signal),
            },
            allowedToolNames,
          ),
        readTodoCompletionPrompt: () => this.readTodoCompletionPrompt(),
      },
      () => {
        this.clearTimeoutHandle();
        this.parentAbortCleanup?.();
        this.parentAbortCleanup = undefined;
        this.activeAbortController = null;
      },
    );
  }

  private async executeNonInteractiveToolCall(
    request: ToolCallRequestInfo,
    signal: AbortSignal,
  ): Promise<NonInteractiveToolExecutionResult> {
    const registry = this.toolExecutorContext.getToolRegistry();
    if (registry === undefined) throw new Error('Missing child tool selection');
    const completed = await executeToolCall(
      (callbacks) =>
        assembleSchedulerOwner(this.subagentId, {
          telemetry: this.toolExecutorContext.telemetry,
          config: this.config,
          messageBus: this.messageBus,
          toolRegistry: registry,
          readApprovalMode: this.toolExecutorContext.readApprovalMode,
          getToolGovernance: () => this.toolExecutorContext.readGovernance(),
          readExecutionPolicy: () =>
            this.toolExecutorContext.readExecutionPolicy(),
          toolContextInteractiveMode: false,
          ...callbacks,
        }),
      request,
      signal,
      this.hookOwner,
    );
    return { status: completed.status, response: completed.response };
  }

  private async readTodoCompletionPrompt(): Promise<string | null> {
    const sessionId = this.runtimeContext.state.sessionId;
    if (!sessionId) return null;
    try {
      const dataDirResolver = () => Storage.getGlobalDataDir();
      let todos = await new LocalTodoStore(
        sessionId,
        { dataDirResolver },
        this.subagentId,
      ).readTodos();
      if (todos.length === 0) {
        todos = await new LocalTodoStore(sessionId, {
          dataDirResolver,
        }).readTodos();
      }
      return buildTodoCompletionPrompt(todos);
    } catch (error) {
      this.logger.warn(
        () =>
          `Subagent ${this.subagentId} could not inspect todos: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private buildExecCtx(): ExecutionLoopContext {
    return {
      output: this.output,
      subagentId: this.subagentId,
      runConfig: this.runConfig,
      outputConfig: this.outputConfig,
      emojiFilter: this.emojiFilter,
      textToolParser: this.textToolParser,
      resolveToolName: (rawName) =>
        resolveToolName(
          rawName,
          (name) =>
            this.runtimeContext.tools.getToolMetadata(name) !== undefined,
        ),
      logger: this.logger,
      onMessage: this.onMessage,
      onOutputReset: this.onOutputReset,
    };
  }

  cancel(reason?: string): void {
    if (
      this.activeAbortController !== null &&
      this.activeAbortController.signal.aborted === true
    ) {
      return;
    }
    if (this.activeAbortController === null) {
      return;
    }
    this.logger.warn(() => {
      const suffix = reason ? `: ${reason}` : '';
      return `Subagent ${this.subagentId} cancellation requested${suffix}`;
    });
    this.activeAbortController.abort();
  }

  /**
   * Dispose of the subagent scope, cleaning up resources and references.
   * Call this when the subagent is no longer needed to prevent memory leaks.
   *
   * Cleanup performed:
   * - Aborts any active operations
   * - Removes parent abort signal event listeners
   * - Nullifies references to allow garbage collection
   *
   * Safe to call multiple times.
   */
  private trackRun(operation: () => Promise<void>): Promise<void> {
    if (this.activeRun !== undefined)
      return Promise.reject(new Error('Subagent scope is already running'));
    const run = operation();
    this.activeRun = run;
    void run
      .finally(() => {
        if (this.activeRun === run) this.activeRun = undefined;
      })
      .catch(() => undefined);
    return run;
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.closed = true;
    // 1. Cancel any active operations
    if (
      this.activeAbortController &&
      !this.activeAbortController.signal.aborted
    ) {
      this.logger.debug(
        () =>
          `Disposing subagent ${this.subagentId}, aborting active operations`,
      );
      this.activeAbortController.abort();
    }
    this.activeAbortController = null;
    const activeRun = this.activeRun;
    this.disposal = (async () => {
      await activeRun?.catch(() => undefined);
      if (this.parentAbortCleanup) {
        this.parentAbortCleanup();
        this.parentAbortCleanup = undefined;
      }
      this.logger.debug(() => `Subagent ${this.subagentId} disposed`);
    })();
    return this.disposal;
  }
}
