/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03,P06,P08
 * @plan PLAN-20250218-HOOKSYSTEM.P03
 * @requirement:HOOK-061,HOOK-062,HOOK-143,HOOK-144,HOOK-145,HOOK-146,HOOK-147
 * @requirement DELTA-HSYS-001,DELTA-HEVT-004,DELTA-HFAIL-005,DELTA-HPAY-006
 * @pseudocode:analysis/pseudocode/02-hook-event-handler-flow.md
 */

import type { Config } from '../config/config.js';
import type { HookRegistry } from './hookRegistry.js';
import type { HookPlanner } from './hookPlanner.js';
import type { HookRunner } from './hookRunner.js';
import type { HookAggregator, AggregatedHookResult } from './hookAggregator.js';
import type {
  HookInput,
  DefaultHookOutput,
  SessionStartSource,
  SessionEndReason,
  HookExecutionResult,
} from './types.js';
import { HookEventName, NotificationType } from './types.js';
import { DebugLogger } from '../debug/index.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  validateBeforeToolInput,
  validateAfterToolInput,
  validateBeforeAgentInput,
  validateAfterAgentInput,
  validateBeforeModelInput,
  validateAfterModelInput,
  validateBeforeToolSelectionInput,
  validateNotificationInput,
} from './hookValidators.js';

const moduleDebugLogger = DebugLogger.getLogger(
  'llxprt:core:hooks:eventHandler',
);

/**
 * Metadata for failure envelopes
 * @plan PLAN-20250218-HOOKSYSTEM.P03
 * @requirement DELTA-HFAIL-005
 */
export interface FailureMeta {
  hookId?: string;
  eventName?: string;
  [key: string]: unknown;
}

/**
 * Processed hook result with common-output semantics.
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P12
 * @requirement DELTA-HRUN-004
 */
export interface ProcessedHookResult {
  aggregated: AggregatedHookResult;
  shouldStop: boolean;
  stopReason: string | undefined;
  systemMessage: string | undefined;
  suppressOutput: boolean;
}

/**
 * Empty success result for no-op scenarios
 * @requirement:HOOK-145
 */
const EMPTY_SUCCESS_RESULT: AggregatedHookResult = {
  success: true,
  finalOutput: undefined,
  allOutputs: [],
  errors: [],
  totalDuration: 0,
};

/**
 * HookEventHandler coordinates hook execution for all event types.
 * It builds HookInput payloads, delegates to planner/runner/aggregator,
 * and returns typed results to callers.
 *
 * @requirement:HOOK-143 - Exposes fire*Event methods for all hook events
 * @requirement:HOOK-144 - Builds HookInput payloads with base fields from Config
 * @requirement:HOOK-145 - Returns empty success result when no hooks match
 * @requirement:HOOK-146 - Logs telemetry at debug level for every event fire
 * @requirement:HOOK-147 - Wraps fire*Event body in try/catch, never propagates exceptions
 */
export class HookEventHandler {
  private readonly config: Config;
  private readonly planner: HookPlanner;
  private readonly runner: HookRunner;
  private readonly aggregator: HookAggregator;

  /**
   * Reserved for future pub/sub integration; injected but not yet consumed.
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HSYS-001
   */
  private readonly messageBus: MessageBus | undefined;

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HSYS-001
   */
  private readonly debugLogger: DebugLogger;

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HEVT-004
   */
  private disposed = false;

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HEVT-004
   */
  private subscriptionHandle: { unsubscribe(): void } | undefined = undefined;

  /**
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @plan PLAN-20250218-HOOKSYSTEM.P08
   * @requirement DELTA-HSYS-001, DELTA-HEVT-001
   * @pseudocode message-bus-integration.md lines 50-56
   */
  constructor(
    config: Config,
    _registry: HookRegistry, // Retained for future use, planner already has reference
    planner: HookPlanner,
    runner: HookRunner,
    aggregator: HookAggregator,
    messageBus?: MessageBus,
    injectedDebugLogger?: DebugLogger,
  ) {
    this.config = config;
    this.planner = planner;
    this.runner = runner;
    this.aggregator = aggregator;
    this.messageBus = messageBus;
    this.debugLogger = injectedDebugLogger ?? moduleDebugLogger;

    // Wire MessageBus subscription if available
    // @plan PLAN-20250218-HOOKSYSTEM.P08
    // @requirement DELTA-HEVT-001
    // @pseudocode message-bus-integration.md lines 54-55
    if (this.messageBus !== undefined) {
      const unsubscribeFn = this.messageBus.subscribe(
        'HOOK_EXECUTION_REQUEST' as import('../confirmation-bus/types.js').MessageBusType,
        (msg: unknown) => {
          void this.onBusRequest(msg);
        },
      );
      this.subscriptionHandle = { unsubscribe: unsubscribeFn };
    }
  }

