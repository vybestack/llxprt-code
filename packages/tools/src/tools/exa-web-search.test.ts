/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { Readable } from 'node:stream';

import { ExaWebSearchTool } from './exa-web-search.js';
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

describe('ExaWebSearchTool', () => {
  const keyStorage = { resolveKey: vi.fn() };
  let tool: ExaWebSearchTool;

  beforeEach(() => {
    vi.clearAllMocks();
    keyStorage.resolveKey.mockResolvedValue(null);
    tool = new ExaWebSearchTool({ keyStorage });
  });

  it('has correct name and description', () => {
    expect(ExaWebSearchTool.Name).toBe('exa_web_search');
    expect(tool.name).toBe('exa_web_search');
  });

  it('returns search results for a successful query', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: mockBody(
        'data: {"result":{"content":[{"text":"Here are your results."}]}}\n',
      ),
    });

    const result = await tool
      .build({ query: 'successful query' })
      .execute(new AbortController().signal);

    expect(result.llmContent).toBe('Here are your results.');
    expect(result.returnDisplay).toBe('Here are your results.');
  });

  it('returns a WEB_SEARCH_FAILED error on failure', async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      body: mockBody('API Failure'),
    });

    const result = await tool
      .build({ query: 'error query' })
      .execute(new AbortController().signal);

    expect(result.error?.message).toContain('API Failure');
    expect(result.llmContent).toContain('Error performing web search');
  });

  it('appends exaApiKey query parameter when key is available', async () => {
    keyStorage.resolveKey.mockResolvedValue('key+with/special=chars');
    mockedFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: mockBody(''),
    });

    await tool
      .build({ query: 'test query' })
      .execute(new AbortController().signal);

    expect(mockedFetch.mock.calls[0][0]).toBe(
      `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(
        'key+with/special=chars',
      )}`,
    );
  });

  it('resolves key fresh on each invocation', async () => {
    mockedFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => null },
        body: mockBody(''),
      }),
    );

    await tool
      .build({ query: 'first query' })
      .execute(new AbortController().signal);
    keyStorage.resolveKey.mockResolvedValue('new-key');
    await tool
      .build({ query: 'second query' })
      .execute(new AbortController().signal);

    expect(mockedFetch.mock.calls[0][0]).toBe('https://mcp.exa.ai/mcp');
    expect(mockedFetch.mock.calls[1][0]).toBe(
      'https://mcp.exa.ai/mcp?exaApiKey=new-key',
    );
  });

  it('skips malformed SSE lines and still parses valid ones', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: mockBody(
        'garbage line\n' +
          'data: {"result":{"content":[{"text":"Valid result."}]}}\n',
      ),
    });

    const result = await tool
      .build({ query: 'mixed' })
      .execute(new AbortController().signal);

    expect(result.llmContent).toBe('Valid result.');
  });

  describe('body size limits', () => {
    it('returns WEB_SEARCH_FAILED when the success body exceeds the budget', async () => {
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

      expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
      expect(result.error?.message).toMatch(/exceeds/i);
      const fetchSignal = getFetchSignal(mockedFetch.mock.calls[0][1]);
      expect(fetchSignal?.aborted).toBe(true);
      expect(successBody.destroyed).toBe(true);
    });

    it('returns WEB_SEARCH_FAILED when the error body exceeds the budget', async () => {
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

      expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
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

    it('returns WEB_SEARCH_FAILED when a no-Content-Length success body exceeds the budget via observed bytes', async () => {
      const successBody = overflowStream();
      mockedFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        body: successBody,
      });

      const result = await tool
        .build({ query: 'observed-overflow-success' })
        .execute(new AbortController().signal);

      expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
      expect(result.error?.message).toMatch(/exceeds/i);
      const fetchSignal = getFetchSignal(mockedFetch.mock.calls[0][1]);
      expect(fetchSignal?.aborted).toBe(true);
      expect(successBody.destroyed).toBe(true);
    });

    it('returns WEB_SEARCH_FAILED when a no-Content-Length error body exceeds the budget via observed bytes', async () => {
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

      expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
      expect(result.error?.message).toMatch(/exceeds/i);
      expect(result.error?.message).toContain('500');
      const fetchSignal = getFetchSignal(mockedFetch.mock.calls[0][1]);
      expect(fetchSignal?.aborted).toBe(true);
      expect(errorBodyStream.destroyed).toBe(true);
    });
  });
});
