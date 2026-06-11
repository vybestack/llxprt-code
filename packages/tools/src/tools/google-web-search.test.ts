/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GoogleWebSearchTool } from './google-web-search.js';
import type { IWebSearchService } from '../interfaces/index.js';
import type { WebSearchToolParams } from './google-web-search-invocation.js';

describe('GoogleWebSearchTool', () => {
  let tool: GoogleWebSearchTool;
  let mockInvokeServerTool: ReturnType<typeof vi.fn>;
  let mockServerToolsProvider: {
    getServerTools: ReturnType<typeof vi.fn>;
    invokeServerTool: ReturnType<typeof vi.fn>;
  };
  let webSearchService: IWebSearchService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockInvokeServerTool = vi.fn();
    mockServerToolsProvider = {
      getServerTools: vi.fn().mockReturnValue(['web_search']),
      invokeServerTool: mockInvokeServerTool,
    };
    webSearchService = {
      getServerToolsProvider: vi.fn().mockReturnValue(mockServerToolsProvider),
    };

    tool = new GoogleWebSearchTool(webSearchService);
  });

  it('has correct name and description', () => {
    expect(GoogleWebSearchTool.Name).toBe('google_web_search');
    expect(tool.name).toBe('google_web_search');
  });

  it('validates parameters', () => {
    const params: WebSearchToolParams = { query: 'test query' };
    expect(tool.validateToolParams(params)).toBeNull();
    expect(tool.validateToolParams({ query: '   ' })).toBe(
      "The 'query' parameter cannot be empty.",
    );
  });

  it('returns a description of the search', () => {
    const invocation = tool.build({ query: 'test query' });
    expect(invocation.getDescription()).toBe(
      'Searching the web for: "test query"',
    );
  });

  it('returns search results for a successful query', async () => {
    mockInvokeServerTool.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: 'Here are your results.' }],
          },
        },
      ],
    });

    const result = await tool
      .build({ query: 'successful query' })
      .execute(new AbortController().signal);

    expect(result.llmContent).toBe(
      'Web search results for "successful query":\n\nHere are your results.',
    );
    expect(result.returnDisplay).toBe(
      'Search results for "successful query" returned.',
    );
    expect(result.sources).toBeUndefined();
  });

  it('handles no search results found', async () => {
    mockInvokeServerTool.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: '' }] } }],
    });

    const result = await tool
      .build({ query: 'no results query' })
      .execute(new AbortController().signal);

    expect(result.llmContent).toBe(
      'No search results or information found for query: "no results query"',
    );
    expect(result.returnDisplay).toBe('No information found.');
  });

  it('returns a WEB_SEARCH_FAILED error on failure', async () => {
    mockInvokeServerTool.mockRejectedValue(new Error('API Failure'));

    const result = await tool
      .build({ query: 'error query' })
      .execute(new AbortController().signal);

    expect(result.error?.message).toContain('API Failure');
    expect(result.llmContent).toContain('Error during web search');
  });
});
