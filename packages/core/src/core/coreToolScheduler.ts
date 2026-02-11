/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ToolCallRequestInfo,
  type ToolCallResponseInfo,
  ToolConfirmationOutcome,
  type ToolCallConfirmationDetails,
  type ToolResult,
  type ToolResultDisplay,
  ToolRegistry,
  ApprovalMode,
  type EditorType,
  Config,
  logToolCall,
  ToolCallEvent,
  type ToolConfirmationPayload,
  ToolErrorType,
  type AnyDeclarativeTool,
  type AnyToolInvocation,
  type ContextAwareTool,
  BaseToolInvocation,
} from '../index.js';
import { randomUUID } from 'node:crypto';
import {
  MessageBusType,
  type ToolConfirmationResponse,
} from '../confirmation-bus/types.js';
import { PolicyDecision } from '../policy/types.js';

interface QueuedRequest {
  request: ToolCallRequestInfo | ToolCallRequestInfo[];
  signal: AbortSignal;
  resolve: () => void;
  reject: (reason?: Error) => void;
}
import { DEFAULT_AGENT_ID } from './turn.js';
import {
  type Part,
  type PartListUnion,
  type FunctionCall,
} from '@google/genai';
import { getResponseTextFromParts } from '../utils/generateContentResponseUtilities.js';
import {
  isModifiableDeclarativeTool,
  type ModifyContext,
  modifyWithEditor,
} from '../tools/modifiable-tool.js';
import * as Diff from 'diff';
import levenshtein from 'fast-levenshtein';
import { doesToolInvocationMatch } from '../utils/tool-utils.js';
import {
  limitOutputTokens,
  DEFAULT_MAX_TOKENS,
  type ToolOutputSettingsProvider,
} from '../utils/toolOutputLimiter.js';
import { DebugLogger } from '../debug/index.js';
import { buildToolGovernance, isToolBlocked } from './toolGovernance.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
const toolSchedulerLogger = new DebugLogger('llxprt:core:tool-scheduler');

