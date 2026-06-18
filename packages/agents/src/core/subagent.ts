/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity, max-lines -- Phase 5: legacy core boundary retained while larger decomposition continues. */

/**
 * @plan PLAN-20251028-STATELESS6.P08
 * @requirement REQ-STAT6-001.1, REQ-STAT6-003.1
 * @pseudocode agent-runtime-context.md lines 92-101
 */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { type ToolCallRequestInfo, GeminiEventType, Turn } from './turn.js';
import { type ToolExecutionConfig } from './nonInteractiveToolExecutor.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import {
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
} from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import {
  type Content,
  type Part,
  type FunctionCall,
  type FunctionDeclaration,
} from '@google/genai';

import {
  StreamEventType,
  type StreamEvent,
  type ChatSession,
} from './chatSession.js';
import {
  filterHookRestrictedParts,
  filterHookRestrictedFunctionCalls,
  getHookRestrictedAllowedTools,
  getHookRestrictedFunctionCallsFromParts,
  isHookRestrictedToolCall,
  mergeHookRestrictedFunctionCalls,
} from './hookToolRestrictions.js';
import type {
  AgentRuntimeContext,
  ReadonlySettingsSnapshot,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import type { SubagentSchedulerFactory } from './subagentScheduler.js';
import { type CompletedToolCall } from './coreToolScheduler.js';
import { type EmojiFilter } from '@vybestack/llxprt-code-core/filters/EmojiFilter.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  filterToolsAgainstRuntime,
  createToolExecutionConfig,
  createEmojiFilter,
  buildRuntimeFunctionDeclarations,
  getScopeLocalFuncDefs,
  createSchedulerConfig,
  createChatObject,
} from './subagentRuntimeSetup.js';
import {
  isFatalToolError,
  buildToolUnavailableMessage,
  resolveToolName,
  finalizeOutput,
  handleEmitValueCall,
  buildPartsFromCompletedCalls,
  processFunctionCalls,
  buildTodoCompletionPrompt,
} from './subagentToolProcessing.js';
import {
  checkTerminationConditions,
  filterTextWithEmoji,
  checkGoalCompletion,
  processNonInteractiveTextResponse,
  processInteractiveTextResponse,
  handleExecutionError,
  initInteractiveScheduler,
  type ExecutionLoopContext,
} from './subagentExecution.js';

