/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P12,P13,P14,P20
 * @requirement:HOOK-033,HOOK-034,HOOK-035,HOOK-041,HOOK-042,HOOK-043,HOOK-044,HOOK-045,HOOK-046,HOOK-047,HOOK-048,HOOK-049,HOOK-050,HOOK-051,HOOK-052,HOOK-053,HOOK-054,HOOK-055,HOOK-056,HOOK-057,HOOK-058,HOOK-059,HOOK-060,HOOK-134
 * @pseudocode:analysis/pseudocode/04-model-hook-pipeline.md
 */

import type { Config } from '../config/config.js';
import {
  BeforeModelHookOutput,
  AfterModelHookOutput,
  BeforeToolSelectionHookOutput,
} from '../hooks/types.js';
import { DebugLogger } from '../debug/index.js';
import type { IContent } from '../services/history/IContent.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:hook-triggers:model');

/**
 * Trigger BeforeModel hook for an LLM API call
 *
 * @requirement:HOOK-134 - Returns typed result instead of void
 *
 * @param config - Configuration object with hook system access
 * @param request - The LLM request (simplified structure for hooks)
 * @returns BeforeModelHookOutput if hooks execute, undefined otherwise
 */
export async function triggerBeforeModelHook(
  config: Config,
  request: { contents: IContent[]; tools?: unknown },
): Promise<BeforeModelHookOutput | undefined> {
  // Check if hooks are enabled
  if (!config.getEnableHooks?.()) {
    return undefined;
  }

  // Get the HookSystem singleton
  const hookSystem = config.getHookSystem?.();
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Convert request to hook format for passing to event handler
    const llmRequest = {
      messages: request.contents.map((content) => ({
        role: (content.speaker === 'ai' ? 'model' : 'user') as
          | 'model'
          | 'user'
          | 'system',
        content: JSON.stringify(content.blocks),
      })),
      model: config.getModel(),
    };

    // Get the event handler and fire the event
    const eventHandler = hookSystem.getEventHandler();
    const result = await eventHandler.fireBeforeModelEvent(llmRequest);

    debugLogger.debug('BeforeModel hook executed');

    // Return BeforeModelHookOutput from aggregated result
    if (result.finalOutput) {
      return new BeforeModelHookOutput(result.finalOutput);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block LLM execution
    debugLogger.warn('BeforeModel hook failed (non-blocking):', error);
    return undefined;
  }
}

/**
 * Trigger AfterModel hook for an LLM API response
 *
 * @requirement:HOOK-134 - Returns typed result instead of void
 *
 * @param config - Configuration object with hook system access
 * @param response - The LLM response (IContent)
 * @returns AfterModelHookOutput if hooks execute, undefined otherwise
 */
export async function triggerAfterModelHook(
  config: Config,
  response: IContent,
): Promise<AfterModelHookOutput | undefined> {
  // Check if hooks are enabled
  if (!config.getEnableHooks?.()) {
    return undefined;
  }

  // Get the HookSystem singleton
  const hookSystem = config.getHookSystem?.();
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Convert IContent to hook format
    const llmResponse = {
      candidates: [
        {
          content: {
            role: 'model' as const,
            parts: [JSON.stringify(response.blocks)],
          },
          finishReason: 'STOP' as const,
        },
      ],
    };

    // Get the event handler and fire the event
    const eventHandler = hookSystem.getEventHandler();
    const result = await eventHandler.fireAfterModelEvent({}, llmResponse);

    debugLogger.debug('AfterModel hook executed');

    // Return AfterModelHookOutput from aggregated result
    if (result.finalOutput) {
      return new AfterModelHookOutput(result.finalOutput);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block LLM execution
    debugLogger.warn('AfterModel hook failed (non-blocking):', error);
    return undefined;
  }
}

/**
 * Trigger BeforeToolSelection hook before tool selection
 *
 * @requirement:HOOK-134 - Returns typed result instead of void
 *
 * @param config - Configuration object with hook system access
 * @param tools - The tools available for selection
 * @returns BeforeToolSelectionHookOutput if hooks execute, undefined otherwise
 */
export async function triggerBeforeToolSelectionHook(
  config: Config,
  _tools: unknown,
): Promise<BeforeToolSelectionHookOutput | undefined> {
  // Check if hooks are enabled
  if (!config.getEnableHooks?.()) {
    return undefined;
  }

  // Get the HookSystem singleton
  const hookSystem = config.getHookSystem?.();
  if (!hookSystem) {
    return undefined;
  }

  try {
    // Initialize hook system if needed
    await hookSystem.initialize();

    // Get the event handler and fire the event
    const eventHandler = hookSystem.getEventHandler();
    const result = await eventHandler.fireBeforeToolSelectionEvent({});

    debugLogger.debug('BeforeToolSelection hook executed');

    // Return BeforeToolSelectionHookOutput from aggregated result
    if (result.finalOutput) {
      return new BeforeToolSelectionHookOutput(result.finalOutput);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block tool selection
    debugLogger.warn('BeforeToolSelection hook failed (non-blocking):', error);
    return undefined;
  }
}
