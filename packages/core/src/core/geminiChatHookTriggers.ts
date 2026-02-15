/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { HookEventName } from '../hooks/types.js';
import type {
  BeforeModelInput,
  AfterModelInput,
  BeforeToolSelectionInput,
} from '../hooks/types.js';
import { HookRegistry } from '../hooks/hookRegistry.js';
import { HookPlanner } from '../hooks/hookPlanner.js';
import { HookRunner } from '../hooks/hookRunner.js';
import { DebugLogger } from '../debug/index.js';
import type { IContent } from '../services/history/IContent.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:hook-triggers:model');

/**
 * Trigger BeforeModel hook for an LLM API call
 *
 * @param config - Configuration object with hook system access
 * @param request - The LLM request (simplified structure for hooks)
 */
export async function triggerBeforeModelHook(
  config: Config,
  request: { contents: IContent[]; tools?: unknown },
): Promise<void> {
  // Check if hooks are enabled
  if (!config.getEnableHooks?.()) {
    return;
  }

  try {
    // Create hook system instances
    const hookRegistry = new HookRegistry(config);
    await hookRegistry.initialize();
    const hookPlanner = new HookPlanner(hookRegistry);
    const hookRunner = new HookRunner();

    // Create execution plan
    const executionPlan = hookPlanner.createExecutionPlan(
      HookEventName.BeforeModel,
      undefined,
    );

    if (!executionPlan) {
      return;
    }

    // Convert request to hook format
    // IContent speaker is 'ai' | 'human' | 'tool'; map to hook role
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

    // Build hook input
    const hookInput: BeforeModelInput = {
      session_id: config.getSessionId(),
      transcript_path: '', // TODO: Add transcript path to Config if needed
      cwd: config.getWorkingDir(),
      hook_event_name: HookEventName.BeforeModel,
      timestamp: new Date().toISOString(),
      llm_request: llmRequest,
    };

    // Execute hooks
    if (executionPlan.sequential) {
      await hookRunner.executeHooksSequential(
        executionPlan.hookConfigs,
        HookEventName.BeforeModel,
        hookInput,
      );
    } else {
      await hookRunner.executeHooksParallel(
        executionPlan.hookConfigs,
        HookEventName.BeforeModel,
        hookInput,
      );
    }

    debugLogger.debug('BeforeModel hook executed');
  } catch (error) {
    // Hook failures must NOT block LLM execution
    debugLogger.warn('BeforeModel hook failed (non-blocking):', error);
  }
}

/**
 * Trigger AfterModel hook for an LLM API response
 *
 * @param config - Configuration object with hook system access
 * @param response - The LLM response (IContent)
 */
export async function triggerAfterModelHook(
  config: Config,
  response: IContent,
): Promise<void> {
  // Check if hooks are enabled
  if (!config.getEnableHooks?.()) {
    return;
  }

  try {
    // Create hook system instances
    const hookRegistry = new HookRegistry(config);
    await hookRegistry.initialize();
    const hookPlanner = new HookPlanner(hookRegistry);
    const hookRunner = new HookRunner();

    // Create execution plan
    const executionPlan = hookPlanner.createExecutionPlan(
      HookEventName.AfterModel,
      undefined,
    );

    if (!executionPlan) {
      return;
    }

    // Convert IContent to hook format
    // IContent doesn't have a role field, it has a speaker field ('ai', 'human', 'tool')
    // For hook purposes, we treat AI responses as 'model' role
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

    // Build hook input
    const hookInput: AfterModelInput = {
      session_id: config.getSessionId(),
      transcript_path: '', // TODO: Add transcript path to Config if needed
      cwd: config.getWorkingDir(),
      hook_event_name: HookEventName.AfterModel,
      timestamp: new Date().toISOString(),
      llm_request: {} as never, // Request not available in this context
      llm_response: llmResponse,
    };

    // Execute hooks
    if (executionPlan.sequential) {
      await hookRunner.executeHooksSequential(
        executionPlan.hookConfigs,
        HookEventName.AfterModel,
        hookInput,
      );
    } else {
      await hookRunner.executeHooksParallel(
        executionPlan.hookConfigs,
        HookEventName.AfterModel,
        hookInput,
      );
    }

    debugLogger.debug('AfterModel hook executed');
  } catch (error) {
    // Hook failures must NOT block LLM execution
    debugLogger.warn('AfterModel hook failed (non-blocking):', error);
  }
}

/**
 * Trigger BeforeToolSelection hook before tool selection
 *
 * @param config - Configuration object with hook system access
 * @param tools - The tools available for selection
 */
export async function triggerBeforeToolSelectionHook(
  config: Config,
  _tools: unknown,
): Promise<void> {
  // Check if hooks are enabled
  if (!config.getEnableHooks?.()) {
    return;
  }

  try {
    // Create hook system instances
    const hookRegistry = new HookRegistry(config);
    await hookRegistry.initialize();
    const hookPlanner = new HookPlanner(hookRegistry);
    const hookRunner = new HookRunner();

    // Create execution plan
    const executionPlan = hookPlanner.createExecutionPlan(
      HookEventName.BeforeToolSelection,
      undefined,
    );

    if (!executionPlan) {
      return;
    }

    // Build hook input
    const hookInput: BeforeToolSelectionInput = {
      session_id: config.getSessionId(),
      transcript_path: '', // TODO: Add transcript path to Config if needed
      cwd: config.getWorkingDir(),
      hook_event_name: HookEventName.BeforeToolSelection,
      timestamp: new Date().toISOString(),
      llm_request: {} as never, // Request not available in this context
    };

    // Execute hooks
    if (executionPlan.sequential) {
      await hookRunner.executeHooksSequential(
        executionPlan.hookConfigs,
        HookEventName.BeforeToolSelection,
        hookInput,
      );
    } else {
      await hookRunner.executeHooksParallel(
        executionPlan.hookConfigs,
        HookEventName.BeforeToolSelection,
        hookInput,
      );
    }

    debugLogger.debug('BeforeToolSelection hook executed');
  } catch (error) {
    // Hook failures must NOT block tool selection
    debugLogger.warn('BeforeToolSelection hook failed (non-blocking):', error);
  }
}
