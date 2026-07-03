/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GeminiEventType,
  ToolConfirmationOutcome,
  ApprovalMode,
  createAgentRuntimeState,
  DEFAULT_GUI_EDITOR,
  MessageBus,
} from '@vybestack/llxprt-code-core';
import type {
  CompletedToolCall,
  ToolCall,
  ToolCallRequestInfo,
  ServerGeminiStreamEvent,
  ToolCallConfirmationDetails,
  SerializableConfirmationDetails,
  Config,
  UserTierId,
  ModelInfo,
  AnsiOutput,
  ToolSchedulerContract,
  AgentClientContract,
} from '@vybestack/llxprt-code-core';
import { createAgentClient } from '@vybestack/llxprt-code-agents';
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
import type { PartUnion } from '@google/genai';
import {
  createToolStatusMessage,
  isInformationalAgentEvent,
  getLogWarnTypes,
  getLogInfoTypes,
  logInformationalEvent,
  isInteractiveConfirmationDetails,
  handleToolConfirmationPart,
  handleStreamIdleTimeout,
  handleInvalidStream,
  handleStreamError,
  handleUserCancelled,
  normalizeToolCallRequest,
  convertAnsiOutputToString,
  createTextMessage,
  createDataMessage,
} from './task-support.js';
import {
  type SchedulerConfig,
  getEventTraceId,
  getProposedContent,
  resolveModel,
  resolveTimestamp,
  normalizeResponseToGenAiParts,
  buildLlmPartsFromToolCalls,
  createCheckpointsForRestorableTools,
  buildServerAndToolMetadata,
} from './task-runtime-helpers.js';

export class Task {
  id: string;
  contextId: string;
  scheduler: ToolSchedulerContract | null;
  config: Config;
  agentClient: AgentClientContract;
  pendingToolConfirmationDetails: Map<
    string,
    ToolCallConfirmationDetails | SerializableConfirmationDetails
  >;
  taskState: TaskState;
  eventBus?: ExecutionEventBus;
  completedToolCalls: CompletedToolCall[];
  skipFinalTrueAfterInlineEdit = { value: false };
  currentPromptId: string | undefined;
  promptCount = 0;
  autoExecute: boolean;

  private pendingToolCalls: Map<string, string> = new Map(); //toolCallId --> status
  private toolCompletionPromise?: Promise<void>;
  private toolCompletionNotifier?: {
    resolve: () => void;
    reject: (reason?: Error) => void;
  };
  private modelInfo?: ModelInfo;
  private readonly sessionMessageBus: MessageBus;

  private constructor(
    id: string,
    contextId: string,
    config: Config,
    eventBus?: ExecutionEventBus,
    autoExecute = false,
  ) {
    this.id = id;
    this.contextId = contextId;
    this.config = config;
    this.scheduler = null;
    this.sessionMessageBus = new MessageBus(
      this.config.getPolicyEngine(),
      this.config.getDebugMode(),
    );
    const contentConfig = this.config.getContentGeneratorConfig();
    const runtimeState = createAgentRuntimeState({
      runtimeId: `${this.contextId}-task-runtime`,
      provider: this.config.getProvider() ?? 'gemini',
      model: resolveModel(
        this.config.getModel(),
        contentConfig?.model,
        'gemini-pro',
      ),
      proxyUrl: this.config.getProxy(),
      sessionId: this.config.getSessionId(),
    });
    this.agentClient = createAgentClient(this.config, runtimeState);
    this.pendingToolConfirmationDetails = new Map();
    this.taskState = 'submitted';
    this.eventBus = eventBus;
    this.completedToolCalls = [];
    this.autoExecute = autoExecute;
    this._resetToolCompletionPromise();
  }

  static async create(
    id: string,
    contextId: string,
    config: Config,
    eventBus?: ExecutionEventBus,
    autoExecute?: boolean,
  ): Promise<Task> {
    const task = new Task(id, contextId, config, eventBus, autoExecute);
    task.scheduler = await task.createScheduler();
    return task;
  }

