/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P09,P10,P11,P20
 * @requirement:HOOK-014,HOOK-015,HOOK-016a,HOOK-016b,HOOK-017,HOOK-018,HOOK-019,HOOK-020,HOOK-021,HOOK-022,HOOK-023,HOOK-024,HOOK-025,HOOK-026,HOOK-027,HOOK-028,HOOK-029,HOOK-030,HOOK-031,HOOK-134
 * @pseudocode:analysis/pseudocode/03-tool-hook-pipeline.md
 */

import type { Config } from '../config/config.js';
import { BeforeToolHookOutput, AfterToolHookOutput } from '../hooks/types.js';
import type { ToolResult } from '../tools/tools.js';
import { DebugLogger } from '../debug/index.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:hook-triggers:tool');

/**
 * Trigger BeforeTool hook for a tool call
 *
 * @requirement:HOOK-134 - Returns typed result instead of void
 *
 * @param config - Configuration object with hook system access
 * @param toolName - Name of the tool being called
 * @param toolInput - Input arguments for the tool
 * @returns BeforeToolHookOutput if hooks execute, undefined otherwise
 */
export async function triggerBeforeToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<BeforeToolHookOutput | undefined> {
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
    const result = await eventHandler.fireBeforeToolEvent(toolName, toolInput);

    debugLogger.debug(`BeforeTool hook executed for tool: ${toolName}`);

    // Wrap result in BeforeToolHookOutput
    if (result) {
      return new BeforeToolHookOutput(result);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block tool execution
    debugLogger.warn(
      `BeforeTool hook failed for tool ${toolName} (non-blocking):`,
      error,
    );
    return undefined;
  }
}

/**
 * Trigger AfterTool hook (non-blocking)
 *
 * @requirement:HOOK-134 - Returns typed result instead of void
 *
 * @param config - Configuration object with hook system access
 * @param toolName - Name of the tool that was called
 * @param toolInput - Input/arguments that were passed to the tool
 * @param toolOutput - Output/response from the tool
 * @returns AfterToolHookOutput if hooks execute, undefined otherwise
 */
export async function triggerAfterToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: ToolResult,
): Promise<AfterToolHookOutput | undefined> {
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
    const toolResponse = {
      llmContent: toolOutput.llmContent,
      returnDisplay: toolOutput.returnDisplay,
      ...(toolOutput.metadata && { metadata: toolOutput.metadata }),
      ...(toolOutput.error && { error: toolOutput.error }),
    };
    const result = await eventHandler.fireAfterToolEvent(
      toolName,
      toolInput,
      toolResponse,
    );

    debugLogger.debug(`AfterTool hook executed for tool: ${toolName}`);

    // Wrap result in AfterToolHookOutput
    if (result) {
      return new AfterToolHookOutput(result);
    }

    return undefined;
  } catch (error) {
    // Hook failures must NOT block tool execution
    debugLogger.warn(
      `AfterTool hook failed for tool ${toolName} (non-blocking):`,
      error,
    );
    return undefined;
  }
}
