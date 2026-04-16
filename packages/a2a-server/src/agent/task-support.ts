/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Support module for task.ts containing pure helper functions and
 * informational event handling logic extracted to reduce module size.
 */

import {
  GeminiEventType,
  ToolConfirmationOutcome,
  parseAndFormatApiError,
  DEFAULT_AGENT_ID,
  type ServerGeminiStreamEvent,
  type ToolConfirmationPayload,
  type ToolCallRequestInfo,
  type ToolCallConfirmationDetails,
  type SerializableConfirmationDetails,
  type ToolCall,
  type AnyDeclarativeTool,
} from '@vybestack/llxprt-code-core';
import type { ExecutionEventBus } from '@a2a-js/sdk/server';
import type {
  TaskStatusUpdateEvent,
  TaskState,
  Part,
  Message,
} from '@a2a-js/sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { CoderAgentEvent } from '../types.js';
import type {
  CoderAgentMessage,
  StateChange,
  ToolCallUpdate,
} from '../types.js';

/**
 * Type utility for extracting union keys.
 */
export type UnionKeys<T> = T extends T ? keyof T : never;

/**
 * Pick specified fields from an object, returning a partial with only those fields.
 * Used for creating serializable versions of objects that may contain methods or circular references.
 */
export function pickFields<
  T extends ToolCall | AnyDeclarativeTool,
  K extends UnionKeys<T>,
>(from: T, ...fields: K[]): Partial<T> {
  const ret = {} as Pick<T, K>;
  for (const field of fields) {
    if (field in from) {
      ret[field] = from[field];
    }
  }
  return ret as Partial<T>;
}

/**
 * Creates a serializable tool status message for event bus publication.
 * Extracts only the necessary fields from a ToolCall to avoid circular references.
 */
export function createToolStatusMessage(
  tc: ToolCall,
  taskId: string,
  contextId: string,
): Message {
  const messageParts: Part[] = [];

  // Create a serializable version of the ToolCall (pick necessary
  // properties/avoid methods causing circular reference errors)
  const serializableToolCall: Partial<ToolCall> = pickFields(
    tc,
    'request',
    'status',
    'confirmationDetails',
    'liveOutput',
    'response',
  );

  if (tc.tool) {
    serializableToolCall.tool = pickFields(
      tc.tool,
      'name',
      'displayName',
      'description',
      'kind',
      'isOutputMarkdown',
      'canUpdateOutput',
      'schema',
      'parameterSchema',
    ) as AnyDeclarativeTool;
  }

  messageParts.push({
    kind: 'data',
    data: serializableToolCall,
  } as Part);

  return {
    kind: 'message',
    role: 'agent',
    parts: messageParts,
    messageId: uuidv4(),
    taskId,
    contextId,
  };
}

// Informational event type Sets (module-level to avoid rebuilding on each call)
const LOG_WARN_TYPES: ReadonlySet<GeminiEventType> = new Set([
  GeminiEventType.ToolCallRequest,
  GeminiEventType.MaxSessionTurns,
  GeminiEventType.LoopDetected,
  GeminiEventType.ContextWindowWillOverflow,
]);

const LOG_INFO_TYPES: ReadonlySet<GeminiEventType> = new Set([
  GeminiEventType.ToolCallResponse,
  GeminiEventType.Finished,
  GeminiEventType.Retry,
  GeminiEventType.SystemNotice,
  GeminiEventType.AgentExecutionStopped,
  GeminiEventType.AgentExecutionBlocked,
]);

const SILENT_TYPES: ReadonlySet<GeminiEventType> = new Set([
  GeminiEventType.ChatCompressed,
  GeminiEventType.UsageMetadata,
  GeminiEventType.Citation,
]);

// Union of all informational event types for type narrowing
const INFORMATIONAL_TYPES: ReadonlySet<GeminiEventType> = new Set([
  ...LOG_WARN_TYPES,
  ...LOG_INFO_TYPES,
  ...SILENT_TYPES,
]);

