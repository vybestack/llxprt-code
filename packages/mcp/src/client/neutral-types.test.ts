/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, it, expect } from 'vitest';
import {
  type CallableTool,
  type ContentPart,
  type ToolDeclarations,
} from '@vybestack/llxprt-code-tools';
import { McpCallableTool } from './mcp-callable-tool.js';

describe('MCP behavioral tests for neutral wire types', () => {
  it('McpCallableTool.tool() maps the MCP input schema to parametersJsonSchema', async () => {
    const callableTool = new McpCallableTool(
      new Client({ name: 'neutral-types-test', version: '1.0.0' }),
      {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object' },
      },
      5000,
    );

    const tool: ToolDeclarations = await callableTool.tool();
    expect(tool.functionDeclarations?.[0]).toStrictEqual({
      name: 'test_tool',
      description: 'A test tool',
      parametersJsonSchema: { type: 'object' },
    });
  });

  it('a ContentPart with text is usable in MCP response transformation', () => {
    const part: ContentPart = { text: 'hello' };
    expect(part.text).toBe('hello');
  });

  it('a ContentPart with functionResponse is structurally compatible', () => {
    const part: ContentPart = {
      functionResponse: {
        name: 'test',
        response: { content: [{ type: 'text', text: 'result' }] },
      },
    };
    expect(part.functionResponse?.name).toBe('test');
  });

  it('McpCallableTool.callTool rejects empty functionCalls array', async () => {
    const callableTool = new McpCallableTool(
      new Client({ name: 'neutral-types-test', version: '1.0.0' }),
      { name: 'test', description: 'test', inputSchema: {} },
      5000,
    );

    await expect(callableTool.callTool([])).rejects.toThrow(
      'McpCallableTool only supports single function call',
    );
  });

  it('McpCallableTool.callTool rejects a missing function name', async () => {
    const callableTool = new McpCallableTool(
      new Client({ name: 'neutral-types-test', version: '1.0.0' }),
      { name: 'test', description: 'test', inputSchema: {} },
      5000,
    );

    await expect(
      Reflect.apply(callableTool.callTool, callableTool, [[{ args: {} }]]),
    ).rejects.toThrow('McpCallableTool requires a non-empty function name');
  });

  it('CallableTool type is importable from tools package', () => {
    const accept = (tool: CallableTool): CallableTool => tool;
    const callableTool = new McpCallableTool(
      new Client({ name: 'neutral-types-test', version: '1.0.0' }),
      { name: 'test', description: 'test', inputSchema: {} },
      5000,
    );
    expect(accept(callableTool)).toBe(callableTool);
  });
});
