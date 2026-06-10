/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-BEHAVIORAL-TDD
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type {
  IMcpToolService,
  McpFunctionCall,
  McpResponsePart,
} from '../interfaces/index.js';
import {
  DiscoveredMCPTool,
  generateMcpToolName,
  generateValidName,
  ToolConfirmationOutcome,
  ToolErrorType,
} from '../index.js';

function createCallableTool(
  response: McpResponsePart[],
  trustedFolder = false,
): IMcpToolService {
  return {
    callTool: async (_calls: McpFunctionCall[]): Promise<McpResponsePart[]> =>
      response,
    isTrustedFolder: () => trustedFolder,
  };
}

function createMcpResponse(
  toolName: string,
  content: readonly Record<string, unknown>[],
  isError = false,
): McpResponsePart[] {
  return [
    {
      functionResponse: {
        name: toolName,
        response: {
          isError,
          content,
        },
      },
    },
  ];
}

describe('MCP Tool Group Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  it('DiscoveredMCPTool executes callable MCP tool and returns transformed text content', async () => {
    const callableTool = createCallableTool(
      createMcpResponse('search', [
        { type: 'text', text: 'MCP result from test-server:search' },
      ]),
    );
    const tool = new DiscoveredMCPTool(
      callableTool,
      'test-server',
      'search',
      'Search tool',
      { type: 'object', properties: { query: { type: 'string' } } },
    );

    const result = await tool
      .build({ query: 'test' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toEqual([
      { text: 'MCP result from test-server:search' },
    ]);
    expect(result.returnDisplay).toBe('MCP result from test-server:search');
  });

  it('DiscoveredMCPTool returns a ToolErrorType.MCP_TOOL_ERROR when MCP marks the response as an error', async () => {
    const callableTool = createCallableTool(
      createMcpResponse(
        'search',
        [{ type: 'text', text: 'backend rejected query' }],
        true,
      ),
    );
    const tool = new DiscoveredMCPTool(
      callableTool,
      'test-server',
      'search',
      'Search tool',
      { type: 'object', properties: { query: { type: 'string' } } },
    );

    const result = await tool
      .build({ query: 'test' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.MCP_TOOL_ERROR);
    expect(result.error?.message).toContain("MCP tool 'search' reported");
    expect(result.returnDisplay).toBe(
      "Error: MCP tool 'search' reported an error.",
    );
  });

  it('trusted MCP tools skip confirmation in trusted folders', async () => {
    const tool = new DiscoveredMCPTool(
      createCallableTool(createMcpResponse('search', []), true),
      'test-server',
      'search',
      'Search tool',
      { type: 'object', properties: {} },
      true,
    );

    const confirmation = await tool
      .build({})
      .shouldConfirmExecute(new AbortController().signal);

    expect(confirmation).toBe(false);
  });

  it('untrusted MCP tools return MCP confirmation details with server and tool names', async () => {
    const tool = new DiscoveredMCPTool(
      createCallableTool(createMcpResponse('search', [])),
      'test-server',
      'search',
      'Search tool',
      { type: 'object', properties: {} },
    );

    const confirmation = await tool
      .build({})
      .shouldConfirmExecute(new AbortController().signal);

    expect(confirmation).toEqual(
      expect.objectContaining({
        type: 'mcp',
        serverName: 'test-server',
        toolName: 'search',
        title: 'Confirm MCP Tool Execution',
      }),
    );
  });

  it('MCP allowlist confirmation suppresses subsequent confirmations for the same tool', async () => {
    const tool = new DiscoveredMCPTool(
      createCallableTool(createMcpResponse('search', [])),
      'allowlist-server',
      'search',
      'Search tool',
      { type: 'object', properties: {} },
    );
    const firstConfirmation = await tool
      .build({})
      .shouldConfirmExecute(new AbortController().signal);

    if (firstConfirmation === false) {
      throw new Error('Expected MCP confirmation details');
    }
    await firstConfirmation.onConfirm(
      ToolConfirmationOutcome.ProceedAlwaysTool,
    );

    const secondConfirmation = await tool
      .build({})
      .shouldConfirmExecute(new AbortController().signal);
    expect(secondConfirmation).toBe(false);
  });

  it('MCP tool name generation preserves server and tool identity in a valid tool name', () => {
    expect(generateMcpToolName('server-a', 'search tool')).toBe(
      'mcp__server-a__search_tool',
    );
    expect(generateValidName('x'.repeat(80))).toBe(
      'xxxxxxxxxxxxxxxxxxxxxxxxxxxx___xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    );
  });
});