/**
 * Type alias for informational/log-only events that don't affect task state.
 * These events are logged (or silent) and should be handled early to reduce complexity.
 */
export type InformationalGeminiStreamEvent = Extract<
  ServerGeminiStreamEvent,
  {
    type:
      | GeminiEventType.ToolCallRequest
      | GeminiEventType.MaxSessionTurns
      | GeminiEventType.LoopDetected
      | GeminiEventType.ContextWindowWillOverflow
      | GeminiEventType.ToolCallResponse
      | GeminiEventType.Finished
      | GeminiEventType.Retry
      | GeminiEventType.SystemNotice
      | GeminiEventType.AgentExecutionStopped
      | GeminiEventType.AgentExecutionBlocked
      | GeminiEventType.ChatCompressed
      | GeminiEventType.UsageMetadata
      | GeminiEventType.Citation;
  }
>;

/**
 * Type guard to check if an event is informational (log-only or silent).
 * These events don't affect task state and are handled early to reduce branching complexity.
 */
export function isInformationalAgentEvent(
  event: ServerGeminiStreamEvent,
): event is InformationalGeminiStreamEvent {
  return INFORMATIONAL_TYPES.has(event.type);
}

/**
 * Returns the set of event types that should be logged at warn level.
 */
export function getLogWarnTypes(): ReadonlySet<GeminiEventType> {
  return LOG_WARN_TYPES;
}

/**
 * Returns the set of event types that should be logged at info level.
 */
export function getLogInfoTypes(): ReadonlySet<GeminiEventType> {
  return LOG_INFO_TYPES;
}

// Flat dispatch for informational events: logs and returns whether handled
export function logInformationalEvent(
  type: GeminiEventType,
  event: InformationalGeminiStreamEvent,
  taskId: string,
): void {
  if (type === GeminiEventType.ToolCallRequest) {
    logger.warn(
      '[Task] A single tool call request was passed to acceptAgentMessage. This should be handled in a batch by the agent. Ignoring.',
    );
  } else if (type === GeminiEventType.MaxSessionTurns) {
    logger.warn('[Task] Max session turns reached.');
  } else if (type === GeminiEventType.LoopDetected) {
    logger.warn('[Task] Loop detected in agent execution.');
  } else if (type === GeminiEventType.ContextWindowWillOverflow) {
    logger.warn('[Task] Context window will overflow event received.');
  } else if (type === GeminiEventType.ToolCallResponse) {
    // Type narrow to ToolCallResponse event which has the value property
    const responseEvent = event as Extract<
      InformationalGeminiStreamEvent,
      { type: GeminiEventType.ToolCallResponse }
    >;
    logger.info(
      '[Task] Received tool call response from LLM (part of generation):',
      responseEvent.value,
    );
  } else if (type === GeminiEventType.Finished) {
    logger.info(`[Task ${taskId}] Agent finished its turn.`);
  } else if (type === GeminiEventType.Retry) {
    logger.info('[Task] Retry event received from LLM stream.');
  } else if (type === GeminiEventType.SystemNotice) {
    logger.info('[Task] System notice received from LLM stream.');
  } else if (type === GeminiEventType.AgentExecutionStopped) {
    logger.info('[Task] Agent execution stopped event received.');
  } else if (type === GeminiEventType.AgentExecutionBlocked) {
    logger.info('[Task] Agent execution blocked event received.');
  }
  // ChatCompressed, UsageMetadata, Citation are silent - no logging
}

/**
 * Type guard to check if confirmation details are interactive (have onConfirm callback).
 */
export function isInteractiveConfirmationDetails(
  details: ToolCallConfirmationDetails | SerializableConfirmationDetails,
): details is ToolCallConfirmationDetails {
  return 'onConfirm' in details;
}

/**
 * Maps an outcome string from a tool confirmation part to the corresponding
 * ToolConfirmationOutcome enum value. Returns undefined for unknown outcomes.
 */
