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
  type ToolOutputSettingsProvider,
} from '../utils/toolOutputLimiter.js';
import { DebugLogger } from '../debug/index.js';
import { buildToolGovernance, isToolBlocked } from './toolGovernance.js';

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
  liveOutput?: string;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
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
  outputChunk: string,
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
    // First, the tool call
    {
      functionCall: {
        id: request.callId,
        name: request.name,
        args: request.args,
      },
    },
    // Then, the error response
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

interface CoreToolSchedulerOptions {
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
  private toolRegistry: ToolRegistry;
  private toolCalls: ToolCall[] = [];
  private outputUpdateHandler?: OutputUpdateHandler;
  private onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  private onToolCallsUpdate?: ToolCallsUpdateHandler;
  private getPreferredEditor: () => EditorType | undefined;
  private config: Config;
  private onEditorClose: () => void;
  private onEditorOpen?: () => void;
  private isFinalizingToolCalls = false;
  private isScheduling = false;
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
    }
  > = new Map();
  private nextPublishIndex = 0;
  private readonly toolContextInteractiveMode: boolean;

  constructor(options: CoreToolSchedulerOptions) {
    this.config = options.config;
    this.toolRegistry = options.config.getToolRegistry();
    this.outputUpdateHandler = options.outputUpdateHandler;
    this.onAllToolCallsComplete = options.onAllToolCallsComplete;
    this.onToolCallsUpdate = options.onToolCallsUpdate;
    this.getPreferredEditor = options.getPreferredEditor;
    this.onEditorClose = options.onEditorClose;
    this.onEditorOpen = options.onEditorOpen;
    this.toolContextInteractiveMode =
      options.toolContextInteractiveMode ?? true;

    const messageBus = this.config.getMessageBus();
    this.messageBusUnsubscribe = messageBus.subscribe<ToolConfirmationResponse>(
      MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      this.handleMessageBusResponse.bind(this),
    );
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
      return; // Not our confirmation request
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

    const abortController = new AbortController();
    void this.handleConfirmationResponse(
      callId,
      waitingToolCall.confirmationDetails.onConfirm,
      derivedOutcome,
      abortController.signal,
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
                // First, the tool call
                {
                  functionCall: {
                    id: currentCall.request.callId,
                    name: currentCall.request.name,
                    args: currentCall.request.args,
                  },
                },
                // Then, the cancellation response
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
      const governance = buildToolGovernance(this.config);

      const newToolCalls: ToolCall[] = requestsToProcess.map(
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

        const { updatedParams, updatedDiff } = await modifyWithEditor<
          typeof waitingToolCall.request.args
        >(
          waitingToolCall.request.args,
          modifyContext as ModifyContext<typeof waitingToolCall.request.args>,
          editorType,
          signal,
          this.onEditorClose,
          this.onEditorOpen,
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

  private async publishBufferedResults(signal: AbortSignal): Promise<void> {
    const callsInOrder = this.toolCalls.filter(
      (call) => call.status === 'scheduled' || call.status === 'executing',
    );

    // Publish results in original request order
    while (this.nextPublishIndex < callsInOrder.length) {
      const expectedCall = callsInOrder[this.nextPublishIndex];
      const buffered = this.pendingResults.get(expectedCall.request.callId);

      if (!buffered) {
        // Next result not ready yet, stop publishing
        break;
      }

      // Publish this result
      await this.publishResult(buffered, signal);

      // Remove from buffer
      this.pendingResults.delete(buffered.callId);
      this.nextPublishIndex++;
    }

    // Check if all tools completed
    if (
      this.nextPublishIndex === callsInOrder.length &&
      callsInOrder.length > 0
    ) {
      // Reset for next batch
      this.nextPublishIndex = 0;
      this.pendingResults.clear();
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
      // Success case
      const response = convertToFunctionResponse(
        toolName,
        callId,
        result.llmContent,
        this.config,
      );
      const metadataAgentId = extractAgentIdFromMetadata(
        result.metadata as Record<string, unknown> | undefined,
      );

      const responseParts = [
        // First, the tool call
        {
          functionCall: {
            id: callId,
            name: toolName,
            args: scheduledCall.request.args,
          },
        },
        // Then, spread the response(s)
        ...response,
      ] as Part[];

      const successResponse: ToolCallResponseInfo = {
        callId,
        responseParts,
        resultDisplay: result.returnDisplay,
        error: undefined,
        errorType: undefined,
        agentId:
          metadataAgentId ?? scheduledCall.request.agentId ?? DEFAULT_AGENT_ID,
      };

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

      // Assign execution indices for ordered publishing
      const executionIndices = new Map<string, number>();
      callsToExecute.forEach((call, index) => {
        executionIndices.set(call.request.callId, index);
      });

      // Execute all tools in parallel (PRESERVE EXISTING PATTERN)
      callsToExecute.forEach((toolCall) => {
        if (toolCall.status !== 'scheduled') return;

        const scheduledCall = toolCall;
        const { callId, name: toolName } = scheduledCall.request;
        const invocation = scheduledCall.invocation;
        const executionIndex = executionIndices.get(callId)!;

        this.setStatusInternal(callId, 'executing');

        const liveOutputCallback =
          scheduledCall.tool.canUpdateOutput && this.outputUpdateHandler
            ? (outputChunk: string) => {
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

        invocation
          .execute(signal, liveOutputCallback)
          .then(async (toolResult: ToolResult) => {
            if (signal.aborted) {
              this.setStatusInternal(
                callId,
                'cancelled',
                'User cancelled tool execution.',
              );
              return;
            }

            // Buffer the result instead of publishing immediately
            this.bufferResult(
              callId,
              toolName,
              toolResult,
              scheduledCall,
              executionIndex,
            );

            // Try to publish buffered results in order
            await this.publishBufferedResults(signal);
          })
          .catch(async (executionError: Error) => {
            if (signal.aborted) {
              this.setStatusInternal(
                callId,
                'cancelled',
                'User cancelled tool execution.',
              );
            } else {
              this.bufferError(
                callId,
                executionError,
                scheduledCall,
                executionIndex,
              );
              await this.publishBufferedResults(signal);
            }
          });
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

      for (const call of completedCalls) {
        logToolCall(this.config, new ToolCallEvent(call));
      }

      if (this.onAllToolCallsComplete) {
        this.isFinalizingToolCalls = true;
        await this.onAllToolCallsComplete(completedCalls);
        this.isFinalizingToolCalls = false;
      }
      this.notifyToolCallsUpdate();
      // After completion, process the next item in the queue.
      if (this.requestQueue.length > 0) {
        const next = this.requestQueue.shift()!;
        this._schedule(next.request, next.signal)
          .then(next.resolve)
          .catch(next.reject);
      }
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

    // 2. Cancel all active tool calls
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
            {
              functionCall: {
                id: call.request.callId,
                name: call.request.name,
                args: call.request.args,
              },
            },
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
