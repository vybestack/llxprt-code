/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251028-STATELESS6.P08
 * @requirement REQ-STAT6-001.1, REQ-STAT6-003.1
 * @pseudocode agent-runtime-context.md lines 92-101
 */
import { DebugLogger } from '../debug/DebugLogger.js';
import { Config } from '../config/config.js';
import {
  type ToolCallRequestInfo,
  GeminiEventType,
  Turn,
  TURN_STREAM_IDLE_TIMEOUT_MS,
} from './turn.js';
import { type ToolExecutionConfig } from './nonInteractiveToolExecutor.js';
import { createAbortError } from '../utils/delay.js';
import { nextStreamEventWithIdleTimeout } from '../utils/streamIdleTimeout.js';
import {
  type Content,
  type Part,
  type FunctionCall,
  type FunctionDeclaration,
} from '@google/genai';
import { StreamEventType } from './geminiChat.js';
import type {
  AgentRuntimeContext,
  ReadonlySettingsSnapshot,
} from '../runtime/AgentRuntimeContext.js';
import { GemmaToolCallParser } from '../parsers/TextToolCallParser.js';
import type { SubagentSchedulerFactory } from './subagentScheduler.js';
import { type CompletedToolCall } from './coreToolScheduler.js';
import { type EmojiFilter } from '../filters/EmojiFilter.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
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
import {
  SubagentTerminateMode,
  ContextState,
  defaultEnvironmentContextLoader,
  type OutputObject,
  type PromptConfig,
  type ToolConfig,
  type OutputConfig,
  type SubAgentRuntimeOverrides,
  type EnvironmentContextLoader,
  type ModelConfig,
  type RunConfig,
} from './subagentTypes.js';

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
    private readonly contentGenerator: import('./contentGenerator.js').ContentGenerator,
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
      runtimeBundle.runtimeContext.tools ?? runtimeBundle.toolsView;
    if (!toolsView) {
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
      // Use undefined if all tools were filtered out
      toolConfig =
        filteredToolConfig.tools.length > 0 ? filteredToolConfig : undefined;
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

    return new SubAgentScope(
      name,
      runtimeBundle.runtimeContext,
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
      if (abortController.signal.aborted) {
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
  async runInteractive(
    context: ContextState,
    options?: {
      schedulerFactory?: SubagentSchedulerFactory;
    },
  ): Promise<void> {
    const setup = await this.prepareRun(context);
    if (!setup) return;
    const { chat, abortController } = setup;
    const { scheduler, schedulerDispose } = await this.initScheduler(options);

    const execCtx = this.buildExecCtx();
    const startTime = Date.now();
    let turnCounter = 0;
    let currentMessages = this.buildInitialMessages(context);

    try {
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
        if (abortController.signal.aborted) return;

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

        // Post-turn timeout recheck
        const recheck = checkTerminationConditions(
          turnCounter,
          startTime,
          execCtx,
        );
        if (recheck.shouldStop) break;

        const todoReminder = await buildTodoCompletionPrompt(
          this.runtimeContext,
          this.subagentId,
          this.logger,
        );
        const nextMessages = await checkGoalCompletion(
          execCtx,
          todoReminder,
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
    chat: import('./geminiChat.js').GeminiChat,
    currentMessages: Content[],
    abortController: AbortController,
    turnIndex: number,
    execCtx: ExecutionLoopContext,
  ) {
    const currentTurn = turnIndex;
    const promptId = `${this.runtimeContext.state.sessionId}#${this.subagentId}#${currentTurn}`;
    const providerName = this.runtimeContext.state.provider ?? 'backend';
    const turn = new Turn(chat, promptId, this.subagentId, providerName);
    const parts = currentMessages[0]?.parts ?? [];

    let textResponse = '';
    try {
      const stream = turn.run(parts, abortController.signal);
      for await (const event of stream) {
        if (abortController.signal.aborted) break;
        if (event.type === GeminiEventType.Content && event.value) {
          textResponse += event.value;
          const filtered = filterTextWithEmoji(event.value, execCtx);
          if (filtered.blocked) {
            execCtx.output.terminate_reason = SubagentTerminateMode.ERROR;
            throw new Error(
              filtered.error ?? 'Content blocked by emoji filter',
            );
          }
          if (execCtx.onMessage && filtered.text) {
            execCtx.onMessage(filtered.text);
          }
        } else if (event.type === GeminiEventType.Error && event.value?.error) {
          execCtx.output.terminate_reason = SubagentTerminateMode.ERROR;
          throw new Error(event.value.error.message);
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
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

    const manualParts: Part[] = [];
    const schedulerRequests: ToolCallRequestInfo[] = [];

    for (const request of toolRequests) {
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
        if (abortController.signal.aborted) return;

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
    chat: import('./geminiChat.js').GeminiChat,
    currentMessages: Content[],
    toolsList: FunctionDeclaration[],
    abortController: AbortController,
    currentTurn: number,
    execCtx: ExecutionLoopContext,
  ) {
    const messageParams = {
      message: currentMessages[0]?.parts || [],
      config: {
        abortSignal: abortController.signal,
        tools: [{ functionDeclarations: toolsList }],
      },
    };

    const responseStream = await chat.sendMessageStream(
      messageParams,
      `${this.runtimeContext.state.sessionId}#${this.subagentId}#${currentTurn}`,
    );

    const timeoutController = new AbortController();
    const timeoutSignal = timeoutController.signal;
    const onAbort = () => timeoutController.abort();
    abortController.signal.addEventListener('abort', onAbort, { once: true });
    if (abortController.signal.aborted) {
      onAbort();
      abortController.signal.removeEventListener('abort', onAbort);
      return { functionCalls: [], textResponse: '' };
    }

    let functionCalls: FunctionCall[] = [];
    let textResponse = '';
    const iterator = responseStream[Symbol.asyncIterator]();

    try {
      while (true) {
        const result = await nextStreamEventWithIdleTimeout({
          iterator,
          timeoutMs: TURN_STREAM_IDLE_TIMEOUT_MS,
          signal: timeoutSignal,
          onTimeout: () => {
            if (abortController.signal.aborted) {
              return;
            }
            this.output.terminate_reason = SubagentTerminateMode.TIMEOUT;
            timeoutController.abort();
            abortController.abort(createAbortError());
          },
          createTimeoutError: () => createAbortError(),
        });
        if (result.done) {
          break;
        }
        const resp = result.value;
        if (abortController.signal.aborted)
          return { functionCalls: [], textResponse: '' };
        if (resp.type === StreamEventType.CHUNK && resp.value.functionCalls) {
          const chunkCalls = resp.value.functionCalls ?? [];
          if (chunkCalls.length > 0) {
            functionCalls.push(...chunkCalls);
            this.logger.debug(
              () =>
                `Subagent ${this.subagentId} received ${chunkCalls.length} function calls on turn ${currentTurn}`,
            );
          }
        }
        if (resp.type === StreamEventType.CHUNK && resp.value.text) {
          textResponse += resp.value.text;
        }
      }
    } finally {
      // Close the stream iterator to release sendPromise in TurnProcessor.
      iterator.return?.(undefined).catch(() => {});
      timeoutController.abort();
      abortController.signal.removeEventListener('abort', onAbort);
    }

    if (textResponse) {
      const result = processNonInteractiveTextResponse(
        textResponse,
        functionCalls,
        execCtx,
        resolveToolName,
      );
      functionCalls = result.functionCalls;
    }

    return { functionCalls, textResponse };
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
    if (this.activeAbortController?.signal.aborted) {
      return;
    }
    if (!this.activeAbortController) {
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