export function mapOutcomeStringToEnum(
  outcomeString: string,
): ToolConfirmationOutcome | undefined {
  switch (outcomeString) {
    case 'proceed_once':
      return ToolConfirmationOutcome.ProceedOnce;
    case 'cancel':
      return ToolConfirmationOutcome.Cancel;
    case 'proceed_always':
      return ToolConfirmationOutcome.ProceedAlways;
    case 'proceed_always_server':
      return ToolConfirmationOutcome.ProceedAlwaysServer;
    case 'proceed_always_tool':
      return ToolConfirmationOutcome.ProceedAlwaysTool;
    case 'modify_with_editor':
      return ToolConfirmationOutcome.ModifyWithEditor;
    case 'suggest_edit':
      return ToolConfirmationOutcome.SuggestEdit;
    default:
      return undefined;
  }
}

/**
 * Extracts tool confirmation payload data from a part.
 * Returns undefined if neither newContent nor editedCommand is present.
 */
export function buildToolConfirmationPayload(
  partData: Record<string, unknown>,
): ToolConfirmationPayload | undefined {
  const newContent =
    typeof partData['newContent'] === 'string'
      ? partData['newContent']
      : undefined;
  const editedCommand =
    typeof partData['editedCommand'] === 'string'
      ? partData['editedCommand']
      : undefined;

  if (newContent === undefined && editedCommand === undefined) {
    return undefined;
  }
  return { newContent, editedCommand };
}

/**
 * Interface for Task methods needed by handleToolConfirmationError.
 * Extracted to avoid circular dependency on Task class.
 */
export interface TaskErrorContext {
  taskState: TaskState;
  resolveToolCall: (id: string) => void;
  createTextMessage: (text: string) => Message;
  createStatusUpdateEvent: (
    state: TaskState,
    message: CoderAgentMessage,
    msg: Message,
    final: boolean,
  ) => TaskStatusUpdateEvent;
  eventBus?: ExecutionEventBus;
}

/**
 * Interface for Task methods needed by handleToolConfirmationPart.
 * Extracted to avoid circular dependency on Task class.
 */
export interface ToolConfirmationContext {
  pendingToolConfirmationDetails: Map<
    string,
    ToolCallConfirmationDetails | SerializableConfirmationDetails
  >;
  skipFinalTrueAfterInlineEdit: { value: boolean };
  taskState: TaskState;
  resolveToolCall: (id: string) => void;
  createTextMessage: (text: string) => Message;
  createStatusUpdateEvent: (
    state: TaskState,
    message: CoderAgentMessage,
    msg: Message,
    final: boolean,
  ) => TaskStatusUpdateEvent;
  eventBus?: ExecutionEventBus;
}

/**
 * Handles error scenarios during tool confirmation processing.
 * Logs the error, resolves the tool call, and publishes an error event.
 */
export function handleToolConfirmationError(
  callId: string,
  error: unknown,
  context: TaskErrorContext,
): void {
  logger.error(
    `[Task] Error during tool confirmation for callId ${callId}:`,
    error,
  );
  context.resolveToolCall(callId);
  const errorMessageText =
    error instanceof Error
      ? error.message
      : `Error processing tool confirmation for ${callId}`;
  const message = context.createTextMessage(errorMessageText);
  const toolCallUpdate: ToolCallUpdate = {
    kind: CoderAgentEvent.ToolCallUpdateEvent,
  };
  const event = context.createStatusUpdateEvent(
    context.taskState,
    toolCallUpdate,
    message,
    false,
  );
  context.eventBus?.publish(event);
}

/**
 * Handles tool confirmation parts from user messages.
 * Returns true if the part was a valid tool confirmation that was processed,
 * false otherwise.
 *
 * Context must provide:
 * - pendingToolConfirmationDetails: Map of pending confirmations
 * - skipFinalTrueAfterInlineEdit: Mutable flag for inline edit behavior
 * - taskState: Current task state
 * - resolveToolCall: Callback to resolve tool calls
 * - createTextMessage: Factory for text messages
 * - createStatusUpdateEvent: Factory for status events
 * - eventBus: Optional event bus for publishing
 */