export type ValidatingToolCall = {
  status: 'validating';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ScheduledToolCall = {
  status: 'scheduled';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ErroredToolCall = {
  status: 'error';
  request: ToolCallRequestInfo;
  response: ToolCallResponseInfo;
  tool?: AnyDeclarativeTool;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type SuccessfulToolCall = {
  status: 'success';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  response: ToolCallResponseInfo;
  invocation: AnyToolInvocation;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ExecutingToolCall = {
  status: 'executing';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  liveOutput?: string | AnsiOutput;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
  pid?: number;
};

export type CancelledToolCall = {
  status: 'cancelled';
  request: ToolCallRequestInfo;
  response: ToolCallResponseInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type WaitingToolCall = {
  status: 'awaiting_approval';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  confirmationDetails: ToolCallConfirmationDetails;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

type PolicyContext = {
  toolName: string;
  args: Record<string, unknown>;
  serverName?: string;
};

export type Status = ToolCall['status'];

export type ToolCall =
  | ValidatingToolCall
  | ScheduledToolCall
  | ErroredToolCall
  | SuccessfulToolCall
  | ExecutingToolCall
  | CancelledToolCall
  | WaitingToolCall;

export type CompletedToolCall =
  | SuccessfulToolCall
  | CancelledToolCall
  | ErroredToolCall;

export type ConfirmHandler = (
  toolCall: WaitingToolCall,
) => Promise<ToolConfirmationOutcome>;

export type OutputUpdateHandler = (
  toolCallId: string,
  outputChunk: string | AnsiOutput,
) => void;

export type AllToolCallsCompleteHandler = (
  completedToolCalls: CompletedToolCall[],
) => Promise<void>;

export type ToolCallsUpdateHandler = (toolCalls: ToolCall[]) => void;

/**
 * Formats tool output for a Gemini FunctionResponse.
 */
function createFunctionResponsePart(
  callId: string,
  toolName: string,
  output: string,
): Part {
  return {
    functionResponse: {
      id: callId,
      name: toolName,
      response: { output },
    },
  };
}

function limitStringOutput(
  text: string,
  toolName: string,
  config?: ToolOutputSettingsProvider,
): string {
  if (!config || typeof config.getEphemeralSettings !== 'function') {
    return text;
  }
  const limited = limitOutputTokens(text, config, toolName);
  if (!limited.wasTruncated) {
    return limited.content;
  }
  if (limited.content && limited.content.length > 0) {
    return limited.content;
  }
  return limited.message ?? '';
}

function limitFunctionResponsePart(
  part: Part,
  toolName: string,
  config?: ToolOutputSettingsProvider,
): Part {
  if (!config || !part.functionResponse) {
    return part;
  }
  const response = part.functionResponse.response;
  if (!response || typeof response !== 'object') {
    return part;
  }
  const existingOutput = response['output'];
  if (typeof existingOutput !== 'string') {
    return part;
  }
  const limitedOutput = limitStringOutput(existingOutput, toolName, config);
  if (limitedOutput === existingOutput) {
    return part;
  }
  return {
    ...part,
    functionResponse: {
      ...part.functionResponse,
      response: {
        ...response,
        output: limitedOutput,
      },
    },
  };
}

export function convertToFunctionResponse(
  toolName: string,
  callId: string,
  llmContent: PartListUnion,
  config?: ToolOutputSettingsProvider,
): Part[] {
  const contentToProcess =
    Array.isArray(llmContent) && llmContent.length === 1
      ? llmContent[0]
      : llmContent;

  if (typeof contentToProcess === 'string') {
    const limitedOutput = limitStringOutput(contentToProcess, toolName, config);
    return [createFunctionResponsePart(callId, toolName, limitedOutput)];
  }

  if (Array.isArray(contentToProcess)) {
    // Check if any part already has a function response to avoid duplicates
    const hasFunctionResponse = contentToProcess.some(
      (part) => typeof part === 'object' && part.functionResponse,
    );

    if (hasFunctionResponse) {
      // Already has function response(s), return as-is without creating duplicates
      return toParts(contentToProcess).map((part) =>
        typeof part === 'object' && part.functionResponse
          ? limitFunctionResponsePart(part, toolName, config)
          : part,
      );
    }

    // No existing function response, create one
    const functionResponse = createFunctionResponsePart(
      callId,
      toolName,
      'Tool execution succeeded.',
    );
    return [functionResponse, ...toParts(contentToProcess)];
  }

  // After this point, contentToProcess is a single Part object.
  if (contentToProcess.functionResponse) {
    if (contentToProcess.functionResponse.response?.['content']) {
      const stringifiedOutput =
        getResponseTextFromParts(
          contentToProcess.functionResponse.response['content'] as Part[],
        ) || '';
      const limitedOutput = limitStringOutput(
        stringifiedOutput,
        toolName,
        config,
      );
      return [createFunctionResponsePart(callId, toolName, limitedOutput)];
    }
    // It's a functionResponse that we should pass through after enforcing limits.
    return [limitFunctionResponsePart(contentToProcess, toolName, config)];
  }

  if (contentToProcess.inlineData || contentToProcess.fileData) {
    const mimeType =
      contentToProcess.inlineData?.mimeType ||
      contentToProcess.fileData?.mimeType ||
      'unknown';
    const functionResponse = createFunctionResponsePart(
      callId,
      toolName,
      `Binary content of type ${mimeType} was processed.`,
    );
    return [functionResponse, contentToProcess];
  }

  if (contentToProcess.text !== undefined) {
    const limitedOutput = limitStringOutput(
      contentToProcess.text,
      toolName,
      config,
    );
    return [createFunctionResponsePart(callId, toolName, limitedOutput)];
  }

  // Default case for other kinds of parts.
  return [
    createFunctionResponsePart(callId, toolName, 'Tool execution succeeded.'),
  ];
}

function extractAgentIdFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata) {
    return undefined;
  }
  const candidate = metadata['agentId'];
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate;
  }
  return undefined;
}

function toParts(input: PartListUnion): Part[] {
  const parts: Part[] = [];
  for (const part of Array.isArray(input) ? input : [input]) {
    if (typeof part === 'string') {
      parts.push({ text: part });
    } else if (part) {
      parts.push(part);
    }
  }
  return parts;
}

const createErrorResponse = (
  request: ToolCallRequestInfo,
  error: Error,
  errorType: ToolErrorType | undefined,
): ToolCallResponseInfo => ({
  callId: request.callId,
  error,
  responseParts: [
    // Only functionResponse — the functionCall is already recorded in history
    // from the model's assistant message. Re-emitting it here would create
    // orphan tool_use blocks for Anthropic (Issue #244).
    {
      functionResponse: {
        id: request.callId,
        name: request.name,
        response: { error: error.message },
      },
    },
  ],
  resultDisplay: error.message,
  errorType,
  agentId: request.agentId ?? DEFAULT_AGENT_ID,
});

export interface CoreToolSchedulerOptions {
  config: Config;
  outputUpdateHandler?: OutputUpdateHandler;
  onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen?: () => void;
  toolContextInteractiveMode?: boolean;
}

export class CoreToolScheduler {
  private readonly logger = DebugLogger.getLogger('llxprt:scheduler');
  private toolRegistry: ToolRegistry;
  private toolCalls: ToolCall[] = [];
  private outputUpdateHandler?: OutputUpdateHandler;
  private onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  private onToolCallsUpdate?: ToolCallsUpdateHandler;
  private getPreferredEditor: () => EditorType | undefined = () => undefined;
  private config: Config;
  private onEditorClose: () => void = () => undefined;
  private onEditorOpen?: () => void;
  private isFinalizingToolCalls = false;
  private isScheduling = false;
  private toolContextInteractiveMode: boolean;
  private requestQueue: QueuedRequest[] = [];
  private messageBusUnsubscribe?: () => void;
  private pendingConfirmations: Map<string, string> = new Map();
  private staleCorrelationIds: Map<string, NodeJS.Timeout> = new Map();
  private pendingResults: Map<
    string,
    {
      result: ToolResult;
      callId: string;
      toolName: string;
      scheduledCall: ScheduledToolCall;
      executionIndex: number;
      isCancelled?: boolean; // If true, skip publishing (already transitioned to cancelled)
    }
  > = new Map();
  private nextPublishIndex = 0;
  // Track the abort signal for each tool call so we can use it when handling
  // confirmation responses from the message bus
  private callIdToSignal: Map<string, AbortSignal> = new Map();
  private processedConfirmations: Set<string> = new Set();
  // Track all callIds seen at the scheduler boundary to prevent duplicate execution
  private seenCallIds: Set<string> = new Set();
  // When a parallel batch would exceed the context budget, this is set to a
  // tighter per-tool output config so each result is truncated to fit.
  private batchOutputConfig?: ToolOutputSettingsProvider;

  constructor(options: CoreToolSchedulerOptions) {
    this.config = options.config;
    this.toolRegistry = options.config.getToolRegistry();
    this.setCallbacks(options);
    this.toolContextInteractiveMode =
      options.toolContextInteractiveMode ?? true;

    const messageBus = this.config.getMessageBus();
    this.messageBusUnsubscribe = messageBus.subscribe<ToolConfirmationResponse>(
      MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      this.handleMessageBusResponse.bind(this),
    );
  }

  setCallbacks(options: CoreToolSchedulerOptions): void {
    this.outputUpdateHandler = options.outputUpdateHandler;
    this.onAllToolCallsComplete = options.onAllToolCallsComplete;
    this.onToolCallsUpdate = options.onToolCallsUpdate;
    this.getPreferredEditor = options.getPreferredEditor;
    this.onEditorClose = options.onEditorClose;
    this.onEditorOpen = options.onEditorOpen;
  }

  /**
   * Handles message bus confirmation responses.
   * Called when PolicyEngine or other components respond via message bus.
   */
  private handleMessageBusResponse(response: ToolConfirmationResponse): void {
    const callId = this.pendingConfirmations.get(response.correlationId);

    // Check if this is a stale correlationId (from before ModifyWithEditor created a new one)
    if (!callId && this.staleCorrelationIds.has(response.correlationId)) {
      if (toolSchedulerLogger.enabled) {
        toolSchedulerLogger.debug(
          () =>
            `Received TOOL_CONFIRMATION_RESPONSE for stale correlationId=${response.correlationId} (likely from UI race condition after ModifyWithEditor). Ignoring.`,
        );
      }
      return; // Stale correlation ID from before editor modification
    }

    if (!callId) {
      if (toolSchedulerLogger.enabled) {
        toolSchedulerLogger.debug(
          () =>
            `Received TOOL_CONFIRMATION_RESPONSE for unknown correlationId=${response.correlationId}`,
        );
      }
      return;
    }

    const waitingToolCall = this.toolCalls.find(
      (call) =>
        call.request.callId === callId && call.status === 'awaiting_approval',
    ) as WaitingToolCall | undefined;

    if (!waitingToolCall) {
      if (toolSchedulerLogger.enabled) {
        toolSchedulerLogger.debug(
          () =>
            `No waiting tool call found for correlationId=${response.correlationId}, callId=${callId}`,
        );
      }
      this.pendingConfirmations.delete(response.correlationId);

      return;
    }

    if (toolSchedulerLogger.enabled) {
      toolSchedulerLogger.debug(
        () =>
          `Processing TOOL_CONFIRMATION_RESPONSE correlationId=${response.correlationId} callId=${callId} outcome=${response.outcome ?? response.confirmed}`,
      );
    }

    const derivedOutcome =
      response.outcome ??
      (response.confirmed !== undefined
        ? response.confirmed
          ? ToolConfirmationOutcome.ProceedOnce
          : ToolConfirmationOutcome.Cancel
        : ToolConfirmationOutcome.Cancel);

    // Use the original signal stored for this call. If it's missing, the call
    // has already completed/cancelled and we should ignore this response.
    const originalSignal = this.callIdToSignal.get(callId);
    if (!originalSignal) {
      if (toolSchedulerLogger.enabled) {
        toolSchedulerLogger.debug(
          () =>
            `Skipping TOOL_CONFIRMATION_RESPONSE for callId=${callId} because signal is missing (call already finalized).`,
        );
      }
      this.pendingConfirmations.delete(response.correlationId);
      return;
    }
    const signal = originalSignal;
    void this.handleConfirmationResponse(
      callId,
      waitingToolCall.confirmationDetails.onConfirm,
      derivedOutcome,
      signal,
      response.payload,
      true,
    );
  }

  /**
   * Cleanup method to unsubscribe from message bus.
   * Should be called when scheduler is no longer needed.
   */
  dispose(): void {
    if (this.messageBusUnsubscribe) {
      this.messageBusUnsubscribe();
      this.messageBusUnsubscribe = undefined;
    }
    this.pendingConfirmations.clear();
    this.processedConfirmations.clear();
    this.seenCallIds.clear();

    // Clean up any pending stale correlation ID timeouts
    for (const timeout of this.staleCorrelationIds.values()) {
      clearTimeout(timeout);
    }
    this.staleCorrelationIds.clear();
  }

  private setStatusInternal(
    targetCallId: string,
    status: 'success',
    response: ToolCallResponseInfo,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'awaiting_approval',
    confirmationDetails: ToolCallConfirmationDetails,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'error',
    response: ToolCallResponseInfo,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'cancelled',
    reason: string,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'executing' | 'scheduled' | 'validating',
  ): void;
  private setStatusInternal(
    targetCallId: string,
    newStatus: Status,
    auxiliaryData?: unknown,
  ): void {
    this.toolCalls = this.toolCalls.map((currentCall) => {
      if (
        currentCall.request.callId !== targetCallId ||
        currentCall.status === 'success' ||
        currentCall.status === 'error' ||
        currentCall.status === 'cancelled'
      ) {
        return currentCall;
      }

      // currentCall is a non-terminal state here and should have startTime and tool.
      const existingStartTime = currentCall.startTime;
      const toolInstance = currentCall.tool;
      const invocation = currentCall.invocation;

      const outcome = currentCall.outcome;

      switch (newStatus) {
        case 'success': {
          const durationMs = existingStartTime
            ? Date.now() - existingStartTime
            : undefined;
          const response = {
            ...(auxiliaryData as ToolCallResponseInfo),
          };
          if (!response.agentId) {
            response.agentId = currentCall.request.agentId ?? DEFAULT_AGENT_ID;
          }
          return {
            request: currentCall.request,
            tool: toolInstance,
            invocation,
            status: 'success',
            response,
            durationMs,
            outcome,
          } as SuccessfulToolCall;
        }
        case 'error': {
          const durationMs = existingStartTime
            ? Date.now() - existingStartTime
            : undefined;
          const response = {
            ...(auxiliaryData as ToolCallResponseInfo),
          };
          if (!response.agentId) {
            response.agentId = currentCall.request.agentId ?? DEFAULT_AGENT_ID;
          }
          return {
            request: currentCall.request,
            status: 'error',
            tool: toolInstance,
            response,
            durationMs,
            outcome,
          } as ErroredToolCall;
        }
        case 'awaiting_approval':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'awaiting_approval',
            confirmationDetails: auxiliaryData as ToolCallConfirmationDetails,
            startTime: existingStartTime,
            outcome,
            invocation,
          } as WaitingToolCall;
        case 'scheduled':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'scheduled',
            startTime: existingStartTime,
            outcome,
            invocation,
          } as ScheduledToolCall;
        case 'cancelled': {
          const durationMs = existingStartTime
            ? Date.now() - existingStartTime
            : undefined;

          // Preserve diff for cancelled edit operations
          let resultDisplay: ToolResultDisplay | undefined = undefined;
          if (currentCall.status === 'awaiting_approval') {
            const waitingCall = currentCall as WaitingToolCall;
            if (waitingCall.confirmationDetails.type === 'edit') {
              resultDisplay = {
                fileDiff: waitingCall.confirmationDetails.fileDiff,
                fileName: waitingCall.confirmationDetails.fileName,
                originalContent:
                  waitingCall.confirmationDetails.originalContent,
                newContent: waitingCall.confirmationDetails.newContent,
              };
            }
          }

          return {
            request: currentCall.request,
            tool: toolInstance,
            invocation,
            status: 'cancelled',
            response: {
              callId: currentCall.request.callId,
              responseParts: [
                // Only functionResponse — the functionCall is already in history
                // from the model's assistant message (Issue #244).
                {
                  functionResponse: {
                    id: currentCall.request.callId,
                    name: currentCall.request.name,
                    response: {
                      error: `[Operation Cancelled] Reason: ${auxiliaryData}`,
                    },
                  },
                },
              ],
              resultDisplay,
              error: undefined,
              errorType: undefined,
              agentId: currentCall.request.agentId ?? DEFAULT_AGENT_ID,
            },
            durationMs,
            outcome,
          } as CancelledToolCall;
        }
        case 'validating':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'validating',
            startTime: existingStartTime,
            outcome,
            invocation,
          } as ValidatingToolCall;
        case 'executing':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'executing',
            startTime: existingStartTime,
            outcome,
            invocation,
          } as ExecutingToolCall;
        default: {
          const exhaustiveCheck: never = newStatus;
          return exhaustiveCheck;
        }
      }
    });
    this.notifyToolCallsUpdate();
    this.checkAndNotifyCompletion();
  }

  private setArgsInternal(targetCallId: string, args: unknown): void {
    this.toolCalls = this.toolCalls.map((call) => {
      // We should never be asked to set args on an ErroredToolCall, but
      // we guard for the case anyways.
      if (call.request.callId !== targetCallId || call.status === 'error') {
        return call;
      }

      // Set context for ContextAwareTool instances
      if ('context' in call.tool) {
        const contextAwareTool = call.tool as ContextAwareTool;
        contextAwareTool.context = {
          sessionId: this.config.getSessionId(),
          agentId: call.request.agentId ?? DEFAULT_AGENT_ID,
          interactiveMode: this.toolContextInteractiveMode,
        };
      }

      const invocationOrError = this.buildInvocation(
        call.tool,
        args as Record<string, unknown>,
      );
      if (invocationOrError instanceof Error) {
        const response = createErrorResponse(
          call.request,
          invocationOrError,
          ToolErrorType.INVALID_TOOL_PARAMS,
        );
        return {
          request: { ...call.request, args: args as Record<string, unknown> },
          status: 'error',
          tool: call.tool,
          response,
        } as ErroredToolCall;
      }

      return {
        ...call,
        request: { ...call.request, args: args as Record<string, unknown> },
        invocation: invocationOrError,
      };
    });
  }

  private setPidInternal(targetCallId: string, pid: number): void {
    this.toolCalls = this.toolCalls.map((call) => {
      if (call.request.callId !== targetCallId || call.status !== 'executing') {
        return call;
      }
      return {
        ...call,
        pid,
      } as ExecutingToolCall;
    });
    this.notifyToolCallsUpdate();
  }

  private isRunning(): boolean {
    return (
      this.isFinalizingToolCalls ||
      this.toolCalls.some(
        (call) =>
          call.status === 'executing' || call.status === 'awaiting_approval',
      )
    );
  }

  private buildInvocation(
    tool: AnyDeclarativeTool,
    args: object,
  ): AnyToolInvocation | Error {
    try {
      return tool.build(args);
    } catch (e) {
      if (e instanceof Error) {
        return e;
      }
      return new Error(String(e));
    }
  }

  /**
   * Build a friendly suggestion message when a tool can't be found.
   */
  private getToolSuggestion(unknownToolName: string, topN = 3): string {
    const allToolNames = this.toolRegistry.getAllToolNames();
    if (!allToolNames.length) {
      return '';
    }

    const matches = allToolNames
      .map((toolName) => ({
        name: toolName,
        distance: levenshtein.get(unknownToolName, toolName),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, topN);

    if (!matches.length || matches[0].distance === Infinity) {
      return '';
    }

    const suggestedNames = matches.map((match) => `"${match.name}"`).join(', ');
    return matches.length > 1
      ? ` Did you mean one of: ${suggestedNames}?`
      : ` Did you mean ${suggestedNames}?`;
  }

  schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<void> {
    if (this.isRunning() || this.isScheduling) {
      return new Promise((resolve, reject) => {
        const abortHandler = () => {
          // Find and remove the request from the queue
          const index = this.requestQueue.findIndex(
            (item) => item.request === request,
          );
          if (index > -1) {
            this.requestQueue.splice(index, 1);
            reject(new Error('Tool call cancelled while in queue.'));
          }
        };

        signal.addEventListener('abort', abortHandler, { once: true });

        this.requestQueue.push({
          request,
          signal,
          resolve: () => {
            signal.removeEventListener('abort', abortHandler);
            resolve();
          },
          reject: (reason?: Error) => {
            signal.removeEventListener('abort', abortHandler);
            reject(reason);
          },
        });
      });
    }
    return this._schedule(request, signal);
  }

  private async _schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<void> {
    this.isScheduling = true;
    try {
      if (this.isRunning()) {
        throw new Error(
          'Cannot schedule new tool calls while other tool calls are actively running (executing or awaiting approval).',
        );
      }
      const requestsToProcess = (
        Array.isArray(request) ? request : [request]
      ).map((req) => {
        if (!req.agentId) {
          req.agentId = DEFAULT_AGENT_ID;
        }
        return req;
      });

      // Filter out duplicate calls at the scheduler boundary to prevent duplicate execution
      const freshRequests = requestsToProcess.filter(
        (r) => !this.seenCallIds.has(r.callId),
      );
      for (const req of freshRequests) {
        this.seenCallIds.add(req.callId);
      }
      if (freshRequests.length === 0) {
        // All calls were duplicates, nothing to do
        return;
      }

      // Use only fresh requests for all subsequent processing
      const requestsToProcessActual = freshRequests;
      const governance = buildToolGovernance(this.config);

      const newToolCalls: ToolCall[] = requestsToProcessActual.map(
        (reqInfo): ToolCall => {
          if (isToolBlocked(reqInfo.name, governance)) {
            const errorMessage = `Tool "${reqInfo.name}" is disabled in the current profile.`;
            return {
              status: 'error',
              request: reqInfo,
              response: createErrorResponse(
                reqInfo,
                new Error(errorMessage),
                ToolErrorType.TOOL_DISABLED,
              ),
              durationMs: 0,
            };
          }

          const toolInstance = this.toolRegistry.getTool(reqInfo.name);
          if (!toolInstance) {
            const suggestion = this.getToolSuggestion(reqInfo.name);
            const errorMessage = `Tool "${reqInfo.name}" could not be loaded.${suggestion}`;
            return {
              status: 'error',
              request: reqInfo,
              response: createErrorResponse(
                reqInfo,
                new Error(errorMessage),
                ToolErrorType.TOOL_NOT_REGISTERED,
              ),
              durationMs: 0,
            };
          }

          // Set context for ContextAwareTool instances
          if ('context' in toolInstance) {
            const contextAwareTool = toolInstance as ContextAwareTool;
            contextAwareTool.context = {
              sessionId: this.config.getSessionId(),
              agentId: reqInfo.agentId ?? DEFAULT_AGENT_ID,
              interactiveMode: this.toolContextInteractiveMode,
            };
          }

          const invocationOrError = this.buildInvocation(
            toolInstance,
            reqInfo.args,
          );
          if (invocationOrError instanceof Error) {
            return {
              status: 'error',
              request: reqInfo,
              tool: toolInstance,
              response: createErrorResponse(
                reqInfo,
                invocationOrError,
                ToolErrorType.INVALID_TOOL_PARAMS,
              ),
              durationMs: 0,
            };
          }

          return {
            status: 'validating',
            request: reqInfo,
            tool: toolInstance,
            invocation: invocationOrError,
            startTime: Date.now(),
          };
        },
      );

      this.toolCalls = this.toolCalls.concat(newToolCalls);
      this.notifyToolCallsUpdate();

      for (const toolCall of newToolCalls) {
        if (toolCall.status !== 'validating') {
          continue;
        }

        const { request: reqInfo, invocation } = toolCall;
        // Store the signal for this call so we can use it later in message bus responses
        this.callIdToSignal.set(reqInfo.callId, signal);

        try {
          if (signal.aborted) {
            this.setStatusInternal(
              reqInfo.callId,
              'cancelled',
              'Tool call cancelled by user.',
            );
            continue;
          }

          const evaluation = this.evaluatePolicyDecision(invocation, reqInfo);
          const policyContext = evaluation.context;

          if (evaluation.decision === PolicyDecision.ALLOW) {
            this.approveToolCall(reqInfo.callId);
            continue;
          }

          if (evaluation.decision === PolicyDecision.DENY) {
            this.handlePolicyDenial(reqInfo, evaluation.context);
            continue;
          }

          const confirmationDetails =
            await invocation.shouldConfirmExecute(signal);

          if (!confirmationDetails) {
            this.approveToolCall(reqInfo.callId);
            continue;
          }

          const allowedTools = this.config.getAllowedTools() || [];
          if (
            this.config.getApprovalMode() === ApprovalMode.YOLO ||
            doesToolInvocationMatch(toolCall.tool, invocation, allowedTools)
          ) {
            this.approveToolCall(reqInfo.callId);
          } else {
            // Allow IDE to resolve confirmation
            if (
              confirmationDetails.type === 'edit' &&
              confirmationDetails.ideConfirmation
            ) {
              confirmationDetails.ideConfirmation.then((resolution) => {
                if (resolution.status === 'accepted') {
                  this.handleConfirmationResponse(
                    reqInfo.callId,
                    confirmationDetails.onConfirm,
                    ToolConfirmationOutcome.ProceedOnce,
                    signal,
                  );
                } else {
                  this.handleConfirmationResponse(
                    reqInfo.callId,
                    confirmationDetails.onConfirm,
                    ToolConfirmationOutcome.Cancel,
                    signal,
                  );
                }
              });
            }

            const originalOnConfirm = confirmationDetails.onConfirm;
            const wrappedConfirmationDetails: ToolCallConfirmationDetails = {
              ...confirmationDetails,
              onConfirm: (
                outcome: ToolConfirmationOutcome,
                payload?: ToolConfirmationPayload,
              ) =>
                this.handleConfirmationResponse(
                  reqInfo.callId,
                  originalOnConfirm,
                  outcome,
                  signal,
                  payload,
                  false,
                ),
            };

            const correlationId = randomUUID();
            wrappedConfirmationDetails.correlationId = correlationId;
            this.pendingConfirmations.set(correlationId, reqInfo.callId);

            const context =
              policyContext ??
              this.getPolicyContextFromInvocation(invocation, reqInfo);

            this.publishConfirmationRequest(correlationId, context);

            this.setStatusInternal(
              reqInfo.callId,
              'awaiting_approval',
              wrappedConfirmationDetails,
            );
          }
        } catch (error) {
          if (signal.aborted) {
            this.setStatusInternal(
              reqInfo.callId,
              'cancelled',
              'Tool call cancelled by user.',
            );
            continue;
          }

          this.setStatusInternal(
            reqInfo.callId,
            'error',
            createErrorResponse(
              reqInfo,
              error instanceof Error ? error : new Error(String(error)),
              ToolErrorType.UNHANDLED_EXCEPTION,
            ),
          );
        }
      }
      this.attemptExecutionOfScheduledCalls(signal);
      void this.checkAndNotifyCompletion();
    } finally {
      this.isScheduling = false;
    }
  }

  async handleConfirmationResponse(
    callId: string,
    originalOnConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>,
    outcome: ToolConfirmationOutcome,
    signal: AbortSignal,
    payload?: ToolConfirmationPayload,
    skipBusPublish = false,
  ): Promise<void> {
    if (this.processedConfirmations.has(callId)) {
      if (toolSchedulerLogger.enabled) {
        toolSchedulerLogger.debug(
          () => `Skipping duplicate confirmation for callId=${callId}`,
        );
      }
      return;
    }
    this.processedConfirmations.add(callId);

    const toolCall = this.toolCalls.find(
      (c) => c.request.callId === callId && c.status === 'awaiting_approval',
    );

    let waitingToolCall: WaitingToolCall | undefined;
    if (toolCall && toolCall.status === 'awaiting_approval') {
      waitingToolCall = toolCall as WaitingToolCall;
    }
    const previousCorrelationId =
      waitingToolCall?.confirmationDetails?.correlationId;

    await originalOnConfirm(outcome);

    if (outcome === ToolConfirmationOutcome.ProceedAlways) {
      await this.autoApproveCompatiblePendingTools(signal, callId);
    }

    this.setToolCallOutcome(callId, outcome);

    if (outcome === ToolConfirmationOutcome.Cancel || signal.aborted) {
      this.setStatusInternal(
        callId,
        'cancelled',
        'User did not allow tool call',
      );
    } else if (
      outcome === ToolConfirmationOutcome.ModifyWithEditor &&
      waitingToolCall
    ) {
      if (isModifiableDeclarativeTool(waitingToolCall.tool)) {
        const modifyContext = waitingToolCall.tool.getModifyContext(signal);
        const editorType = this.getPreferredEditor();
        if (!editorType) {
          return;
        }

        this.setStatusInternal(callId, 'awaiting_approval', {
          ...waitingToolCall.confirmationDetails,
          isModifying: true,
        } as ToolCallConfirmationDetails);

        const contentOverrides =
          waitingToolCall.confirmationDetails.type === 'edit'
            ? {
                currentContent:
                  waitingToolCall.confirmationDetails.originalContent,
                proposedContent: waitingToolCall.confirmationDetails.newContent,
              }
            : undefined;

        const { updatedParams, updatedDiff } = await modifyWithEditor<
          typeof waitingToolCall.request.args
        >(
          waitingToolCall.request.args,
          modifyContext as ModifyContext<typeof waitingToolCall.request.args>,
          editorType,
          signal,
          this.onEditorClose,
          this.onEditorOpen,
          contentOverrides,
        );
        this.setArgsInternal(callId, updatedParams);
        const newCorrelationId = randomUUID();
        const updatedDetails: ToolCallConfirmationDetails = {
          ...waitingToolCall.confirmationDetails,
          fileDiff: updatedDiff,
          isModifying: false,
          correlationId: newCorrelationId,
        } as ToolCallConfirmationDetails;
        this.pendingConfirmations.set(newCorrelationId, callId);
        // Remove from processedConfirmations so the tool can be confirmed again
        // after editor modification
        this.processedConfirmations.delete(callId);
        const context = this.getPolicyContextFromInvocation(
          waitingToolCall.invocation,
          waitingToolCall.request,
        );
        this.publishConfirmationRequest(newCorrelationId, context);
        this.setStatusInternal(callId, 'awaiting_approval', updatedDetails);

        // Mark the old correlationId as stale to handle race condition with UI
        // where the UI might still send a response with the old correlationId
        // before it receives the update with the new one
        if (previousCorrelationId) {
          const graceTimeout = setTimeout(() => {
            this.staleCorrelationIds.delete(previousCorrelationId);
            if (toolSchedulerLogger.enabled) {
              toolSchedulerLogger.debug(
                () =>
                  `Removed stale correlationId=${previousCorrelationId} after grace period`,
              );
            }
          }, 2000); // 2 second grace period

          this.staleCorrelationIds.set(previousCorrelationId, graceTimeout);
          if (toolSchedulerLogger.enabled) {
            toolSchedulerLogger.debug(
              () =>
                `Marked correlationId=${previousCorrelationId} as stale with 2s grace period after ModifyWithEditor created new correlationId=${newCorrelationId}`,
            );
          }
        }
      }
    } else {
      if (payload?.newContent && waitingToolCall) {
        await this._applyInlineModify(waitingToolCall, payload, signal);
      }
      this.setStatusInternal(callId, 'scheduled');
    }
    this.attemptExecutionOfScheduledCalls(signal);

    const correlationId = previousCorrelationId;
    if (correlationId) {
      this.pendingConfirmations.delete(correlationId);
      if (!skipBusPublish) {
        const confirmed =
          outcome !== ToolConfirmationOutcome.Cancel &&
          outcome !== ToolConfirmationOutcome.ModifyWithEditor;
        this.config.getMessageBus().publish({
          type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
          correlationId,
          outcome,
          payload,
          confirmed,
          requiresUserConfirmation: false,
        });
      }
    }
  }

  private approveToolCall(callId: string): void {
    this.setToolCallOutcome(callId, ToolConfirmationOutcome.ProceedAlways);
    this.setStatusInternal(callId, 'scheduled');
  }

  private getPolicyContextFromInvocation(
    invocation: AnyToolInvocation,
    request: ToolCallRequestInfo,
  ): PolicyContext {
    if (invocation instanceof BaseToolInvocation) {
      const context = invocation.getPolicyContext();
      if (context.toolName === 'unknown' || !context.toolName) {
        return {
          ...context,
          toolName: request.name,
        };
      }
      return context;
    }
    return {
      toolName: request.name,
      args: request.args,
    };
  }

  private evaluatePolicyDecision(
    invocation: AnyToolInvocation,
    request: ToolCallRequestInfo,
  ): { decision: PolicyDecision; context: PolicyContext } {
    const context = this.getPolicyContextFromInvocation(invocation, request);
    const policyEngine = this.config.getPolicyEngine();
    const decision = policyEngine.evaluate(
      context.toolName,
      context.args,
      context.serverName,
    );
    return { decision, context };
  }

  private handlePolicyDenial(
    request: ToolCallRequestInfo,
    context: PolicyContext,
  ): void {
    const message = `Policy denied execution of tool "${context.toolName}".`;
    const error = new Error(message);
    const response = createErrorResponse(
      request,
      error,
      ToolErrorType.POLICY_VIOLATION,
    );
    this.setStatusInternal(request.callId, 'error', response);

    const toolCall: FunctionCall = {
      name: context.toolName,
      args: context.args,
    };
    this.config.getMessageBus().publish({
      type: MessageBusType.TOOL_POLICY_REJECTION,
      toolCall,
      correlationId: randomUUID(),
      reason: message,
      serverName: context.serverName,
    });
  }

  private publishConfirmationRequest(
    correlationId: string,
    context: PolicyContext,
  ): void {
    const toolCall: FunctionCall = {
      name: context.toolName,
      args: context.args,
    };
    this.config.getMessageBus().publish({
      type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
      toolCall,
      correlationId,
      serverName: context.serverName,
    });
  }

  /**
   * Applies user-provided content changes to a tool call that is awaiting confirmation.
   * This method updates the tool's arguments and refreshes the confirmation prompt with a new diff
   * before the tool is scheduled for execution.
   * @private
   */
  private async _applyInlineModify(
    toolCall: WaitingToolCall,
    payload: ToolConfirmationPayload,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      toolCall.confirmationDetails.type !== 'edit' ||
      !isModifiableDeclarativeTool(toolCall.tool)
    ) {
      return;
    }

    const modifyContext = toolCall.tool.getModifyContext(signal);
    const currentContent = await modifyContext.getCurrentContent(
      toolCall.request.args,
    );

    const updatedParams = modifyContext.createUpdatedParams(
      currentContent,
      payload.newContent,
      toolCall.request.args,
    );
    const updatedDiff = Diff.createPatch(
      modifyContext.getFilePath(toolCall.request.args),
      currentContent,
      payload.newContent,
      'Current',
      'Proposed',
    );

    this.setArgsInternal(toolCall.request.callId, updatedParams);
    this.setStatusInternal(toolCall.request.callId, 'awaiting_approval', {
      ...toolCall.confirmationDetails,
      fileDiff: updatedDiff,
    });
  }

  private bufferResult(
    callId: string,
    toolName: string,
    result: ToolResult,
    scheduledCall: ScheduledToolCall,
    executionIndex: number,
  ): void {
    this.pendingResults.set(callId, {
      result,
      callId,
      toolName,
      scheduledCall,
      executionIndex,
    });
  }

  private bufferError(
    callId: string,
    error: Error,
    scheduledCall: ScheduledToolCall,
    executionIndex: number,
  ): void {
    const errorResult: ToolResult = {
      error: {
        message: error.message,
        type: ToolErrorType.UNHANDLED_EXCEPTION,
      },
      llmContent: error.message,
      returnDisplay: error.message,
    };
    this.pendingResults.set(callId, {
      result: errorResult,
      callId,
      toolName: scheduledCall.request.name,
      scheduledCall,
      executionIndex,
    });
  }

  /**
   * Buffer a cancelled placeholder so ordered publishing can skip past this
   * index without waiting forever. The tool is already transitioned to
   * 'cancelled' status before this is called.
   */
  private bufferCancelled(
    callId: string,
    scheduledCall: ScheduledToolCall,
    executionIndex: number,
  ): void {
    const cancelledResult: ToolResult = {
      error: {
        message: 'Tool call cancelled by user.',
        type: ToolErrorType.EXECUTION_FAILED,
      },
      llmContent: 'Tool call cancelled by user.',
      returnDisplay: 'Cancelled',
    };
    this.pendingResults.set(callId, {
      result: cancelledResult,
      callId,
      toolName: scheduledCall.request.name,
      scheduledCall,
      executionIndex,
      isCancelled: true, // Mark so publishBufferedResults can skip publishing
    });
  }

  // Reentrancy guard for publishBufferedResults to prevent race conditions
  // when multiple async tool completions trigger publishing simultaneously
  private isPublishingBufferedResults = false;
  // Flag to track if another publish was requested while we were publishing
  private pendingPublishRequest = false;
  // Total number of tools in the current batch (set when execution starts)
  private currentBatchSize = 0;

  private async publishBufferedResults(signal: AbortSignal): Promise<void> {
    // If already publishing, mark that we need another pass after current one completes
    if (this.isPublishingBufferedResults) {
      this.pendingPublishRequest = true;
      return;
    }
    this.isPublishingBufferedResults = true;
    this.pendingPublishRequest = false;

    try {
      // Loop to handle cases where new results arrive while we're publishing
      do {
        this.pendingPublishRequest = false;

        // Issue #987 fix: Handle the race condition where tools complete before
        // currentBatchSize is set. If we have pending results but currentBatchSize
        // is 0, recalculate the batch size from the pending results to prevent
        // an infinite setImmediate loop.
        if (this.currentBatchSize === 0 && this.pendingResults.size > 0) {
          // Find the maximum executionIndex to determine batch size
          let maxIndex = -1;
          for (const buffered of this.pendingResults.values()) {
            if (buffered.executionIndex > maxIndex) {
              maxIndex = buffered.executionIndex;
            }
          }
          // Batch size is maxIndex + 1 (since indices are 0-based)
          // Sanity check: batch size should not exceed the number of pending results
          // in case of sparse indices (though this shouldn't happen in practice)
          const recoveredBatchSize = Math.min(
            maxIndex + 1,
            this.pendingResults.size,
          );
          this.currentBatchSize =
            recoveredBatchSize > 0 ? recoveredBatchSize : 1;
          if (toolSchedulerLogger.enabled) {
            toolSchedulerLogger.debug(
              () =>
                `Recovered batch size from pending results: currentBatchSize=${this.currentBatchSize}, pendingResults.size=${this.pendingResults.size}, maxIndex=${maxIndex}`,
            );
          }
        }

        // Publish results in execution order using the stored executionIndex.
        // We iterate while there are buffered results that match the next expected index.
        // This approach doesn't rely on filtering toolCalls by status, which changes
        // as we publish results (status goes from 'executing' to 'success').
        while (this.nextPublishIndex < this.currentBatchSize) {
          // Find the buffered result with the next expected executionIndex
          let nextBuffered:
            | {
                result: ToolResult;
                callId: string;
                toolName: string;
                scheduledCall: ScheduledToolCall;
                executionIndex: number;
                isCancelled?: boolean;
              }
            | undefined;

          for (const buffered of this.pendingResults.values()) {
            if (buffered.executionIndex === this.nextPublishIndex) {
              nextBuffered = buffered;
              break;
            }
          }

          if (!nextBuffered) {
            // The result for the next index isn't ready yet, stop publishing
            break;
          }

          // Skip publishing for cancelled tools - they're already in terminal state
          // Just remove from buffer and advance the index
          if (!nextBuffered.isCancelled) {
            // Publish this result
            await this.publishResult(nextBuffered, signal);
          }

          // Remove from buffer
          this.pendingResults.delete(nextBuffered.callId);
          this.nextPublishIndex++;
        }

        // Check if all tools in this batch completed
        if (
          this.nextPublishIndex === this.currentBatchSize &&
          this.currentBatchSize > 0
        ) {
          // Reset for next batch
          this.nextPublishIndex = 0;
          this.currentBatchSize = 0;
          this.pendingResults.clear();
          this.batchOutputConfig = undefined;
        }
      } while (this.pendingPublishRequest);
    } finally {
      this.isPublishingBufferedResults = false;

      // After releasing the lock, check if there are still pending results
      // that need publishing. This handles the race condition where:
      // 1. We break out of the while loop waiting for result N
      // 2. Result N arrives and calls publishBufferedResults
      // 3. That call sees isPublishingBufferedResults=true, sets pendingPublishRequest=true, and returns
      // 4. We then check pendingPublishRequest in the do-while, but it was set AFTER we checked
      // 5. We exit without publishing the remaining buffered results
      //
      // By checking pendingResults.size here after releasing the lock, we ensure
      // any buffered results get published.
      if (this.pendingResults.size > 0) {
        // Use setImmediate to avoid deep recursion and allow the event loop to process
        // other pending tool completions first
        // Avoid scheduling when there are no results to publish yet.
        let hasNextBuffered = false;
        for (const buffered of this.pendingResults.values()) {
          if (buffered.executionIndex === this.nextPublishIndex) {
            hasNextBuffered = true;
            break;
          }
        }
        if (hasNextBuffered) {
          setImmediate(() => {
            void this.publishBufferedResults(signal);
          });
        }
      }
    }
  }

  private async publishResult(
    buffered: {
      result: ToolResult;
      callId: string;
      toolName: string;
      scheduledCall: ScheduledToolCall;
    },
    _signal: AbortSignal,
  ): Promise<void> {
    const { result, callId, toolName, scheduledCall } = buffered;

    if (result.error === undefined) {
      // Success case — use tighter per-tool limits when the batch risked
      // exceeding the context window (#1301)
      const outputConfig = this.batchOutputConfig ?? this.config;
      const response = convertToFunctionResponse(
        toolName,
        callId,
        result.llmContent,
        outputConfig,
      );
      const metadataAgentId = extractAgentIdFromMetadata(
        result.metadata as Record<string, unknown> | undefined,
      );

      // Only include functionResponse parts - the functionCall is already in
      // history from the original assistant message. Including it again would
      // create duplicate tool_use blocks for Anthropic. (Issue #1150)
      const responseParts = [...response] as Part[];

      const successResponse: ToolCallResponseInfo = {
        callId,
        responseParts,
        resultDisplay: result.returnDisplay,
        error: undefined,
        errorType: undefined,
        agentId:
          metadataAgentId ?? scheduledCall.request.agentId ?? DEFAULT_AGENT_ID,
      };

      this.logger.debug(
        `callId=${callId}, toolName=${toolName}, returnDisplay type=${typeof result.returnDisplay}, hasValue=${!!result.returnDisplay}`,
      );

      this.setStatusInternal(callId, 'success', successResponse);
    } else {
      // Error case
      const error = new Error(result.error.message);
      const errorResponse = createErrorResponse(
        scheduledCall.request,
        error,
        result.error.type,
      );
      this.setStatusInternal(callId, 'error', errorResponse);
    }
  }

  /**
   * Apply batch-level output limits for parallel tool batches. (#1301)
   *
   * `tool-output-max-tokens` is treated as a budget for the entire batch of
   * tool outputs combined, not per-tool.  For batches of 2+ tools this method
   * divides the budget equally and stores the reduced per-tool limit in
   * {@link batchOutputConfig}, which {@link publishResult} picks up when
   * building function response parts.
   */
  private applyBatchOutputLimits(batchSize: number): void {
    if (batchSize <= 1) {
      this.batchOutputConfig = undefined;
      return;
    }

    try {
      const ephemeral =
        typeof this.config.getEphemeralSettings === 'function'
          ? this.config.getEphemeralSettings()
          : {};

      const maxBatchTokens =
        (ephemeral['tool-output-max-tokens'] as number | undefined) ??
        DEFAULT_MAX_TOKENS;

      const perToolBudget = Math.max(
        1000,
        Math.floor(maxBatchTokens / batchSize),
      );

      if (toolSchedulerLogger.enabled) {
        toolSchedulerLogger.debug(
          () =>
            `Batch of ${batchSize} tools: applying per-tool output limit ` +
            `of ${perToolBudget} tokens (batch budget: ${maxBatchTokens}).`,
        );
      }

      this.batchOutputConfig = {
        getEphemeralSettings: () => ({
          ...ephemeral,
          'tool-output-max-tokens': perToolBudget,
          // Preserve user's truncate-mode preference; default to 'truncate' if unset
          ...(!ephemeral['tool-output-truncate-mode']
            ? { 'tool-output-truncate-mode': 'truncate' }
            : {}),
        }),
      };
    } catch (error) {
      if (toolSchedulerLogger.enabled) {
        toolSchedulerLogger.debug(
          () =>
            `Failed to compute batch output limits; skipping budget guard: ${error}`,
        );
      }
      this.batchOutputConfig = undefined;
    }
  }

  /**
   * Launch a single scheduled tool call and wire up result buffering / error handling.
   */
  private launchToolExecution(
    scheduledCall: ScheduledToolCall,
    executionIndex: number,
    signal: AbortSignal,
  ): Promise<void> {
    const { callId, name: toolName } = scheduledCall.request;
    const invocation = scheduledCall.invocation;

    this.setStatusInternal(callId, 'executing');

    const liveOutputCallback = scheduledCall.tool.canUpdateOutput
      ? (outputChunk: string | AnsiOutput) => {
          if (this.outputUpdateHandler) {
            this.outputUpdateHandler(callId, outputChunk);
          }
          this.toolCalls = this.toolCalls.map((tc) =>
            tc.request.callId === callId && tc.status === 'executing'
              ? { ...tc, liveOutput: outputChunk }
              : tc,
          );
          this.notifyToolCallsUpdate();
        }
      : undefined;

    const setPidCallback = (pid: number) => {
      this.setPidInternal(callId, pid);
    };

    return (
      invocation
        .execute(
          signal,
          liveOutputCallback,
          undefined,
          undefined,
          setPidCallback,
        )
        .then(async (toolResult: ToolResult) => {
          if (signal.aborted) {
            this.setStatusInternal(
              callId,
              'cancelled',
              'User cancelled tool execution.',
            );
            this.bufferCancelled(callId, scheduledCall, executionIndex);
            await this.publishBufferedResults(signal);
            return;
          }

          this.bufferResult(
            callId,
            toolName,
            toolResult,
            scheduledCall,
            executionIndex,
          );

          await this.publishBufferedResults(signal);
        })
        .catch(async (executionError: Error) => {
          if (signal.aborted) {
            this.setStatusInternal(
              callId,
              'cancelled',
              'User cancelled tool execution.',
            );
            this.bufferCancelled(callId, scheduledCall, executionIndex);
            await this.publishBufferedResults(signal);
          } else {
            this.bufferError(
              callId,
              executionError,
              scheduledCall,
              executionIndex,
            );
            await this.publishBufferedResults(signal);
          }
        })
        // Issue #957: Final catch handler to ensure tool always reaches
        // terminal state even if publishBufferedResults throws.
        .catch((publishError: Error) => {
          if (toolSchedulerLogger.enabled) {
            toolSchedulerLogger.debug(
              () =>
                `Error during tool result publishing for ${toolName} (${callId}): ${publishError.message}`,
            );
          }

          const toolCall = this.toolCalls.find(
            (tc) => tc.request.callId === callId,
          );
          if (
            toolCall &&
            toolCall.status !== 'success' &&
            toolCall.status !== 'error' &&
            toolCall.status !== 'cancelled'
          ) {
            const errorResponse = createErrorResponse(
              scheduledCall.request,
              new Error(
                `Failed to publish tool result: ${publishError.message}`,
              ),
              ToolErrorType.UNHANDLED_EXCEPTION,
            );
            this.setStatusInternal(callId, 'error', errorResponse);
          }
        })
    );
  }

  private attemptExecutionOfScheduledCalls(signal: AbortSignal): void {
    const allCallsFinalOrScheduled = this.toolCalls.every(
      (call) =>
        call.status === 'scheduled' ||
        call.status === 'cancelled' ||
        call.status === 'success' ||
        call.status === 'error',
    );

    if (allCallsFinalOrScheduled) {
      const callsToExecute = this.toolCalls.filter(
        (call) => call.status === 'scheduled',
      );

      // Store the batch size for ordered publishing - this is set once at the start
      // and doesn't change as tools complete, ensuring we know when all are done
      this.currentBatchSize = callsToExecute.length;

      // Assign execution indices for ordered publishing
      const executionIndices = new Map<string, number>();
      callsToExecute.forEach((call, index) => {
        executionIndices.set(call.request.callId, index);
      });

      // Apply batch-level output limits: tool-output-max-tokens is a budget
      // for all tool outputs combined, divided equally among them. (#1301)
      this.applyBatchOutputLimits(callsToExecute.length);

      // Execute all tools in parallel (PRESERVE EXISTING PATTERN)
      callsToExecute.forEach((toolCall) => {
        if (toolCall.status !== 'scheduled') return;
        const scheduledCall = toolCall;
        const executionIndex = executionIndices.get(
          scheduledCall.request.callId,
        )!;
        void this.launchToolExecution(scheduledCall, executionIndex, signal);
      });
    }
  }

  private async checkAndNotifyCompletion(): Promise<void> {
    const allCallsAreTerminal = this.toolCalls.every(
      (call) =>
        call.status === 'success' ||
        call.status === 'error' ||
        call.status === 'cancelled',
    );

    if (this.toolCalls.length > 0 && allCallsAreTerminal) {
      const completedCalls = [...this.toolCalls] as CompletedToolCall[];
      this.toolCalls = [];

      // Clean up signal mappings for completed calls
      for (const call of completedCalls) {
        this.callIdToSignal.delete(call.request.callId);
        logToolCall(this.config, new ToolCallEvent(call));
      }

      if (this.onAllToolCallsComplete) {
        this.isFinalizingToolCalls = true;
        try {
          await this.onAllToolCallsComplete(completedCalls);
        } finally {
          this.isFinalizingToolCalls = false;
        }
      }

      this.notifyToolCallsUpdate();
    }
  }

  private notifyToolCallsUpdate(): void {
    if (this.onToolCallsUpdate) {
      this.onToolCallsUpdate([...this.toolCalls]);
    }
  }

  private setToolCallOutcome(callId: string, outcome: ToolConfirmationOutcome) {
    this.toolCalls = this.toolCalls.map((call) => {
      if (call.request.callId !== callId) return call;
      return {
        ...call,
        outcome,
      };
    });
  }

  private async autoApproveCompatiblePendingTools(
    signal: AbortSignal,
    triggeringCallId: string,
  ): Promise<void> {
    const pendingTools = this.toolCalls.filter(
      (call) =>
        call.status === 'awaiting_approval' &&
        call.request.callId !== triggeringCallId,
    ) as WaitingToolCall[];

    for (const pendingTool of pendingTools) {
      try {
        const stillNeedsConfirmation =
          await pendingTool.invocation.shouldConfirmExecute(signal);

        if (!stillNeedsConfirmation) {
          this.setToolCallOutcome(
            pendingTool.request.callId,
            ToolConfirmationOutcome.ProceedAlways,
          );
          this.setStatusInternal(pendingTool.request.callId, 'scheduled');
        }
      } catch (error) {
        toolSchedulerLogger.debug(
          () =>
            `Error checking confirmation for tool ${pendingTool.request.callId}: ${error}`,
        );
      }
    }
  }

  /**
   * Synchronously cancels all queued and active tool calls in the scheduler.
   * This updates the status of tracked tools to 'cancelled'.
   * Note: The actual async execution of tools is interrupted by the AbortSignal
   * passed during scheduling, which the caller is responsible for aborting.
   */
  cancelAll(): void {
    // 1. Cancel all queued requests
    while (this.requestQueue.length > 0) {
      const item = this.requestQueue.shift();
      if (item) {
        item.reject(new Error('Tool call cancelled by user.'));
      }
    }

    // 2. Reset batch bookkeeping state to prevent stale state issues
    // if the scheduler is reused after cancellation
    this.pendingResults.clear();
    this.nextPublishIndex = 0;
    this.currentBatchSize = 0;
    this.isPublishingBufferedResults = false;
    this.pendingPublishRequest = false;
    this.processedConfirmations.clear();
    this.seenCallIds.clear();
    this.batchOutputConfig = undefined;

    // 3. Cancel all active tool calls
    this.toolCalls = this.toolCalls.map((call) => {
      if (
        call.status === 'success' ||
        call.status === 'error' ||
        call.status === 'cancelled'
      ) {
        return call;
      }

      // For awaiting_approval, we need to clean up pending confirmations
      if (call.status === 'awaiting_approval') {
        const waitingCall = call as WaitingToolCall;
        if (waitingCall.confirmationDetails.correlationId) {
          this.pendingConfirmations.delete(
            waitingCall.confirmationDetails.correlationId,
          );
        }
      }

      // Create a cancelled tool call
      const cancelledCall: CancelledToolCall = {
        status: 'cancelled',
        request: call.request,
        response: {
          callId: call.request.callId,
          responseParts: [
            // Only functionResponse — the functionCall is already in history
            // from the model's assistant message (Issue #244).
            {
              functionResponse: {
                id: call.request.callId,
                name: call.request.name,
                response: {
                  error: 'Tool call cancelled by user.',
                },
              },
            },
          ],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
          agentId: call.request.agentId ?? DEFAULT_AGENT_ID,
        },
        tool: call.tool,
        invocation: call.invocation,
        durationMs: call.startTime ? Date.now() - call.startTime : undefined,
        outcome: ToolConfirmationOutcome.Cancel,
      };

      return cancelledCall;
    });

    this.notifyToolCallsUpdate();
    this.checkAndNotifyCompletion();
  }
}
