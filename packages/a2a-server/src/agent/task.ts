/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AgentEvent,
  StructuredError,
  ToolConfirmation,
  ToolUpdate,
} from '@vybestack/llxprt-code-agents';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  parseAndFormatApiError,
  ToolConfirmationOutcome,
  UNCONFIGURED_PROVIDER,
  type AnsiOutput,
} from '@vybestack/llxprt-code-core';
import { MCPServerStatus } from '@vybestack/llxprt-code-mcp';
import type {
  ContentBlock,
  ModelInfo,
  TextBlock,
  UserTierId,
} from '@vybestack/llxprt-code-core';
import type { RequestContext } from '@a2a-js/sdk/server';
import { type ExecutionEventBus } from '@a2a-js/sdk/server';
import type {
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  TaskState,
  Message,
  Part,
  Artifact,
} from '@a2a-js/sdk';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

import { CoderAgentEvent } from '../types.js';
import type {
  CoderAgentMessage,
  StateChange,
  TaskMetadata,
  ThoughtSummary,
} from '../types.js';
import {
  buildToolConfirmationPayload,
  convertAnsiOutputToString,
  createTextMessage,
  createDataMessage,
  mapOutcomeStringToEnum,
} from './task-support.js';
import { resolveTimestamp } from './task-runtime-helpers.js';

/**
 * Maps the public McpServerInfo status projection onto the a2a protocol's
 * MCPServerStatus enum. The public surface adds `error`/`disabled` states
 * the enum lacks; both report as DISCONNECTED, matching the legacy default
 * for servers with no healthy connection.
 */
function mapPublicMcpStatus(
  status: 'connected' | 'connecting' | 'disconnected' | 'error' | 'disabled',
): MCPServerStatus {
  if (status === 'connected') {
    return MCPServerStatus.CONNECTED;
  }
  if (status === 'connecting') {
    return MCPServerStatus.CONNECTING;
  }
  return MCPServerStatus.DISCONNECTED;
}

/**
 * Interface-neutral Task runtime (#3221).
 *
 * The Task wraps a public {@link Agent} facade instead of hand-assembled
 * runtime services: turns stream through `agent.stream()`, tool
 * confirmations resolve through `agent.tools.respondToConfirmation`, and
 * model/tier/MCP metadata come from Agent accessors. The a2a protocol
 * mapping (status updates, artifacts, task states) stays here.
 */
export class Task {
  readonly id: string;
  readonly contextId: string;
  taskState: TaskState;
  eventBus?: ExecutionEventBus;

  private readonly agent: Agent;
  private readonly autoExecute: boolean;
  private promptCount = 0;
  private currentPromptId: string;
  private modelInfo?: ModelInfo;
  /** Pending public confirmations keyed by the a2a wire callId (toolCallId). */
  private readonly pendingToolConfirmations = new Map<
    string,
    ToolConfirmation
  >();
  /**
   * Aborts the active turn's Agent stream. Linked with the executor's request
   * abort signal so either client disconnect or task cancellation ends the
   * turn.
   */
  private turnAbortController?: AbortController;
  /**
   * The currently live (possibly paused-at-confirmation) agent turn. Kept so
   * a confirmation-only follow-up message can resume the paused stream and
   * deliver its remaining events on the new request's bus.
   */
  private activeTurn?: {
    stream: AsyncGenerator<AgentEvent, void, unknown>;
    controller: AbortController;
  };
  /**
   * Tool callIds whose confirmation this task already resolved. The
   * scheduler's awaiting_approval snapshot can re-emit confirmations for
   * already-resolved calls while the paused turn resumes, so consumers filter
   * stale replays against this set. Cleared when the turn completes.
   */
  private readonly resolvedToolCallIds = new Set<string>();

  constructor(
    taskId: string,
    contextId: string,
    agent: Agent,
    eventBus?: ExecutionEventBus,
    autoExecute = false,
  ) {
    this.id = taskId;
    this.contextId = contextId;
    this.agent = agent;
    this.eventBus = eventBus;
    this.autoExecute = autoExecute;
    this.taskState = 'submitted';
    this.currentPromptId = '';
  }

