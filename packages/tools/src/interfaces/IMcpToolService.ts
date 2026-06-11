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
 * Tools-owned interface for MCP tool invocation.
 *
 * The retained core MCP client/manager own transport, auth, discovery, and SDK
 * callable details. Moved MCP tools depend only on this boundary for executing
 * an already-discovered MCP tool.
 *
 * Consumed by: mcp-tool.
 * Implemented by: CoreMcpToolServiceAdapter in packages/core.
 */

export type McpToolParams = Record<string, unknown>;

export type McpFunctionCall = {
  name?: string;
  args?: McpToolParams;
};

export type McpResponsePart = {
  functionResponse?: {
    name?: string;
    response?: {
      content?: unknown;
      isError?: boolean | string;
      error?: {
        isError?: boolean | string;
      };
      [key: string]: unknown;
    };
  };
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  [key: string]: unknown;
};

export interface IMcpToolService {
  callTool(functionCalls: McpFunctionCall[]): Promise<McpResponsePart[]>;
  isTrustedFolder?(): boolean;
}
