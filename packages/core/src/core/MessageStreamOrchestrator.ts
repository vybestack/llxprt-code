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
} from './turn.js';
import type { Config } from '../config/config.js';
import type { GeminiChat } from './geminiChat.js';
import type { DebugLogger } from '../debug/index.js';
import type { LoopDetectionService } from '../services/loopDetectionService.js';
import type { TodoContinuationService } from './TodoContinuationService.js';
import type { IdeContextTracker } from './IdeContextTracker.js';
import type { AgentHookManager } from './AgentHookManager.js';
import type { AfterAgentHookOutput } from '../hooks/types.js';
import { estimateTextOnlyLength, extractPromptText } from './clientHelpers.js';
import { tokenLimit } from './tokenLimits.js';
import type { Todo } from '../tools/todo-schemas.js';
import type { ComplexityAnalyzer } from '../services/complexity-analyzer.js';

export interface MessageStreamDeps {
  config: Config;
  getChat: () => GeminiChat;
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
  startChat: (extraHistory?: Content[]) => Promise<GeminiChat>;
  getPreviousHistory: () => Content[] | undefined;
  setChat: (chat: GeminiChat) => void;
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

interface StreamContext {
  prompt_id: string;
  promptText: string;
  responseChunks: string[];
  signal: AbortSignal;
  turns: number;
  isInvalidStreamRetry: boolean;
  is413Retry: boolean;
}

interface IterationResult {
  earlyReturn: boolean;
  hadToolCallsThisTurn: boolean;
  todoPauseSeen: boolean;
  hadThinking: boolean;
  hadContent: boolean;
  deferredEvents: ServerGeminiStreamEvent[];
}

interface PostTurnResult {
  done: boolean;
  retryCount: number;
  newBaseRequest: PartListUnion | undefined;
}

const MAX_TURNS = 100;
const MAX_RETRIES = 3;

export class MessageStreamOrchestrator {
  constructor(private readonly deps: MessageStreamDeps) {}

  async *execute(
    initialRequest: PartListUnion,
    signal: AbortSignal,
    prompt_id: string,
    turns: number,
    isInvalidStreamRetry: boolean,
    is413Retry: boolean = false,
  ): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
    this.deps.logger.debug(
      () => 'DEBUG: GeminiClient.sendMessageStream called',
    );

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
      const conversationHistory = previousHistory.slice(2);
      setChat(await startChat(conversationHistory));
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

      const hookOutput = await agentHookManager.fireBeforeAgentHookSafe(
        ctx.prompt_id,
        ctx.promptText,
      );