export async function handleToolConfirmationPart(
  part: Part,
  context: ToolConfirmationContext,
): Promise<boolean> {
  // For DataPart (kind: 'data'), the data property is always defined and non-null.
  // The part.kind !== 'data' check handles the discriminator, after which part.data is guaranteed.
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

  if (!confirmationOutcome) {
    logger.warn(
      `[Task] Unknown tool confirmation outcome: "${outcomeString}" for callId: ${callId}`,
    );
    return false;
  }

  const confirmationDetails =
    context.pendingToolConfirmationDetails.get(callId);

  if (!confirmationDetails) {
    logger.warn(
      `[Task] Received tool confirmation for unknown or already processed callId: ${callId}`,
    );
    return false;
  }

  logger.info(
    `[Task] Handling tool confirmation for callId: ${callId} with outcome: ${outcomeString}`,
  );

  if (!isInteractiveConfirmationDetails(confirmationDetails)) {
    logger.warn(
      `[Task] Received non-interactive confirmation details for callId: ${callId}`,
    );
    return false;
  }

  try {
    // Temporarily unset GCP environment variables so they do not leak into
    // tool calls.
    const gcpProject = process.env['GOOGLE_CLOUD_PROJECT'];
    const gcpCreds = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
    try {
      delete process.env['GOOGLE_CLOUD_PROJECT'];
      delete process.env['GOOGLE_APPLICATION_CREDENTIALS'];

      // This will trigger the scheduler to continue or cancel the specific tool.
      // The scheduler's onToolCallsUpdate will then reflect the new state (e.g., executing or cancelled).

      const payload = buildToolConfirmationPayload(part.data);
      const hasPayload = payload !== undefined;

      // Preserve existing inline-edit behavior: final event should be emitted
      // only after the follow-up confirmation completes.
      // Use hasPayload to cover both newContent and editedCommand cases.
      if (confirmationDetails.type === 'edit') {
        context.skipFinalTrueAfterInlineEdit.value = hasPayload;
        try {
          await confirmationDetails.onConfirm(
            confirmationOutcome,
            hasPayload ? payload : undefined,
          );
        } finally {
          // Once confirmationDetails.onConfirm finishes (or fails) with a payload,
          // reset skipFinalTrueAfterInlineEdit so that external callers receive
          // their call has been completed.
          context.skipFinalTrueAfterInlineEdit.value = false;
        }
      } else {
        await confirmationDetails.onConfirm(
          confirmationOutcome,
          hasPayload ? payload : undefined,
        );
      }
    } finally {
      if (gcpProject) {
        process.env['GOOGLE_CLOUD_PROJECT'] = gcpProject;
      }
      if (gcpCreds) {
        process.env['GOOGLE_APPLICATION_CREDENTIALS'] = gcpCreds;
      }
    }

    // Do not delete if modifying, a subsequent tool confirmation for the same
    // callId will be passed with ProceedOnce/Cancel/etc
    // Note !== ToolConfirmationOutcome.ModifyWithEditor does not work!
    if (confirmationOutcome !== 'modify_with_editor') {
      context.pendingToolConfirmationDetails.delete(callId);
    }

    // If outcome is Cancel, scheduler should update status to 'cancelled', which then resolves the tool.
    // If ProceedOnce, scheduler updates to 'executing', then eventually 'success'/'error', which resolves.
    return true;
  } catch (error) {
    handleToolConfirmationError(callId, error, {
      taskState: context.taskState,
      resolveToolCall: context.resolveToolCall,
      createTextMessage: context.createTextMessage,
      createStatusUpdateEvent: context.createStatusUpdateEvent,
      eventBus: context.eventBus,
    });
    return false;
  }
}

