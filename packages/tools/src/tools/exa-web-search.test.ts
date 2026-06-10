/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fetch from 'node-fetch';

import { ExaWebSearchTool } from './exa-web-search.js';

vi.mock('node-fetch');
const mockedFetch = fetch as unknown as ReturnType<typeof vi.fn>;

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
      text: vi
        .fn()
        .mockResolvedValue(
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
      text: vi.fn().mockResolvedValue('API Failure'),
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
      text: vi.fn().mockResolvedValue(''),
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
    mockedFetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(''),
    });

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
});
