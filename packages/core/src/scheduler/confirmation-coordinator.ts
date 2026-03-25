/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @internal
 * Owns the entire confirmation flow lifecycle: MessageBus subscription,
 * policy evaluation routing, approval/cancel/modify/suggest-edit handling,
 * stale correlation management, and auto-approve cascading.
 *
 * Extracted from CoreToolScheduler as part of the Phase 3 decomposition
 * (issue 1580).
 */

import { randomUUID } from 'node:crypto';
import * as Diff from 'diff';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type ToolConfirmationResponse,
} from '../confirmation-bus/types.js';
import {
  ToolConfirmationOutcome,
} from '../tools/tools.js';
import type { ToolCallConfirmationDetails } from '../tools/tools.js';
import type { ToolConfirmationPayload } from '../tools/tool-confirmation-types.js';
import type { ToolCallResponseInfo } from '../core/turn.js';
import { PolicyDecision } from '../policy/types.js';
import {
  evaluatePolicyDecision,
  handlePolicyDenial,
  getPolicyContextFromInvocation,
  publishConfirmationRequest,
} from '../policy/policy-helpers.js';
import {
  isModifiableDeclarativeTool,
  modifyWithEditor,
  type ModifyContext,
} from '../tools/modifiable-tool.js';
import { doesToolInvocationMatch } from '../utils/tool-utils.js';
import { DebugLogger } from '../debug/index.js';
import type { WaitingToolCall, ToolCall, ValidatingToolCall } from './types.js';
import type { EditorType } from '../utils/editor.js';

const logger = new DebugLogger('llxprt:scheduler:confirmation-coordinator');

// ── Callback interfaces ────────────────────────────────────────────────────

/**
 * Discriminated status-mutation callbacks provided by CoreToolScheduler.
 * Each method maps 1:1 to a setStatusInternal overload.
 */
export interface StatusMutator {
  setSuccess(callId: string, response: ToolCallResponseInfo): void;
  setError(callId: string, response: ToolCallResponseInfo): void;
  setCancelled(callId: string, reason: string): void;
  setAwaitingApproval(callId: string, details: ToolCallConfirmationDetails): void;
  setScheduled(callId: string): void;
  setExecuting(callId: string): void;
  setValidating(callId: string): void;
  setArgs(callId: string, args: unknown): void;
  setOutcome(callId: string, outcome: ToolConfirmationOutcome): void;
  approve(callId: string): void;
}

/**
 * Accessor into the scheduler for reading tool call state and triggering
 * execution. The getter MUST return the current array on each call — stored
 * references become stale because setStatusInternal reassigns toolCalls[].
 */
export interface SchedulerAccessor {
  attemptExecution(signal: AbortSignal): Promise<void>;
  getToolCalls(): readonly ToolCall[];
}

/**
 * Editor-related callbacks from the host environment.
 */
export interface EditorCallbacks {
  getPreferredEditor(): EditorType | undefined;
  onEditorClose(): void;
  onEditorOpen?(): void;
}

// ── ConfirmationCoordinator ───────────────────────────────────────────────

/**
 * Coordinates the full confirmation flow for tool execution:
 * - Policy evaluation and routing (ALLOW/DENY/ASK)
 * - Confirmation prompt setup and MessageBus subscription
 * - Handling all confirmation outcomes (ProceedOnce, ProceedAlways, Cancel,
 *   ModifyWithEditor, SuggestEdit, inline modify)
 * - Auto-approving compatible pending tools after ProceedAlways
 * - Stale correlation ID grace-period management
 */
export class ConfirmationCoordinator {
  /** correlationId → callId */
  private readonly pendingConfirmations: Map<string, string> = new Map();
  /** correlationId → timeout handle — tracks stale IDs after ModifyWithEditor */
  private readonly staleCorrelationIds: Map<string, NodeJS.Timeout> = new Map();
  /** callIds already processed — prevents double-handling */
  private readonly processedConfirmations: Set<string> = new Set();
  /** callId → AbortSignal — populated via registerSignal(), removed via deleteSignal() */
  private readonly callIdToSignal: Map<string, AbortSignal> = new Map();
  /** MessageBus unsubscribe handle */
  private messageBusUnsubscribe?: () => void;