  // Note: `getAllMCPServerStatuses` retrieves the status of all MCP servers for the entire
  // process. This is not scoped to the individual task but reflects the global connection
  // state managed within the @gemini-cli/core module.
  async getMetadata(): Promise<TaskMetadata> {
    const { mcpServers, availableTools } = buildServerAndToolMetadata(
      this.config,
    );

    return {
      id: this.id,
      contextId: this.contextId,
      taskState: this.taskState,
      model:
        this.modelInfo?.model ??
        this.config.getContentGeneratorConfig()?.model ??
        'unknown',
      mcpServers,
      availableTools,
    };
  }

  private _resetToolCompletionPromise(): void {
    this.toolCompletionPromise = new Promise((resolve, reject) => {
      this.toolCompletionNotifier = { resolve, reject };
    });
    // If there are no pending calls when reset, resolve immediately.
    if (this.pendingToolCalls.size === 0 && this.toolCompletionNotifier) {
      this.toolCompletionNotifier.resolve();
    }
  }

  private _registerToolCall(toolCallId: string, status: string): void {
    const wasEmpty = this.pendingToolCalls.size === 0;
    this.pendingToolCalls.set(toolCallId, status);
    if (wasEmpty) {
      this._resetToolCompletionPromise();
    }
    logger.info(
      `[Task] Registered tool call: ${toolCallId}. Pending: ${this.pendingToolCalls.size}`,
    );
  }

  private _resolveToolCall(toolCallId: string): void {
    if (this.pendingToolCalls.has(toolCallId)) {
      this.pendingToolCalls.delete(toolCallId);
      logger.info(
        `[Task] Resolved tool call: ${toolCallId}. Pending: ${this.pendingToolCalls.size}`,
      );
      if (this.pendingToolCalls.size === 0 && this.toolCompletionNotifier) {
        this.toolCompletionNotifier.resolve();
      }
    }
  }

  async waitForPendingTools(): Promise<void> {
    if (this.pendingToolCalls.size === 0) {
      return Promise.resolve();
    }
    logger.info(
      `[Task] Waiting for ${this.pendingToolCalls.size} pending tool(s)...`,
    );
    return this.toolCompletionPromise;
  }