// --- Internal imports from subagentTypes.ts (used within this file) ---
import type { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import {
  SubagentTerminateMode,
  defaultEnvironmentContextLoader,
  type OutputObject,
  type PromptConfig,
  type ToolConfig,
  type OutputConfig,
  type SubAgentRuntimeOverrides,
  type EnvironmentContextLoader,
  type ModelConfig,
  type RunConfig,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';

// Types, interfaces, enums, and ContextState are now in subagentTypes.ts
// Runtime setup helpers are now in subagentRuntimeSetup.ts

/**
 * Represents the scope and execution environment for a subagent.
 * This class orchestrates the subagent's lifecycle, managing its chat interactions,
 * runtime context, and the collection of its outputs.
 *
 * @plan PLAN-20251028-STATELESS6.P08
 * @requirement REQ-STAT6-001.1, REQ-STAT6-001.2, REQ-STAT6-003.1, REQ-STAT6-003.2
 * @pseudocode agent-runtime-context.md line 93 (step 007.1)
 */
export class SubAgentScope {
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

  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  /** @plan PLAN-20251028-STATELESS6.P08, PLAN-20260303-MESSAGEBUS.P01 */
  private constructor(
    readonly name: string,
    readonly runtimeContext: AgentRuntimeContext,
    private readonly modelConfig: ModelConfig,
    private readonly runConfig: RunConfig,
    private readonly promptConfig: PromptConfig,
    private readonly contentGenerator: ContentGenerator,
    private readonly toolExecutorContext: ToolExecutionConfig,
    private readonly environmentContextLoader: EnvironmentContextLoader,
    private readonly config: Config,
    private readonly messageBus?: MessageBus,
    private readonly toolConfig?: ToolConfig,
    private readonly outputConfig?: OutputConfig,
    settingsSnapshot?: ReadonlySettingsSnapshot,
    parentAbortSignal?: AbortSignal,
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
    name: string,
    foregroundConfig: Config,
    promptConfig: PromptConfig,
    modelConfig: ModelConfig,
    runConfig: RunConfig,
    toolConfig?: ToolConfig,
    outputConfig?: OutputConfig,
    overrides: SubAgentRuntimeOverrides = {},
    parentSignal?: AbortSignal,
  ): Promise<SubAgentScope> {
    const runtimeBundle = overrides.runtimeBundle;
    if (!runtimeBundle) {
      throw new Error(
        'SubAgentScope.create requires a runtime bundle after initialization.',
      );
    }

    const toolsView =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Persisted subagent config and runtime tool payloads.
      runtimeBundle.runtimeContext.tools ?? runtimeBundle.toolsView;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Persisted subagent config and runtime tool payloads.
    if (toolsView == null) {
      throw new Error(
        'SubAgentScope.create requires a ToolRegistryView from the runtime bundle.',
      );
    }

    const toolRegistry = overrides.toolRegistry ?? runtimeBundle.toolRegistry;
    if (!toolRegistry) {
      throw new Error(
        'SubAgentScope.create requires a ToolRegistry in the runtime bundle or overrides.',
      );
    }

    if (toolConfig) {
      const filteredToolConfig = await filterToolsAgainstRuntime({
        toolConfig,
        toolsView,
      });
      // Preserve explicit empty/fail-closed semantics: an explicit toolConfig
      // that filters to zero tools must remain { tools: [] } so the runtime
      // produces no normal declarations. Only undefined toolConfig means
      // runtime/profile defaults.
      toolConfig = filteredToolConfig;
    }

    const settingsSnapshot =
      overrides.settingsSnapshot ?? runtimeBundle.settingsSnapshot;

    const toolExecutorContext = createToolExecutionConfig(
      runtimeBundle,
      toolRegistry,
      foregroundConfig,
      overrides.messageBus,
      settingsSnapshot,
      toolConfig,
    );

    const environmentContextLoader =
      overrides.environmentContextLoader ?? defaultEnvironmentContextLoader;

    const runtimeContext: AgentRuntimeContext = Object.freeze({
      ...runtimeBundle.runtimeContext,
      tools: toolsView,
    });

    return new SubAgentScope(
      name,
      runtimeContext,
      modelConfig,
      runConfig,
      promptConfig,
      runtimeBundle.contentGenerator,
      toolExecutorContext,
      environmentContextLoader,
      foregroundConfig,
      overrides.messageBus,
      toolConfig,
      outputConfig,
      settingsSnapshot,
      parentSignal,
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
    const chat = await createChatObject({
      promptConfig: this.promptConfig,
      modelConfig: this.modelConfig,
      outputConfig: this.outputConfig,
      toolConfig: this.toolConfig,
      runtimeContext: this.runtimeContext,
      contentGenerator: this.contentGenerator,
      environmentContextLoader: this.environmentContextLoader,
      foregroundConfig: this.config,
      context,
    });
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

  private buildInitialMessages(context: ContextState): Content[] {
    const behaviourPrompts =
      (context.get('task_behaviour_prompts') as string[] | undefined) ?? [];
    const initialInstruction =
      behaviourPrompts.length > 0
        ? behaviourPrompts.join('\n')
        : 'Follow the task directives provided in the system prompt.';

    return [
      {
        role: 'user',
        parts: [{ text: initialInstruction }],
      },
    ];
  }

  /**
   * Executes the subagent in interactive mode by routing tool calls through the
   * shared CoreToolScheduler. Tests may supply a custom schedulerFactory to
   * observe scheduling behaviour without touching the real scheduler.
   */
  private async runInteractiveGoalCheckLoop(
    execCtx: ExecutionLoopContext,
    startTime: number,
    turnCounter: number,
    currentTurn: number,
  ): Promise<Content[] | null> {
    const recheck = checkTerminationConditions(turnCounter, startTime, execCtx);
    if (recheck.shouldStop) return null;

    const todoReminder = await buildTodoCompletionPrompt(
      this.runtimeContext,
      this.subagentId,
      this.logger,
    );
    return checkGoalCompletion(execCtx, todoReminder, currentTurn);
  }

  async runInteractive(
    context: ContextState,
    options?: {
      schedulerFactory?: SubagentSchedulerFactory;
    },
  ): Promise<void> {
    const setup = await this.prepareRun(context);
    if (!setup) return;
    const { chat, abortController } = setup;
    let schedulerDispose: () => Promise<void> = async () => {};

    const execCtx = this.buildExecCtx();
    const startTime = Date.now();
    let turnCounter = 0;
    let currentMessages = this.buildInitialMessages(context);

    try {
      const { scheduler, schedulerDispose: disposeScheduler } =
        await this.initScheduler(options);
      schedulerDispose = disposeScheduler;

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, sonarjs/too-many-break-or-continue-in-loop -- Persisted subagent config and runtime tool payloads.
      while (true) {
        const check = checkTerminationConditions(
          turnCounter,
          startTime,
          execCtx,
        );
        if (check.shouldStop) break;

        const { responseParts, textResponse, currentTurn } =
          await this.runInteractiveTurn(
            chat,
            currentMessages,
            abortController,
            turnCounter++,
            execCtx,
          );
        if (abortController.signal.aborted === true) return;

        processInteractiveTextResponse(textResponse, execCtx);

        const toolMessages = await this.handleInteractiveToolCalls(
          responseParts,
          scheduler,
          abortController,
          execCtx,
        );
        if (toolMessages) {
          currentMessages = toolMessages;
          continue;
        }

        const nextMessages = await this.runInteractiveGoalCheckLoop(
          execCtx,
          startTime,
          turnCounter,
          currentTurn,
        );
        if (!nextMessages) break;
        currentMessages = nextMessages;
      }
      finalizeOutput(this.output);
    } catch (error) {
      if (this.output.terminate_reason !== SubagentTerminateMode.TIMEOUT) {
        handleExecutionError(error, execCtx);
      }
      finalizeOutput(this.output);
      throw error;
    } finally {
      await this.cleanupInteractive(schedulerDispose, abortController);
    }
  }

  private async initScheduler(
    options: { schedulerFactory?: SubagentSchedulerFactory } | undefined,
  ) {
    return initInteractiveScheduler(options, {
      schedulerConfig: createSchedulerConfig(
        this.toolExecutorContext,
        this.config,
        { interactive: true },
      ),
      onMessage: this.onMessage,
      messageBus: this.messageBus,
      subagentId: this.subagentId,
      logger: this.logger,
    });
  }

  private async runInteractiveTurn(
    chat: ChatSession,
    currentMessages: Content[],
    abortController: AbortController,
    turnIndex: number,
    execCtx: ExecutionLoopContext,
  ) {
    const currentTurn = turnIndex;
    const promptId = `${this.runtimeContext.state.sessionId}#${this.subagentId}#${currentTurn}`;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Persisted subagent config and runtime tool payloads.
    const providerName = this.runtimeContext.state.provider ?? 'backend';
    const turn = new Turn(chat, promptId, this.subagentId, providerName);
    const parts = currentMessages[0]?.parts ?? [];

    let textResponse = '';
    try {
      const stream = turn.run(parts, abortController.signal);
      for await (const event of stream) {
        if (abortController.signal.aborted === true) break;
        if (event.type === GeminiEventType.Content && event.value) {
          textResponse += event.value;
          const filtered = filterTextWithEmoji(event.value, execCtx);
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (filtered.blocked) {
            execCtx.output.terminate_reason = SubagentTerminateMode.ERROR;
            throw new Error(
              filtered.error ?? 'Content blocked by emoji filter',
            );
          }
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (execCtx.onMessage && filtered.text) {
            execCtx.onMessage(filtered.text);
          }
        } else if (event.type === GeminiEventType.Error) {
          const eventError = (
            event.value as { error?: Error | null } | undefined
          )?.error;
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (eventError != null) {
            execCtx.output.terminate_reason = SubagentTerminateMode.ERROR;
            throw new Error(eventError.message);
          }
        }
      }
    } catch (error) {
      if (abortController.signal.aborted === true) {
        throw createAbortError();
      }
      throw error;
    }

    return {
      responseParts: [...turn.pendingToolCalls],
      textResponse,
      currentTurn,
    };
  }

  private partitionInteractiveToolRequests(
    toolRequests: ToolCallRequestInfo[],
  ): { manualParts: Part[]; schedulerRequests: ToolCallRequestInfo[] } {
    const manualParts: Part[] = [];
    const schedulerRequests: ToolCallRequestInfo[] = [];

    for (const request of toolRequests) {
      const hookRestrictedAllowedTools = request.hookRestrictedAllowedTools;
      const functionCall = {
        name: request.name,
        args: request.args,
        id: request.callId,
      };
      if (isHookRestrictedToolCall(functionCall, hookRestrictedAllowedTools)) {
        continue;
      }
      if (request.name === 'self_emitvalue') {
        manualParts.push(
          ...handleEmitValueCall(request, {
            output: this.output,
            onMessage: this.onMessage,
            subagentId: this.subagentId,
            logger: this.logger,
          }),
        );
      } else {
        schedulerRequests.push(request);
      }
    }

    return { manualParts, schedulerRequests };
  }

  private async handleInteractiveToolCalls(
    toolRequests: ToolCallRequestInfo[],
    scheduler: {
      schedule: (
        req: ToolCallRequestInfo | ToolCallRequestInfo[],
        signal: AbortSignal,
      ) => Promise<void> | void;
      awaitCompletedCalls: (
        signal?: AbortSignal,
      ) => Promise<CompletedToolCall[]>;
    },
    abortController: AbortController,
    execCtx: ExecutionLoopContext,
  ): Promise<Content[] | null> {
    if (toolRequests.length === 0) return null;

    const { manualParts, schedulerRequests } =
      this.partitionInteractiveToolRequests(toolRequests);

    let responseParts: Part[] = [...manualParts];

    if (schedulerRequests.length > 0) {
      const completionPromise = scheduler.awaitCompletedCalls(
        abortController.signal,
      );
      // Prevent unhandled rejection if both schedule() and
      // completionPromise reject on the same abort signal.
      completionPromise.catch(() => {});
      await scheduler.schedule(schedulerRequests, abortController.signal);
      const completedCalls = await completionPromise;

      responseParts = responseParts.concat(
        buildPartsFromCompletedCalls(completedCalls, {
          onMessage: this.onMessage,
          subagentId: this.subagentId,
          logger: this.logger,
        }),
      );
      const fatalCall = completedCalls.find(
        (call) =>
          call.status === 'error' && isFatalToolError(call.response.errorType),
      );
      if (fatalCall) {
        const fatalMessage = buildToolUnavailableMessage(
          fatalCall.request.name,
          fatalCall.response.resultDisplay,
          fatalCall.response.error,
        );
        this.logger.warn(
          () =>
            `Subagent ${this.subagentId} cannot use tool '${fatalCall.request.name}': ${fatalMessage}`,
        );
        responseParts.push({ text: fatalMessage });
        execCtx.output.final_message = fatalMessage;
      }
    }

    if (responseParts.length === 0) {
      if (manualParts.length === 0 && schedulerRequests.length === 0) {
        return null;
      }
      responseParts.push({
        text: 'All tool calls failed. Please analyze the errors and try an alternative approach.',
      });
    }

    return [{ role: 'user', parts: responseParts }];
  }

  private async cleanupInteractive(
    schedulerDispose: () => Promise<void>,
    _abortController: AbortController,
  ): Promise<void> {
    this.clearTimeoutHandle();
    try {
      await schedulerDispose();
    } catch (error) {
      this.logger.warn(
        () =>
          `Subagent ${this.subagentId} failed to dispose scheduler: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
    this.parentAbortCleanup?.();
    this.parentAbortCleanup = undefined;
    this.activeAbortController = null;
  }

  /**
   * Runs the subagent in a non-interactive mode.
   *
   * @plan PLAN-20251028-STATELESS6.P08
   * @requirement REQ-STAT6-001.1
   */
  async runNonInteractive(context: ContextState): Promise<void> {
    const setup = await this.prepareRun(context);
    if (!setup) return;
    const { chat, abortController, functionDeclarations: toolsList } = setup;

    this.logger.debug(() => {
      const outputs = this.outputConfig
        ? Object.keys(this.outputConfig.outputs).join(', ')
        : 'none';
      return `Subagent ${this.subagentId} (${this.name}) starting run with toolCount=${toolsList.length} requestedOutputs=${outputs} runConfig=${JSON.stringify(this.runConfig)}`;
    });
    const execCtx = this.buildExecCtx();
    let currentMessages: Content[] = this.buildInitialMessages(context);
    const startTime = Date.now();
    let turnCounter = 0;

    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, sonarjs/too-many-break-or-continue-in-loop -- Persisted subagent config and runtime tool payloads.
      while (true) {
        const check = checkTerminationConditions(
          turnCounter,
          startTime,
          execCtx,
        );
        if (check.shouldStop) break;

        const currentTurn = turnCounter++;
        const promptId = `${this.runtimeContext.state.sessionId}#${this.subagentId}#${currentTurn}`;
        this.logger.debug(
          () =>
            `Subagent ${this.subagentId} turn=${currentTurn} promptId=${promptId}`,
        );

        const { functionCalls } = await this.runNonInteractiveTurn(
          chat,
          currentMessages,
          toolsList,
          abortController,
          currentTurn,
          execCtx,
        );
        if (abortController.signal.aborted === true) return;

        // Post-send timeout recheck
        const recheck = checkTerminationConditions(
          turnCounter,
          startTime,
          execCtx,
        );
        if (recheck.shouldStop) break;

        const nextMessages = await this.dispatchNonInteractiveTurnResult(
          functionCalls,
          abortController,
          promptId,
          currentTurn,
          execCtx,
        );
        if (!nextMessages) break;
        currentMessages = nextMessages;
      }
      finalizeOutput(this.output);
    } catch (error) {
      if (this.output.terminate_reason !== SubagentTerminateMode.TIMEOUT) {
        handleExecutionError(error, execCtx);
      }
      finalizeOutput(this.output);
      throw error;
    } finally {
      this.clearTimeoutHandle();
      this.parentAbortCleanup?.();
      this.parentAbortCleanup = undefined;
      this.activeAbortController = null;
    }
  }

  private async runNonInteractiveTurn(
    chat: ChatSession,
    currentMessages: Content[],
    toolsList: FunctionDeclaration[],
    abortController: AbortController,
    currentTurn: number,
    execCtx: ExecutionLoopContext,
  ) {
    const messageParams = {
      message: currentMessages[0]?.parts ?? [],
      config: {
        abortSignal: abortController.signal,
        tools: [{ functionDeclarations: toolsList }],
      },
    };

    const responseStream = await chat.sendMessageStream(
      messageParams,
      `${this.runtimeContext.state.sessionId}#${this.subagentId}#${currentTurn}`,
    );

    const {
      functionCalls: rawCalls,
      textResponse,
      parseableTextResponse,
      hookRestrictedAllowedTools,
    } = await this.consumeNonInteractiveStream(
      responseStream,
      abortController,
      currentTurn,
    );
    if (abortController.signal.aborted === true) {
      return { functionCalls: [], textResponse: '' };
    }

    let functionCalls = rawCalls;
    if (parseableTextResponse) {
      const result = processNonInteractiveTextResponse(
        parseableTextResponse,
        functionCalls,
        execCtx,
        resolveToolName,
        hookRestrictedAllowedTools,
      );
      functionCalls = result.functionCalls;
    }

    return { functionCalls, textResponse };
  }

  private async consumeNonInteractiveStream(
    responseStream: AsyncIterable<StreamEvent>,
    abortController: AbortController,
    currentTurn: number,
  ): Promise<{
    functionCalls: FunctionCall[];
    textResponse: string;
    parseableTextResponse: string;
    hookRestrictedAllowedTools: string[] | undefined;
  }> {
    const timeoutController = new AbortController();
    const timeoutSignal = timeoutController.signal;
    const onAbort = () => timeoutController.abort();
    abortController.signal.addEventListener('abort', onAbort, { once: true });
    if (abortController.signal.aborted === true) {
      onAbort();
      abortController.signal.removeEventListener('abort', onAbort);
      return {
        functionCalls: [],
        textResponse: '',
        parseableTextResponse: '',
        hookRestrictedAllowedTools: undefined,
      };
    }

    const functionCalls: FunctionCall[] = [];
    let textResponse = '';
    let parseableTextResponse = '';
    let hookRestrictedAllowedTools: string[] | undefined;
    const iterator = responseStream[Symbol.asyncIterator]();
    const effectiveTimeoutMs = resolveStreamIdleTimeoutMs(this.config);

    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Persisted subagent config and runtime tool payloads.
      while (true) {
        const result = await this.readNextNonInteractiveEvent(
          iterator,
          abortController,
          timeoutController,
          timeoutSignal,
          effectiveTimeoutMs,
        );
        if (result.done === true) {
          break;
        }
        const resp = result.value;
        const isRuntimeAborted = Boolean(abortController.signal.aborted);
        if (isRuntimeAborted) {
          return {
            functionCalls: [],
            textResponse: '',
            parseableTextResponse: '',
            hookRestrictedAllowedTools,
          };
        }
        if (resp.type === StreamEventType.CHUNK) {
          const chunkResult = this.collectNonInteractiveChunk(
            resp,
            functionCalls,
            currentTurn,
          );
          hookRestrictedAllowedTools =
            chunkResult.hookRestrictedAllowedTools ??
            hookRestrictedAllowedTools;
          textResponse += chunkResult.text;
          parseableTextResponse += chunkResult.text;
        }
      }
    } finally {
      iterator.return?.(undefined).catch(() => {});
      timeoutController.abort();
      abortController.signal.removeEventListener('abort', onAbort);
    }

    return {
      functionCalls,
      textResponse,
      parseableTextResponse,
      hookRestrictedAllowedTools,
    };
  }

  private async readNextNonInteractiveEvent(
    iterator: AsyncIterator<StreamEvent, unknown>,
    abortController: AbortController,
    timeoutController: AbortController,
    timeoutSignal: AbortSignal,
    effectiveTimeoutMs: number,
  ): Promise<IteratorResult<StreamEvent, unknown>> {
    if (effectiveTimeoutMs > 0) {
      return nextStreamEventWithIdleTimeout({
        iterator,
        timeoutMs: effectiveTimeoutMs,
        signal: timeoutSignal,
        onTimeout: () => {
          if (abortController.signal.aborted === true) {
            return;
          }
          this.output.terminate_reason = SubagentTerminateMode.TIMEOUT;
          timeoutController.abort();
          abortController.abort(createAbortError());
        },
        createTimeoutError: () => createAbortError(),
      });
    }
    return iterator.next();
  }

  private collectNonInteractiveChunk(
    resp: StreamEvent & { type: StreamEventType.CHUNK },
    functionCalls: FunctionCall[],
    currentTurn: number,
  ): { text: string; hookRestrictedAllowedTools: string[] | undefined } {
    const allowedTools = getHookRestrictedAllowedTools(resp.value);
    const parts = resp.value.candidates?.[0]?.content?.parts ?? [];
    const partCalls = getHookRestrictedFunctionCallsFromParts(
      parts,
      allowedTools,
    );
    const topLevelCalls = filterHookRestrictedFunctionCalls(
      resp.value.functionCalls ?? [],
      allowedTools,
    );
    const chunkCalls = mergeHookRestrictedFunctionCalls(
      partCalls,
      topLevelCalls,
    );
    if (chunkCalls.length > 0) {
      functionCalls.push(...chunkCalls);
      this.logger.debug(
        () =>
          `Subagent ${this.subagentId} received ${chunkCalls.length} function calls on turn ${currentTurn}`,
      );
    }
    if (allowedTools === undefined) {
      return {
        text: resp.value.text ?? '',
        hookRestrictedAllowedTools: undefined,
      };
    }
    const filteredParts = filterHookRestrictedParts(parts, allowedTools);
    const filteredText = filteredParts
      .map((part) => part.text)
      .filter((text): text is string => typeof text === 'string')
      .join('');
    return { text: filteredText, hookRestrictedAllowedTools: allowedTools };
  }

  private async dispatchNonInteractiveTurnResult(
    functionCalls: FunctionCall[],
    abortController: AbortController,
    promptId: string,
    currentTurn: number,
    execCtx: ExecutionLoopContext,
  ): Promise<Content[] | null> {
    if (functionCalls.length > 0) {
      return processFunctionCalls(functionCalls, abortController, promptId, {
        output: this.output,
        subagentId: this.subagentId,
        logger: this.logger,
        toolExecutorContext: this.toolExecutorContext,
        config: this.config,
        messageBus: this.messageBus,
      });
    }
    const todoReminder = await buildTodoCompletionPrompt(
      this.runtimeContext,
      this.subagentId,
      this.logger,
    );
    return checkGoalCompletion(execCtx, todoReminder, currentTurn);
  }

  private buildExecCtx(): ExecutionLoopContext {
    return {
      output: this.output,
      subagentId: this.subagentId,
      runConfig: this.runConfig,
      outputConfig: this.outputConfig,
      emojiFilter: this.emojiFilter,
      textToolParser: this.textToolParser,
      toolsView: this.runtimeContext.tools,
      logger: this.logger,
      onMessage: this.onMessage,
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
  dispose(): void {
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

    // 2. Clean up parent abort signal event listeners
    if (this.parentAbortCleanup) {
      this.parentAbortCleanup();
      this.parentAbortCleanup = undefined;
    }

    this.logger.debug(() => `Subagent ${this.subagentId} disposed`);
  }
}