  constructor(
    private readonly messageBus: MessageBus,
    private readonly config: Config,
    private readonly statusMutator: StatusMutator,
    private readonly schedulerAccessor: SchedulerAccessor,
    private readonly editorCallbacks: EditorCallbacks,
    private readonly onToolNotification: (
      config: Config,
      details: ToolCallConfirmationDetails,
    ) => Promise<unknown>,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Subscribe to MessageBus TOOL_CONFIRMATION_RESPONSE events. */
  subscribe(): void {
    this.messageBusUnsubscribe = this.messageBus.subscribe<ToolConfirmationResponse>(
      MessageBusType.TOOL_CONFIRMATION_RESPONSE,
      this.handleMessageBusResponse.bind(this),
    );
  }

  /** Unsubscribe from MessageBus and reset all state. */
  dispose(): void {
    if (this.messageBusUnsubscribe) {
      this.messageBusUnsubscribe();
      this.messageBusUnsubscribe = undefined;
    }
    this.reset();
  }

  /** Clear all maps, sets, and timers. Called during cancelAll(). */
  reset(): void {
    this.pendingConfirmations.clear();
    this.processedConfirmations.clear();
    this.staleCorrelationIds.forEach((t) => clearTimeout(t));
    this.staleCorrelationIds.clear();
    this.callIdToSignal.clear();
  }

  // ── Signal lifecycle ───────────────────────────────────────────────────────

  /** Store an AbortSignal for a tool call so MessageBus responses can use it. */
  registerSignal(callId: string, signal: AbortSignal): void {
    this.callIdToSignal.set(callId, signal);
  }

  /** Remove the signal on terminal completion. */
  deleteSignal(callId: string): void {
    this.callIdToSignal.delete(callId);
  }

  // ── Policy evaluation and routing ─────────────────────────────────────────

  /**
   * Synchronous fast-path for ALLOW and DENY policy decisions.
   * Returns true if the decision was handled synchronously (no async work needed).
   * Returns false if the decision is ASK and requires async confirmation.
   *
   * This preserves the synchronous approval semantics of the original _schedule loop,
   * which is critical for tests that rely on all tools reaching 'executing' state
   * within the same microtask as schedule().
   */
  tryFastApprove(
    toolCall: ValidatingToolCall,
  ): boolean {
    const { request: reqInfo, invocation } = toolCall;

    const evaluation = evaluatePolicyDecision(
      invocation,
      reqInfo,
      this.config.getPolicyEngine(),
    );

    if (evaluation.decision === PolicyDecision.ALLOW) {
      this.approveInternal(reqInfo.callId);
      return true;
    }

    if (evaluation.decision === PolicyDecision.DENY) {
      handlePolicyDenial(
        reqInfo,
        evaluation.context,
        (callId, _status, response) =>
          this.statusMutator.setError(callId, response),
        this.messageBus,
      );
      return true;
    }

    return false;
  }

  /**
   * Async confirmation path for PolicyDecision.ASK.
   * Called only when tryFastApprove returns false.
   */
  async evaluateAndRoute(
    toolCall: ValidatingToolCall,
    signal: AbortSignal,
  ): Promise<void> {
    const { request: reqInfo, invocation } = toolCall;

    const evaluation = evaluatePolicyDecision(
      invocation,
      reqInfo,
      this.config.getPolicyEngine(),
    );

    // ALLOW and DENY should have been handled by tryFastApprove, but
    // handle them here as well for safety
    if (evaluation.decision === PolicyDecision.ALLOW) {
      this.approveInternal(reqInfo.callId);
      return;
    }

    if (evaluation.decision === PolicyDecision.DENY) {
      handlePolicyDenial(
        reqInfo,
        evaluation.context,
        (callId, _status, response) =>
          this.statusMutator.setError(callId, response),
        this.messageBus,
      );
      return;
    }

    // PolicyDecision.ASK — check shouldConfirmExecute
    const confirmationDetails = await invocation.shouldConfirmExecute(signal);

    if (!confirmationDetails) {
      this.approveInternal(reqInfo.callId);
      return;
    }

    const allowedTools = this.config.getAllowedTools() || [];
    if (
      this.config.getApprovalMode() === ApprovalMode.YOLO ||
      doesToolInvocationMatch(toolCall.tool, invocation, allowedTools)
    ) {
      this.approveInternal(reqInfo.callId);
      return;
    }

    await this.setupConfirmationPrompt(
      toolCall,
      signal,
      confirmationDetails,
      evaluation.context ?? getPolicyContextFromInvocation(invocation, reqInfo),
    );
  }

  /**
   * Set up the interactive confirmation prompt:
   * - Wire IDE resolution promise if present
   * - Wrap onConfirm to route through handleConfirmationResponse
   * - Publish confirmation request and set awaiting_approval status
   */
  private async setupConfirmationPrompt(
    toolCall: ValidatingToolCall,
    signal: AbortSignal,
    confirmationDetails: ToolCallConfirmationDetails,
    policyContext: { toolName: string; args: Record<string, unknown>; serverName?: string },
  ): Promise<void> {
    const { request: reqInfo } = toolCall;

    if (!this.config.isInteractive()) {
      throw new Error(
        `Tool execution for "${
          toolCall.tool.displayName || toolCall.tool.name
        }" requires user confirmation, which is not supported in non-interactive mode.`,
      );
    }

    if (
      confirmationDetails.type === 'edit' &&
      confirmationDetails.ideConfirmation
    ) {
      void confirmationDetails.ideConfirmation.then((resolution) => {
        const outcome =
          resolution.status === 'accepted'
            ? ToolConfirmationOutcome.ProceedOnce
            : ToolConfirmationOutcome.Cancel;
        void this.handleConfirmationResponse(
          reqInfo.callId,
          confirmationDetails.onConfirm,
          outcome,
          signal,
        );
      });
    }

    const originalOnConfirm = confirmationDetails.onConfirm;
    const correlationId = randomUUID();

    const wrappedDetails: ToolCallConfirmationDetails = {
      ...confirmationDetails,
      correlationId,
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

    this.pendingConfirmations.set(correlationId, reqInfo.callId);
    void this.onToolNotification(this.config, wrappedDetails);
    publishConfirmationRequest(correlationId, policyContext, this.messageBus);
    this.statusMutator.setAwaitingApproval(reqInfo.callId, wrappedDetails);
  }

  // ── MessageBus handler ────────────────────────────────────────────────────

  /**
   * Called when a TOOL_CONFIRMATION_RESPONSE arrives on the MessageBus.
   * Validates the correlation, derives the outcome, and dispatches to
   * handleConfirmationResponse.
   */
  private handleMessageBusResponse(response: ToolConfirmationResponse): void {
    const callId = this.pendingConfirmations.get(response.correlationId);

    if (!callId && this.staleCorrelationIds.has(response.correlationId)) {
      if (logger.enabled) {
        logger.debug(
          () =>
            `Received TOOL_CONFIRMATION_RESPONSE for stale correlationId=${response.correlationId}. Ignoring.`,
        );
      }
      return;
    }

    if (!callId) {
      if (logger.enabled) {
        logger.debug(
          () =>
            `Received TOOL_CONFIRMATION_RESPONSE for unknown correlationId=${response.correlationId}`,
        );
      }
      return;
    }

    const waitingToolCall = this.schedulerAccessor
      .getToolCalls()
      .find(
        (call) =>
          call.request.callId === callId && call.status === 'awaiting_approval',
      ) as WaitingToolCall | undefined;

    if (!waitingToolCall) {
      if (logger.enabled) {
        logger.debug(
          () =>
            `No waiting tool call found for correlationId=${response.correlationId}, callId=${callId}`,
        );
      }
      this.pendingConfirmations.delete(response.correlationId);
      return;
    }

    const derivedOutcome = this.deriveOutcome(response);
    const signal = this.callIdToSignal.get(callId);

    if (!signal) {
      if (logger.enabled) {
        logger.debug(
          () =>
            `Skipping TOOL_CONFIRMATION_RESPONSE for callId=${callId} — signal missing (call already finalized).`,
        );
      }
      this.pendingConfirmations.delete(response.correlationId);
      return;
    }

    void this.handleConfirmationResponse(
      callId,
      waitingToolCall.confirmationDetails.onConfirm,
      derivedOutcome,
      signal,
      response.payload,
      true,
    );
  }

  private deriveOutcome(response: ToolConfirmationResponse): ToolConfirmationOutcome {
    return (
      response.outcome ??
      (response.confirmed !== undefined
        ? response.confirmed
          ? ToolConfirmationOutcome.ProceedOnce
          : ToolConfirmationOutcome.Cancel
        : ToolConfirmationOutcome.Cancel)
    );
  }

  // ── Main confirmation dispatcher ──────────────────────────────────────────

  /**
   * Public facade: handle a confirmation response for the given callId.
   * Routes to the appropriate sub-handler based on the outcome.
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
    if (this.processedConfirmations.has(callId)) {
      if (logger.enabled) {
        logger.debug(() => `Skipping duplicate confirmation for callId=${callId}`);
      }
      return;
    }
    this.processedConfirmations.add(callId);

    const waitingToolCall = this.findWaitingToolCall(callId);
    const previousCorrelationId = waitingToolCall?.confirmationDetails?.correlationId;

    await originalOnConfirm(outcome, payload);

    if (outcome === ToolConfirmationOutcome.ProceedAlways) {
      await this.autoApproveCompatiblePendingTools(signal, callId);
    }

    this.statusMutator.setOutcome(callId, outcome);

    if (outcome === ToolConfirmationOutcome.Cancel || signal.aborted) {
      await this.handleCancellation(callId);
    } else if (outcome === ToolConfirmationOutcome.ModifyWithEditor && waitingToolCall) {
      await this.handleModifyWithEditor(callId, waitingToolCall, signal);
    } else {
      await this.handleApproval(callId, waitingToolCall, outcome, payload, signal);
    }

    await this.publishOutcome(previousCorrelationId, outcome, payload, skipBusPublish);
  }

  // ── Sub-handlers ──────────────────────────────────────────────────────────

  private async handleCancellation(callId: string): Promise<void> {
    this.statusMutator.setCancelled(callId, 'User did not allow tool call');
  }

  private async handleApproval(
    callId: string,
    waitingToolCall: WaitingToolCall | undefined,
    outcome: ToolConfirmationOutcome,
    payload: ToolConfirmationPayload | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    if (outcome === ToolConfirmationOutcome.SuggestEdit && waitingToolCall) {
      this.handleSuggestEdit(callId, waitingToolCall, payload);
    } else if (payload?.newContent && waitingToolCall) {
      await this.handleInlineModify(callId, waitingToolCall, payload, signal);
      return; // setScheduled is called inside handleInlineModify
    }
    this.statusMutator.setScheduled(callId);
    await this.schedulerAccessor.attemptExecution(signal);
  }

  private handleSuggestEdit(
    callId: string,
    waitingToolCall: WaitingToolCall,
    payload: ToolConfirmationPayload | undefined,
  ): void {
    if (
      waitingToolCall.confirmationDetails.type === 'exec' &&
      payload?.editedCommand
    ) {
      const updatedArgs = {
        ...waitingToolCall.request.args,
        command: payload.editedCommand,
      };
      this.statusMutator.setArgs(callId, updatedArgs);
    }
  }

  private async handleInlineModify(
    callId: string,
    waitingToolCall: WaitingToolCall,
    payload: ToolConfirmationPayload,
    signal: AbortSignal,
  ): Promise<void> {
    await this._applyInlineModify(waitingToolCall, payload.newContent!, signal);
    this.statusMutator.setScheduled(callId);
    await this.schedulerAccessor.attemptExecution(signal);
  }

  private async handleModifyWithEditor(
    callId: string,
    waitingToolCall: WaitingToolCall,
    signal: AbortSignal,
  ): Promise<void> {
    if (!isModifiableDeclarativeTool(waitingToolCall.tool)) {
      return;
    }

    const modifyContext = waitingToolCall.tool.getModifyContext(signal);
    const editorType = this.editorCallbacks.getPreferredEditor();
    if (!editorType) {
      return;
    }

    this.statusMutator.setAwaitingApproval(callId, {
      ...waitingToolCall.confirmationDetails,
      isModifying: true,
    } as ToolCallConfirmationDetails);

    const contentOverrides =
      waitingToolCall.confirmationDetails.type === 'edit'
        ? {
            currentContent: waitingToolCall.confirmationDetails.originalContent,
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
      this.editorCallbacks.onEditorClose,
      this.editorCallbacks.onEditorOpen,
      contentOverrides,
    );

    this.statusMutator.setArgs(callId, updatedParams);

    const newCorrelationId = randomUUID();
    const updatedDetails: ToolCallConfirmationDetails = {
      ...waitingToolCall.confirmationDetails,
      fileDiff: updatedDiff,
      isModifying: false,
      correlationId: newCorrelationId,
    } as ToolCallConfirmationDetails;

    this.pendingConfirmations.set(newCorrelationId, callId);
    this.processedConfirmations.delete(callId);

    const context = getPolicyContextFromInvocation(
      waitingToolCall.invocation,
      waitingToolCall.request,
    );
    publishConfirmationRequest(newCorrelationId, context, this.messageBus);
    this.statusMutator.setAwaitingApproval(callId, updatedDetails);

    this.registerStaleCorrelationId(
      waitingToolCall.confirmationDetails.correlationId,
      newCorrelationId,
    );
  }

  private registerStaleCorrelationId(
    previousCorrelationId: string | undefined,
    newCorrelationId: string,
  ): void {
    if (!previousCorrelationId) return;

    const graceTimeout = setTimeout(() => {
      this.staleCorrelationIds.delete(previousCorrelationId);
      if (logger.enabled) {
        logger.debug(
          () =>
            `Removed stale correlationId=${previousCorrelationId} after grace period`,
        );
      }
    }, 2000);

    this.staleCorrelationIds.set(previousCorrelationId, graceTimeout);
    if (logger.enabled) {
      logger.debug(
        () =>
          `Marked correlationId=${previousCorrelationId} as stale with 2s grace period after ModifyWithEditor created new correlationId=${newCorrelationId}`,
      );
    }
  }

  // ── Auto-approve cascade ──────────────────────────────────────────────────

  /**
   * After a ProceedAlways outcome, check all other pending tools and
   * auto-approve those that no longer need confirmation.
   */
  private async autoApproveCompatiblePendingTools(
    signal: AbortSignal,
    triggeringCallId: string,
  ): Promise<void> {
    const pendingTools = this.schedulerAccessor
      .getToolCalls()
      .filter(
        (call) =>
          call.status === 'awaiting_approval' &&
          call.request.callId !== triggeringCallId,
      ) as WaitingToolCall[];

    for (const pendingTool of pendingTools) {
      try {
        const stillNeedsConfirmation =
          await pendingTool.invocation.shouldConfirmExecute(signal);

        if (!stillNeedsConfirmation) {
          this.statusMutator.setOutcome(
            pendingTool.request.callId,
            ToolConfirmationOutcome.ProceedAlways,
          );
          this.statusMutator.setScheduled(pendingTool.request.callId);
        }
      } catch (error) {
        logger.debug(
          () =>
            `Error checking confirmation for tool ${pendingTool.request.callId}: ${error}`,
        );
      }
    }
  }

  // ── Inline modify ─────────────────────────────────────────────────────────

  /**
   * Applies user-provided content changes to a tool call awaiting confirmation.
   * Updates the tool's arguments and refreshes the confirmation prompt with a
   * new diff.
   */
  private async _applyInlineModify(
    toolCall: WaitingToolCall,
    newContent: string,
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
      newContent,
      toolCall.request.args,
    );
    const updatedDiff = Diff.createPatch(
      modifyContext.getFilePath(toolCall.request.args),
      currentContent,
      newContent,
      'Current',
      'Proposed',
    );

    this.statusMutator.setArgs(toolCall.request.callId, updatedParams);
    this.statusMutator.setAwaitingApproval(toolCall.request.callId, {
      ...toolCall.confirmationDetails,
      fileDiff: updatedDiff,
    });
  }

  // ── Bus publish ────────────────────────────────────────────────────────────

  private async publishOutcome(
    correlationId: string | undefined,
    outcome: ToolConfirmationOutcome,
    payload: ToolConfirmationPayload | undefined,
    skipBusPublish: boolean,
  ): Promise<void> {
    if (!correlationId) return;

    this.pendingConfirmations.delete(correlationId);

    if (!skipBusPublish) {
      const confirmed =
        outcome !== ToolConfirmationOutcome.Cancel &&
        outcome !== ToolConfirmationOutcome.ModifyWithEditor &&
        outcome !== ToolConfirmationOutcome.SuggestEdit;
      this.messageBus.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId,
        outcome,
        payload,
        confirmed,
        requiresUserConfirmation: false,
      });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private approveInternal(callId: string): void {
    this.statusMutator.setOutcome(callId, ToolConfirmationOutcome.ProceedAlways);
    this.statusMutator.setScheduled(callId);
  }

  private findWaitingToolCall(callId: string): WaitingToolCall | undefined {
    const toolCall = this.schedulerAccessor
      .getToolCalls()
      .find(
        (c) => c.request.callId === callId && c.status === 'awaiting_approval',
      );
    if (toolCall && toolCall.status === 'awaiting_approval') {
      return toolCall;
    }
    return undefined;
  }
}