  cancelPendingTools(reason: string): void {
    if (this.pendingToolCalls.size > 0) {
      logger.info(
        `[Task] Cancelling all ${this.pendingToolCalls.size} pending tool calls. Reason: ${reason}`,
      );
    }
    if (this.toolCompletionNotifier) {
      this.toolCompletionNotifier.reject(new Error(reason));
    }
    this.pendingToolCalls.clear();
    // Reset the promise for any future operations, ensuring it's in a clean state.
    this._resetToolCompletionPromise();
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
      model: this.modelInfo?.model ?? this.config.getModel(),
      userTier: this.agentClient.getUserTier(),
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
        message, // Shorthand property
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
    messageParts?: Part[], // For more complex messages
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

  private _schedulerOutputUpdate(
    toolCallId: string,
    outputChunk: string | AnsiOutput,
  ): void {
    const textOutput = convertAnsiOutputToString(outputChunk);
    logger.info(
      '[Task] Scheduler output update for tool call ' +
        toolCallId +
        ': ' +
        textOutput,
    );
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

  private async _schedulerAllToolCallsComplete(
    completedToolCalls: CompletedToolCall[],
  ): Promise<void> {
    logger.info(
      '[Task] All tool calls completed by scheduler (batch):',
      completedToolCalls.map((tc) => tc.request.callId),
    );
    this.completedToolCalls.push(...completedToolCalls);
    completedToolCalls.forEach((tc) => {
      this._resolveToolCall(tc.request.callId);
    });
  }

  private _schedulerToolCallsUpdate(toolCalls: ToolCall[]): void {
    logger.info(
      '[Task] Scheduler tool calls updated:',
      toolCalls.map((tc) => `${tc.request.callId} (${tc.status})`),
    );

    toolCalls.forEach((tc) => this.updateToolCallStatus(tc));

    if (this.shouldAutoApproveToolCalls()) {
      this.autoApproveToolCalls(toolCalls);
      return;
    }

    this.publishInputRequiredIfStable();
  }

  private updateToolCallStatus(tc: ToolCall): void {
    const previousStatus = this.pendingToolCalls.get(tc.request.callId);
    const hasChanged = previousStatus !== tc.status;

    if (['success', 'error', 'cancelled'].includes(tc.status)) {
      this._resolveToolCall(tc.request.callId);
    } else {
      this._registerToolCall(tc.request.callId, tc.status);
    }

    if (tc.status === 'awaiting_approval') {
      this.pendingToolConfirmationDetails.set(
        tc.request.callId,
        tc.confirmationDetails,
      );
    }

    if (hasChanged) {
      this.publishToolCallUpdate(tc);
    }
  }

  private publishToolCallUpdate(tc: ToolCall): void {
    const message = createToolStatusMessage(tc, this.id, this.contextId);
    const coderAgentMessage: CoderAgentMessage =
      tc.status === 'awaiting_approval'
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

  private shouldAutoApproveToolCalls(): boolean {
    return (
      this.autoExecute || this.config.getApprovalMode() === ApprovalMode.YOLO
    );
  }

  private autoApproveToolCalls(toolCalls: ToolCall[]): void {
    logger.info(
      '[Task] ' +
        (this.autoExecute ? '' : 'YOLO mode enabled. ') +
        'Auto-approving all tool calls.',
    );
    toolCalls.forEach((tc: ToolCall) => {
      if (
        tc.status === 'awaiting_approval' &&
        isInteractiveConfirmationDetails(tc.confirmationDetails)
      ) {
        void tc.confirmationDetails.onConfirm(
          ToolConfirmationOutcome.ProceedOnce,
        );
        this.pendingToolConfirmationDetails.delete(tc.request.callId);
      }
    });
  }

  private publishInputRequiredIfStable(): void {
    const allPendingStatuses = Array.from(this.pendingToolCalls.values());
    const isAwaitingApproval = allPendingStatuses.some(
      (status) => status === 'awaiting_approval',
    );
    const allPendingAreStable = allPendingStatuses.every((status) =>
      ['awaiting_approval', 'success', 'error', 'cancelled'].includes(status),
    );

    if (
      isAwaitingApproval &&
      allPendingAreStable &&
      !this.skipFinalTrueAfterInlineEdit.value
    ) {
      this.setTaskStateAndPublishUpdate(
        'input-required',
        { kind: CoderAgentEvent.StateChangeEvent },
        undefined,
        undefined,
        true,
      );
    }
  }

  private async createScheduler(): Promise<ToolSchedulerContract> {
    const sessionId = this.config.getSessionId();
    if (!sessionId) {
      throw new Error('Scheduler sessionId is required');
    }
    return (this.config as SchedulerConfig).getOrCreateScheduler(
      sessionId,
      {
        outputUpdateHandler: this._schedulerOutputUpdate.bind(this),
        onAllToolCallsComplete: this._schedulerAllToolCallsComplete.bind(this),
        onToolCallsUpdate: this._schedulerToolCallsUpdate.bind(this),
        getPreferredEditor: () => DEFAULT_GUI_EDITOR,
        onEditorClose: () => {},
      },
      undefined,
      { messageBus: this.sessionMessageBus },
    );
  }

  private async getProposedContent(
    file_path: string,
    old_string: string,
    new_string: string,
  ): Promise<string> {
    return getProposedContent(file_path, old_string, new_string);
  }

  async scheduleToolCalls(
    requests: ToolCallRequestInfo[],
    abortSignal: AbortSignal,
  ): Promise<void> {
    if (requests.length === 0) {
      return;
    }

    const updatedRequests = await Promise.all(
      requests.map((request) =>
        normalizeToolCallRequest(request, this.getProposedContent.bind(this)),
      ),
    );

    logger.info(
      `[Task] Scheduling batch of ${updatedRequests.length} tool calls.`,
    );
    const stateChange: StateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };
    this.setTaskStateAndPublishUpdate('working', stateChange);

    await createCheckpointsForRestorableTools(
      this.config,
      updatedRequests,
      this.agentClient,
    );

    if (!this.scheduler) {
      throw new Error('Scheduler not initialized');
    }
    await this.scheduler.schedule(updatedRequests, abortSignal);
  }

  async acceptAgentMessage(event: ServerGeminiStreamEvent): Promise<void> {
    // Handle informational/log-only events early to reduce branching complexity.
    // Type guard narrows event to informational types; early return ensures
    // the main switch only handles state-changing events.
    if (isInformationalAgentEvent(event)) {
      const type = event.type;
      if (getLogWarnTypes().has(type) || getLogInfoTypes().has(type)) {
        logInformationalEvent(type, event, this.id);
      }
      // Silent types (ChatCompressed, UsageMetadata, Citation) require no action
      return;
    }

    const traceId = getEventTraceId(event);
    this.handleStateChangingAgentEvent(event, traceId);
  }

  private handleStateChangingAgentEvent(
    event: ServerGeminiStreamEvent,
    traceId: string | undefined,
  ): void {
    const stateChange: StateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };

    switch (event.type) {
      case GeminiEventType.Content:
        logger.info('[Task] Sending agent message content...');
        this._sendTextContent(event.value, traceId);
        break;
      case GeminiEventType.ToolCallConfirmation:
        this.handleToolCallConfirmationEvent(event);
        break;
      case GeminiEventType.UserCancelled:
        handleUserCancelled(this.createStreamContext(), stateChange, traceId);
        break;
      case GeminiEventType.StreamIdleTimeout:
        handleStreamIdleTimeout(
          event,
          this.createStreamContext(),
          stateChange,
          traceId,
        );
        break;
      case GeminiEventType.Thought:
        logger.info('[Task] Sending agent thought...');
        this._sendThought(event.value, traceId);
        break;
      case GeminiEventType.ModelInfo:
        logger.info('[Task] Received model info event:', event.value);
        this.modelInfo = event.value;
        break;
      case GeminiEventType.InvalidStream:
        handleInvalidStream(this.createStreamContext(), stateChange, traceId);
        break;
      case GeminiEventType.Error:
        handleStreamError(
          event,
          this.createStreamContext(),
          stateChange,
          traceId,
        );
        break;
      default:
        throw new Error(`Unknown event type: ${JSON.stringify(event)}`);
    }
  }

  private createStreamContext() {
    const providerName = this.config.getProvider()?.trim();
    return {
      taskState: this.taskState,
      currentModel: this.modelInfo?.model ?? this.config.getModel(),
      providerName: providerName === '' ? undefined : providerName,
      cancelPendingTools: this.cancelPendingTools.bind(this),
      setTaskStateAndPublishUpdate:
        this.setTaskStateAndPublishUpdate.bind(this),
    };
  }

  private handleToolCallConfirmationEvent(
    event: Extract<
      ServerGeminiStreamEvent,
      { type: typeof GeminiEventType.ToolCallConfirmation }
    >,
  ): void {
    logger.info(
      '[Task] Received tool call confirmation request from LLM:',
      event.value.request.callId,
    );
    this.pendingToolConfirmationDetails.set(
      event.value.request.callId,
      event.value.details,
    );
  }

  getAndClearCompletedTools(): CompletedToolCall[] {
    const tools = [...this.completedToolCalls];
    this.completedToolCalls = [];
    return tools;
  }

  addToolResponsesToHistory(completedTools: CompletedToolCall[]): void {
    logger.info(
      `[Task] Adding ${completedTools.length} tool responses to history without generating a new response.`,
    );
    const responsesToAdd = completedTools.flatMap(
      (toolCall) => toolCall.response.responseParts,
    );

    for (const response of responsesToAdd) {
      const parts = normalizeResponseToGenAiParts(response);
      void this.agentClient.addHistory({
        role: 'user',
        parts,
      });
    }
  }

  async *sendCompletedToolsToLlm(
    completedToolCalls: CompletedToolCall[],
    aborted: AbortSignal,
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    if (completedToolCalls.length === 0) {
      yield* (async function* () {})(); // Yield nothing
      return;
    }

    const llmParts = buildLlmPartsFromToolCalls(completedToolCalls);
    logger.info(
      `[Task] Feeding ${completedToolCalls.length} tool responses to LLM.`,
    );
    for (const completedToolCall of completedToolCalls) {
      logger.info(
        `[Task] Adding tool response for "${completedToolCall.request.name}" (callId: ${completedToolCall.request.callId}) to LLM input.`,
      );
    }

    logger.info('[Task] Sending new parts to agent.');
    const stateChange: StateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };
    // Set task state to working as we are about to call LLM
    this.setTaskStateAndPublishUpdate('working', stateChange);
    yield* this.agentClient.sendMessageStream(
      llmParts,
      aborted,
      completedToolCalls[0]?.request.prompt_id ?? '',
    );
  }

