/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { Readable } from 'node:stream';

import { CodeSearchTool, type CodeSearchToolParams } from './codesearch.js';
import { ToolErrorType } from '../types/tool-error.js';

const { mockedFetch } = { mockedFetch: vi.fn() };
void vi.mock('node-fetch', () => ({
  default: mockedFetch,
}));

function mockBody(text: string): Readable {
  return Readable.from([Buffer.from(text)]);
}

function getFetchSignal(value: unknown): AbortSignal | undefined {
  if (typeof value !== 'object' || value === null || !('signal' in value)) {
    return undefined;
  }
  return value.signal instanceof AbortSignal ? value.signal : undefined;
}

describe('CodeSearchTool', () => {
  const keyStorage = { resolveKey: vi.fn() };
  const settingsService = {
    getSetting: vi.fn(),
    getSettingsService: vi.fn(() => ({ get: vi.fn() })),
  };
  let tool: CodeSearchTool;

  beforeEach(() => {
    vi.clearAllMocks();
    keyStorage.resolveKey.mockResolvedValue(null);
    settingsService.getSetting.mockReturnValue(undefined);
    tool = new CodeSearchTool({ keyStorage, settingsService });
  });

  it('validates parameters correctly', () => {
    const params: CodeSearchToolParams = { query: 'test query' };
    expect(tool.validateToolParams(params)).toBeNull();
  });

  it('executes search successfully with default tokens', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: mockBody(
        'data: {"result":{"content":[{"text":"Here is some React hooks documentation..."}]}}\n',
      ),
    });

    const result = await tool
      .build({ query: 'react hooks' })
      .execute(new AbortController().signal);

    const callArgs = mockedFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    const url = new URL(callArgs[0]);
    expect(url.searchParams.get('tools')).toBe('get_code_context_exa');
    expect(requestBody.params.arguments.tokensNum).toBe(5000);
    expect(result.llmContent).toBe('Here is some React hooks documentation...');
  });

  it('caps tokensNum with settings value when params exceed it', async () => {
    settingsService.getSetting.mockReturnValue(2000);
    mockedFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: mockBody(''),
    });

    await tool
      .build({ query: 'test', tokensNum: 4000 })
      .execute(new AbortController().signal);

    const requestBody = JSON.parse(mockedFetch.mock.calls[0][1].body);
    expect(requestBody.params.arguments.tokensNum).toBe(2000);
  });

  it('appends exaApiKey query parameter when key is available', async () => {
    keyStorage.resolveKey.mockResolvedValue('sk-test-key');
    mockedFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: mockBody(''),
    });

    await tool
      .build({ query: 'test query' })
      .execute(new AbortController().signal);

    const url = new URL(mockedFetch.mock.calls[0][0]);
    expect(url.searchParams.get('tools')).toBe('get_code_context_exa');
    expect(url.searchParams.get('exaApiKey')).toBe('sk-test-key');
  });

  it('handles API errors', async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      body: mockBody('Internal Server Error'),
    });

    const result = await tool
      .build({ query: 'error' })
      .execute(new AbortController().signal);

    expect(result.error?.message).toContain('Code search error (500)');
  });

  it('preserves malformed SSE line skipping behavior', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: mockBody(
        'garbage line\n' +
          'data: {"result":{"content":[{"text":"Valid code result."}]}}\n',
      ),
    });

    const result = await tool
      .build({ query: 'mixed' })
      .execute(new AbortController().signal);

    expect(result.llmContent).toBe('Valid code result.');
  });

  it('handles upstream MCP error responses', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: mockBody(
        'data: {"error":{"code":-32603,"message":"upstream failure"}}\n',
      ),
    });

    const result = await tool
      .build({ query: 'upstream-error' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
    expect(result.error?.message).toContain('upstream failure');
  });

  describe('body size limits', () => {
    it('returns SEARCH_ERROR when the success body exceeds the budget', async () => {
      const successBody = mockBody('x'.repeat(100));
      mockedFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (key: string) => (key === 'content-length' ? '9999999' : null),
        },
        body: successBody,
      });

      const result = await tool
        .build({ query: 'overflow' })
        .execute(new AbortController().signal);

      expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
      expect(result.error?.message).toMatch(/exceeds/i);
      const fetchSignal = getFetchSignal(mockedFetch.mock.calls[0][1]);
      expect(fetchSignal?.aborted).toBe(true);
      expect(successBody.destroyed).toBe(true);
    });

    it('returns SEARCH_ERROR when the error body exceeds the budget', async () => {
      const errorBodyStream = mockBody('x'.repeat(100));
      mockedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: {
          get: (key: string) => (key === 'content-length' ? '9999999' : null),
        },
        body: errorBodyStream,
      });

      const result = await tool
        .build({ query: 'overflow-error' })
        .execute(new AbortController().signal);

      expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
      expect(result.error?.message).toMatch(/exceeds/i);
      expect(result.error?.message).toContain('500');
      const fetchSignal = getFetchSignal(mockedFetch.mock.calls[0][1]);
      expect(fetchSignal?.aborted).toBe(true);
      expect(errorBodyStream.destroyed).toBe(true);
    });
  });

  describe('observed-byte overflow (no Content-Length)', () => {
    const BUDGET_BYTES = 4 * 1024 * 1024; // 4 MiB

    function overflowStream(): Readable {
      const chunkSize = 64 * 1024;
      let sent = 0;
      return new Readable({
        read() {
          if (sent > BUDGET_BYTES) {
            this.push(null);
            return;
          }
          this.push(Buffer.alloc(chunkSize, 0x78));
          sent += chunkSize;
        },
      });
    }

    it('returns SEARCH_ERROR when a no-Content-Length success body exceeds the budget via observed bytes', async () => {
      const successBody = overflowStream();
      mockedFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        body: successBody,
      });

      const result = await tool
        .build({ query: 'observed-overflow-success' })
        .execute(new AbortController().signal);

      expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
      expect(result.error?.message).toMatch(/exceeds/i);
      const fetchSignal = getFetchSignal(mockedFetch.mock.calls[0][1]);
      expect(fetchSignal?.aborted).toBe(true);
      expect(successBody.destroyed).toBe(true);
    });

    it('returns SEARCH_ERROR when a no-Content-Length error body exceeds the budget via observed bytes', async () => {
      const errorBodyStream = overflowStream();
      mockedFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: () => null },
        body: errorBodyStream,
      });

      const result = await tool
        .build({ query: 'observed-overflow-error' })
        .execute(new AbortController().signal);

      expect(result.error?.type).toBe(ToolErrorType.SEARCH_ERROR);
      expect(result.error?.message).toMatch(/exceeds/i);
      expect(result.error?.message).toContain('500');
      const fetchSignal = getFetchSignal(mockedFetch.mock.calls[0][1]);
      expect(fetchSignal?.aborted).toBe(true);
      expect(errorBodyStream.destroyed).toBe(true);
    });
  });
});
