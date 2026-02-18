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
import {
  BeforeToolHookOutput,
  AfterToolHookOutput,
  NotificationType,
} from '../hooks/types.js';
import type {
  ToolResult,
  ToolCallConfirmationDetails,
} from '../tools/tools.js';
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

/**
 * Result from triggering a Notification hook
 */
export interface NotificationHookResult {
  notificationType: NotificationType;
  message: string;
  details: SerializableConfirmationDetails;
}

/**
 * Serializable representation of tool confirmation details for hooks.
 * Excludes function properties like onConfirm that can't be serialized.
 * Uses index signature for Record<string, unknown> compatibility.
 */
interface SerializableConfirmationDetails {
  [key: string]: unknown;
  type: 'edit' | 'exec' | 'mcp' | 'info';
  title: string;
  fileName?: string;
  filePath?: string;
  fileDiff?: string;
  originalContent?: string | null;
  newContent?: string;
  isModifying?: boolean;
  command?: string;
  rootCommand?: string;
  serverName?: string;
  toolName?: string;
  toolDisplayName?: string;
  prompt?: string;
  urls?: string[];
}

/**
 * Converts ToolCallConfirmationDetails to a serializable format for hooks.
 * Excludes function properties (onConfirm, ideConfirmation) that can't be serialized.
 */
function toSerializableDetails(
  details: ToolCallConfirmationDetails,
): SerializableConfirmationDetails {
  const base: SerializableConfirmationDetails = {
    type: details.type,
    title: details.title,
  };

  switch (details.type) {
    case 'edit':
      return {
        ...base,
        fileName: details.fileName,
        filePath: details.filePath,
        fileDiff: details.fileDiff,
        originalContent: details.originalContent,
        newContent: details.newContent,
        isModifying: details.isModifying,
      };
    case 'exec':
      return {
        ...base,
        command: details.command,
        rootCommand: details.rootCommand,
      };
    case 'mcp':
      return {
        ...base,
        serverName: details.serverName,
        toolName: details.toolName,
        toolDisplayName: details.toolDisplayName,
      };
    case 'info':
      return {
        ...base,
        prompt: details.prompt,
        urls: details.urls,
      };
    default:
      return base;
  }
}

/**
 * Gets the message to display in the notification hook for tool confirmation.
 */
function getNotificationMessage(
  confirmationDetails: ToolCallConfirmationDetails,
): string {
  switch (confirmationDetails.type) {
    case 'edit':
      return `Tool ${confirmationDetails.title} requires editing`;
    case 'exec':
      return `Tool ${confirmationDetails.title} requires execution`;
    case 'mcp':
      return `Tool ${confirmationDetails.title} requires MCP`;
    case 'info':
      return `Tool ${confirmationDetails.title} requires information`;
    default:
      return `Tool requires confirmation`;
  }
}

/**
 * Trigger ToolPermission Notification hook before showing confirmation dialog.
 *
 * This hook fires before the user is prompted to confirm a tool execution,
 * allowing external systems to be notified about pending tool confirmations
 * (e.g., for desktop notifications, logging, or integration with other tools).
 *
 * @param config - Configuration object with hook system access
 * @param confirmationDetails - Details about the tool requiring confirmation
 * @returns NotificationHookResult if hooks execute, undefined otherwise
 */
export async function triggerToolNotificationHook(
  config: Config,
  confirmationDetails: ToolCallConfirmationDetails,
): Promise<NotificationHookResult | undefined> {
  if (!config.getEnableHooks?.()) {
    return undefined;
  }

  const hookSystem = config.getHookSystem?.();
  if (!hookSystem) {
    return undefined;
  }

  try {
    await hookSystem.initialize();

    const eventHandler = hookSystem.getEventHandler();
    const message = getNotificationMessage(confirmationDetails);
    const serializedDetails = toSerializableDetails(confirmationDetails);

    await eventHandler.fireNotificationEvent(
      NotificationType.ToolPermission,
      message,
      serializedDetails,
    );

    debugLogger.debug(
      `Notification hook (ToolPermission) executed for: ${confirmationDetails.title}`,
    );

    return {
      notificationType: NotificationType.ToolPermission,
      message,
      details: serializedDetails,
    };
  } catch (error) {
    debugLogger.warn(
      `Notification hook failed for ${confirmationDetails.title} (non-blocking):`,
      error,
    );
    return undefined;
  }
}