  /**
   * Build base HookInput fields from Config
   * @requirement:HOOK-144
   */
  private buildBaseInput(eventName: string): HookInput {
    return {
      session_id: this.config.getSessionId(),
      cwd: this.config.getTargetDir(),
      timestamp: new Date().toISOString(),
      hook_event_name: eventName,
      transcript_path: '',
    };
  }

  /**
   * Fire BeforeTool event
   * @requirement:HOOK-143
   */
  async fireBeforeToolEvent(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<DefaultHookOutput | undefined> {
    return this.executeEvent(HookEventName.BeforeTool, {
      tool_name: toolName,
      tool_input: toolInput,
    });
  }

  /**
   * Fire AfterTool event
   * @requirement:HOOK-143
   */
  async fireAfterToolEvent(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolResponse: Record<string, unknown>,
  ): Promise<DefaultHookOutput | undefined> {
    return this.executeEvent(HookEventName.AfterTool, {
      tool_name: toolName,
      tool_input: toolInput,
      tool_response: toolResponse,
    });
  }

  /**
   * Fire BeforeModel event
   * @requirement:HOOK-143
   * @plan PLAN-20250218-HOOKSYSTEM.P12
   * @requirement DELTA-HFAIL-001
   */
  async fireBeforeModelEvent(
    llmRequest: unknown,
  ): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult(HookEventName.BeforeModel, {
        llmRequest,
      });
    } catch (error) {
      return this.buildFailureEnvelope(error, 'fireBeforeModelEvent', {
        eventName: HookEventName.BeforeModel,
      });
    }
  }

  /**
   * Fire AfterModel event
   * @requirement:HOOK-143
   * @plan PLAN-20250218-HOOKSYSTEM.P12
   * @requirement DELTA-HFAIL-001
   */
  async fireAfterModelEvent(
    llmRequest: unknown,
    llmResponse: unknown,
  ): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult(HookEventName.AfterModel, {
        llmRequest,
        llmResponse,
      });
    } catch (error) {
      return this.buildFailureEnvelope(error, 'fireAfterModelEvent', {
        eventName: HookEventName.AfterModel,
      });
    }
  }

  /**
   * Fire BeforeToolSelection event
   * @requirement:HOOK-143
   * @plan PLAN-20250218-HOOKSYSTEM.P12
   * @requirement DELTA-HFAIL-001
   */
  async fireBeforeToolSelectionEvent(
    llmRequest: unknown,
  ): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult(
        HookEventName.BeforeToolSelection,
        { llmRequest },
      );
    } catch (error) {
      return this.buildFailureEnvelope(error, 'fireBeforeToolSelectionEvent', {
        eventName: HookEventName.BeforeToolSelection,
      });
    }
  }

  /**
   * Fire SessionStart event
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P03, PLAN-20250218-HOOKSYSTEM.P12
   * @requirement DELTA-HPAY-006, DELTA-HFAIL-001
   * @requirement:HOOK-143
   */
  async fireSessionStartEvent(context: {
    source: SessionStartSource;
  }): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult(
        HookEventName.SessionStart,
        context as unknown as Record<string, unknown>,
      );
    } catch (error) {
      return this.buildFailureEnvelope(error, 'fireSessionStartEvent', {
        eventName: HookEventName.SessionStart,
      });
    }
  }

  /**
   * Fire SessionEnd event
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P03, PLAN-20250218-HOOKSYSTEM.P12
   * @requirement DELTA-HPAY-006, DELTA-HFAIL-001
   * @requirement:HOOK-143
   */
  async fireSessionEndEvent(context: {
    reason: SessionEndReason;
  }): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult(
        HookEventName.SessionEnd,
        context as unknown as Record<string, unknown>,
      );
    } catch (error) {
      return this.buildFailureEnvelope(error, 'fireSessionEndEvent', {
        eventName: HookEventName.SessionEnd,
      });
    }
  }

  /**
   * Fire BeforeAgent event
   * @requirement:HOOK-143
   * @plan PLAN-20250218-HOOKSYSTEM.P12
   * @requirement DELTA-HFAIL-001
   */
  async fireBeforeAgentEvent(context: {
    prompt: string;
  }): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult(
        HookEventName.BeforeAgent,
        context,
      );
    } catch (error) {
      return this.buildFailureEnvelope(error, 'fireBeforeAgentEvent', {
        eventName: HookEventName.BeforeAgent,
      });
    }
  }

  /**
   * Fire AfterAgent event
   * @requirement:HOOK-143
   * @plan PLAN-20250218-HOOKSYSTEM.P12
   * @requirement DELTA-HFAIL-001
   */
  async fireAfterAgentEvent(context: {
    prompt: string;
    prompt_response: string;
    stop_hook_active: boolean;
  }): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult(
        HookEventName.AfterAgent,
        context,
      );
    } catch (error) {
      return this.buildFailureEnvelope(error, 'fireAfterAgentEvent', {
        eventName: HookEventName.AfterAgent,
      });
    }
  }

  /**
   * Fire Notification event (e.g., ToolPermission before confirmation dialog)
   * @requirement:HOOK-143
   * @plan PLAN-20250218-HOOKSYSTEM.P12
   * @requirement DELTA-HFAIL-001
   */
  async fireNotificationEvent(
    type: NotificationType,
    message: string,
    details: Record<string, unknown>,
  ): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult(HookEventName.Notification, {
        notification_type: type,
        message,
        details,
      });
    } catch (error) {
      return this.buildFailureEnvelope(error, 'fireNotificationEvent', {
        eventName: HookEventName.Notification,
      });
    }
  }

  /**
   * Execute an event and return the final output (or undefined)
   * @requirement:HOOK-147 - Wraps in try/catch
   */
  private async executeEvent(
    eventName: HookEventName,
    context: Record<string, unknown>,
  ): Promise<DefaultHookOutput | undefined> {
    try {
      const result = await this.executeEventWithFullResult(eventName, context);
      return result.finalOutput;
    } catch (error) {
      this.debugLogger.warn(`${eventName} hook error (non-fatal): ${error}`);
      return undefined;
    }
  }

  /**
   * Execute an event and return the full aggregated result
   * @requirement:HOOK-145,HOOK-146
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HFAIL-005
   */
  private async executeEventWithFullResult(
    eventName: HookEventName,
    context: Record<string, unknown>,
  ): Promise<AggregatedHookResult> {
    const startTime = Date.now();

    // Create execution plan
    const plan = this.planner.createExecutionPlan(
      eventName,
      context.tool_name ? { toolName: context.tool_name as string } : undefined,
    );

    // No matching hooks - return empty success
    // @requirement:HOOK-145
    // @plan PLAN-20250218-HOOKSYSTEM.P12
    // @requirement DELTA-HFAIL-004
    if (!plan || plan.hookConfigs.length === 0) {
      this.debugLogger.debug(
        `No hooks for event ${eventName}, returning empty success`,
      );
      return this.makeEmptySuccessResult();
    }

    // Build input payload
    const baseInput = this.buildBaseInput(eventName);
    const input = { ...baseInput, ...context } as HookInput;

    // Execute hooks
    const results = plan.sequential
      ? await this.runner.executeHooksSequential(
          plan.hookConfigs,
          eventName,
          input,
        )
      : await this.runner.executeHooksParallel(
          plan.hookConfigs,
          eventName,
          input,
        );

    // Aggregate results
    const aggregated = this.aggregator.aggregateResults(results, eventName);

    const duration = Date.now() - startTime;

    // Process common-output semantics (P12 stub - P14 will implement)
    // @plan PLAN-20250218-HOOKSYSTEM.P12
    // @requirement DELTA-HRUN-001
    // Note: P14 will change this to use the return value
    this.processCommonHookOutputFields(aggregated);

    // Emit per-hook logs (P12 stub - P14 will implement)
    // @plan PLAN-20250218-HOOKSYSTEM.P12
    // @requirement DELTA-HTEL-001
    this.emitPerHookLogs(eventName, results);

    // Emit batch summary (P12 stub - P14 will implement)
    // @plan PLAN-20250218-HOOKSYSTEM.P12
    // @requirement DELTA-HTEL-002
    this.emitBatchSummary(eventName, results, duration);

    // Log telemetry
    // @requirement:HOOK-146
    this.debugLogger.debug(
      `Hook event ${eventName}: ${plan.hookConfigs.length} hook(s), ${duration}ms, success=${aggregated.success}`,
    );

    return aggregated;
  }

  /**
   * Return a copy of the empty success result for use in no-op scenarios.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HFAIL-005
   */
  makeEmptySuccessResult(): AggregatedHookResult {
    return { ...EMPTY_SUCCESS_RESULT };
  }

  /**
   * Build a failure envelope for error reporting.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @requirement DELTA-HFAIL-005
   */
  buildFailureEnvelope(
    error: unknown,
    stage: string,
    meta?: FailureMeta,
  ): AggregatedHookResult {
    const wrappedError =
      error instanceof Error ? error : new Error(String(error));
    this.debugLogger.warn(
      `Hook failure at stage=${stage} meta=${JSON.stringify(meta ?? {})}: ${wrappedError.message}`,
    );
    return {
      success: false,
      finalOutput: undefined,
      allOutputs: [],
      errors: [wrappedError],
      totalDuration: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Common-Output Semantics (Phase 12)
  // ---------------------------------------------------------------------------

  /**
   * Process common hook output fields (shouldStop, systemMessage, suppressOutput).
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P12, PLAN-20250218-HOOKSYSTEM.P14
   * @requirement DELTA-HRUN-001, DELTA-HRUN-004
   */
  private processCommonHookOutputFields(
    aggregated: AggregatedHookResult,
  ): ProcessedHookResult {
    let shouldStop = false;
    let stopReason: string | undefined = undefined;
    let systemMessage: string | undefined = undefined;
    let suppressOutput = false;

    // Pass 1 - stop intent (first wins): triggered by continue === false (upstream parity)
    for (const hookOutput of aggregated.allOutputs ?? []) {
      if (hookOutput.continue === false) {
        shouldStop = true;
        // Use effective reason: reason, stopReason, or fallback
        stopReason =
          this.normalizeStopReason(hookOutput.reason) ??
          this.normalizeStopReason(hookOutput.stopReason) ??
          'Hook requested stop';
        break;
      }
    }

    // Pass 2 - systemMessage and suppressOutput (first non-empty systemMessage wins)
    for (const hookOutput of aggregated.allOutputs ?? []) {
      if (hookOutput.systemMessage != null && hookOutput.systemMessage !== '') {
        systemMessage = hookOutput.systemMessage;
        if (hookOutput.suppressOutput === true) {
          suppressOutput = true;
        }
        break;
      }
    }

    return {
      aggregated,
      shouldStop,
      stopReason,
      systemMessage,
      suppressOutput,
    };
  }

  /**
   * Normalize a raw stopReason value to a trimmed string or undefined.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P14
   * @requirement DELTA-HRUN-002
   */
  private normalizeStopReason(rawReason: unknown): string | undefined {
    if (rawReason === undefined || rawReason === null) return undefined;
    if (typeof rawReason === 'string') {
      const trimmed = rawReason.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    }
    return String(rawReason);
  }

  /**
   * Emit per-hook log records via DebugLogger.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P12, PLAN-20250218-HOOKSYSTEM.P14
   * @requirement DELTA-HTEL-001
   * @requirement DELTA-HTEL-003
   */
  private emitPerHookLogs(
    eventName: HookEventName,
    hookResults: readonly HookExecutionResult[],
  ): void {
    if (this.debugLogger === undefined) return;

    for (const result of hookResults) {
      const record = {
        eventName: String(eventName),
        hookIdentity: result.hookConfig?.type ?? 'unknown',
        duration: result.duration,
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        errorMessage: result.success
          ? undefined
          : (result.error?.message ?? 'execution failed'),
      };

      this.debugLogger.log('hook:result', record);

      if (!result.success) {
        this.debugLogger.log('hook:failure_diagnostic', {
          ...record,
          error: result.error,
        });
      }
    }
  }

  /**
   * Emit batch-level summary via DebugLogger.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P12, PLAN-20250218-HOOKSYSTEM.P14
   * @requirement DELTA-HTEL-002
   */
  private emitBatchSummary(
    eventName: HookEventName,
    hookResults: readonly HookExecutionResult[],
    totalDurationMs: number,
  ): void {
    if (this.debugLogger === undefined) return;

    const hookCount = hookResults.length;
    const successCount = hookResults.filter((r) => r.success).length;
    const failureCount = hookCount - successCount;

    this.debugLogger.log('hook:batch_summary', {
      eventName: String(eventName),
      hookCount,
      successCount,
      failureCount,
      totalDurationMs,
    });
  }

  // ---------------------------------------------------------------------------
  // MessageBus integration (Phase 08)
  // ---------------------------------------------------------------------------

  /**
   * Handle incoming HOOK_EXECUTION_REQUEST from the message bus.
   * Routes to appropriate executeEventWithFullResult based on eventName.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P08
   * @requirement DELTA-HEVT-001, DELTA-HEVT-002
   * @pseudocode message-bus-integration.md lines 60-81
   */
  private onBusRequest = async (rawMessage: unknown): Promise<void> => {
    // Line 61: IF disposed → return silently
    if (this.disposed) return;

    // Line 67: extract correlationId
    const correlationId = this.extractCorrelationId(rawMessage);

    try {
      // Lines 70-73: validate structure
      if (
        rawMessage === null ||
        typeof rawMessage !== 'object' ||
        !('payload' in rawMessage)
      ) {
        this.publishResponse({
          correlationId,
          success: false,
          error: { code: 'invalid_request', message: 'Missing payload' },
        });
        return;
      }

      const payload = (rawMessage as { payload: unknown }).payload;
      if (
        payload === null ||
        typeof payload !== 'object' ||
        !('eventName' in payload) ||
        !('input' in payload)
      ) {
        this.publishResponse({
          correlationId,
          success: false,
          error: {
            code: 'invalid_request',
            message: 'Missing eventName or input',
          },
        });
        return;
      }

      const request = payload as { eventName: unknown; input: unknown };

      // Line 77: delegate to routeAndExecuteMediated
      const result = await this.routeAndExecuteMediated(
        request.eventName,
        request.input,
        correlationId,
      );

      // Line 78: publish response with result's success status
      this.publishResponse({
        correlationId,
        success: result.success,
        output: result,
      });
    } catch (error) {
      // Lines 79-80: catch → publish failure
      const errorObj = error as { code?: string; message?: string };
      this.publishResponse({
        correlationId,
        success: false,
        error: {
          code: errorObj.code ?? 'internal_error',
          message:
            errorObj.message ??
            (error instanceof Error ? error.message : String(error)),
        },
      });
    }
  };

  /**
   * Route and execute a mediated hook request.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P08
   * @requirement DELTA-HEVT-003, DELTA-HPAY-003
   * @pseudocode message-bus-integration.md lines 90-114
   */
  private async routeAndExecuteMediated(
    eventName: unknown,
    input: unknown,
    _correlationId: string,
  ): Promise<AggregatedHookResult> {
    // Lines 92-95: validate eventName is known HookEventName
    if (!Object.values(HookEventName).includes(eventName as HookEventName)) {
      throw {
        code: 'unsupported_event',
        message: 'Unknown event: ' + eventName,
      };
    }

    // Lines 97-101: validate event payload before execution
    // @plan PLAN-20250218-HOOKSYSTEM.P09
    // @requirement DELTA-HPAY-001, DELTA-HPAY-002
    if (!this.validateEventPayload(eventName as HookEventName, input)) {
      return this.buildFailureEnvelope(
        {
          code: 'VALIDATION_FAILURE',
          message: `Invalid payload for event '${String(eventName)}'`,
        },
        'validation',
        { eventName: eventName as HookEventName },
      );
    }

    // Lines 103-110: translate model payloads if needed
    let resolvedInput = (input ?? {}) as Record<string, unknown>;
    if (
      [
        HookEventName.BeforeModel,
        HookEventName.AfterModel,
        HookEventName.BeforeToolSelection,
      ].includes(eventName as HookEventName)
    ) {
      resolvedInput = this.translateModelPayload(
        eventName as HookEventName,
        resolvedInput,
      );
    }

    // Lines 112-114: execute through core
    return this.executeEventWithFullResult(
      eventName as HookEventName,
      resolvedInput,
    );
  }

  /**
   * Publish a HOOK_EXECUTION_RESPONSE to the message bus.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P08
   * @requirement DELTA-HEVT-002
   * @pseudocode message-bus-integration.md lines 120-123
   */
  private publishResponse = (
    response: import('./hookBusContracts.js').HookExecutionResponse,
  ): void => {
    // Line 121: CALL this.messageBus.publish('HOOK_EXECUTION_RESPONSE', response)
    // Note: HOOK_EXECUTION_RESPONSE is a hook-specific message type not yet in
    // the MessageBusMessage union; cast through unknown for now
    this.messageBus?.publish({
      type: 'HOOK_EXECUTION_RESPONSE',
      payload: response,
    } as unknown as import('../confirmation-bus/types.js').MessageBusMessage);
  };

  /**
   * Extract or generate correlationId from a raw message.
   * If absent, generates one via crypto.randomUUID().
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P08
   * @requirement DELTA-HBUS-003
   * @pseudocode hook-event-handler.md lines 260-264
   */
  private extractCorrelationId = (rawMessage: unknown): string => {
    // Lines 261-263: IF rawMessage.payload.correlationId is non-empty string → return it
    if (
      rawMessage !== null &&
      typeof rawMessage === 'object' &&
      'payload' in rawMessage
    ) {
      const payload = (rawMessage as { payload: unknown }).payload;
      if (
        payload !== null &&
        typeof payload === 'object' &&
        'correlationId' in payload &&
        typeof (payload as Record<string, unknown>).correlationId ===
          'string' &&
        ((payload as Record<string, unknown>).correlationId as string).length >
          0
      ) {
        return (payload as Record<string, unknown>).correlationId as string;
      }
    }
    // Line 264: RETURN crypto.randomUUID()
    return crypto.randomUUID();
  };

  /**
   * Translate model payloads for BeforeModel/AfterModel/BeforeToolSelection.
   * Both mediated and direct paths use this translation.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P08
   * @requirement DELTA-HPAY-003
   * @pseudocode message-bus-integration.md lines 140-161
   */
  private translateModelPayload = (
    _eventName: HookEventName,
    input: Record<string, unknown>,
  ): Record<string, unknown> =>
    // For now, return input unchanged - model translation will be
    // enhanced in future phases when hookTranslator integration is needed
    input;

  /**
   * Validates event payload before execution.
   * Returns false if payload is invalid for the given event type.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P09
   * @requirement DELTA-HPAY-001
   * @pseudocode validation-boundary.md lines 50-81
   */
  /**
   * Route validation to the appropriate type-predicate validator.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P11
   * @requirement DELTA-HPAY-001, DELTA-HPAY-002
   */
  private validateEventPayload(
    eventName: HookEventName,
    input: unknown,
  ): boolean {
    switch (eventName) {
      case HookEventName.BeforeTool:
        return validateBeforeToolInput(input);
      case HookEventName.AfterTool:
        return validateAfterToolInput(input);
      case HookEventName.BeforeAgent:
        return validateBeforeAgentInput(input);
      case HookEventName.AfterAgent:
        return validateAfterAgentInput(input);
      case HookEventName.BeforeModel:
        return validateBeforeModelInput(input);
      case HookEventName.AfterModel:
        return validateAfterModelInput(input);
      case HookEventName.BeforeToolSelection:
        return validateBeforeToolSelectionInput(input);
      case HookEventName.Notification:
        return validateNotificationInput(input);
      default:
        return false;
    }
  }

  /**
   * Dispose this HookEventHandler, releasing subscriptions and preventing further use.
   *
   * @plan PLAN-20250218-HOOKSYSTEM.P03
   * @plan PLAN-20250218-HOOKSYSTEM.P08
   * @requirement DELTA-HEVT-004
   * @pseudocode message-bus-integration.md lines 130-136
   */
  dispose(): void {
    // Line 131: SET this.isDisposed = true (idempotent)
    if (this.disposed) return;
    this.disposed = true;
    // Lines 132-134: IF subscription exists → unsubscribe
    this.subscriptionHandle?.unsubscribe();
    this.subscriptionHandle = undefined;
  }
}
