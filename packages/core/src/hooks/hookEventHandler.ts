/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03,P06,P08
 * @requirement:HOOK-061,HOOK-062,HOOK-143,HOOK-144,HOOK-145,HOOK-146,HOOK-147
 * @pseudocode:analysis/pseudocode/02-hook-event-handler-flow.md
 */

import type { Config } from '../config/config.js';
import type { HookRegistry } from './hookRegistry.js';
import type { HookPlanner } from './hookPlanner.js';
import type { HookRunner } from './hookRunner.js';
import type { HookAggregator, AggregatedHookResult } from './hookAggregator.js';
import type { HookInput, HookEventName, DefaultHookOutput } from './types.js';
import { NotificationType } from './types.js';
import { DebugLogger } from '../debug/index.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:hooks:eventHandler');

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

  constructor(
    config: Config,
    _registry: HookRegistry, // Retained for future use, planner already has reference
    planner: HookPlanner,
    runner: HookRunner,
    aggregator: HookAggregator,
  ) {
    this.config = config;
    this.planner = planner;
    this.runner = runner;
    this.aggregator = aggregator;
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
      transcript_path: '', // TODO: Implement transcript path resolution
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
    return this.executeEvent('BeforeTool', { toolName, toolInput });
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
    return this.executeEvent('AfterTool', {
      toolName,
      toolInput,
      toolResponse,
    });
  }

  /**
   * Fire BeforeModel event
   * @requirement:HOOK-143
   */
  async fireBeforeModelEvent(
    llmRequest: unknown,
  ): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult('BeforeModel', {
        llmRequest,
      });
    } catch (error) {
      debugLogger.warn(`BeforeModel hook error (non-fatal): ${error}`);
      return EMPTY_SUCCESS_RESULT;
    }
  }

  /**
   * Fire AfterModel event
   * @requirement:HOOK-143
   */
  async fireAfterModelEvent(
    llmRequest: unknown,
    llmResponse: unknown,
  ): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult('AfterModel', {
        llmRequest,
        llmResponse,
      });
    } catch (error) {
      debugLogger.warn(`AfterModel hook error (non-fatal): ${error}`);
      return EMPTY_SUCCESS_RESULT;
    }
  }

  /**
   * Fire BeforeToolSelection event
   * @requirement:HOOK-143
   */
  async fireBeforeToolSelectionEvent(
    llmRequest: unknown,
  ): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult('BeforeToolSelection', {
        llmRequest,
      });
    } catch (error) {
      debugLogger.warn(`BeforeToolSelection hook error (non-fatal): ${error}`);
      return EMPTY_SUCCESS_RESULT;
    }
  }

  /**
   * Fire SessionStart event
   * @requirement:HOOK-143
   */
  async fireSessionStartEvent(context: {
    source: string;
  }): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult('SessionStart', context);
    } catch (error) {
      debugLogger.warn(`SessionStart hook error (non-fatal): ${error}`);
      return EMPTY_SUCCESS_RESULT;
    }
  }

  /**
   * Fire SessionEnd event
   * @requirement:HOOK-143
   */
  async fireSessionEndEvent(context: {
    reason: string;
  }): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult('SessionEnd', context);
    } catch (error) {
      debugLogger.warn(`SessionEnd hook error (non-fatal): ${error}`);
      return EMPTY_SUCCESS_RESULT;
    }
  }

  /**
   * Fire BeforeAgent event
   * @requirement:HOOK-143
   */
  async fireBeforeAgentEvent(context: {
    prompt: string;
  }): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult('BeforeAgent', context);
    } catch (error) {
      debugLogger.warn(`BeforeAgent hook error (non-fatal): ${error}`);
      return EMPTY_SUCCESS_RESULT;
    }
  }

  /**
   * Fire AfterAgent event
   * @requirement:HOOK-143
   */
  async fireAfterAgentEvent(context: {
    prompt: string;
    prompt_response: string;
    stop_hook_active: boolean;
  }): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult('AfterAgent', context);
    } catch (error) {
      debugLogger.warn(`AfterAgent hook error (non-fatal): ${error}`);
      return EMPTY_SUCCESS_RESULT;
    }
  }

  /**
   * Fire Notification event (e.g., ToolPermission before confirmation dialog)
   * @requirement:HOOK-143
   */
  async fireNotificationEvent(
    type: NotificationType,
    message: string,
    details: Record<string, unknown>,
  ): Promise<AggregatedHookResult> {
    try {
      return await this.executeEventWithFullResult('Notification', {
        notification_type: type,
        message,
        details,
      });
    } catch (error) {
      debugLogger.warn(`Notification hook error (non-fatal): ${error}`);
      return EMPTY_SUCCESS_RESULT;
    }
  }

  /**
   * Execute an event and return the final output (or undefined)
   * @requirement:HOOK-147 - Wraps in try/catch
   */
  private async executeEvent(
    eventName: string,
    context: Record<string, unknown>,
  ): Promise<DefaultHookOutput | undefined> {
    try {
      const result = await this.executeEventWithFullResult(eventName, context);
      return result.finalOutput;
    } catch (error) {
      debugLogger.warn(`${eventName} hook error (non-fatal): ${error}`);
      return undefined;
    }
  }

  /**
   * Execute an event and return the full aggregated result
   * @requirement:HOOK-145,HOOK-146
   */
  private async executeEventWithFullResult(
    eventName: string,
    context: Record<string, unknown>,
  ): Promise<AggregatedHookResult> {
    const startTime = Date.now();

    // Create execution plan
    const plan = this.planner.createExecutionPlan(
      eventName as HookEventName,
      context.toolName ? { toolName: context.toolName as string } : undefined,
    );

    // No matching hooks - return empty success
    // @requirement:HOOK-145
    if (!plan || plan.hookConfigs.length === 0) {
      debugLogger.debug(
        `No hooks for event ${eventName}, returning empty success`,
      );
      return EMPTY_SUCCESS_RESULT;
    }

    // Build input payload
    const baseInput = this.buildBaseInput(eventName);
    const input = { ...baseInput, ...context } as HookInput;

    // Execute hooks
    const results = plan.sequential
      ? await this.runner.executeHooksSequential(
          plan.hookConfigs,
          eventName as HookEventName,
          input,
        )
      : await this.runner.executeHooksParallel(
          plan.hookConfigs,
          eventName as HookEventName,
          input,
        );

    // Aggregate results
    const aggregated = this.aggregator.aggregateResults(
      results,
      eventName as HookEventName,
    );

    const duration = Date.now() - startTime;

    // Log telemetry
    // @requirement:HOOK-146
    debugLogger.debug(
      `Hook event ${eventName}: ${plan.hookConfigs.length} hook(s), ${duration}ms, success=${aggregated.success}`,
    );

    return aggregated;
  }
}
