/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { HookEventName } from '../hooks/types.js';
import type { BeforeToolInput, AfterToolInput } from '../hooks/types.js';
import { HookRegistry } from '../hooks/hookRegistry.js';
import { HookPlanner } from '../hooks/hookPlanner.js';
import { HookRunner } from '../hooks/hookRunner.js';
import type { ToolResult } from '../tools/tools.js';
import { DebugLogger } from '../debug/index.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:hook-triggers:tool');

/**
 * Trigger BeforeTool hook for a tool call
 *
 * @param config - Configuration object with hook system access
 * @param toolName - Name of the tool being called
 * @param toolInput - Input arguments for the tool
 */
export async function triggerBeforeToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
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
      HookEventName.BeforeTool,
      { toolName },
    );

    if (!executionPlan) {
      return;
    }

    // Build hook input
    const hookInput: BeforeToolInput = {
      session_id: config.getSessionId(),
      transcript_path: '', // TODO: Add transcript path to Config if needed
      cwd: config.getWorkingDir(),
      hook_event_name: HookEventName.BeforeTool,
      timestamp: new Date().toISOString(),
      tool_name: toolName,
      tool_input: toolInput,
    };

    // Execute hooks
    if (executionPlan.sequential) {
      await hookRunner.executeHooksSequential(
        executionPlan.hookConfigs,
        HookEventName.BeforeTool,
        hookInput,
      );
    } else {
      await hookRunner.executeHooksParallel(
        executionPlan.hookConfigs,
        HookEventName.BeforeTool,
        hookInput,
      );
    }

    debugLogger.debug(`BeforeTool hook executed for tool: ${toolName}`);
  } catch (error) {
    // Hook failures must NOT block tool execution
    debugLogger.warn(
      `BeforeTool hook failed for tool ${toolName} (non-blocking):`,
      error,
    );
  }
}

/**
 * Trigger AfterTool hook (non-blocking)
 *
 * @param config - Configuration object with hook system access
 * @param toolName - Name of the tool that was called
 * @param toolInput - Input/arguments that were passed to the tool
 * @param toolOutput - Output/response from the tool
 */
export async function triggerAfterToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: ToolResult,
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
      HookEventName.AfterTool,
      { toolName },
    );

    if (!executionPlan) {
      return;
    }

    // Build hook input
    const hookInput: AfterToolInput = {
      session_id: config.getSessionId(),
      transcript_path: '', // TODO: Add transcript path to Config if needed
      cwd: config.getWorkingDir(),
      hook_event_name: HookEventName.AfterTool,
      timestamp: new Date().toISOString(),
      tool_name: toolName,
      tool_input: toolInput,
      tool_response: {
        llmContent: toolOutput.llmContent,
        returnDisplay: toolOutput.returnDisplay,
        ...(toolOutput.metadata && { metadata: toolOutput.metadata }),
        ...(toolOutput.error && { error: toolOutput.error }),
      },
    };

    // Execute hooks
    if (executionPlan.sequential) {
      await hookRunner.executeHooksSequential(
        executionPlan.hookConfigs,
        HookEventName.AfterTool,
        hookInput,
      );
    } else {
      await hookRunner.executeHooksParallel(
        executionPlan.hookConfigs,
        HookEventName.AfterTool,
        hookInput,
      );
    }

    debugLogger.debug(`AfterTool hook executed for tool: ${toolName}`);
  } catch (error) {
    // Hook failures must NOT block tool execution
    debugLogger.warn(
      `AfterTool hook failed for tool ${toolName} (non-blocking):`,
      error,
    );
  }
}