  static async create(
    taskId: string,
    contextId: string,
    agent: Agent,
    eventBus?: ExecutionEventBus,
    autoExecute = false,
  ): Promise<Task> {
    return new Task(taskId, contextId, agent, eventBus, autoExecute);
  }

  get agentFacade(): Agent {
    return this.agent;
  }

  async dispose(): Promise<void> {
    // A paused approval turn would otherwise outlive the task: abort it so
    // its suspended generator ends before the underlying agent goes away.
    this.#abortActiveTurn();
    await this.agent.dispose();
  }

  getMetadata(): TaskMetadata {
    const tools = this.agent.listTools();
    const toolByKey = new Map(
      tools.map((tool) => [`${tool.server ?? ''}.${tool.name}`, tool]),
    );
    const describeTool = (server: string, name: string) => {
      // Per-server lookup first; falls back to the server-less key so a tool
      // reported by a server but not registered under it still resolves.
      const info =
        toolByKey.get(`${server}.${name}`) ?? toolByKey.get(`.${name}`);
      return {
        name,
        description: info?.description ?? '',
        parameterSchema: info?.parametersSchema,
      };
    };
    const mcpServers = this.agent.mcp.listServers().map((server) => ({
      name: server.name,
      status: mapPublicMcpStatus(server.status),
      tools: (server.tools ?? []).map((tool) =>
        describeTool(server.name, tool),
      ),
    }));
    const availableTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      parameterSchema: tool.parametersSchema,
    }));
    return {
      id: this.id,
      contextId: this.contextId,
      taskState: this.taskState,
      model: this.modelInfo?.model ?? this.agent.getModel(),
      mcpServers,
      availableTools,
    };
  }

  private _createStatusUpdateEvent(
    stateToReport: TaskState,
    coderAgentMessage: CoderAgentMessage,
    message?: Message,
    final = false,
    timestamp?: string,
    metadataError?: string,
    traceId?: string,
  ): TaskStatusUpdateEvent {
    const metadata: {
      coderAgent: CoderAgentMessage;
      model: string;
      userTier?: UserTierId;
      error?: string;
      traceId?: string;
    } = {
      coderAgent: coderAgentMessage,
      model: this.modelInfo?.model ?? this.agent.getModel(),
      userTier: this.agent.getUserTier(),
    };

    if (metadataError) {
      metadata.error = metadataError;
    }

    if (traceId) {
      metadata.traceId = traceId;
    }

    return {
      kind: 'status-update',
      taskId: this.id,
      contextId: this.contextId,
      status: {
        state: stateToReport,
        message,
        timestamp: resolveTimestamp(timestamp),
      },
      final,
      metadata,
    };
  }

  setTaskStateAndPublishUpdate(
    newState: TaskState,
    coderAgentMessage: CoderAgentMessage,
    messageText?: string,
    messageParts?: Part[],
    final = false,
    metadataError?: string,
    traceId?: string,
  ): void {
    this.taskState = newState;
    let message: Message | undefined;

    if (messageText) {
      message = createTextMessage(messageText, this.id, this.contextId);
    } else if (messageParts) {
      message = {
        kind: 'message',
        role: 'agent',
        parts: messageParts,
        messageId: uuidv4(),
        taskId: this.id,
        contextId: this.contextId,
      };
    }

    const event = this._createStatusUpdateEvent(
      this.taskState,
      coderAgentMessage,
      message,
      final,
      undefined,
      metadataError,
      traceId,
    );
    this.eventBus?.publish(event);
  }

  /**
   * Streams a user turn through the Agent facade. Confirmation parts in the
   * user message are resolved against pending confirmations; text parts
   * become the turn input with the `sessionId########N` promptId scheme.
   */
  async *acceptUserMessage(
    requestContext: RequestContext,
    aborted: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const userMessage = requestContext.userMessage;
    const llmParts: ContentBlock[] = [];
    let anyConfirmationHandled = false;
    let hasContentForLlm = false;

    // Fail fast on incoherent mixed messages: resolving a confirmation
    // resumes the paused turn, while new content supersedes (aborts) it.
    // Doing both in one message would resolve the confirmation and then
    // immediately kill the resumed stream, so the combination is a client
    // protocol error.
    if (
      userMessage.parts.some((p) => this.#isPendingConfirmationPart(p)) &&
      userMessage.parts.some((p) => p.kind === 'text')
    ) {
      throw new Error(
        'Task message mixed tool-confirmation and content parts: send confirmation-only or content-only messages.',
      );
    }

    for (const part of userMessage.parts) {
      const confirmationHandled = await this.handleToolConfirmationPart(part);
      if (confirmationHandled) {
        anyConfirmationHandled = true;
        continue;
      }

      if (part.kind === 'text') {
        const textBlock: TextBlock = { type: 'text', text: part.text };
        llmParts.push(textBlock);
        hasContentForLlm = true;
      }
    }

    if (hasContentForLlm) {
      this.currentPromptId = this.id + '########' + this.promptCount++;
      logger.info('[Task] Streaming user turn through the Agent facade.');
      // A new content turn supersedes any paused one (e.g. an abandoned
      // approval): abort it so only one live turn exists per task.
      this.#abortActiveTurn();
      const controller = new AbortController();
      this.turnAbortController = controller;
      const turnSignal = AbortSignal.any([aborted, controller.signal]);
      const stream = this.agent.stream(llmParts, {
        signal: turnSignal,
        promptId: this.currentPromptId,
      }) as AsyncGenerator<AgentEvent, void, unknown>;
      this.activeTurn = { stream, controller };
      try {
        // Drive the stream through the return-firewall helper: an early
        // consumer exit (the executor stops at an approval boundary by
        // returning) must NOT propagate stream.return() into the Agent
        // stream, or the paused turn the confirmation request is supposed
        // to resume would be killed.
        yield* this.#driveTurnStream(stream);
        // Natural completion releases the turn; the abandoned case leaves
        // it in place for the resuming confirmation-only request.
        this.#releaseTurnIfCurrent(stream);
      } catch (err) {
        // A failed turn is not resumable: discard it so a confirmation-only
        // message cannot later resume a dead stream.
        this.#releaseTurnIfCurrent(stream);
        throw err;
      } finally {
        if (this.turnAbortController === controller) {
          this.turnAbortController = undefined;
        }
      }
    } else if (anyConfirmationHandled) {
      logger.info(
        '[Task] User message only contained tool confirmations. Resolved through the Agent confirmation API.',
      );
      // Resolving the confirmation resumes the paused turn; its remaining
      // events flow to THIS request's bus (the executor re-points the bus on
      // task reuse), matching the legacy continuation contract.
      const paused = this.activeTurn;
      if (paused) {
        logger.info('[Task] Resuming paused agent turn after confirmation.');
        // The paused turn's stream was created under the PREVIOUS request's
        // signal (already dead). Link this request's abort to the paused
        // turn's controller so a disconnecting client cancels the resumed
        // turn — the same semantics a fresh turn gets from AbortSignal.any.
        const onRequestAbort = (): void => paused.controller.abort();
        if (aborted.aborted) {
          onRequestAbort();
        } else {
          aborted.addEventListener('abort', onRequestAbort, { once: true });
        }
        try {
          yield* this.#driveTurnStream(paused.stream);
        } finally {
          aborted.removeEventListener('abort', onRequestAbort);
        }
        if (this.activeTurn === paused) {
          this.activeTurn = undefined;
          this.resolvedToolCallIds.clear();
        }
      }
    } else {
      logger.info(
        '[Task] No relevant parts in user message for LLM interaction or tool confirmation.',
      );
    }
  }

  /**
   * Re-yields a (possibly paused) agent-turn stream without letting a
   * consumer-side return reach the underlying Agent stream. The explicit
   * next() loop is the firewall; yield* onto the agent stream directly
   * would propagate a .return() into it and cancel the paused turn.
   */
  async *#driveTurnStream(
    stream: AsyncGenerator<AgentEvent, void, unknown>,
  ): AsyncGenerator<AgentEvent, void, unknown> {
    let next = await stream.next();
    while (next.done !== true) {
      yield next.value;
      next = await stream.next();
    }
  }

  /**
   * Releases the turn bookkeeping when `stream` is still the active turn.
   * No-ops when an abort path or a superseding turn already cleared it —
   * the type system cannot see #abortActiveTurn nulling the field, so the
   * guard lives here instead of at each call site.
   */
  #releaseTurnIfCurrent(
    stream: AsyncGenerator<AgentEvent, void, unknown>,
  ): void {
    if (this.activeTurn?.stream === stream) {
      this.activeTurn = undefined;
      this.resolvedToolCallIds.clear();
    }
  }

  #abortActiveTurn(): void {
    if (this.activeTurn) {
      this.activeTurn.controller.abort(
        new Error('Task superseded by a new user turn.'),
      );
      this.activeTurn = undefined;
      // The pending/resolved confirmation bookkeeping is turn-scoped; a
      // superseded turn's confirmations can never be resumed, so releasing
      // them here keeps a stale callId from satisfying a later turn's
      // stale-replay guard lookups.
      this.pendingToolConfirmations.clear();
      this.resolvedToolCallIds.clear();
    }
  }

  /**
   * Cancels the active turn, if any: aborts the Agent stream and lets the
   * executor's abort path finish the task state transition. Pending tool
   * cancellation is owned by the agent loop.
   */
  cancelTurn(): void {
    this.turnAbortController?.abort(
      new Error('Task canceled by user request.'),
    );
    this.#abortActiveTurn();
  }

  /**
   * Steers the active turn with mid-turn user text. No-op when no turn is
   * active; the Agent stashes the message until the next tool boundary.
   */
  injectSteerText(text: string): void {
    this.agent.injectSteer(text);
  }

  // ── Confirmation handling (public Agent confirmation API) ──────────────────

  recordPendingConfirmation(confirmation: ToolConfirmation): void {
    this.pendingToolConfirmations.set(confirmation.toolCallId, confirmation);
  }

  hasPendingConfirmation(callId: string): boolean {
    return this.pendingToolConfirmations.has(callId);
  }

  /**
   * True when this task already resolved the confirmation for the call.
   * Used to drop stale confirmation replays the scheduler emits from its
   * awaiting_approval snapshot while a paused turn resumes.
   */
  isToolCallResolved(callId: string): boolean {
    return this.resolvedToolCallIds.has(callId);
  }

  shouldAutoApproveToolCalls(): boolean {
    return this.autoExecute;
  }

  autoApproveConfirmation(confirmation: ToolConfirmation): void {
    logger.info(
      '[Task] Auto-executing tool confirmation for callId ' +
        confirmation.toolCallId +
        '.',
    );
    this.agent.tools.respondToConfirmation(
      confirmation.confirmationId,
      ToolConfirmationOutcome.ProceedOnce,
    );
    this.pendingToolConfirmations.delete(confirmation.toolCallId);
  }

  /**
   * Structural + pending check for a tool-confirmation data part: matches the
   * exact conditions under which {@link handleToolConfirmationPart} would
   * resolve a confirmation (used by the mixed-message fail-fast guard).
   */
  #isPendingConfirmationPart(part: Part): boolean {
    if (
      part.kind !== 'data' ||
      typeof part.data['callId'] !== 'string' ||
      typeof part.data['outcome'] !== 'string' ||
      mapOutcomeStringToEnum(part.data['outcome']) === undefined
    ) {
      return false;
    }
    return this.pendingToolConfirmations.has(part.data['callId']);
  }

  private async handleToolConfirmationPart(part: Part): Promise<boolean> {
    if (
      part.kind !== 'data' ||
      typeof part.data['callId'] !== 'string' ||
      typeof part.data['outcome'] !== 'string'
    ) {
      return false;
    }

    const callId = part.data['callId'];
    const outcomeString = part.data['outcome'];
    const confirmationOutcome = mapOutcomeStringToEnum(outcomeString);

    if (confirmationOutcome === undefined) {
      logger.warn(
        `[Task] Unknown tool confirmation outcome: "${outcomeString}" for callId: ${callId}`,
      );
      return false;
    }

    const confirmation = this.pendingToolConfirmations.get(callId);

    if (!confirmation) {
      logger.warn(
        `[Task] Received tool confirmation for unknown or already processed callId: ${callId}`,
      );
      return false;
    }

    logger.info(
      `[Task] Handling tool confirmation for callId: ${callId} with outcome: ${outcomeString}`,
    );

    try {
      const payload = buildToolConfirmationPayload(part.data);
      const hasPayload = payload !== undefined;
      const confirmPayload = hasPayload ? payload : undefined;

      // Resolve through the public confirmation API; the agent's tool
      // continuation runs asynchronously on the agent's own event bus.
      // (#3221 follow-up): legacy parity keeps GCP credential env unshielded
      // here — the facade's respondToConfirmation is synchronous
      // fire-onto-bus, so a process-global env window around this call would
      // shield nothing while exposing other tasks to transient mutation.
      // Real isolation needs a facade-level credential-context API.
      this.agent.tools.respondToConfirmation(
        confirmation.confirmationId,
        confirmationOutcome,
        confirmPayload,
      );
      if (confirmationOutcome !== 'modify_with_editor') {
        this.pendingToolConfirmations.delete(callId);
        this.resolvedToolCallIds.add(callId);
      }
      return true;
    } catch (error) {
      logger.error(
        `[Task] Error during tool confirmation for callId ${callId}:`,
        error,
      );
      const errorMessageText =
        error instanceof Error
          ? error.message
          : `Error processing tool confirmation for ${callId}`;
      this.setTaskStateAndPublishUpdate(
        this.taskState,
        { kind: CoderAgentEvent.ToolCallUpdateEvent },
        errorMessageText,
        undefined,
        false,
      );
      return false;
    }
  }

  // ── Stream event publication (AgentEvent → a2a protocol) ───────────────────

  sendTextContent(content: string, traceId?: string): void {
    if (content === '') {
      return;
    }
    this.publishContentMessage(
      createTextMessage(content, this.id, this.contextId),
      { kind: CoderAgentEvent.TextContentEvent },
      traceId,
    );
  }

  sendThought(content: ThoughtSummary, traceId?: string): void {
    if (!content.subject && !content.description) {
      return;
    }
    this.publishContentMessage(
      createDataMessage(content, this.id, this.contextId),
      { kind: CoderAgentEvent.ThoughtEvent },
      traceId,
    );
  }

  handleModelInfo(info: ModelInfo): void {
    logger.info('[Task] Received model info event:', info);
    this.modelInfo = info;
  }

  /**
   * Publishes a tool status update on the a2a bus, mirroring the legacy
   * scheduler-update publication using the public {@link ToolUpdate}
   * projection.
   */
  publishToolUpdate(update: ToolUpdate): void {
    const message: Message = {
      kind: 'message',
      role: 'agent',
      parts: [{ kind: 'data', data: update } as Part],
      messageId: uuidv4(),
      taskId: this.id,
      contextId: this.contextId,
    };
    const coderAgentMessage: CoderAgentMessage =
      update.status === 'awaiting-approval'
        ? { kind: CoderAgentEvent.ToolCallConfirmationEvent }
        : { kind: CoderAgentEvent.ToolCallUpdateEvent };

    const event = this._createStatusUpdateEvent(
      this.taskState,
      coderAgentMessage,
      message,
      false,
    );
    this.eventBus?.publish(event);
  }

  /**
   * Publishes incremental tool output as an append artifact, mirroring the
   * legacy scheduler outputUpdateHandler publication (including its
   * ANSI-grid flattening).
   */
  publishToolOutput(
    toolCallId: string,
    outputChunk: string | AnsiOutput,
  ): void {
    const textOutput = convertAnsiOutputToString(outputChunk);
    const artifact: Artifact = {
      artifactId: `tool-${toolCallId}-output`,
      parts: [
        {
          kind: 'text',
          text: textOutput,
        } as Part,
      ],
    };
    const artifactEvent: TaskArtifactUpdateEvent = {
      kind: 'artifact-update',
      taskId: this.id,
      contextId: this.contextId,
      artifact,
      append: true,
      lastChunk: false,
    };
    this.eventBus?.publish(artifactEvent);
  }

  /**
   * Handles stream idle timeout: publishes a final input-required update
   * with the formatted API error.
   */
  handleStreamIdleTimeout(
    error: StructuredError,
    stateChange: StateChange,
    traceId?: string,
  ): void {
    const timeoutMessage =
      error.message ||
      'Stream idle timeout: no response received within the allowed time.';
    logger.warn(
      '[Task] Received stream idle timeout event from LLM stream:',
      timeoutMessage,
    );
    this.setTaskStateAndPublishUpdate(
      'input-required',
      stateChange,
      'Task timed out waiting for model response.',
      undefined,
      true,
      parseAndFormatApiError(
        error,
        undefined,
        this.getErrorFallbackModel(),
        this.getProviderName(),
      ),
      traceId,
    );
  }

  /**
   * Handles invalid stream events by publishing an error status update.
   */
  handleInvalidStream(stateChange: StateChange, traceId?: string): void {
    const invalidStreamMessage =
      'Invalid stream event received from LLM stream.';
    logger.error(
      '[Task] Received error event from LLM stream:',
      invalidStreamMessage,
    );
    this.setTaskStateAndPublishUpdate(
      this.taskState,
      stateChange,
      `Agent Error, unknown agent message: ${invalidStreamMessage}`,
      undefined,
      false,
      invalidStreamMessage,
      traceId,
    );
  }

  /**
   * Handles LLM stream error events by publishing an error status update.
   */
  handleStreamError(
    error: StructuredError,
    stateChange: StateChange,
    traceId?: string,
  ): void {
    const errorMessage =
      typeof error.message === 'string' && error.message !== ''
        ? error.message
        : 'Unknown error from LLM stream';
    logger.error('[Task] Received error event from LLM stream:', errorMessage);
    const errMessage = parseAndFormatApiError(
      error,
      undefined,
      this.getErrorFallbackModel(),
      this.getProviderName(),
    );
    this.setTaskStateAndPublishUpdate(
      this.taskState,
      stateChange,
      `Agent Error, unknown agent message: ${errorMessage}`,
      undefined,
      false,
      errMessage,
      traceId,
    );
  }

  private getErrorFallbackModel(): string | undefined {
    const providerName = this.getProviderName();
    const normalizedProviderName = providerName?.trim().toLowerCase();
    if (
      normalizedProviderName !== undefined &&
      normalizedProviderName !== '' &&
      normalizedProviderName !== 'gemini'
    ) {
      return undefined;
    }
    return this.modelInfo?.model ?? this.agent.getModel();
  }

  private getProviderName(): string | undefined {
    const providerName = this.agent.getProvider().trim();
    return providerName === '' || providerName === UNCONFIGURED_PROVIDER
      ? undefined
      : providerName;
  }

  private publishContentMessage(
    message: Message,
    coderAgentMessage: CoderAgentMessage,
    traceId?: string,
  ): void {
    this.eventBus?.publish(
      this._createStatusUpdateEvent(
        this.taskState,
        coderAgentMessage,
        message,
        false,
        undefined,
        undefined,
        traceId,
      ),
    );
  }
}