  async *acceptUserMessage(
    requestContext: RequestContext,
    aborted: AbortSignal,
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    const userMessage = requestContext.userMessage;
    const llmParts: PartUnion[] = [];
    let anyConfirmationHandled = false;
    let hasContentForLlm = false;

    for (const part of userMessage.parts) {
      const confirmationHandled = await handleToolConfirmationPart(part, {
        pendingToolConfirmationDetails: this.pendingToolConfirmationDetails,
        skipFinalTrueAfterInlineEdit: this.skipFinalTrueAfterInlineEdit,
        taskState: this.taskState,
        resolveToolCall: this._resolveToolCall.bind(this),
        createTextMessage: (text: string) =>
          createTextMessage(text, this.id, this.contextId),
        createStatusUpdateEvent: this._createStatusUpdateEvent.bind(this),
        eventBus: this.eventBus,
      });
      if (confirmationHandled) {
        anyConfirmationHandled = true;
        // If a confirmation was handled, the scheduler will now run the tool (or cancel it).
        // We don't send anything to the LLM for this part.
        // The subsequent tool execution will eventually lead to resolveToolCall.
        continue;
      }

      if (part.kind === 'text') {
        llmParts.push({ text: part.text });
        hasContentForLlm = true;
      }
    }

    if (hasContentForLlm) {
      this.currentPromptId =
        this.config.getSessionId() + '########' + this.promptCount++;
      logger.info('[Task] Sending new parts to LLM.');
      const stateChange: StateChange = {
        kind: CoderAgentEvent.StateChangeEvent,
      };
      // Set task state to working as we are about to call LLM
      this.setTaskStateAndPublishUpdate('working', stateChange);
      yield* this.agentClient.sendMessageStream(
        llmParts,
        aborted,
        this.currentPromptId,
      );
    } else if (anyConfirmationHandled) {
      logger.info(
        '[Task] User message only contained tool confirmations. Scheduler is active. No new input for LLM this turn.',
      );
      // Ensure task state reflects that scheduler might be working due to confirmation.
      // If scheduler is active, it will emit its own status updates.
      // If all pending tools were just confirmed, waitForPendingTools will handle the wait.
      // If some tools are still pending approval, scheduler would have set InputRequired.
      // If not, and no new text, we are just waiting.
      if (
        this.pendingToolCalls.size > 0 &&
        this.taskState !== 'input-required'
      ) {
        const stateChange: StateChange = {
          kind: CoderAgentEvent.StateChangeEvent,
        };
        this.setTaskStateAndPublishUpdate('working', stateChange); // Reflect potential background activity
      }
      yield* (async function* () {})(); // Yield nothing
    } else {
      logger.info(
        '[Task] No relevant parts in user message for LLM interaction or tool confirmation.',
      );
      // If there's no new text and no confirmations, and no pending tools,
      // it implies we might need to signal input required if nothing else is happening.
      // However, the agent.ts will make this determination after waitForPendingTools.
      yield* (async function* () {})(); // Yield nothing
    }
  }

  _sendTextContent(content: string, traceId?: string): void {
    if (content === '') {
      return;
    }
    logger.info('[Task] Sending text content to event bus.');
    this.publishContentMessage(
      createTextMessage(content, this.id, this.contextId),
      { kind: CoderAgentEvent.TextContentEvent },
      traceId,
    );
  }

  _sendThought(content: ThoughtSummary, traceId?: string): void {
    if (!content.subject && !content.description) {
      return;
    }
    logger.info('[Task] Sending thought to event bus.');
    this.publishContentMessage(
      createDataMessage(content, this.id, this.contextId),
      { kind: CoderAgentEvent.ThoughtEvent },
      traceId,
    );
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
