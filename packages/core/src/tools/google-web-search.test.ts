/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleWebSearchTool } from './google-web-search.js';
import { Config } from '../config/config.js';
import { WebSearchToolParams } from './google-web-search-invocation.js';

// Mock dependencies
vi.mock('../config/config.js');

describe('GoogleWebSearchTool', () => {
  let tool: GoogleWebSearchTool;
  let config: Config;
  let mockInvokeServerTool: ReturnType<typeof vi.fn>;
  let mockServerToolsProvider: {
    getServerTools: ReturnType<typeof vi.fn>;
    invokeServerTool: ReturnType<typeof vi.fn>;
  };
  let mockProviderManager: {
    getServerToolsProvider: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    mockInvokeServerTool = vi.fn();
    mockServerToolsProvider = {
      getServerTools: vi.fn().mockReturnValue(['web_search']),
      invokeServerTool: mockInvokeServerTool,
    };
    mockProviderManager = {
      getServerToolsProvider: vi.fn().mockReturnValue(mockServerToolsProvider),
    };

    // Setup Config mock
    config = {
      llm: {
        apiKey: 'test-api-key',
        model: 'gemini-pro',
      },
      getContentGeneratorConfig: vi.fn().mockReturnValue({
        providerManager: mockProviderManager,
      }),
    } as unknown as Config;

    tool = new GoogleWebSearchTool(config);
  });

  it('should have correct name and description', () => {
    expect(GoogleWebSearchTool.Name).toBe('google_web_search');
    expect(tool.name).toBe('google_web_search');
  });

  describe('validateToolParamValues', () => {
    it('should return null for valid parameters', () => {
      const params: WebSearchToolParams = { query: 'test query' };
      expect(tool.validateToolParams(params)).toBeNull();
    });

    it('should return an error message for empty query', () => {
      const params: WebSearchToolParams = { query: '' };
      expect(tool.validateToolParams(params)).toBe(
        "The 'query' parameter cannot be empty.",
      );
    });

    it('should return an error message for query with only whitespace', () => {
      const params: WebSearchToolParams = { query: '   ' };
      expect(tool.validateToolParams(params)).toBe(
        "The 'query' parameter cannot be empty.",
      );
    });
  });

  describe('getDescription', () => {
    it('should return a description of the search', () => {
      const params: WebSearchToolParams = { query: 'test query' };
      const invocation = tool.build(params);
      expect(invocation.getDescription()).toBe(
        'Searching the web for: "test query"',
      );
    });
  });

  describe('execute', () => {
    const abortSignal = new AbortController().signal;

    it('should return search results for a successful query', async () => {
      const params: WebSearchToolParams = { query: 'successful query' };
      mockInvokeServerTool.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: 'Here are your results.' }],
            },
          },
        ],
      });

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toBe(
        'Web search results for "successful query":\n\nHere are your results.',
      );
      expect(result.returnDisplay).toBe(
        'Search results for "successful query" returned.',
      );
      expect(result.sources).toBeUndefined();
    });

    it('should handle no search results found', async () => {
      const params: WebSearchToolParams = { query: 'no results query' };
      mockInvokeServerTool.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: '' }],
            },
          },
        ],
      });

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toBe(
        'No search results or information found for query: "no results query"',
      );
      expect(result.returnDisplay).toBe('No information found.');
    });

    it('should return a WEB_SEARCH_FAILED error on failure', async () => {
      const params: WebSearchToolParams = { query: 'error query' };
      const testError = new Error('API Failure');
      mockInvokeServerTool.mockRejectedValue(testError);

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('API Failure');
      expect(result.llmContent).toContain('Error during web search');
    });
  });
});
