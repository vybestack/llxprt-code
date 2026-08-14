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
import { measureOwnEnumerableJsonBytes } from './jsonByteMeasurer.js';

const TOOL_DEF: McpTool = {
  name: 'test_tool',
  description: 'A test tool',
  inputSchema: { type: 'object' },
};

const BUDGET_BYTES = 4 * 1024 * 1024;

/**
 * Compute the UTF-8 byte overhead of the JSON wrapper around an EMPTY payload,
 * using JSON.stringify as the structural reference. The bounded recursive
 * measurer must match this accounting exactly, so exact-boundary tests derive
 * the fillable payload size from this rather than hand-counting braces.
 */
function jsonWrapperOverhead(wrapperWithEmptyPayload: unknown): number {
  return Buffer.byteLength(JSON.stringify(wrapperWithEmptyPayload), 'utf8');
}

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
    const overhead = jsonWrapperOverhead({
      content: [{ type: 'text', text: '' }],
    });
    const text = 'x'.repeat(BUDGET_BYTES - overhead);
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
    const overhead = jsonWrapperOverhead({
      content: [{ type: 'text', text: '' }],
    });
    // "é" is 2 UTF-8 bytes. Use the largest even fill ≤ the remaining budget.
    const fillable = (BUDGET_BYTES - overhead) & ~1;
    const text = 'é'.repeat(fillable / 2);
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

  it('accepts exact-boundary resource-link raw JSON', async () => {
    // The recursive measurer budgets the raw resource_link block JSON
    // (not a transformed string). Compute the fillable title size from the
    // wrapper overhead with an empty title.
    const uri = 'file:///r';
    const overhead = jsonWrapperOverhead({
      content: [{ type: 'resource_link', uri, title: '' }],
    });
    const title = 'x'.repeat(BUDGET_BYTES - overhead);
    const client = mockClient({
      content: [{ type: 'resource_link', uri, title }],
    });
    const tool = new McpCallableTool(client, TOOL_DEF, 5000);
    const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
    expect(extractResponse(parts).error).toBeUndefined();
  });

  it('fails one-byte-over resource-link raw JSON atomically', async () => {
    const uri = 'file:///r';
    const overhead = jsonWrapperOverhead({
      content: [{ type: 'resource_link', uri, title: '' }],
    });
    const title = 'x'.repeat(BUDGET_BYTES - overhead + 1);
    const client = mockClient({
      content: [{ type: 'resource_link', uri, title }],
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

  describe('McpCallableTool aggregate budget across all fields (issue #3202)', () => {
    it('enforces budget on structuredContent alone (one-over)', async () => {
      const bigPayload = { data: 'x'.repeat(BUDGET_BYTES + 1) };
      const client = mockClient({
        content: [{ type: 'text', text: 'small' }],
        structuredContent: bigPayload,
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toMatchObject({ isError: true });
    });

    it('accepts structuredContent at exact boundary', async () => {
      // The whole result tree is measured. The wrapper has:
      // content:[{type:"text",text:"small"}] (text "small") plus
      // structuredContent:{d:""}. Compute fillable from the wrapper overhead.
      const overhead = jsonWrapperOverhead({
        content: [{ type: 'text', text: 'small' }],
        structuredContent: { d: '' },
      });
      const value = 'x'.repeat(BUDGET_BYTES - overhead);
      const client = mockClient({
        content: [{ type: 'text', text: 'small' }],
        structuredContent: { d: value },
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toBeUndefined();
    });

    it('enforces budget on _meta alone (one-over)', async () => {
      const client = mockClient({
        content: [{ type: 'text', text: 'small' }],
        _meta: { extension: 'x'.repeat(BUDGET_BYTES + 1) },
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toMatchObject({ isError: true });
    });

    it('enforces mixed aggregate: content + structuredContent + _meta', async () => {
      const third = Math.floor(BUDGET_BYTES / 3);
      const client = mockClient({
        content: [{ type: 'text', text: 'x'.repeat(third + 1) }],
        structuredContent: { d: 'y'.repeat(third + 1) },
        _meta: { ext: 'z'.repeat(third + 1) },
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toMatchObject({ isError: true });
    });

    it('accepts mixed aggregate at exact boundary', async () => {
      // Derive both payload sizes from the wrapper structural overhead so the
      // whole tree measures exactly BUDGET_BYTES.
      const structOverhead = jsonWrapperOverhead({
        content: [{ type: 'text', text: '' }],
        structuredContent: { d: '' },
      });
      const contentBytes = Math.floor((BUDGET_BYTES - structOverhead) / 2);
      const structValue = 'x'.repeat(
        BUDGET_BYTES - structOverhead - contentBytes,
      );
      const client = mockClient({
        content: [{ type: 'text', text: 'y'.repeat(contentBytes) }],
        structuredContent: { d: structValue },
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toBeUndefined();
    });

    it('enforces budget on toolResult (compatibility variant) content', async () => {
      // The compatibility/task variant has toolResult.content instead of content.
      const text = 'x'.repeat(BUDGET_BYTES + 1);
      const client = mockClient({
        toolResult: {
          content: [{ type: 'text', text }],
        },
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toMatchObject({ isError: true });
    });

    it('accepts toolResult (compatibility variant) within budget', async () => {
      const text = 'small result';
      const client = mockClient({
        toolResult: {
          content: [{ type: 'text', text }],
        },
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toBeUndefined();
    });

    it('rejects atomically — no partial content leaks on structuredContent overflow', async () => {
      const client = mockClient({
        content: [{ type: 'text', text: 'leaked content' }],
        structuredContent: { data: 'x'.repeat(BUDGET_BYTES + 1) },
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      const response = extractResponse(parts);
      expect(response.error).toMatchObject({ isError: true });
      // No content or structuredContent must leak through.
      expect(response.content).toBeUndefined();
      expect(response.structuredContent).toBeUndefined();
    });

    it('budgets a loose top-level extension field beyond the known ones', async () => {
      // An arbitrary own-enumerable field not in content/structuredContent/
      // _meta/toolResult must still count toward the aggregate.
      const overhead = jsonWrapperOverhead({
        content: [{ type: 'text', text: 'small' }],
        vendorExtension: '',
      });
      const client = mockClient({
        content: [{ type: 'text', text: 'small' }],
        vendorExtension: 'x'.repeat(BUDGET_BYTES - overhead + 1),
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toMatchObject({ isError: true });
    });

    it('budgets nested resource annotations/metadata fields', async () => {
      // Deeply nested metadata/annotations under a resource must count.
      const overhead = jsonWrapperOverhead({
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'u',
              text: '',
              mimeType: 't',
              annotations: { audience: [], priority: 0 },
              _meta: { note: '' },
            },
          },
        ],
      });
      const note = 'x'.repeat(BUDGET_BYTES - overhead + 1);
      const client = mockClient({
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'u',
              text: '',
              mimeType: 't',
              annotations: { audience: [], priority: 0 },
              _meta: { note },
            },
          },
        ],
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toMatchObject({ isError: true });
    });

    it('budgets the entire arbitrary toolResult object, not just .content', async () => {
      // The compatibility toolResult carries arbitrary sibling fields that must
      // also count.
      const overhead = jsonWrapperOverhead({
        toolResult: { content: [{ type: 'text', text: '' }], blob: '' },
      });
      const client = mockClient({
        toolResult: {
          content: [{ type: 'text', text: 'small' }],
          blob: 'x'.repeat(BUDGET_BYTES - overhead + 1),
        },
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toMatchObject({ isError: true });
    });

    it('budgets structural JSON overhead of many empty records', async () => {
      // Many empty objects cost 2 bytes each structurally ({}) — a huge array
      // of them must overflow purely on structural overhead, with no content.
      const overhead = jsonWrapperOverhead({ content: [] });
      const perEmpty = jsonWrapperOverhead({}); // {} = 2 bytes
      const count = Math.ceil((BUDGET_BYTES - overhead) / perEmpty) + 1;
      const client = mockClient({
        content: Array.from({ length: count }, () => ({})),
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toMatchObject({ isError: true });
    });

    it('counts JSON string escaping overhead (quotes inflate bytes)', async () => {
      // A string of double-quotes doubles in size under JSON escaping. Size the
      // payload so it is accepted without escaping accounting but rejected with it.
      const overhead = jsonWrapperOverhead({
        content: [{ type: 'text', text: '' }],
      });
      // Each `"` becomes `"` (2 bytes). fillable / 2 raw quotes fit, but
      // (fillable/2)+1 raw quotes exceed after escaping.
      const fillable = BUDGET_BYTES - overhead;
      const rawQuotes = Math.floor(fillable / 2) + 1; // exceeds once escaped
      const text = '"'.repeat(rawQuotes);
      const client = mockClient({ content: [{ type: 'text', text }] });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toMatchObject({ isError: true });
    });

    it('fails closed on a circular reference in the result', async () => {
      const node: Record<string, unknown> = { label: 'root' };
      node.self = node; // circular
      const client = mockClient({
        content: [{ type: 'text', text: 'small' }],
        circular: node,
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toMatchObject({ isError: true });
    });

    it('fails closed on a non-serializable BigInt value in the result', async () => {
      const client = mockClient({
        content: [{ type: 'text', text: 'small' }],
        big: BigInt(123),
      });
      const tool = new McpCallableTool(client, TOOL_DEF, 5000);
      const parts = await tool.callTool([{ name: 'test_tool', args: {} }]);
      expect(extractResponse(parts).error).toMatchObject({ isError: true });
    });

    it('measurer byte count matches JSON.stringify for a representative tree', () => {
      // Direct correctness cross-check: the bounded measurer must equal the
      // reference JSON byte length for serializable values well under the limit.
      const tree = {
        content: [
          { type: 'text', text: 'héllo "world"' + String.fromCharCode(10, 9) },
          { type: 'image', data: 'AAA', mimeType: 'image/png' },
        ],
        structuredContent: { nested: { a: 1, b: [true, null, 2.5, 'x'] } },
        _meta: { k: 'v' },
        flag: false,
      };
      const reference = Buffer.byteLength(JSON.stringify(tree), 'utf8');
      expect(measureOwnEnumerableJsonBytes(tree, BUDGET_BYTES)).toBe(reference);
    });

    it('-0 serializes as "0", matching JSON.stringify (issue #3202 OCR reject)', () => {
      // String(-0) is "0", NOT "-0". JSON.stringify(-0) is also "0". The
      // measurer must match this. This locks down the factually-correct
      // behavior that OCR incorrectly flagged.
      const value = { n: -0 };
      const reference = Buffer.byteLength(JSON.stringify(value), 'utf8');
      expect(measureOwnEnumerableJsonBytes(value, BUDGET_BYTES)).toBe(
        reference,
      );
      // Structural sanity: {"n":0} = 7 bytes.
      expect(reference).toBe(7);
    });

    it('counts a lone high surrogate as a six-byte \\uXXXX escape, matching JSON.stringify', () => {
      const value = { s: '\ud800' };
      const reference = Buffer.byteLength(JSON.stringify(value), 'utf8');
      expect(measureOwnEnumerableJsonBytes(value, BUDGET_BYTES)).toBe(
        reference,
      );
      // JSON.stringify emits the ASCII escape \ud800 (6 bytes) for the lone
      // high surrogate, not raw UTF-8 (3 bytes).
      expect(JSON.stringify(value)).toBe('{"s":"\\ud800"}');
    });

    it('counts a lone low surrogate as a six-byte \\uXXXX escape, matching JSON.stringify', () => {
      const value = { s: '\udfff' };
      const reference = Buffer.byteLength(JSON.stringify(value), 'utf8');
      expect(measureOwnEnumerableJsonBytes(value, BUDGET_BYTES)).toBe(
        reference,
      );
      expect(JSON.stringify(value)).toBe('{"s":"\\udfff"}');
    });

    it('counts mixed lone surrogates as six-byte escapes each, matching JSON.stringify', () => {
      const value = { s: 'a\ud800b\udc00c' };
      const reference = Buffer.byteLength(JSON.stringify(value), 'utf8');
      expect(measureOwnEnumerableJsonBytes(value, BUDGET_BYTES)).toBe(
        reference,
      );
      expect(JSON.stringify(value)).toBe('{"s":"a\\ud800b\\udc00c"}');
    });

    it('counts a valid surrogate pair as its 4-byte UTF-8 code point, matching JSON.stringify', () => {
      const value = { s: '\u{1F600}' };
      const reference = Buffer.byteLength(JSON.stringify(value), 'utf8');
      expect(measureOwnEnumerableJsonBytes(value, BUDGET_BYTES)).toBe(
        reference,
      );
      // The emoji (U+1F600) is a valid pair that encodes to 4 UTF-8 bytes,
      // NOT an escape sequence.
      expect(reference).toBe(
        Buffer.byteLength('{"s":"', 'utf8') +
          4 +
          Buffer.byteLength('"}', 'utf8'),
      );
    });

    it('rethrows a genuine getter error instead of swallowing it as over-budget', () => {
      const evil: Record<string, unknown> = {};
      Object.defineProperty(evil, 'boom', {
        enumerable: true,
        get(): number {
          throw new Error('genuine getter error');
        },
      });
      // Fail fast: a genuine runtime error from an unexpected source must
      // propagate, not be masked as an over-budget result.
      expect(() => measureOwnEnumerableJsonBytes(evil, BUDGET_BYTES)).toThrow(
        'genuine getter error',
      );
    });

    it('still fails closed on circular references (sentinel path returns over-budget)', () => {
      const node: Record<string, unknown> = { label: 'root' };
      node.self = node;
      // Circular references throw the internal sentinel and are treated as
      // over-budget (limit + 1), preserving the deliberate fail-closed
      // contract even after the catch was narrowed to the sentinel.
      expect(measureOwnEnumerableJsonBytes(node, BUDGET_BYTES)).toBe(
        BUDGET_BYTES + 1,
      );
    });

    it('ignores inherited enumerable properties, matching JSON.stringify (lazy own-key traversal)', () => {
      // for...in + hasOwnProperty must skip prototype properties exactly like
      // Object.keys / JSON.stringify do, while still counting own keys.
      const proto = { inherited: 'value' };
      const obj: Record<string, unknown> = Object.create(proto);
      obj.own = 1;
      obj.also = 'x';
      const reference = Buffer.byteLength(JSON.stringify(obj), 'utf8');
      expect(measureOwnEnumerableJsonBytes(obj, BUDGET_BYTES)).toBe(reference);
      // Inherited property must NOT contribute; only own keys counted.
      expect(reference).toBe(Buffer.byteLength('{"own":1,"also":"x"}', 'utf8'));
    });
  });
});