      if (
        hookOutput?.isBlockingDecision() ||
        hookOutput?.shouldStopExecution()
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
    if (!boundedTurns) {
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
      tokenLimit(modelForLimitCheck) - getChat().getLastPromptTokenCount();

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
      (lastMessage.parts?.some((p) => 'functionCall' in p) || false);

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

    for await (const event of turn.run(iterRequest, signal)) {
      if (loopDetector.addAndCheck(event)) {
        yield { type: GeminiEventType.LoopDetected };
        yield* this._fireAfterHookAndEmitClearContext(ctx);
        return this._earlyIterResult(hadToolCallsThisTurn, {
          todoPauseSeen,
          hadThinking,
          hadContent,
          deferredEvents,
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
      this._handleTodoToolCall(
        event,
        todoContinuationService,
        this.deps.getSessionTurnCount,
      );
      if (event.type === GeminiEventType.Content && event.value)
        ctx.responseChunks.push(event.value);

      if (todoContinuationService.shouldDeferStreamEvent(event)) {
        deferredEvents.push(event);
      } else {
        yield event;
      }
      updateTelemetryTokenCount();

      const terminalResult = yield* this._handleTerminalEvent(
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
    };
  }

  private async *_handleTerminalEvent(
    event: ServerGeminiStreamEvent,
    signal: AbortSignal,
    ctx: StreamContext,
    deferredEvents: ServerGeminiStreamEvent[],
    state: {
      hadToolCallsThisTurn: boolean;
      todoPauseSeen: boolean;
      hadThinking: boolean;
      hadContent: boolean;
    },
    initialRequest: PartListUnion,
  ): AsyncGenerator<ServerGeminiStreamEvent, IterationResult | undefined> {
    const { config, sendMessageStream } = this.deps;
    const boundedTurns = Math.min(ctx.turns, MAX_TURNS);

    if (event.type === GeminiEventType.Error) {
      const errorStatus =
        event.value?.error && typeof event.value.error === 'object'
          ? (event.value.error as { status?: number }).status
          : undefined;

      this.deps.logger.debug(
        () => `[stream:orchestrator] handling error event`,
        {
          errorStatus,
          continueOnFailedApiCall: config.getContinueOnFailedApiCall(),
          deferredEventCount: deferredEvents.length,
          hadToolCallsThisTurn: state.hadToolCallsThisTurn,
          hadContent: state.hadContent,
          hadThinking: state.hadThinking,
        },
      );

      if (errorStatus === 413 && config.getContinueOnFailedApiCall()) {
        if (ctx.is413Retry) {
          this.deps.logger.warn(
            () =>
              `[stream:orchestrator] received repeated 413 after retry; ending iteration`,
            {
              deferredEventCount: deferredEvents.length,
              hadToolCallsThisTurn: state.hadToolCallsThisTurn,
            },
          );
          for (const d of deferredEvents) yield d;
          await this._fireAfterHook(ctx);
          return this._earlyIterResult(state.hadToolCallsThisTurn, {
            ...state,
            deferredEvents,
          });
        }
        const toolNames = this._extractToolNamesFromRequest(initialRequest);
        const toolList =
          toolNames.length > 0
            ? ` The tools involved were: ${toolNames.join(', ')}.`
            : '';
        const message = `System: The previous tool calls produced a response that was too large (HTTP 413).${toolList} Please retry with fewer or more focused queries.`;
        this.deps.logger.warn(
          () =>
            `[stream:orchestrator] retrying after 413 tool-response overflow`,
          {
            toolNames,
            deferredEventCount: deferredEvents.length,
            hadToolCallsThisTurn: state.hadToolCallsThisTurn,
          },
        );
        yield* sendMessageStream(
          [{ text: message }],
          signal,
          ctx.prompt_id,
          boundedTurns - 1,
          false,
          true,
        );
        await this._fireAfterHook(ctx);
        return this._earlyIterResult(state.hadToolCallsThisTurn, {
          ...state,
          deferredEvents,
        });
      }

      this.deps.logger.warn(
        () =>
          `[stream:orchestrator] error event ending iteration without retry`,
        {
          errorStatus,
          deferredEventCount: deferredEvents.length,
          hadToolCallsThisTurn: state.hadToolCallsThisTurn,
          hadContent: state.hadContent,
          hadThinking: state.hadThinking,
        },
      );
      for (const d of deferredEvents) yield d;
      yield* this._fireAfterHookAndEmitClearContext(ctx);
      return this._earlyIterResult(state.hadToolCallsThisTurn, {
        ...state,
        deferredEvents,
      });
    }

    if (event.type === GeminiEventType.InvalidStream) {
      this.deps.logger.warn(
        () => `[stream:orchestrator] handling InvalidStream event`,
        {
          continueOnFailedApiCall: config.getContinueOnFailedApiCall(),
          isInvalidStreamRetry: ctx.isInvalidStreamRetry,
          deferredEventCount: deferredEvents.length,
          hadToolCallsThisTurn: state.hadToolCallsThisTurn,
          hadContent: state.hadContent,
          hadThinking: state.hadThinking,
        },
      );
      if (config.getContinueOnFailedApiCall()) {
        if (ctx.isInvalidStreamRetry) {
          yield* this._fireAfterHookAndEmitClearContext(ctx);
          return this._earlyIterResult(state.hadToolCallsThisTurn, {
            ...state,
            deferredEvents,
          });
        }
        yield* sendMessageStream(
          [{ text: 'System: Please continue.' }],
          signal,
          ctx.prompt_id,
          boundedTurns - 1,
          true,
        );
        yield* this._fireAfterHookAndEmitClearContext(ctx);
        return this._earlyIterResult(state.hadToolCallsThisTurn, {
          ...state,
          deferredEvents,
        });
      }
    }



    return undefined;
  }

  private _extractToolNamesFromRequest(request: PartListUnion): string[] {
    if (!Array.isArray(request)) return [];
    const names = new Set<string>();
    for (const part of request) {
      if (
        typeof part === 'object' &&
        part !== null &&
        'functionResponse' in part
      ) {
        const funcResp = (part as { functionResponse: { name?: string } })
          .functionResponse;
        if (funcResp?.name) {
          names.add(funcResp.name);
        }
      }
    }
    return [...names];
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

    if (iter.hadThinking && !iter.hadContent && !iter.hadToolCallsThisTurn) {
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
      if (afterOut?.isBlockingDecision() || afterOut?.shouldStopExecution()) {
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
    if (afterOut?.isBlockingDecision() || afterOut?.shouldStopExecution()) {
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
    getSessionTurnCount: () => number,
  ): void {
    if (
      event.type !== GeminiEventType.ToolCallRequest ||
      !todoContinuationService.isTodoToolCall(event.value?.name)
    )
      return;

    todoContinuationService.setLastTodoToolTurn(getSessionTurnCount());
    todoContinuationService.consecutiveComplexTurns = 0;

    const requestedTodos = Array.isArray(event.value?.args?.todos)
      ? (event.value.args.todos as Todo[])
      : [];
    if (requestedTodos.length > 0) {
      todoContinuationService.lastTodoSnapshot = requestedTodos.map((todo) => ({
        id: `${todo.id ?? ''}`,
        content: todo.content ?? '',
        status: todo.status ?? 'pending',
      }));
    }
  }

  private _getProviderName(): string {
    const contentGenConfig = this.deps.config.getContentGeneratorConfig();
    const providerManager = contentGenConfig?.providerManager;
    return providerManager?.getActiveProviderName() || 'backend';
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
    if (afterOut?.shouldClearContext()) {
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