/**
 * Interface for Task methods needed by stream event handlers.
 * Extracted to avoid circular dependency on Task class.
 */
export interface TaskStreamContext {
  taskState: TaskState;
  cancelPendingTools: (reason: string) => void;
  setTaskStateAndPublishUpdate: (
    state: TaskState,
    msg: CoderAgentMessage,
    text: string | undefined,
    parts: Part[] | undefined,
    final: boolean,
    error?: string,
    traceId?: string,
  ) => void;
}

/**
 * Handles stream idle timeout events by cancelling pending tools
 * and publishing an input-required state update.
 */
export function handleStreamIdleTimeout(
  event: ServerGeminiStreamEvent & {
    type: typeof GeminiEventType.StreamIdleTimeout;
  },
  context: TaskStreamContext,
  stateChange: StateChange,
  traceId?: string,
): void {
  const timeoutMessage =
    event.value.error.message ||
    'Stream idle timeout: no response received within the allowed time.';
  logger.warn(
    '[Task] Received stream idle timeout event from LLM stream:',
    timeoutMessage,
  );
  context.cancelPendingTools(`LLM stream idle timeout: ${timeoutMessage}`);
  context.setTaskStateAndPublishUpdate(
    'input-required',
    stateChange,
    'Task timed out waiting for model response.',
    undefined,
    true,
    parseAndFormatApiError(event.value.error),
    traceId,
  );
}

/**
 * Handles invalid stream events by cancelling pending tools
 * and publishing an error status update.
 */
export function handleInvalidStream(
  context: TaskStreamContext,
  stateChange: StateChange,
  traceId?: string,
): void {
  const invalidStreamMessage = 'Invalid stream event received from LLM stream.';
  logger.error(
    '[Task] Received error event from LLM stream:',
    invalidStreamMessage,
  );
  context.cancelPendingTools(`LLM stream error: ${invalidStreamMessage}`);
  context.setTaskStateAndPublishUpdate(
    context.taskState,
    stateChange,
    `Agent Error, unknown agent message: ${invalidStreamMessage}`,
    undefined,
    false,
    invalidStreamMessage,
    traceId,
  );
}

/**
 * Handles LLM stream error events by cancelling pending tools
 * and publishing an error status update.
 */
export function handleStreamError(
  event: ServerGeminiStreamEvent & { type: typeof GeminiEventType.Error },
  context: TaskStreamContext,
  stateChange: StateChange,
  traceId?: string,
): void {
  const errorMessage =
    event.value.error.message ?? 'Unknown error from LLM stream';
  logger.error('[Task] Received error event from LLM stream:', errorMessage);
  const errMessage = parseAndFormatApiError(event.value.error);
  context.cancelPendingTools(`LLM stream error: ${errorMessage}`);
  context.setTaskStateAndPublishUpdate(
    context.taskState,
    stateChange,
    `Agent Error, unknown agent message: ${errorMessage}`,
    undefined,
    false,
    errMessage,
    traceId,
  );
}

/**
 * Handles user cancelled events by cancelling pending tools
 * and publishing an input-required state update.
 */
export function handleUserCancelled(
  context: TaskStreamContext,
  stateChange: StateChange,
  traceId?: string,
): void {
  logger.info('[Task] Received user cancelled event from LLM stream.');
  context.cancelPendingTools('User cancelled via LLM stream event');
  context.setTaskStateAndPublishUpdate(
    'input-required',
    stateChange,
    'Task cancelled by user',
    undefined,
    true,
    undefined,
    traceId,
  );
}

/**
 * Normalizes a tool call request with default agentId and computes newContent
 * for 'replace' tool calls that don't already have newContent set.
 */
