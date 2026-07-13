/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentRequestInput } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  Turn,
  AgentEventType,
  DEFAULT_AGENT_ID,
  type ServerAgentStreamEvent,
  type ServerFinishedOutcome,
  type ModelInfo,
} from './turn.js';
import {
  buildModelInfo,
  modelIdentityKey,
  type EffectiveModelIdentity,
} from './modelInfoHelpers.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  iContentFromBlocks,
  iContentFromAgentMessageInput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ChatSession } from './chatSession.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { LoopDetectionService } from '@vybestack/llxprt-code-core/services/loopDetectionService.js';
import type { TodoContinuationService } from './TodoContinuationService.js';
import type { IdeContextTracker } from './IdeContextTracker.js';
import type { AgentHookManager } from './AgentHookManager.js';
import type { AfterAgentHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  estimateRequestTokensStructured,
  extractPromptText,
} from './clientHelpers.js';
import { getTokenLimitForConfiguredContext } from './contextLimitResolver.js';
import { resolvePreflightOverflow } from './preflightRecovery.js';
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
  getEffectiveModelIdentity: () => EffectiveModelIdentity;
  getHistory: () => Promise<IContent[]>;
  getSessionTurnCount: () => number;
  incrementSessionTurnCount: () => void;
  lazyInitialize: () => Promise<void>;
  startChat: (extraHistory?: IContent[]) => Promise<ChatSession>;
  getPreviousHistory: () => IContent[] | undefined;
  setChat: (chat: ChatSession) => void;
  hasChat: () => boolean;
  complexityAnalyzer: ComplexityAnalyzer;
  getLastPromptId: () => string | undefined;
  setLastPromptId: (id: string) => void;
  resetCurrentSequenceModel: () => void;
  updateTelemetryTokenCount: () => void;
  sendMessageStream: (
    initialRequest: AgentMessageInput,
    signal: AbortSignal,
    prompt_id: string,
    turns?: number,
    isInvalidStreamRetry?: boolean,
    is413Retry?: boolean,
  ) => AsyncGenerator<ServerAgentStreamEvent, Turn>;
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
  deferredEvents: ServerAgentStreamEvent[];
  outcome?: ServerFinishedOutcome;
}

interface PostTurnResult {
  done: boolean;
  retryCount: number;
  newBaseRequest: AgentMessageInput | undefined;
}

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

/**
 * Narrows the contract-level {@link AgentRequestInput} to the neutral
 * {@link AgentMessageInput} expected by the internal stream pipeline. Since
 * AgentRequestInput is now typed as AgentMessageInput, this is a direct
 * identity function — no cast or runtime check is needed.
 */
function toAgentMessageInput(input: AgentRequestInput): AgentMessageInput {
  return input;
}

export class MessageStreamOrchestrator {
  #lastModelIdentity: string | null = null;
  constructor(private readonly deps: MessageStreamDeps) {}

