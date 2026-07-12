/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, it, expect } from 'vitest';
import {
  type CallableTool,
  type GeminiFunctionCall,
  type GeminiPart,
  type GeminiTool,
} from '../types/gemini-neutral.js';
import { McpCallableTool } from './mcp-callable-tool.js';

function acceptCallableTool(tool: CallableTool): CallableTool {
  return tool;
}

describe('neutral MCP CallableTool interface structural assignability', () => {
  it('McpCallableTool satisfies the neutral CallableTool interface', () => {
    const tool = new McpCallableTool(
      new Client({ name: 'neutral-types-test', version: '1.0.0' }),
      { name: 'test', description: 'test', inputSchema: {} },
      5000,
    );

    expect(acceptCallableTool(tool)).toBe(tool);
  });
});

describe('neutral GeminiPart is usable in MCP response transformation', () => {
  it('a text part is structurally compatible', () => {
    const part: GeminiPart = { text: 'hello' };
    expect(part.text).toBe('hello');
  });

  it('a functionResponse part is structurally compatible', () => {
    const part: GeminiPart = {
      functionResponse: {
        name: 'test',
        response: { content: [{ type: 'text', text: 'result' }] },
      },
    };
    expect(part.functionResponse?.name).toBe('test');
  });
});

describe('neutral GeminiTool shape for McpCallableTool.tool()', () => {
  it('maps the MCP input schema to parametersJsonSchema', async () => {
    const callableTool = new McpCallableTool(
      new Client({ name: 'neutral-types-test', version: '1.0.0' }),
      {
        name: 'test_tool',
        description: 'A test tool',
        inputSchema: { type: 'object' },
      },
      5000,
    );

    const tool: GeminiTool = await callableTool.tool();
    expect(tool.functionDeclarations?.[0]).toStrictEqual({
      name: 'test_tool',
      description: 'A test tool',
      parametersJsonSchema: { type: 'object' },
    });
  });
});

describe('neutral GeminiFunctionCall shape', () => {
  it('accepts name and args', () => {
    const call: GeminiFunctionCall = {
      name: 'test_tool',
      args: { param: 'value' },
    };
    expect(call.name).toBe('test_tool');
    expect(call.args?.param).toBe('value');
  });
});
