/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, it, expect } from 'bun:test';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import {
  type CallableTool,
  type ContentPart,
  type ToolDeclarations,
} from '@vybestack/llxprt-code-tools';
import { McpCallableTool } from './mcp-callable-tool.js';

const TOOL_DEF: McpTool = {
  name: 'test_tool',
  description: 'A test tool',
  inputSchema: { type: 'object' },
};

const BUDGET_BYTES = 4 * 1024 * 1024;

function mockClient(result: unknown): Client {
  return { callTool: async () => result } as unknown as Client;
}

function extractResponse(
  parts: Awaited<ReturnType<McpCallableTool['callTool']>>,
): Record<string, unknown> {
  return parts[0]?.functionResponse?.response as Record<string, unknown>;
}

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

describe('McpCallableTool aggregate content budget', () => {
  it('accepts exact-boundary aggregate text', async () => {
    const text = 'x'.repeat(BUDGET_BYTES);
    const client = mockClient({ content: [{ type: 'text', text }] });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    expect(extractResponse(parts).error).toBeUndefined();
  });

  it('fails one-byte-over text content atomically', async () => {
    const text = 'x'.repeat(BUDGET_BYTES + 1);
    const client = mockClient({ content: [{ type: 'text', text }] });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    expect(extractResponse(parts).error).toMatchObject({ isError: true });
  });

  it('fails oversized image base64 content atomically', async () => {
    const data = 'A'.repeat(BUDGET_BYTES + 1);
    const client = mockClient({
      content: [{ type: 'image', data, mimeType: 'image/png' }],
    });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    expect(extractResponse(parts).error).toMatchObject({ isError: true });
  });

  it('fails oversized audio base64 content atomically', async () => {
    const data = 'A'.repeat(BUDGET_BYTES + 1);
    const client = mockClient({
      content: [{ type: 'audio', data, mimeType: 'audio/mp3' }],
    });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    expect(extractResponse(parts).error).toMatchObject({ isError: true });
  });

  it('fails oversized embedded text resource atomically', async () => {
    const text = 'x'.repeat(BUDGET_BYTES + 1);
    const client = mockClient({
      content: [
        {
          type: 'resource',
          resource: { uri: 'file:///r.txt', text, mimeType: 'text/plain' },
        },
      ],
    });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    expect(extractResponse(parts).error).toMatchObject({ isError: true });
  });

  it('fails oversized embedded blob resource atomically', async () => {
    const blob = 'A'.repeat(BUDGET_BYTES + 1);
    const client = mockClient({
      content: [
        {
          type: 'resource',
          resource: {
            uri: 'file:///d.bin',
            blob,
            mimeType: 'application/octet-stream',
          },
        },
      ],
    });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    expect(extractResponse(parts).error).toMatchObject({ isError: true });
  });

  it('fails multiple blocks whose aggregate crosses the budget', async () => {
    const half = Math.floor(BUDGET_BYTES / 2);
    const client = mockClient({
      content: [
        { type: 'text', text: 'x'.repeat(half) },
        { type: 'text', text: 'x'.repeat(half + 1) },
      ],
    });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    expect(extractResponse(parts).error).toMatchObject({ isError: true });
  });

  it('accepts a valid mixed-block response with content returned unchanged', async () => {
    const content = [
      { type: 'text', text: 'First part.' },
      { type: 'image', data: 'BASE64_IMAGE', mimeType: 'image/jpeg' },
      { type: 'text', text: 'Second part.' },
    ];
    const client = mockClient({ content });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    const response = extractResponse(parts);
    expect(response.error).toBeUndefined();
    expect(response.content).toStrictEqual(content);
  });

  it('accepts exact-boundary UTF-8 multibyte text', async () => {
    // "é" is 2 UTF-8 bytes. BUDGET_BYTES / 2 chars = exactly BUDGET_BYTES bytes.
    const text = 'é'.repeat(BUDGET_BYTES / 2);
    const client = mockClient({ content: [{ type: 'text', text }] });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    expect(extractResponse(parts).error).toBeUndefined();
  });

  it('fails one-byte-over UTF-8 multibyte text atomically', async () => {
    const text = 'é'.repeat(BUDGET_BYTES / 2) + 'x';
    const client = mockClient({ content: [{ type: 'text', text }] });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    const response = extractResponse(parts);
    expect(response.error).toMatchObject({ isError: true });
    expect(response.content).toBeUndefined();
  });

  it('accepts exact-boundary resource-link transformed string', async () => {
    // The transformed string is: `Resource Link: ${label} at ${uri}`
    // Overhead: "Resource Link: " (15) + " at " (4) = 19 bytes.
    // uri = "file:///r" (9 bytes). label must be BUDGET_BYTES - 19 - 9 bytes.
    const uri = 'file:///r';
    const labelLength = BUDGET_BYTES - 19 - uri.length;
    const client = mockClient({
      content: [
        {
          type: 'resource_link',
          uri,
          title: 'x'.repeat(labelLength),
        },
      ],
    });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    expect(extractResponse(parts).error).toBeUndefined();
  });

  it('fails one-byte-over resource-link transformed string atomically', async () => {
    const uri = 'file:///r';
    const labelLength = BUDGET_BYTES - 19 - uri.length + 1;
    const client = mockClient({
      content: [
        {
          type: 'resource_link',
          uri,
          title: 'x'.repeat(labelLength),
        },
      ],
    });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    const response = extractResponse(parts);
    expect(response.error).toMatchObject({ isError: true });
    expect(response.content).toBeUndefined();
  });

  it('fails a heterogeneous multi-block aggregate that crosses the budget', async () => {
    const half = Math.floor(BUDGET_BYTES / 2);
    const client = mockClient({
      content: [
        { type: 'text', text: 'x'.repeat(half - 1) },
        { type: 'image', data: 'A'.repeat(half + 2), mimeType: 'image/png' },
      ],
    });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    const response = extractResponse(parts);
    expect(response.error).toMatchObject({ isError: true });
    expect(response.content).toBeUndefined();
  });

  it('returns the exact size-limit error shape with no partial content on overflow', async () => {
    const text = 'x'.repeat(BUDGET_BYTES + 1);
    const client = mockClient({ content: [{ type: 'text', text }] });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    const response = extractResponse(parts);

    const error = response.error as Record<string, unknown> | undefined;
    expect(error).toBeDefined();
    expect(error?.isError).toBe(true);
    expect(typeof error?.message).toBe('string');
    expect(error?.message as string).toMatch(/exceeds the maximum allowed/i);
    expect(error?.message as string).toContain(
      (BUDGET_BYTES + 1).toLocaleString('en-US'),
    );
    expect(error?.message as string).toContain(
      BUDGET_BYTES.toLocaleString('en-US'),
    );
    // No partial content or original result leaks through.
    expect(response.content).toBeUndefined();
    expect(response.isError).toBeUndefined();
  });
});
