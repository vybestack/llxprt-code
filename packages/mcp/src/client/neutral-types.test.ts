/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  type CallableTool,
  type GeminiFunctionCall,
  type GeminiPart,
  type GeminiTool,
  type GeminiFunctionDeclaration,
} from '../types/gemini-neutral.js';
import { McpCallableTool } from './mcp-callable-tool.js';

describe('neutral MCP CallableTool interface structural assignability', () => {
  it('McpCallableTool satisfies the neutral CallableTool interface', () => {
    const tool = new McpCallableTool(
      {} as never,
      { name: 'test', description: 'test', inputSchema: {} },
      5000,
    );
    // If this compiles, McpCallableTool is structurally compatible.
    const _check: CallableTool = tool;
    expect(_check).toBeDefined();
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
  it('produces a structurally valid GeminiTool', () => {
    const decl: GeminiFunctionDeclaration = {
      name: 'test_tool',
      description: 'A test tool',
      parametersJsonSchema: { type: 'object' },
    };
    const tool: GeminiTool = { functionDeclarations: [decl] };
    expect(tool.functionDeclarations?.[0]?.name).toBe('test_tool');
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
