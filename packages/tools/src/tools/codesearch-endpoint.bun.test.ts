/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the codesearch Exa MCP endpoint fix (issue #3038, AC7).
 *
 * Stubs only node-fetch — the single external I/O boundary — and asserts on the
 * request URL (parsed, not string-compared) and on how upstream error/success
 * responses map to ToolResult.
 *
 * @plan issue3038
 */

import { mock, describe, it, expect, beforeEach, type Mock } from 'bun:test';
import { Readable } from 'node:stream';

/**
 * The fetch stub is the only thing standing in for the network. It captures
 * the request URL so each test can parse it, and returns whatever response
 * the test has queued.
 */
interface FetchResponse {
  ok: boolean;
  status?: number;
  body: Readable;
  headers: { get: (name: string) => string | null };
}

let queuedText = '';
let queuedOk = true;
let queuedStatus: number | undefined;

const fetchStub: Mock<(url: string, init: unknown) => Promise<FetchResponse>> =
  mock(
    async (_url: string, _init: unknown): Promise<FetchResponse> => ({
      ok: queuedOk,
      status: queuedStatus,
      body: Readable.from([Buffer.from(queuedText)]),
      headers: { get: () => null },
    }),
  );

// Register the mock BEFORE dynamically importing codesearch.js, so the mock
// is active when that module resolves its `import fetch from 'node-fetch'`.
void mock.module('node-fetch', () => ({ default: fetchStub }));

const { CodeSearchTool } = await import('./codesearch.js');
const { ToolErrorType } = await import('../types/tool-error.js');

interface CapturedCall {
  url: string;
  body: unknown;
}

function lastCall(): CapturedCall {
  const calls = fetchStub.mock.calls;
  if (calls.length === 0) {
    throw new Error('fetch was never called');
  }
  const last = calls[calls.length - 1];
  return { url: String(last[0]), body: last[1] };
}

/**
 * Narrows the captured fetch init to the upstream tool name and query carried
 * in the JSON-RPC request body. Every level is checked — no type assertions.
 */
function extractRequestBody(init: unknown): { name: string; query: string } {
  if (typeof init !== 'object' || init === null) {
    throw new Error(`Expected fetch init object, got ${typeof init}`);
  }
  if (!('body' in init) || typeof init.body !== 'string') {
    throw new Error('Expected fetch init to carry a string body');
  }
  const parsed: unknown = JSON.parse(init.body);
  if (typeof parsed !== 'object' || parsed === null || !('params' in parsed)) {
    throw new Error('Expected JSON-RPC params in request body');
  }
  const params: unknown = parsed.params;
  if (typeof params !== 'object' || params === null) {
    throw new Error('Expected params object in request body');
  }
  if (!('name' in params) || typeof params.name !== 'string') {
    throw new Error('Expected params.name string');
  }
  if (
    !('arguments' in params) ||
    typeof params.arguments !== 'object' ||
    params.arguments === null
  ) {
    throw new Error('Expected params.arguments object');
  }
  const args = params.arguments;
  if (!('query' in args) || typeof args.query !== 'string') {
    throw new Error('Expected params.arguments.query string');
  }
  return { name: params.name, query: args.query };
}

describe('codesearch Exa MCP endpoint (issue #3038, AC7)', () => {
  const keyStorage = {
    resolveKey: mock(async (_name: string): Promise<string | null> => null),
  };
  const settingsService = {
    getSetting: mock(() => undefined),
    getSettingsService: mock(() => ({ get: mock(() => undefined) })),
  };
  let tool: InstanceType<typeof CodeSearchTool>;

  beforeEach(() => {
    fetchStub.mockClear();
    keyStorage.resolveKey.mockClear();
    settingsService.getSetting.mockClear();
    keyStorage.resolveKey.mockImplementation(async () => null);
    queuedText = '';
    queuedOk = true;
    queuedStatus = undefined;
    tool = new CodeSearchTool({ keyStorage, settingsService });
  });

  it('always carries tools=get_code_context_exa in the request URL', async () => {
    queuedOk = true;
    queuedText = 'data: {"result":{"content":[{"text":"snippet"}]}}\n';

    await tool
      .build({ query: 'react hooks' })
      .execute(new AbortController().signal);

    const { url, body } = lastCall();
    const parsed = new URL(url);
    expect(parsed.searchParams.get('tools')).toBe('get_code_context_exa');

    const requestBody = extractRequestBody(body);
    expect(requestBody.name).toBe('get_code_context_exa');
    expect(requestBody.query).toBe('react hooks');
  });

  it('carries both tools and exaApiKey when a key resolves', async () => {
    keyStorage.resolveKey.mockImplementation(async () => 'sk-test-key');
    queuedOk = true;
    queuedText = 'data: {"result":{"content":[{"text":"snippet"}]}}\n';

    await tool
      .build({ query: 'react hooks' })
      .execute(new AbortController().signal);

    const { url } = lastCall();
    const parsed = new URL(url);
    expect(parsed.searchParams.get('tools')).toBe('get_code_context_exa');
    expect(parsed.searchParams.get('exaApiKey')).toBe('sk-test-key');
  });

  it('returns SEARCH_ERROR when the upstream result has isError: true', async () => {
    queuedOk = true;
    queuedText =
      'data: {"result":{"content":[{"type":"text","text":"MCP error -32602: Tool get_code_context_exa not found"}],"isError":true},"jsonrpc":"2.0","id":1}\n';

    const result = await tool
      .build({ query: 'broken query' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
    expect(result.llmContent).toContain('get_code_context_exa');
  });

  it('returns SEARCH_ERROR on a top-level JSON-RPC error object', async () => {
    queuedOk = true;
    queuedText =
      'data: {"error":{"code":-32602,"message":"Invalid params"},"jsonrpc":"2.0","id":1}\n';

    const result = await tool
      .build({ query: 'bad query' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
  });

  it('does not interpolate undefined when error fields are missing (review)', async () => {
    queuedOk = true;
    queuedText = 'data: {"error":{},"jsonrpc":"2.0","id":1}' + '\n';

    const result = await tool
      .build({ query: 'shapeless error' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
    expect(result.llmContent).not.toContain('undefined');
    expect(result.error?.message).not.toContain('undefined');
  });

  it('returns SEARCH_ERROR when isError is true with empty content (FIX-1)', async () => {
    queuedOk = true;
    queuedText =
      'data: {"result":{"content":[],"isError":true},"jsonrpc":"2.0","id":1}\n';

    const result = await tool
      .build({ query: 'empty error' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
  });

  it('returns SEARCH_ERROR when isError is true and content is missing (FIX-1)', async () => {
    queuedOk = true;
    queuedText = 'data: {"result":{"isError":true},"jsonrpc":"2.0","id":1}\n';

    const result = await tool
      .build({ query: 'missing content error' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
  });

  it('sanitizes unpaired surrogates in upstream error text (FIX-2)', async () => {
    queuedOk = true;
    queuedText =
      'data: {"result":{"content":[{"type":"text","text":"\\ud800 broken"}],"isError":true},"jsonrpc":"2.0","id":1}\n';

    const result = await tool
      .build({ query: 'surrogate test' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
    const SURROGATE = String.fromCharCode(0xd800);
    expect(result.llmContent).not.toContain(SURROGATE);
    expect(result.returnDisplay).not.toContain(SURROGATE);
    expect(result.error?.message).not.toContain(SURROGATE);
  });

  it('returns content unchanged for a successful response', async () => {
    queuedOk = true;
    queuedText =
      'data: {"result":{"content":[{"type":"text","text":"Here is some React hooks documentation."}]}}\n';

    const result = await tool
      .build({ query: 'react hooks' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toBe('Here is some React hooks documentation.');
  });
});
