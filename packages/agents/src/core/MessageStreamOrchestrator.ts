/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type PartListUnion, type Part, type Content } from '@google/genai';
import {
  Turn,
  type ServerGeminiStreamEvent,
  GeminiEventType,
  DEFAULT_AGENT_ID,
  type ServerGeminiFinishedOutcome,
  type ModelInfo,
} from './turn.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ChatSession } from './chatSession.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import type { TodoContinuationService } from './TodoContinuationService.js';
import type { IdeContextTracker } from './IdeContextTracker.js';
import type { AgentHookManager } from './AgentHookManager.js';
import type { AfterAgentHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import { estimateTextOnlyLength, extractPromptText } from './clientHelpers.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import type { Todo } from '@vybestack/llxprt-code-tools';
import type { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import { handleTerminalEvent } from './MessageStreamTerminalHandler.js';

export interface MessageStreamDeps {
  config: Config;
  getChat: () => ChatSession;
  logger: DebugLogger;
  loopDetector: LoopDetectionService;
  todoContinuationService: TodoContinuationService;
  ideContextTracker: IdeContextTracker;
  agentHookManager: AgentHookManager;
  getEffectiveModel: () => string;
  getHistory: () => Promise<Content[]>;
  getSessionTurnCount: () => number;
  incrementSessionTurnCount: () => void;
  lazyInitialize: () => Promise<void>;
  startChat: (extraHistory?: Content[]) => Promise<ChatSession>;
  getPreviousHistory: () => Content[] | undefined;
  setChat: (chat: ChatSession) => void;
  hasChat: () => boolean;
  complexityAnalyzer: ComplexityAnalyzer;
  getLastPromptId: () => string | undefined;
  setLastPromptId: (id: string) => void;
  resetCurrentSequenceModel: () => void;
  updateTelemetryTokenCount: () => void;
  sendMessageStream: (
    initialRequest: PartListUnion,
    signal: AbortSignal,
    prompt_id: string,
    turns?: number,
    isInvalidStreamRetry?: boolean,
    is413Retry?: boolean,
  ) => AsyncGenerator<ServerGeminiStreamEvent, Turn>;
}

export interface StreamContext {
  prompt_id: string;
  promptText: string;
  responseChunks: string[];
  signal: AbortSignal;
  turns: number;
  isInvalidStreamRetry: boolean;
  is413Retry: boolean;
}

export interface IterationResult {
  earlyReturn: boolean;
  hadToolCallsThisTurn: boolean;
  todoPauseSeen: boolean;
  hadThinking: boolean;
  hadContent: boolean;
  deferredEvents: ServerGeminiStreamEvent[];
  outcome?: ServerGeminiFinishedOutcome;
}

interface PostTurnResult {
  done: boolean;
  retryCount: number;
  newBaseRequest: PartListUnion | undefined;
}

/**
 * Normalizes a runtime task-list entry for snapshot storage. Provider/tool-call
 * payloads can omit or null out fields despite the declared type.
 */
function normalizeTodoSnapshotEntry(todo: Todo): Todo {
  const raw = todo as Partial<Todo>;
  return {
    id: `${raw.id ?? ''}`,
    content: raw.content ?? '',
    status: raw.status ?? 'pending',
  } as Todo;
}

export const MAX_TURNS = 100;
const MAX_RETRIES = 3;

function getConfiguredContextLimit(config: Config): number | undefined {
  const rawContextLimit = config.getEphemeralSetting('context-limit');
  return typeof rawContextLimit === 'number' &&
    Number.isFinite(rawContextLimit) &&
    rawContextLimit > 0
    ? rawContextLimit
    : undefined;
}

function getTokenLimitForConfiguredContext(
  model: string,
  config: Config,
): number {
  const contextLimit = getConfiguredContextLimit(config);
  return contextLimit === undefined
    ? tokenLimit(model)
    : tokenLimit(model, contextLimit);
}

export class MessageStreamOrchestrator {
  #lastModelIdentity: string | null = null;

  constructor(private readonly deps: MessageStreamDeps) {}

  async *execute(
    initialRequest: PartListUnion,
    signal: AbortSignal,
    prompt_id: string,
    turns: number,
    isInvalidStreamRetry: boolean,
    is413Retry: boolean = false,
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    this.deps.logger.debug(() => 'DEBUG: AgentClient.sendMessageStream called');

    await this.deps.lazyInitialize();
    await this._ensureChatInitialized();

    const promptText = extractPromptText(initialRequest);
    const ctx: StreamContext = {
      prompt_id,
      promptText,
      responseChunks: [],
      signal,
      turns,
      isInvalidStreamRetry,
      is413Retry,
    };

    const request = yield* this._preflight(initialRequest, ctx);
    if (request instanceof Turn) return request;

    const earlyTurn = yield* this._checkSessionLimits(initialRequest, ctx);
    if (earlyTurn) return earlyTurn;

    await this._injectIdeContext();
    return yield* this._runRetryLoop(request, signal, ctx);
  }

  private async _ensureChatInitialized(): Promise<void> {
    const { hasChat, getPreviousHistory, setChat, startChat, logger } =
      this.deps;
    if (hasChat()) return;

    const previousHistory = getPreviousHistory();
    if (previousHistory && previousHistory.length > 0) {
      logger.debug('Restoring previous history during prompt generation', {
        historyLength: previousHistory.length,
      });
      setChat(await startChat(previousHistory));
    } else {
      setChat(await startChat());
    }
  }

  private async *_preflight(
    initialRequest: PartListUnion,
    ctx: StreamContext,
  ): AsyncGenerator<ServerGeminiStreamEvent, PartListUnion | Turn> {
    const {
      agentHookManager,
      loopDetector,
      getLastPromptId,
      setLastPromptId,
      resetCurrentSequenceModel,
      todoContinuationService,
      incrementSessionTurnCount,
    } = this.deps;

    const lastPromptId = getLastPromptId();
    if (lastPromptId && lastPromptId !== ctx.prompt_id) {
      agentHookManager.cleanupOldHookState(ctx.prompt_id, lastPromptId);
    }

    let request: PartListUnion = initialRequest;
    const isNewPrompt = getLastPromptId() !== ctx.prompt_id;

    if (isNewPrompt) {
      loopDetector.reset(ctx.prompt_id);
      setLastPromptId(ctx.prompt_id);
      resetCurrentSequenceModel();
      await todoContinuationService.clearPausedState();

      yield* this._emitModelInfoForNewSequence();

      const hookOutput = await agentHookManager.fireBeforeAgentHookSafe(
        ctx.prompt_id,
        ctx.promptText,
      );

      if (
        hookOutput?.isBlockingDecision() === true ||
        hookOutput?.shouldStopExecution() === true
      ) {
        yield {
          type: GeminiEventType.Error,
          value: {
            error: new Error(
              `BeforeAgent hook blocked processing: ${hookOutput.getEffectiveReason()}`,
            ),
          },
        };
        return new Turn(
          this.deps.getChat(),
          ctx.prompt_id,
          DEFAULT_AGENT_ID,
          this._getProviderName(),
        );
      }

      const additionalContext = hookOutput?.getAdditionalContext();
      if (additionalContext) {
        const requestArray = Array.isArray(request) ? request : [request];
        request = [...requestArray, { text: additionalContext }];
      }
    } else {
      // Continuation / retry of the same prompt — emit ModelInfo only when
      // the composite provider/profile/model identity has changed since the
      // last emission. Duplicates for the same identity are suppressed.
      yield* this._emitModelInfoIfChanged();
    }

    incrementSessionTurnCount();
    todoContinuationService.toolActivityCount = 0;
    todoContinuationService.toolCallReminderLevel = 'none';

    return request;
  }

  private async *_checkSessionLimits(
    initialRequest: PartListUnion,
    ctx: StreamContext,
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn | undefined> {
    const { config, getChat, getSessionTurnCount, getEffectiveModel } =
      this.deps;

    if (
      config.getMaxSessionTurns() > 0 &&
      getSessionTurnCount() > config.getMaxSessionTurns()
    ) {
      yield { type: GeminiEventType.MaxSessionTurns };
      yield* this._fireAfterHookAndEmitClearContext(ctx);
      return new Turn(
        getChat(),
        ctx.prompt_id,
        DEFAULT_AGENT_ID,
        this._getProviderName(),
      );
    }

    const boundedTurns = Math.min(ctx.turns, MAX_TURNS);
    if (boundedTurns === 0) {
      yield* this._fireAfterHookAndEmitClearContext(ctx);
      return new Turn(
        getChat(),
        ctx.prompt_id,
        DEFAULT_AGENT_ID,
        this._getProviderName(),
      );
    }

    const modelForLimitCheck = getEffectiveModel();
    const estimatedRequestTokenCount = Math.floor(
      estimateTextOnlyLength(initialRequest) / 4,
    );
    const remainingTokenCount =
      getTokenLimitForConfiguredContext(modelForLimitCheck, config) -
      getChat().getLastPromptTokenCount();

    if (estimatedRequestTokenCount > remainingTokenCount * 0.95) {
      yield {
        type: GeminiEventType.ContextWindowWillOverflow,
        value: { estimatedRequestTokenCount, remainingTokenCount },
      };
      yield* this._fireAfterHookAndEmitClearContext(ctx);
      return new Turn(
        getChat(),
        ctx.prompt_id,
        DEFAULT_AGENT_ID,
        this._getProviderName(),
      );
    }

    return undefined;
  }

  private async _injectIdeContext(): Promise<void> {
    const { config, ideContextTracker, getChat, getHistory } = this.deps;
    const history = await getHistory();
    const lastMessage =
      history.length > 0 ? history[history.length - 1] : undefined;
    const hasPendingToolCall =
      !!lastMessage &&
      lastMessage.role === 'model' &&
      (lastMessage.parts?.some((p) => 'functionCall' in p) ?? false);

    if (config.getIdeMode() && !hasPendingToolCall) {
      const { contextParts, newIdeContext } = ideContextTracker.getContextParts(
        history.length === 0,
      );
      if (contextParts.length > 0) {
        getChat().addHistory({
          role: 'user',
          parts: [{ text: contextParts.join('\n') }],
        });
      }
      ideContextTracker.recordSentContext(newIdeContext);
    }
  }

  private async *_runRetryLoop(
    initialRequest: PartListUnion,
    signal: AbortSignal,
    ctx: StreamContext,
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    const { todoContinuationService, complexityAnalyzer, getSessionTurnCount } =
      this.deps;

    let baseRequest: PartListUnion = Array.isArray(initialRequest)
      ? [...(initialRequest as Part[])]
      : initialRequest;
    let retryCount = 0;
    let lastTurn: Turn | undefined;
    let hadToolCallsThisTurn = false;

    while (retryCount < MAX_RETRIES) {
      let iterRequest: PartListUnion = Array.isArray(baseRequest)
        ? [...(baseRequest as Part[])]
        : baseRequest;

      if (retryCount === 0) {
        const analyzed = this._applyComplexityAnalysis(
          iterRequest,
          todoContinuationService,
          complexityAnalyzer,
          getSessionTurnCount,
        );
        iterRequest = analyzed.request;
        baseRequest = analyzed.baseRequest;
      } else {
        todoContinuationService.consecutiveComplexTurns = 0;
      }

      iterRequest =
        await todoContinuationService.applyPendingReminder(iterRequest);

      const turn = new Turn(
        this.deps.getChat(),
        ctx.prompt_id,
        DEFAULT_AGENT_ID,
        this._getProviderName(),
      );
      lastTurn = turn;

      const iterResult: IterationResult = yield* this._processStreamIteration(
        iterRequest,
        signal,
        turn,
        ctx,
        hadToolCallsThisTurn,
        initialRequest,
      );
      if (iterResult.earlyReturn) return turn;
      hadToolCallsThisTurn = iterResult.hadToolCallsThisTurn;

      const postTurnResult = yield* this._evaluatePostTurn(
        iterResult,
        baseRequest,
        retryCount,
        ctx,
      );
      if (postTurnResult.done) return turn;
      if (postTurnResult.newBaseRequest !== undefined) {
        baseRequest = postTurnResult.newBaseRequest;
      }
      retryCount = postTurnResult.retryCount;
    }

    yield* this._fireAfterHookAndEmitClearContext(ctx);
    return lastTurn!;
  }

  private async *_processStreamIteration(
    iterRequest: PartListUnion,
    signal: AbortSignal,
    turn: Turn,
    ctx: StreamContext,
    hadToolCallsPrior: boolean,
    initialRequest: PartListUnion,
  ): AsyncGenerator<ServerGeminiStreamEvent, IterationResult> {
    const { loopDetector, todoContinuationService, updateTelemetryTokenCount } =
      this.deps;

    const loopDetected = await loopDetector.turnStarted(signal);
    if (loopDetected) {
      yield { type: GeminiEventType.LoopDetected };
      yield* this._fireAfterHookAndEmitClearContext(ctx);
      return this._earlyIterResult(hadToolCallsPrior);
    }

    let todoPauseSeen = false;
    let hadThinking = false;
    let hadContent = false;
    let hadToolCallsThisTurn = hadToolCallsPrior;
    const deferredEvents: ServerGeminiStreamEvent[] = [];
    let finishedOutcome: ServerGeminiFinishedOutcome | undefined;

    for await (const event of turn.run(iterRequest, signal)) {
      if (loopDetector.addAndCheck(event)) {
        yield { type: GeminiEventType.LoopDetected };
        yield* this._fireAfterHookAndEmitClearContext(ctx);
        return this._earlyIterResult(hadToolCallsThisTurn, {
          todoPauseSeen,
          hadThinking,
          hadContent,
          deferredEvents,
          outcome: finishedOutcome,
        });
      }

      todoContinuationService.recordModelActivity(event);
      if (event.type === GeminiEventType.ToolCallRequest)
        hadToolCallsThisTurn = true;
      if (
        event.type === GeminiEventType.ToolCallResponse &&
        todoContinuationService.isTodoPauseResponse(event.value)
      )
        todoPauseSeen = true;
      if (event.type === GeminiEventType.Thought) hadThinking = true;
      if (event.type === GeminiEventType.Content) hadContent = true;
      if (event.type === GeminiEventType.Finished && event.value.outcome)
        finishedOutcome = event.value.outcome;
      this._handleTodoToolCall(event, todoContinuationService);
      if (event.type === GeminiEventType.Content && event.value)
        ctx.responseChunks.push(event.value);

      if (todoContinuationService.shouldDeferStreamEvent(event)) {
        deferredEvents.push(event);
      } else {
        yield event;
      }
      updateTelemetryTokenCount();

      const terminalResult = yield* handleTerminalEvent(
        this.deps,
        event,
        signal,
        ctx,
        deferredEvents,
        { hadToolCallsThisTurn, todoPauseSeen, hadThinking, hadContent },
        initialRequest,
      );
      if (terminalResult) return terminalResult;
    }

    return {
      earlyReturn: false,
      hadToolCallsThisTurn,
      todoPauseSeen,
      hadThinking,
      hadContent,
      deferredEvents,
      outcome: finishedOutcome,
    };
  }

  private _earlyIterResult(
    hadToolCalls: boolean,
    overrides?: Partial<
      Omit<IterationResult, 'earlyReturn' | 'hadToolCallsThisTurn'>
    >,
  ): IterationResult {
    return {
      earlyReturn: true,
      hadToolCallsThisTurn: hadToolCalls,
      todoPauseSeen: false,
      hadThinking: false,
      hadContent: false,
      deferredEvents: [],
      ...overrides,
    };
  }

  private async *_evaluatePostTurn(
    iter: IterationResult,
    baseRequest: PartListUnion,
    retryCount: number,
    ctx: StreamContext,
  ): AsyncGenerator<ServerGeminiStreamEvent, PostTurnResult> {
    if (iter.hadToolCallsThisTurn) {
      return yield* this._finishWithToolCalls(iter.deferredEvents, ctx);
    }

    // Prefer authoritative Finished outcome when available, fallback to event-inferred flags
    const hadVisible = iter.outcome?.hadVisibleOutput ?? iter.hadContent;
    const hadThinking = iter.outcome?.hadThinking ?? iter.hadThinking;

    if (hadThinking && !hadVisible) {
      const newRetry = retryCount + 1;
      this.deps.logger.debug(
        () =>
          `[stream:thinking-only] detected thinking-only turn; retry=${newRetry}/${MAX_RETRIES}`,
      );
      if (newRetry >= MAX_RETRIES) {
        this.deps.logger.debug(
          () =>
            `[stream:thinking-only] max retries reached; ending turn without user-visible error`,
        );
        for (const d of iter.deferredEvents) yield d;
        return { done: true, retryCount: newRetry, newBaseRequest: undefined };
      }
      for (const d of iter.deferredEvents) {
        if (
          d.type === GeminiEventType.Content ||
          d.type === GeminiEventType.Citation
        )
          yield d;
      }
      return {
        done: false,
        retryCount: newRetry,
        newBaseRequest: [
          {
            text: 'System: Continue and take the next concrete action now. Use tools if needed.',
          } as Part,
        ],
      };
    }

    return yield* this._evaluateTodoContinuation(
      iter,
      baseRequest,
      retryCount,
      ctx,
    );
  }

  private async *_evaluateTodoContinuation(
    iter: IterationResult,
    baseRequest: PartListUnion,
    retryCount: number,
    ctx: StreamContext,
  ): AsyncGenerator<ServerGeminiStreamEvent, PostTurnResult> {
    const { todoContinuationService, sendMessageStream } = this.deps;
    const getBoundedTurns = () => Math.min(ctx.turns, MAX_TURNS);

    const reminderState =
      await todoContinuationService.getTodoReminderForCurrentState();
    const latestSnapshot = reminderState.todos;
    const activeTodos = reminderState.activeTodos;

    if (iter.todoPauseSeen) {
      for (const d of iter.deferredEvents) yield d;
      this._resetTodoState(todoContinuationService, latestSnapshot);
      yield* this._fireAfterHookAndEmitClearContext(ctx);
      return { done: true, retryCount, newBaseRequest: undefined };
    }

    const todosStillPending = activeTodos.length > 0;
    const hasPendingReminder =
      todoContinuationService.toolCallReminderLevel !== 'none';

    if (!todosStillPending && !hasPendingReminder) {
      for (const d of iter.deferredEvents) yield d;
      this._resetTodoState(todoContinuationService, latestSnapshot);
      const afterOut = yield* this._fireAfterHookAndEmitClearContext(ctx);
      if (
        afterOut?.isBlockingDecision() === true ||
        afterOut?.shouldStopExecution() === true
      ) {
        yield* sendMessageStream(
          [{ text: afterOut.getEffectiveReason() }],
          ctx.signal,
          ctx.prompt_id,
          getBoundedTurns() - 1,
        );
      }
      return { done: true, retryCount, newBaseRequest: undefined };
    }

    const newRetry = retryCount + 1;
    if (newRetry >= MAX_RETRIES) {
      for (const d of iter.deferredEvents) yield d;
      this._resetTodoState(todoContinuationService, latestSnapshot);
      yield* this._fireAfterHookAndEmitClearContext(ctx);
      return { done: true, retryCount: newRetry, newBaseRequest: undefined };
    }

    if (!hasPendingReminder) {
      const newBase = await this._buildFollowUpRequest(
        todoContinuationService,
        latestSnapshot,
        activeTodos,
        baseRequest,
        iter.deferredEvents,
        ctx,
      );
      if (newBase === undefined) {
        return { done: true, retryCount: newRetry, newBaseRequest: undefined };
      }
      return { done: false, retryCount: newRetry, newBaseRequest: newBase };
    }

    todoContinuationService.lastTodoSnapshot = latestSnapshot;
    return { done: false, retryCount: newRetry, newBaseRequest: undefined };
  }

  private async *_finishWithToolCalls(
    deferredEvents: ServerGeminiStreamEvent[],
    ctx: StreamContext,
  ): AsyncGenerator<ServerGeminiStreamEvent, PostTurnResult> {
    const { todoContinuationService, sendMessageStream } = this.deps;
    const getBoundedTurns = () => Math.min(ctx.turns, MAX_TURNS);

    this.deps.logger.debug(
      () => `[stream:orchestrator] finishing turn after tool-call path`,
      {
        deferredEventCount: deferredEvents.length,
      },
    );

    const reminderState =
      await todoContinuationService.getTodoReminderForCurrentState();
    for (const d of deferredEvents) yield d;
    todoContinuationService.lastTodoSnapshot = reminderState.todos;
    todoContinuationService.toolCallReminderLevel = 'none';
    todoContinuationService.toolActivityCount = 0;

    const afterOut = yield* this._fireAfterHookAndEmitClearContext(ctx);
    if (
      afterOut?.isBlockingDecision() === true ||
      afterOut?.shouldStopExecution() === true
    ) {
      yield* sendMessageStream(
        [{ text: afterOut.getEffectiveReason() }],
        ctx.signal,
        ctx.prompt_id,
        getBoundedTurns() - 1,
      );
    }

    return { done: true, retryCount: 0, newBaseRequest: undefined };
  }

  private async _buildFollowUpRequest(
    todoContinuationService: TodoContinuationService,
    latestSnapshot: Todo[],
    activeTodos: Todo[],
    baseRequest: PartListUnion,
    _deferredEvents: ServerGeminiStreamEvent[],
    _ctx: StreamContext,
  ): Promise<PartListUnion | undefined> {
    const previousSnapshot = todoContinuationService.lastTodoSnapshot ?? [];
    const snapshotUnchanged = todoContinuationService.areTodoSnapshotsEqual(
      previousSnapshot,
      latestSnapshot,
    );

    const followUpReminder = (
      await todoContinuationService.getTodoReminderForCurrentState({
        todoSnapshot: latestSnapshot,
        activeTodos,
        escalate: snapshotUnchanged,
      })
    ).reminder;

    todoContinuationService.lastTodoSnapshot = latestSnapshot;

    if (!followUpReminder) {
      todoContinuationService.toolCallReminderLevel = 'none';
      todoContinuationService.toolActivityCount = 0;
      return undefined;
    }

    const textOnlyBase = Array.isArray(baseRequest)
      ? (baseRequest as Part[]).filter(
          (part) =>
            typeof part === 'object' &&
            !('functionCall' in part) &&
            !('functionResponse' in part),
        )
      : [];
    return todoContinuationService.appendSystemReminderToRequest(
      textOnlyBase,
      followUpReminder,
    );
  }

  private _applyComplexityAnalysis(
    request: PartListUnion,
    todoContinuationService: TodoContinuationService,
    complexityAnalyzer: ComplexityAnalyzer,
    getSessionTurnCount: () => number,
  ): { request: PartListUnion; baseRequest: PartListUnion } {
    let shouldAppendTodoSuffix = false;

    if (Array.isArray(request) && request.length > 0) {
      const userMessage = request
        .filter((part) => typeof part === 'object' && 'text' in part)
        .map((part) => (part as { text: string }).text)
        .join(' ')
        .trim();

      if (userMessage.length > 0) {
        const analysis = complexityAnalyzer.analyzeComplexity(userMessage);
        const complexityReminder =
          todoContinuationService.processComplexityAnalysis(
            analysis,
            getSessionTurnCount(),
          );
        if (complexityReminder) shouldAppendTodoSuffix = true;
      } else {
        todoContinuationService.consecutiveComplexTurns = 0;
      }
    } else {
      todoContinuationService.consecutiveComplexTurns = 0;
    }

    if (shouldAppendTodoSuffix) {
      request = todoContinuationService.appendTodoSuffixToRequest(request);
    }

    const baseRequest = Array.isArray(request)
      ? [...(request as Part[])]
      : request;
    return { request, baseRequest };
  }

  private _handleTodoToolCall(
    event: ServerGeminiStreamEvent,
    todoContinuationService: TodoContinuationService,
  ): void {
    const rawEvent = event as unknown as {
      type: GeminiEventType;
      value?: { name?: string; args?: { todos?: unknown } };
    };
    if (
      rawEvent.type !== GeminiEventType.ToolCallRequest ||
      !todoContinuationService.isTodoToolCall(rawEvent.value?.name)
    )
      return;

    todoContinuationService.setLastTodoToolTurn(
      this.deps.getSessionTurnCount(),
    );
    todoContinuationService.consecutiveComplexTurns = 0;

    const args = rawEvent.value?.args;
    const requestedTodos: Todo[] =
      args && Array.isArray(args.todos) ? args.todos : [];
    if (requestedTodos.length > 0) {
      todoContinuationService.lastTodoSnapshot = requestedTodos.map((todo) =>
        normalizeTodoSnapshotEntry(todo),
      );
    }
  }

  private _getProviderName(): string {
    const contentGenConfig = this.deps.config.getContentGeneratorConfig();
    const providerManager = contentGenConfig?.providerManager;
    const activeName = providerManager?.getActiveProviderName();
    return activeName && activeName.length > 0 ? activeName : 'backend';
  }

  /**
   * Resolves the effective model for ModelInfo, preferring the provider
   * manager's active provider model where available.
   */
  private _resolveModelForInfo(): string {
    const contentGenConfig = this.deps.config.getContentGeneratorConfig();
    const providerManager = contentGenConfig?.providerManager;
    const providerModel = providerManager
      ?.getActiveProvider()
      ?.getCurrentModel?.();
    if (providerModel && providerModel.trim() !== '') {
      return providerModel;
    }
    return this.deps.getEffectiveModel();
  }

  private _buildModelInfo(): ModelInfo {
    const model = this._resolveModelForInfo();
    const providerName = this._getProviderName();
    const profileName = this._getProfileName();
    const hasProfile = typeof profileName === 'string' && profileName !== '';
    const displayLabel = hasProfile ? profileName : model;
    return { model, providerName, profileName, displayLabel };
  }

  /**
   * Computes a collision-safe composite identity key from provider, profile,
   * and model. Uses JSON.stringify to guarantee unambiguous delimiting — a
   * null-byte-joined approach can still collide when a field value itself
   * contains a null byte.
   */
  private _modelIdentityKey(info: ModelInfo): string {
    return JSON.stringify([
      info.providerName ?? '',
      info.profileName ?? '',
      info.model,
    ]);
  }

  private async *_emitModelInfoForNewSequence(): AsyncGenerator<
    ServerGeminiStreamEvent,
    void
  > {
    const info = this._buildModelInfo();
    this.#lastModelIdentity = this._modelIdentityKey(info);
    yield { type: GeminiEventType.ModelInfo, value: info };
  }

  /**
   * Emits a ModelInfo event only when the current composite identity
   * (model/provider/profile) differs from the last emission.
   * Suppresses duplicates for the same identity.
   */
  private async *_emitModelInfoIfChanged(): AsyncGenerator<
    ServerGeminiStreamEvent,
    void
  > {
    const info = this._buildModelInfo();
    const key = this._modelIdentityKey(info);
    if (key === this.#lastModelIdentity) return;
    this.#lastModelIdentity = key;
    yield { type: GeminiEventType.ModelInfo, value: info };
  }

  private _getProfileName(): string | null {
    try {
      const settingsService = (
        this.deps.config as unknown as {
          getSettingsService?: () => {
            getCurrentProfileName?: () => string | null;
            get?: (key: string) => unknown;
          };
        }
      ).getSettingsService?.();
      if (settingsService?.getCurrentProfileName) {
        return settingsService.getCurrentProfileName();
      }
      if (settingsService?.get) {
        const profile = settingsService.get('currentProfile');
        return typeof profile === 'string' ? profile : null;
      }
    } catch {
      // Settings service unavailable — no profile info
    }
    return null;
  }

  private _resetTodoState(
    todoContinuationService: TodoContinuationService,
    latestSnapshot: Todo[],
  ): void {
    todoContinuationService.lastTodoSnapshot = latestSnapshot;
    todoContinuationService.toolCallReminderLevel = 'none';
    todoContinuationService.toolActivityCount = 0;
  }

  private async _fireAfterHook(
    ctx: StreamContext,
  ): Promise<AfterAgentHookOutput | undefined> {
    const responseText = ctx.responseChunks.join('');
    return this.deps.agentHookManager.fireAfterAgentHookSafe(
      ctx.prompt_id,
      ctx.promptText,
      responseText,
      false,
    );
  }

  /**
   * If the AfterAgent hook requested context clearing, emit an
   * AgentExecutionStopped event with contextCleared=true so the UI
   * can react. Returns the hook output for further caller checks.
   */
  private async *_fireAfterHookAndEmitClearContext(
    ctx: StreamContext,
  ): AsyncGenerator<ServerGeminiStreamEvent, AfterAgentHookOutput | undefined> {
    const afterOut = await this._fireAfterHook(ctx);
    if (afterOut?.shouldClearContext() === true) {
      yield {
        type: GeminiEventType.AgentExecutionStopped,
        reason:
          afterOut.getEffectiveReason() || 'Context cleared by AfterAgent hook',
        contextCleared: true,
      };
    }
    return afterOut;
  }
}
