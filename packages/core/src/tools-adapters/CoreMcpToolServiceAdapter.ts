/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IMcpToolService,
  McpFunctionCall,
  McpResponsePart,
} from '@vybestack/llxprt-code-tools';
import type { ToolCallRequest } from '../llm-types/toolCall.js';

/**
 * Structural shape of a @google/genai `Part` as used at the MCP tool boundary.
 * Defined locally so core does not import @google/genai; the concrete MCP
 * callable tools (packages/mcp, owned by #2351) supply structurally-compatible
 * objects.
 */
export interface McpPart {
  functionResponse?: {
    name?: string;
    response?: unknown;
  };
  text?: string;
  inlineData?: { mimeType: string; data: string };
  [key: string]: unknown;
}

/**
 * Structural shape of a @google/genai `Tool` (function-declaration container).
 */
export interface McpTool {
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
    parameters?: unknown;
  }>;
}

/**
 * Structural shape matching the @google/genai `CallableTool` interface as used
 * by core's MCP/LSP adapters. The concrete `McpCallableTool` (packages/mcp)
 * and `LspNavigationCallableTool` (core/config/lspIntegration) both produce
 * objects structurally-compatible with this interface.
 */
export interface McpCallableTool {
  tool(): Promise<McpTool>;
  callTool(functionCalls: ToolCallRequest[]): Promise<McpPart[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toMcpResponsePart(part: McpPart): McpResponsePart {
  if (part.functionResponse === undefined) {
    return part as McpResponsePart;
  }

  const response = part.functionResponse.response;
  return {
    ...part,
    functionResponse: {
      name: part.functionResponse.name,
      ...(isRecord(response) ? { response } : {}),
    },
  };
}

export class CoreMcpToolServiceAdapter implements IMcpToolService {
  constructor(
    private readonly callableTool: McpCallableTool,
    private readonly trustedFolderProvider?: () => boolean,
  ) {}

  isTrustedFolder(): boolean {
    return this.trustedFolderProvider?.() ?? false;
  }

  async callTool(functionCalls: McpFunctionCall[]): Promise<McpResponsePart[]> {
    const sdkFunctionCalls: ToolCallRequest[] = functionCalls.map(
      (functionCall) => {
        if (!functionCall.name) {
          throw new Error(
            'Cannot dispatch MCP tool call: function name is missing or empty',
          );
        }
        return {
          name: functionCall.name,
          args: functionCall.args ?? {},
        };
      },
    );
    const response = await this.callableTool.callTool(sdkFunctionCalls);
    return response.map(toMcpResponsePart);
  }
}
