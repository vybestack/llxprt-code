/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GeminiClient,
  GeminiEventType,
  ToolConfirmationOutcome,
  ApprovalMode,
  getAllMCPServerStatuses,
  MCPServerStatus,
  isNodeError,
  createAgentRuntimeState,
  DEFAULT_GUI_EDITOR,
  EDIT_TOOL_NAMES,
  processRestorableToolCalls,
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
  CoreToolScheduler,
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
import * as fs from 'node:fs';

import { CoderAgentEvent } from '../types.js';
import type {
  CoderAgentMessage,
  StateChange,
  TextContent,
  TaskMetadata,
  Thought,
  ThoughtSummary,
} from '../types.js';
import type { PartUnion, Part as genAiPart } from '@google/genai';
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
  writeCheckpointsAndUpdateRequests,
  applyReplacement,
  convertAnsiOutputToString,
  createTextMessage,
  createDataMessage,
} from './task-support.js';

export class Task {
  id: string;
  contextId: string;
  scheduler: CoreToolScheduler | null;
  config: Config;
  geminiClient: GeminiClient;
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

  // For tool waiting logic
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
      // getModel() returns string (non-null), so no nullish coalescing needed
      model: this.config.getModel() || contentConfig?.model || 'gemini-pro',
      proxyUrl: this.config.getProxy(),
      sessionId: this.config.getSessionId(),
    });
    this.geminiClient = new GeminiClient(this.config, runtimeState);
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
    const toolRegistry = this.config.getToolRegistry();
    const mcpServers = this.config.getMcpServers() || {};
    const serverStatuses = getAllMCPServerStatuses();
    const servers = Object.keys(mcpServers).map((serverName) => ({
      name: serverName,
      status: serverStatuses.get(serverName) ?? MCPServerStatus.DISCONNECTED,
      tools: toolRegistry.getToolsByServer(serverName).map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameterSchema: tool.schema.parameters,
      })),
    }));

    const availableTools = toolRegistry.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameterSchema: tool.schema.parameters,
    }));

    const metadata: TaskMetadata = {
      id: this.id,
      contextId: this.contextId,
      taskState: this.taskState,
      model:
        this.modelInfo?.model ||
        this.config.getContentGeneratorConfig()?.model ||
        'unknown',
      mcpServers: servers,
      availableTools,
    };
    return metadata;
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
      model: this.modelInfo?.model || this.config.getModel(),
      userTier: this.geminiClient.getUserTier(),
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
        timestamp: timestamp || new Date().toISOString(),
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

    // Update state and send continuous, non-final updates
    toolCalls.forEach((tc) => {
      const previousStatus = this.pendingToolCalls.get(tc.request.callId);
      const hasChanged = previousStatus !== tc.status;

      // Resolve tool call if it has reached a terminal state
      if (['success', 'error', 'cancelled'].includes(tc.status)) {
        this._resolveToolCall(tc.request.callId);
      } else {
        // This will update the map
        this._registerToolCall(tc.request.callId, tc.status);
      }

      // When status is 'awaiting_approval', tc is narrowed to WaitingToolCall which always has confirmationDetails.
      if (tc.status === 'awaiting_approval') {
        this.pendingToolConfirmationDetails.set(
          tc.request.callId,
          tc.confirmationDetails,
        );
      }

      // Only send an update if the status has actually changed.
      if (hasChanged) {
        const message = createToolStatusMessage(tc, this.id, this.contextId);
        const coderAgentMessage: CoderAgentMessage =
          tc.status === 'awaiting_approval'
            ? { kind: CoderAgentEvent.ToolCallConfirmationEvent }
            : { kind: CoderAgentEvent.ToolCallUpdateEvent };

        const event = this._createStatusUpdateEvent(
          this.taskState,
          coderAgentMessage,
          message,
          false, // Always false for these continuous updates
        );
        this.eventBus?.publish(event);
      }
    });

    if (
      this.autoExecute ||
      this.config.getApprovalMode() === ApprovalMode.YOLO
    ) {
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
      return;
    }

    const allPendingStatuses = Array.from(this.pendingToolCalls.values());
    const isAwaitingApproval = allPendingStatuses.some(
      (status) => status === 'awaiting_approval',
    );
    const allPendingAreStable = allPendingStatuses.every(
      (status) =>
        status === 'awaiting_approval' ||
        status === 'success' ||
        status === 'error' ||
        status === 'cancelled',
    );

    // 1. Are any pending tool calls awaiting_approval
    // 2. Are all pending tool calls in a stable state (i.e. not in validing or executing)
    // 3. After an inline edit, the edited tool call will send awaiting_approval THEN scheduled. We wait for the next update in this case.
    if (
      isAwaitingApproval &&
      allPendingAreStable &&
      !this.skipFinalTrueAfterInlineEdit.value
    ) {
      // We don't need to send another message, just a final status update.
      this.setTaskStateAndPublishUpdate(
        'input-required',
        { kind: CoderAgentEvent.StateChangeEvent },
        undefined,
        undefined,
        /*final*/ true,
      );
    }
  }

  private async createScheduler(): Promise<CoreToolScheduler> {
    const sessionId = this.config.getSessionId();
    if (!sessionId) {
      throw new Error('Scheduler sessionId is required');
    }
    return (
      this.config as Config & {
        getOrCreateScheduler(
          sessionId: string,
          callbacks: {
            outputUpdateHandler: (toolCallId: string, chunk: string) => void;
            onAllToolCallsComplete: (
              completedToolCalls: CompletedToolCall[],
            ) => Promise<void>;
            onToolCallsUpdate: (toolCalls: ToolCall[]) => void;
            getPreferredEditor: () => typeof DEFAULT_GUI_EDITOR;
            onEditorClose: () => void;
          },
          options?: Record<string, unknown>,
          dependencies?: { messageBus?: MessageBus },
        ): Promise<CoreToolScheduler>;
      }
    ).getOrCreateScheduler(
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
    try {
      const currentContent = fs.readFileSync(file_path, 'utf8');
      return applyReplacement(
        currentContent,
        old_string,
        new_string,
        old_string === '' && currentContent === '',
      );
    } catch (err) {
      if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
      return '';
    }
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

    await this._createCheckpointsForRestorableTools(updatedRequests);

    if (!this.scheduler) {
      throw new Error('Scheduler not initialized');
    }
    await this.scheduler.schedule(updatedRequests, abortSignal);
  }

  private async _createCheckpointsForRestorableTools(
    updatedRequests: ToolCallRequestInfo[],
  ): Promise<void> {
    if (!this.config.getCheckpointingEnabled()) {
      return;
    }

    try {
      const restorableRequests = updatedRequests.filter((r) =>
        EDIT_TOOL_NAMES.has(r.name),
      );

      if (restorableRequests.length === 0) {
        return;
      }

      logger.info(
        `[Task] Creating checkpoints for ${restorableRequests.length} restorable tool calls.`,
      );

      const gitService = await this.config.getGitService();
      const { checkpointsToWrite, toolCallToCheckpointMap, errors } =
        await processRestorableToolCalls(
          restorableRequests,
          gitService,
          this.geminiClient,
        );

      if (errors.length > 0) {
        logger.warn(
          `[Task] Checkpoint creation had ${errors.length} errors: ${errors.join(', ')}`,
        );
      }

      if (checkpointsToWrite.size > 0) {
        const checkpointDir =
          this.config.storage.getProjectTempCheckpointsDir();
        await writeCheckpointsAndUpdateRequests(
          checkpointsToWrite,
          checkpointDir,
          toolCallToCheckpointMap,
          updatedRequests,
        );
      }
    } catch (checkpointError) {
      logger.warn(
        `[Task] Checkpoint creation failed, continuing with tool execution: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`,
      );
    }
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

    const stateChange: StateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };
    const traceId =
      'traceId' in event && typeof event.traceId === 'string'
        ? event.traceId
        : undefined;

    switch (event.type) {
      case GeminiEventType.Content:
        logger.info('[Task] Sending agent message content...');
        this._sendTextContent(event.value, traceId);
        break;
      case GeminiEventType.ToolCallConfirmation:
        // This is when LLM requests confirmation, not when user provides it.
        logger.info(
          '[Task] Received tool call confirmation request from LLM:',
          event.value.request.callId,
        );
        this.pendingToolConfirmationDetails.set(
          event.value.request.callId,
          event.value.details,
        );
        // This will be handled by the scheduler and _schedulerToolCallsUpdate will set InputRequired if needed.
        // No direct state change here, scheduler drives it.
        break;
      case GeminiEventType.UserCancelled:
        handleUserCancelled(
          {
            taskState: this.taskState,
            cancelPendingTools: this.cancelPendingTools.bind(this),
            setTaskStateAndPublishUpdate:
              this.setTaskStateAndPublishUpdate.bind(this),
          },
          stateChange,
          traceId,
        );
        break;
      case GeminiEventType.StreamIdleTimeout:
        handleStreamIdleTimeout(
          event,
          {
            taskState: this.taskState,
            cancelPendingTools: this.cancelPendingTools.bind(this),
            setTaskStateAndPublishUpdate:
              this.setTaskStateAndPublishUpdate.bind(this),
          },
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
        handleInvalidStream(
          {
            taskState: this.taskState,
            cancelPendingTools: this.cancelPendingTools.bind(this),
            setTaskStateAndPublishUpdate:
              this.setTaskStateAndPublishUpdate.bind(this),
          },
          stateChange,
          traceId,
        );
        break;
      case GeminiEventType.Error:
        handleStreamError(
          event,
          {
            taskState: this.taskState,
            cancelPendingTools: this.cancelPendingTools.bind(this),
            setTaskStateAndPublishUpdate:
              this.setTaskStateAndPublishUpdate.bind(this),
          },
          stateChange,
          traceId,
        );
        break;
      default: {
        // Exhaustiveness check: after early-return for informational events,
        // all remaining cases are state-changing and should be handled above.
        const _exhaustiveCheck: never = event;
        throw new Error(
          `Unknown event type: ${JSON.stringify(_exhaustiveCheck)}`,
        );
      }
    }
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
      let parts: genAiPart[];
      if (Array.isArray(response)) {
        parts = response;
      } else if (typeof response === 'string') {
        parts = [{ text: response }];
      } else {
        parts = [response];
      }
      void this.geminiClient.addHistory({
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

    const llmParts: PartUnion[] = [];
    logger.info(
      `[Task] Feeding ${completedToolCalls.length} tool responses to LLM.`,
    );
    for (const completedToolCall of completedToolCalls) {
      logger.info(
        `[Task] Adding tool response for "${completedToolCall.request.name}" (callId: ${completedToolCall.request.callId}) to LLM input.`,
      );
      const responseParts = completedToolCall.response.responseParts;
      if (Array.isArray(responseParts)) {
        llmParts.push(...responseParts);
      } else {
        llmParts.push(responseParts);
      }
    }

    logger.info('[Task] Sending new parts to agent.');
    const stateChange: StateChange = {
      kind: CoderAgentEvent.StateChangeEvent,
    };
    // Set task state to working as we are about to call LLM
    this.setTaskStateAndPublishUpdate('working', stateChange);
    yield* this.geminiClient.sendMessageStream(
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
      yield* this.geminiClient.sendMessageStream(
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
    const message = createTextMessage(content, this.id, this.contextId);
    const textContent: TextContent = {
      kind: CoderAgentEvent.TextContentEvent,
    };
    this.eventBus?.publish(
      this._createStatusUpdateEvent(
        this.taskState,
        textContent,
        message,
        false,
        undefined,
        undefined,
        traceId,
      ),
    );
  }

  _sendThought(content: ThoughtSummary, traceId?: string): void {
    if (!content.subject && !content.description) {
      return;
    }
    logger.info('[Task] Sending thought to event bus.');
    const message = createDataMessage(content, this.id, this.contextId);
    const thought: Thought = {
      kind: CoderAgentEvent.ThoughtEvent,
    };
    this.eventBus?.publish(
      this._createStatusUpdateEvent(
        this.taskState,
        thought,
        message,
        false,
        undefined,
        undefined,
        traceId,
      ),
    );
  }
}