export async function normalizeToolCallRequest(
  request: ToolCallRequestInfo,
  getProposedContent: (
    filePath: string,
    oldString: string,
    newString: string,
  ) => Promise<string>,
): Promise<ToolCallRequestInfo> {
  const normalizedRequest: ToolCallRequestInfo = {
    ...request,
    agentId: request.agentId ?? DEFAULT_AGENT_ID,
  };

  if (
    normalizedRequest.name === 'replace' &&
    !normalizedRequest.args['newContent'] &&
    normalizedRequest.args['file_path'] &&
    normalizedRequest.args['old_string'] &&
    normalizedRequest.args['new_string']
  ) {
    const newContent = await getProposedContent(
      normalizedRequest.args['file_path'] as string,
      normalizedRequest.args['old_string'] as string,
      normalizedRequest.args['new_string'] as string,
    );
    return {
      ...normalizedRequest,
      args: { ...normalizedRequest.args, newContent },
    };
  }
  return normalizedRequest;
}

/**
 * Extracts helper for writing checkpoint files and updating request checkpoints.
 */
export async function writeCheckpointsAndUpdateRequests(
  checkpointsToWrite: Map<string, string>,
  checkpointDir: string,
  toolCallToCheckpointMap: Map<string, string>,
  updatedRequests: ToolCallRequestInfo[],
): Promise<void> {
  await fs.promises.mkdir(checkpointDir, { recursive: true });

  for (const [filename, content] of checkpointsToWrite.entries()) {
    const checkpointPath = path.join(checkpointDir, filename);
    const tmpPath = `${checkpointPath}.tmp`;

    try {
      await fs.promises.writeFile(tmpPath, content, 'utf8');
      await fs.promises.rename(tmpPath, checkpointPath);

      const checkpointKey = filename.replace(/\.json$/, '');
      const callId = Array.from(toolCallToCheckpointMap.entries()).find(
        ([, fname]) => fname === checkpointKey,
      )?.[0];

      if (callId) {
        const request = updatedRequests.find((req) => req.callId === callId);
        if (request) {
          request.checkpoint = checkpointPath;
          logger.info(
            `[Task] Checkpoint created for callId ${callId}: ${checkpointPath}`,
          );
        }
      }
    } catch (writeError) {
      logger.warn(
        `[Task] Failed to write checkpoint ${filename}: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
      );
    }
  }
}

/**
 * Applies a string replacement to content.
 * Pure helper function used by getProposedContent.
 */
export function applyReplacement(
  currentContent: string | null,
  oldString: string,
  newString: string,
  isNewFile: boolean,
): string {
  if (isNewFile) {
    return newString;
  }
  if (currentContent === null) {
    // Should not happen if not a new file, but defensively return empty or newString if oldString is also empty
    return oldString === '' ? newString : '';
  }
  // If oldString is empty, do not modify the content. At this point isNewFile is always false
  // due to the early return, so no need to check it again.
  if (oldString === '') {
    return currentContent;
  }
  return currentContent.replaceAll(oldString, newString);
}

/**
 * Converts AnsiOutput to string for A2A protocol.
 */
export function convertAnsiOutputToString(
  outputChunk: string | AnsiOutput,
): string {
  return typeof outputChunk === 'string'
    ? outputChunk
    : outputChunk
        .map((line) => line.map((token) => token.text).join(''))
        .join('\n');
}

// Import AnsiOutput type for convertAnsiOutputToString
import type { AnsiOutput } from '@vybestack/llxprt-code-core';

/**
 * Creates a text message for the event bus.
 */
export function createTextMessage(
  text: string,
  taskId: string,
  contextId: string,
  role: 'agent' | 'user' = 'agent',
): Message {
  return {
    kind: 'message',
    role,
    parts: [{ kind: 'text', text }],
    messageId: uuidv4(),
    taskId,
    contextId,
  };
}

/**
 * Creates a data message with arbitrary data payload.
 */
export function createDataMessage(
  data: unknown,
  taskId: string,
  contextId: string,
): Message {
  return {
    kind: 'message',
    role: 'agent',
    parts: [
      {
        kind: 'data',
        data,
      } as Part,
    ],
    messageId: uuidv4(),
    taskId,
    contextId,
  };
}
