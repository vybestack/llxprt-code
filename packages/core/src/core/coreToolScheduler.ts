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
  ToolRegistry,
  type EditorType,
  Config,
  logToolCall,
  ToolCallEvent,
  type ToolConfirmationPayload,
  ToolErrorType,
} from '../index.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { SerializableConfirmationDetails } from '../confirmation-bus/types.js';

interface QueuedRequest {
  request: ToolCallRequestInfo | ToolCallRequestInfo[];
  signal: AbortSignal;
  resolve: () => void;
  reject: (reason?: Error) => void;
}
import { DEFAULT_AGENT_ID } from './turn.js';
import { createErrorResponse } from '../utils/generateContentResponseUtilities.js';
import { DebugLogger } from '../debug/index.js';
import { buildToolGovernance } from './toolGovernance.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import { triggerToolNotificationHook } from './coreToolHookTriggers.js';
import { ToolExecutor } from '../scheduler/tool-executor.js';
import { ToolDispatcher } from '../scheduler/tool-dispatcher.js';
import {
  ResultAggregator,
  type ResultPublishCallbacks,
} from '../scheduler/result-aggregator.js';
import {
  ConfirmationCoordinator,
  type StatusMutator,
  type SchedulerAccessor,
  type EditorCallbacks,
} from '../scheduler/confirmation-coordinator.js';
import type {
  ScheduledToolCall,
  ErroredToolCall,
  ExecutingToolCall,
  ToolCall,
  CompletedToolCall,
  Status,
  OutputUpdateHandler,
  AllToolCallsCompleteHandler,
  ToolCallsUpdateHandler,
} from '../scheduler/types.js';
import { setToolContext } from '../scheduler/utils.js';
import {
  applyTransition,
  buildCancelAllEntry,
} from '../scheduler/status-transitions.js';
const toolSchedulerLogger = new DebugLogger('llxprt:core:tool-scheduler');

export {
  ValidatingToolCall,
  ScheduledToolCall,
  ErroredToolCall,
  SuccessfulToolCall,
  ExecutingToolCall,
  CancelledToolCall,
  WaitingToolCall,
  ToolCall,
  CompletedToolCall,
  Status,
  ConfirmHandler,
  OutputUpdateHandler,
  AllToolCallsCompleteHandler,
  ToolCallsUpdateHandler,
} from '../scheduler/types.js';

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
 * @requirement REQ-D01-001.1
 * @requirement REQ-D01-001.2
 * @pseudocode lines 56-72
 */
export interface CoreToolSchedulerOptions {
  config: Config;
  messageBus: MessageBus;
  toolRegistry: ToolRegistry;
  outputUpdateHandler?: OutputUpdateHandler;
  onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen?: () => void;
  toolContextInteractiveMode?: boolean;
}

export class CoreToolScheduler {
  private toolCalls: ToolCall[] = [];
  private outputUpdateHandler?: OutputUpdateHandler;
  private onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  private onToolCallsUpdate?: ToolCallsUpdateHandler;
  private getPreferredEditor: () => EditorType | undefined = () => undefined;
  private config: Config;
  private readonly toolExecutor: ToolExecutor;
  private readonly toolDispatcher: ToolDispatcher;
  private readonly confirmationCoordinator: ConfirmationCoordinator;
  private onEditorClose: () => void = () => undefined;
  private onEditorOpen?: () => void;
  private isFinalizingToolCalls = false;
  private isScheduling = false;
  private toolContextInteractiveMode: boolean;
  private requestQueue: QueuedRequest[] = [];
  private readonly resultAggregator: ResultAggregator;

