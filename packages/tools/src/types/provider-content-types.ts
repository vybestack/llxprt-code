/**
 * @plan:PLAN-20260608-ISSUE1585.P11
 * @requirement:REQ-PKG-BOUNDARY
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned structural replacement types for provider content shapes.
 *
 * These replace imports from packages/core/src/runtime/contracts and
 * packages/core/src/services/history that would create forbidden
 * dependencies. Moved tool files MUST import from this module instead.
 */

/**
 * Tools-owned structural replacement for RuntimeProviderChat.
 * Replaces import from packages/core/src/runtime/contracts/RuntimeProviderChat.
 * Shape matches the provider content fields that ToolFormatter and tool registry consume.
 */
export interface ProviderChatContent {
  role: string;
  content?: string;
  toolCalls?: ProviderToolCallBlock[];
  toolResults?: ProviderToolResultBlock[];
  [key: string]: unknown;
}

/**
 * Tools-owned structural replacement for tool call blocks in history content.
 * Replaces import from packages/core/src/services/history IContent shapes.
 */
export interface ProviderToolCallBlock {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Tools-owned structural replacement for tool result blocks in history content.
 */
export interface ProviderToolResultBlock {
  toolCallId: string;
  output: string;
}

/**
 * Tools-owned structural type for RuntimeProviderTool.
 * Replaces import from packages/core/src/runtime/contracts.
 */
export interface ProviderToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