  async *execute(
    initialRequest: AgentRequestInput,
    signal: AbortSignal,
    prompt_id: string,
    turns: number,
    isInvalidStreamRetry: boolean,
    is413Retry: boolean = false,
  ): AsyncGenerator<ServerAgentStreamEvent, Turn> {
    this.deps.logger.debug(() => 'DEBUG: AgentClient.sendMessageStream called');

    await this.deps.lazyInitialize();
    await this._ensureChatInitialized();

    const narrowedRequest = toAgentMessageInput(initialRequest);
    const promptText = extractPromptText(narrowedRequest);
    const ctx: StreamContext = {
      prompt_id,
      promptText,
      responseChunks: [],
      signal,
      turns,
      isInvalidStreamRetry,
      is413Retry,
    };

    const request = yield* this._preflight(narrowedRequest, ctx);
    if (request instanceof Turn) return request;

    const earlyTurn = yield* this._checkSessionLimits(narrowedRequest, ctx);
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
    initialRequest: AgentMessageInput,
    ctx: StreamContext,
  ): AsyncGenerator<ServerAgentStreamEvent, AgentMessageInput | Turn> {
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

    let request: AgentMessageInput = initialRequest;
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
          type: AgentEventType.Error,
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
        const additionalBlock: ContentBlock = {
          type: 'text',
          text: additionalContext,
        };
        // Normalize the request to ContentBlock[] so the resulting array is
        // a valid AgentMessageInput (ContentBlock[]). Mixing a raw string
        // with ContentBlock in a plain array produces an invalid union that
        // iContentFromAgentMessageInput cannot classify, causing the context
        // to be dropped ("unsupported legacy input: empty conversion").
        const blocks = iContentFromAgentMessageInput(request).flatMap(
          (c) => c.blocks,
        );
        request = [...blocks, additionalBlock] as AgentMessageInput;
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
    initialRequest: AgentMessageInput,
    ctx: StreamContext,
  ): AsyncGenerator<ServerAgentStreamEvent, Turn | undefined> {
    const { config, getChat, getSessionTurnCount, getEffectiveModelIdentity } =
      this.deps;

    if (
      config.getMaxSessionTurns() > 0 &&
      getSessionTurnCount() > config.getMaxSessionTurns()
    ) {
      yield { type: AgentEventType.MaxSessionTurns };
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

    const chat = getChat();
    const effectiveIdentity = getEffectiveModelIdentity();
    const remainingTokenCount =
      getTokenLimitForConfiguredContext(effectiveIdentity.model, config) -
      chat.getLastPromptTokenCount();

    // When history already exceeds the current model's limit (e.g. after a
    // provider/profile switch to a smaller context window), remaining capacity
    // is zero or negative. The preflight guard must NOT short-circuit: even a
    // 0-token tool-response continuation would otherwise trip it
    // (0 > negative * 0.95), emitting a bogus ContextWindowWillOverflow before
    // the downstream compression path can resolve the overflow with the
    // switched model's tokenizer. Defer to the normal send path.
    if (remainingTokenCount <= 0) {
      return undefined;
    }

    // Use the model-aware tokenizer for request sizing rather than a naive
    // text-only estimate, which under-counts functionResponse-only
    // continuations as 0 tokens. When the chat session does not expose the
    // tokenizer-backed methods (e.g. a minimal test double), or the tokenizer
    // throws (e.g. uninitialized internals during early preflight), fall back
    // to the structured payload-aware estimate so the guard still functions
    // while counting tool-response/tool-call JSON payloads.
    const { estimatePendingTokens: est } = chat;
    const fallback = estimateRequestTokensStructured(initialRequest);
    const estimatedRequestTokenCount =
      typeof est === 'function'
        ? await Promise.resolve()
            .then(() => {
              const contents = iContentFromAgentMessageInput(initialRequest);
              return est.call(chat, contents);
            })
            .catch(() => fallback)
        : fallback;

    // Overflow guard: attempt automatic compression before bailing (issue
    // #2402), matching manual /compress, the load-balancer guard (#2207),
    // and the provider content enforcer (#2299).
    const proceed = await resolvePreflightOverflow(this.deps, {
      promptId: ctx.prompt_id,
      estimatedRequestTokenCount,
      remainingTokenCount,
    });
    if (proceed) return undefined;
    yield {
      type: AgentEventType.ContextWindowWillOverflow,
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

  /**
   * Pending-tool-call detection on neutral blocks (P15).
   *
   * @plan:PLAN-20260707-AGENTNEUTRAL.P15
   * @requirement:REQ-005.4
   */
  private async _injectIdeContext(): Promise<void> {
    const { config, ideContextTracker, getChat, getHistory } = this.deps;
    const history = await getHistory();
    const lastMessage =
      history.length > 0 ? history[history.length - 1] : undefined;
    const lastIContent = lastMessage;
    const hasPendingToolCall =
      !!lastIContent &&
      lastIContent.speaker === 'ai' &&
      lastIContent.blocks.some((b) => b.type === 'tool_call');

    if (config.getIdeMode() && !hasPendingToolCall) {
      const { contextParts, newIdeContext } = ideContextTracker.getContextParts(
        history.length === 0,
      );
      if (contextParts.length > 0) {
        getChat().addHistory(
          iContentFromBlocks(
            [{ type: 'text', text: contextParts.join('\n') }],
            'human',
          ),
        );
      }
      ideContextTracker.recordSentContext(newIdeContext);
    }
  }

  private async *_runRetryLoop(
    initialRequest: AgentMessageInput,
    signal: AbortSignal,
    ctx: StreamContext,
  ): AsyncGenerator<ServerAgentStreamEvent, Turn> {
    const { todoContinuationService, complexityAnalyzer, getSessionTurnCount } =
      this.deps;

    let baseRequest: AgentMessageInput =
      iContentFromAgentMessageInput(initialRequest);
    let retryCount = 0;
    let lastTurn: Turn | undefined;
    let hadToolCallsThisTurn = false;

    while (retryCount < MAX_RETRIES) {
      let iterRequest: AgentMessageInput = iContentFromAgentMessageInput(
        baseRequest,
      ).map((content) => ({
        ...content,
        blocks: [...content.blocks],
      }));

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

      const postTurnResult: PostTurnResult = yield* this._evaluatePostTurn(
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
    iterRequest: AgentMessageInput,
    signal: AbortSignal,
    turn: Turn,
    ctx: StreamContext,
    hadToolCallsPrior: boolean,
    initialRequest: AgentMessageInput,
  ): AsyncGenerator<ServerAgentStreamEvent, IterationResult> {
    const { loopDetector, todoContinuationService, updateTelemetryTokenCount } =
      this.deps;

    const loopDetected = await loopDetector.turnStarted(signal);
    if (loopDetected) {
      yield { type: AgentEventType.LoopDetected };
      yield* this._fireAfterHookAndEmitClearContext(ctx);
      return this._earlyIterResult(hadToolCallsPrior);
    }

    let todoPauseSeen = false;
    let hadThinking = false;
    let hadContent = false;
    let hadToolCallsThisTurn = hadToolCallsPrior;
    const deferredEvents: ServerAgentStreamEvent[] = [];
    let finishedOutcome: ServerFinishedOutcome | undefined;

    for await (const event of turn.run(iterRequest, signal)) {
      if (loopDetector.addAndCheck(event)) {
        yield { type: AgentEventType.LoopDetected };
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
      if (event.type === AgentEventType.ToolCallRequest)
        hadToolCallsThisTurn = true;
      if (
        event.type === AgentEventType.ToolCallResponse &&
        todoContinuationService.isSuccessfulTodoPauseResponse(event.value)
      )
        todoPauseSeen = true;
      if (event.type === AgentEventType.Thought) hadThinking = true;
      if (event.type === AgentEventType.Content) hadContent = true;
      if (event.type === AgentEventType.Finished && event.value.outcome)
        finishedOutcome = event.value.outcome;
      this._handleTodoToolCall(event, todoContinuationService);
      if (event.type === AgentEventType.Content && event.value)
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
    baseRequest: AgentMessageInput,
    retryCount: number,
    ctx: StreamContext,
  ): AsyncGenerator<ServerAgentStreamEvent, PostTurnResult> {
    if (iter.todoPauseSeen) {
      return yield* this._evaluateTodoContinuation(
        iter,
        baseRequest,
        retryCount,
        ctx,
      );
    }

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
          d.type === AgentEventType.Content ||
          d.type === AgentEventType.Citation
        )
          yield d;
      }
      return {
        done: false,
        retryCount: newRetry,
        newBaseRequest: [
          {
            text: 'System: Continue and take the next concrete action now. Use tools if needed.',
          } as ContentBlock,
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
    baseRequest: AgentMessageInput,
    retryCount: number,
    ctx: StreamContext,
  ): AsyncGenerator<ServerAgentStreamEvent, PostTurnResult> {
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
          [{ type: 'text', text: afterOut.getEffectiveReason() }],
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
    deferredEvents: ServerAgentStreamEvent[],
    ctx: StreamContext,
  ): AsyncGenerator<ServerAgentStreamEvent, PostTurnResult> {
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
        [{ type: 'text', text: afterOut.getEffectiveReason() }],
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
    baseRequest: AgentMessageInput,
    _deferredEvents: ServerAgentStreamEvent[],
    _ctx: StreamContext,
  ): Promise<AgentMessageInput | undefined> {
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

    return todoContinuationService.appendSystemReminderToRequest(
      iContentFromAgentMessageInput(baseRequest),
      followUpReminder,
    );
  }

  private _applyComplexityAnalysis(
    request: IContent[],
    todoContinuationService: TodoContinuationService,
    complexityAnalyzer: ComplexityAnalyzer,
    getSessionTurnCount: () => number,
  ): { request: AgentMessageInput; baseRequest: AgentMessageInput } {
    let shouldAppendTodoSuffix = false;

    if (request.length > 0) {
      const userMessage = iContentFromAgentMessageInput(request)
        .flatMap((content) => content.blocks)
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
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
      request = iContentFromAgentMessageInput(
        todoContinuationService.appendTodoSuffixToRequest(request),
      );
    }

    const baseRequest = iContentFromAgentMessageInput(request);
    return { request, baseRequest };
  }

  private _handleTodoToolCall(
    event: ServerAgentStreamEvent,
    todoContinuationService: TodoContinuationService,
  ): void {
    const rawEvent = event as unknown as {
      type: AgentEventType;
      value?: { name?: string; args?: { todos?: unknown } };
    };
    if (
      rawEvent.type !== AgentEventType.ToolCallRequest ||
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
    return this.deps.getEffectiveModelIdentity().providerName;
  }

  private _buildModelInfo(): ModelInfo {
    return buildModelInfo(
      this.deps.config,
      this.deps.getEffectiveModelIdentity(),
    );
  }

  private *_modelInfoEvents(force: boolean): Generator<ServerAgentStreamEvent> {
    const info = this._buildModelInfo();
    const key = modelIdentityKey(info);
    if (!force && key === this.#lastModelIdentity) return;
    this.#lastModelIdentity = key;
    yield { type: AgentEventType.ModelInfo, value: info };
  }

  private async *_emitModelInfoForNewSequence(): AsyncGenerator<
    ServerAgentStreamEvent,
    void
  > {
    yield* this._modelInfoEvents(true);
  }

  private async *_emitModelInfoIfChanged(): AsyncGenerator<
    ServerAgentStreamEvent,
    void
  > {
    yield* this._modelInfoEvents(false);
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
    return this.deps.agentHookManager.fireAfterAgentHookSafe(
      ctx.prompt_id,
      ctx.promptText,
      ctx.responseChunks.join(''),
      false,
    );
  }

  /**
   * If the AfterAgent hook requested context clearing, emit an
   * AgentExecutionStopped event with contextCleared=true so the UI can react.
   * Returns the hook output for further caller checks.
   */
  private async *_fireAfterHookAndEmitClearContext(
    ctx: StreamContext,
  ): AsyncGenerator<ServerAgentStreamEvent, AfterAgentHookOutput | undefined> {
    const afterOut = await this._fireAfterHook(ctx);
    if (afterOut?.shouldClearContext() === true) {
      yield {
        type: AgentEventType.AgentExecutionStopped,
        reason:
          afterOut.getEffectiveReason() || 'Context cleared by AfterAgent hook',
        contextCleared: true,
      };
    }
    return afterOut;
  }
}