  // Track all callIds seen at the scheduler boundary to prevent duplicate execution
  private seenCallIds: Set<string> = new Set();
  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
   * @requirement REQ-D01-001.1
   * @requirement REQ-D01-001.2
   * @pseudocode lines 56-72
   */
  constructor(options: CoreToolSchedulerOptions) {
    this.config = options.config;
    this.toolExecutor = new ToolExecutor(this.config);
    this.toolDispatcher = new ToolDispatcher(
      options.toolRegistry,
      options.config,
    );
    this.setCallbacks(options);
    this.toolContextInteractiveMode =
      options.toolContextInteractiveMode ?? true;

    const resultPublishCallbacks: ResultPublishCallbacks = {
      setSuccess: (callId, response) =>
        this.setStatusInternal(callId, 'success', response),
      setError: (callId, response) =>
        this.setStatusInternal(callId, 'error', response),
      getFallbackOutputConfig: () => this.config,
    };
    this.resultAggregator = new ResultAggregator(resultPublishCallbacks);

    const statusMutator: StatusMutator = {
      setSuccess: (callId, response) =>
        this.setStatusInternal(callId, 'success', response),
      setError: (callId, response) =>
        this.setStatusInternal(callId, 'error', response),
      setCancelled: (callId, reason) =>
        this.setStatusInternal(callId, 'cancelled', reason),
      setAwaitingApproval: (callId, details) =>
        this.setStatusInternal(callId, 'awaiting_approval', details),
      setScheduled: (callId) => this.setStatusInternal(callId, 'scheduled'),
      setExecuting: (callId) => this.setStatusInternal(callId, 'executing'),
      setValidating: (callId) => this.setStatusInternal(callId, 'validating'),
      setArgs: (callId, args) => this.setArgsInternal(callId, args),
      setOutcome: (callId, outcome) => this.setToolCallOutcome(callId, outcome),
      approve: (callId) => this.approveToolCall(callId),
    };
    const schedulerAccessor: SchedulerAccessor = {
      attemptExecution: (signal) =>
        this.attemptExecutionOfScheduledCalls(signal),
      getToolCalls: () => this.toolCalls,
    };
    const editorCallbacks: EditorCallbacks = {
      getPreferredEditor: () => this.getPreferredEditor(),
      onEditorClose: () => this.onEditorClose(),
      onEditorOpen: () => this.onEditorOpen?.(),
    };
    this.confirmationCoordinator = new ConfirmationCoordinator(
      options.messageBus,
      options.config,
      statusMutator,
      schedulerAccessor,
      editorCallbacks,
      (config, details) => triggerToolNotificationHook(config, details),
    );
    this.confirmationCoordinator.subscribe();
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
   * Cleanup method to unsubscribe from message bus.
   * Call this when the scheduler is no longer needed.
   */
  dispose(): void {
    this.confirmationCoordinator.dispose();
    this.seenCallIds.clear();
  }

  private setStatusInternal(
    targetCallId: string,
    status: 'success',
    response: ToolCallResponseInfo,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'awaiting_approval',
    confirmationDetails:
      | ToolCallConfirmationDetails
      | SerializableConfirmationDetails,
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
    this.toolCalls = this.toolCalls.map((currentCall) =>
      applyTransition(currentCall, targetCallId, newStatus, auxiliaryData),
    );
    this.notifyToolCallsUpdate();
    void this.checkAndNotifyCompletion();
  }

  private setArgsInternal(targetCallId: string, args: unknown): void {
    this.toolCalls = this.toolCalls.map((call) => {
      // We should never be asked to set args on an ErroredToolCall, but
      // we guard for the case anyways.
      if (call.request.callId !== targetCallId || call.status === 'error') {
        return call;
      }

      setToolContext(
        call.tool,
        this.config.getSessionId(),
        call.request.agentId ?? DEFAULT_AGENT_ID,
        this.toolContextInteractiveMode,
      );

      const invocationOrError = this.toolDispatcher.buildInvocation(
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

  // Backward-compat shim: accessed via @ts-expect-error in coreToolScheduler.test.ts.
  // Delegates to ToolDispatcher.getToolSuggestion which owns the implementation.
  protected getToolSuggestion(unknownToolName: string, topN?: number): string {
    return this.toolDispatcher.getToolSuggestion(unknownToolName, topN);
  }

  // Backward-compat shim: accessed via @ts-expect-error in coreToolScheduler.publishingError.test.ts.
  // Delegates to ResultAggregator.publishBufferedResults which owns the implementation.
  // This indirection allows existing tests to spy on the scheduler's publishing step
  // without importing ResultAggregator directly.
  protected async publishBufferedResults(signal: AbortSignal): Promise<void> {
    return this.resultAggregator.publishBufferedResults(signal);
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

  private deduplicateRequests(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
  ): ToolCallRequestInfo[] {
    const requestsToProcess = (
      Array.isArray(request) ? request : [request]
    ).map((req) => {
      if (!req.agentId) {
        req.agentId = DEFAULT_AGENT_ID;
      }
      return req;
    });

    const freshRequests = requestsToProcess.filter(
      (r) => !this.seenCallIds.has(r.callId),
    );
    for (const req of freshRequests) {
      this.seenCallIds.add(req.callId);
    }
    return freshRequests;
  }

  private evaluateToolCall(
    toolCall: ToolCall,
    signal: AbortSignal,
  ): Promise<void> | void {
    if (toolCall.status !== 'validating') return;

    const { request: reqInfo } = toolCall;
    this.confirmationCoordinator.registerSignal(reqInfo.callId, signal);

    if (signal.aborted) {
      this.setStatusInternal(
        reqInfo.callId,
        'cancelled',
        'Tool call cancelled by user.',
      );
      return;
    }

    // Synchronous fast-path for ALLOW/DENY decisions.
    // Preserves original synchronous approval semantics:
    // all ALLOW tools reach 'scheduled' in the same microtask.
    if (this.confirmationCoordinator.tryFastApprove(toolCall)) {
      return;
    }

    // ASK path — requires async confirmation
    return this.confirmationCoordinator
      .evaluateAndRoute(toolCall, signal)
      .catch((error) => {
        if (signal.aborted) {
          this.setStatusInternal(
            reqInfo.callId,
            'cancelled',
            'Tool call cancelled by user.',
          );
          return;
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
      });
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

      const freshRequests = this.deduplicateRequests(request);
      if (freshRequests.length === 0) return;

      const governance = buildToolGovernance(this.config);
      const newToolCalls = this.toolDispatcher.resolveAndValidate(
        freshRequests,
        governance,
        this.toolContextInteractiveMode,
      );

      this.toolCalls = this.toolCalls.concat(newToolCalls);
      this.notifyToolCallsUpdate();

      for (const toolCall of newToolCalls) {
        const result = this.evaluateToolCall(toolCall, signal);
        if (result) await result;
      }

      await this.attemptExecutionOfScheduledCalls(signal);
      void this.checkAndNotifyCompletion();
    } finally {
      this.isScheduling = false;
    }
  }

  /**
   * Public delegating facade — preserves the original public API.
   * All confirmation flow logic now lives in ConfirmationCoordinator.
   */
  async handleConfirmationResponse(
    callId: string,
    originalOnConfirm: (
      outcome: ToolConfirmationOutcome,
      payload?: ToolConfirmationPayload,
    ) => Promise<void>,
    outcome: ToolConfirmationOutcome,
    signal: AbortSignal,
    payload?: ToolConfirmationPayload,
    skipBusPublish = false,
  ): Promise<void> {
    return this.confirmationCoordinator.handleConfirmationResponse(
      callId,
      originalOnConfirm,
      outcome,
      signal,
      payload,
      skipBusPublish,
    );
  }

  private approveToolCall(callId: string): void {
    this.setToolCallOutcome(callId, ToolConfirmationOutcome.ProceedAlways);
    this.setStatusInternal(callId, 'scheduled');
  }

  /**
   * Launch a single scheduled tool call and wire up result buffering / error handling.
   * @requirement:HOOK-017,HOOK-019,HOOK-129,HOOK-131,HOOK-132,HOOK-134 - Hook result application
   */
  private async launchToolExecution(
    scheduledCall: ScheduledToolCall,
    executionIndex: number,
    signal: AbortSignal,
  ): Promise<void> {
    const { callId, name: toolName } = scheduledCall.request;
    this.setStatusInternal(callId, 'executing');

    return this.toolExecutor
      .execute({
        call: scheduledCall,
        signal,
        onLiveOutput: scheduledCall.tool.canUpdateOutput
          ? (id: string, chunk: string | AnsiOutput) => {
              if (this.outputUpdateHandler) {
                try {
                  this.outputUpdateHandler(id, chunk);
                } catch (error) {
                  toolSchedulerLogger.debug(
                    () =>
                      `Error in outputUpdateHandler for ${id}: ${error instanceof Error ? error.message : String(error)}`,
                  );
                }
              }
              this.toolCalls = this.toolCalls.map((tc) =>
                tc.request.callId === id && tc.status === 'executing'
                  ? { ...tc, liveOutput: chunk }
                  : tc,
              );
              this.notifyToolCallsUpdate();
            }
          : undefined,
        onPid: (id: string, pid: number) => {
          this.setPidInternal(id, pid);
        },
      })
      .then(async (executionResult) => {
        this.resultAggregator.bufferResult(
          callId,
          toolName,
          scheduledCall,
          executionResult.result,
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
          this.resultAggregator.bufferCancelled(
            callId,
            scheduledCall,
            executionIndex,
          );
          await this.publishBufferedResults(signal);
        } else {
          this.resultAggregator.bufferError(
            callId,
            toolName,
            scheduledCall,
            executionError,
            executionIndex,
          );
          await this.publishBufferedResults(signal);
        }
      })
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
          this.setStatusInternal(
            callId,
            'error',
            createErrorResponse(
              scheduledCall.request,
              new Error(
                `Failed to publish tool result: ${publishError.message}`,
              ),
              ToolErrorType.UNHANDLED_EXCEPTION,
            ),
          );
        }
      });
  }

  private async attemptExecutionOfScheduledCalls(
    signal: AbortSignal,
  ): Promise<void> {
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

      // Begin the batch: sets batch size and applies per-tool output limits.
      // tool-output-max-tokens is a budget for all tool outputs combined,
      // divided equally among them. (#1301)
      this.resultAggregator.beginBatch(callsToExecute.length);

      // Execute all tools in parallel and wait for all to complete
      // @requirement:HOOK-134 - Hook results are now awaited, so we wait for all executions
      await Promise.all(
        callsToExecute
          .filter((toolCall) => toolCall.status === 'scheduled')
          .map((toolCall) => {
            const scheduledCall = toolCall;
            const executionIndex = executionIndices.get(
              scheduledCall.request.callId,
            )!;
            return this.launchToolExecution(
              scheduledCall,
              executionIndex,
              signal,
            );
          }),
      );
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
      // If we are already finalizing, another concurrent call to
      // checkAndNotifyCompletion will just return. The ongoing finalized loop
      // will handle the completion.
      if (this.isFinalizingToolCalls) {
        return;
      }

      const completedCalls = [...this.toolCalls] as CompletedToolCall[];
      this.toolCalls = [];

      // Clean up signal mappings for completed calls
      for (const call of completedCalls) {
        this.confirmationCoordinator.deleteSignal(call.request.callId);
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

    // 2. Reset batch bookkeeping state and confirmation state
    this.resultAggregator.reset();
    this.confirmationCoordinator.reset();
    this.seenCallIds.clear();

    // 3. Cancel all active tool calls
    this.toolCalls = this.toolCalls.map((call) => {
      if (
        call.status === 'success' ||
        call.status === 'error' ||
        call.status === 'cancelled'
      ) {
        return call;
      }
      return buildCancelAllEntry(call);
    });

    this.notifyToolCallsUpdate();
    void this.checkAndNotifyCompletion();
  }
}
