/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned interface for the tool message bus.
 *
 * Provides confirmation request, policy update, and optional
 * subscription capabilities needed by tools that require user
 * confirmation before execution.
 *
 * Consumed by: tools.ts / BaseToolInvocation, modifiable-tool,
 * shell, mcp-tool.
 * Implemented by: CoreMessageBusAdapter in packages/core.
 */

export type { ToolConfirmationOutcome } from '../types/tool-confirmation-types.js';
import type { ToolConfirmationOutcome } from '../types/tool-confirmation-types.js';

/** Options for policy update after confirmation. */
export interface PolicyUpdateOptions {
  /** Tool name whose policy should be updated. */
  toolName?: string;
  /** Whether to persist the update. */
  persist?: boolean;
  /** Optional shell command prefix used by shell-like tools. */
  commandPrefix?: string | string[];
  /** Optional MCP server name used by MCP tools. */
  mcpName?: string;
}

/** Handler for tool message events. */
export type ToolMessageHandler = (
  event: ToolMessageEvent,
) => void | Promise<void>;

/** Event emitted through the message bus. */
export interface ToolMessageEvent {
  type: string;
  payload?: unknown;
}

/** Unsubscribe function returned by subscribe. */
export type Unsubscribe = () => void;

export interface IToolMessageBus {
  /**
   * Request user confirmation for a tool call.
   * @param details - Serializable confirmation details object.
   * @param abortSignal - Optional abort signal for cancellation.
   * @returns The outcome of the confirmation request.
   */
  requestConfirmation(...args: any[]): Promise<any>;

  /**
   * Publish a policy update after confirmation.
   * @param outcome - The confirmation outcome to apply.
   * @param options - Optional policy update options.
   */
  publishPolicyUpdate?(
    outcome: ToolConfirmationOutcome,
    options?: PolicyUpdateOptions,
  ): Promise<void>;

  /**
   * Optional: subscribe to message bus events.
   * @param handler - Handler function for events.
   * @returns Unsubscribe function.
   */
  subscribe?: any;
}
