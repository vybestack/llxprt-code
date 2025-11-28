/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExaWebSearchTool } from './exa-web-search.js';
import { Config } from '../config/config.js';
import fetch from 'node-fetch';

// Mock dependencies
vi.mock('../config/config.js');
vi.mock('node-fetch');

describe('ExaWebSearchTool', () => {
  let tool: ExaWebSearchTool;
  let config: Config;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup Config mock
    config = {
      llm: {
        apiKey: 'test-api-key',
        model: 'gemini-pro',
      },
    } as unknown as Config;

    tool = new ExaWebSearchTool(config);
  });

  it('should have correct name and description', () => {
    expect(ExaWebSearchTool.Name).toBe('exa_web_search');
    expect(tool.name).toBe('exa_web_search');
  });

  describe('execute', () => {
    const abortSignal = new AbortController().signal;

    it('should return search results for a successful query', async () => {
      const params = { query: 'successful query' };
      const mockResponse = {
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(
            'data: {"result":{"content":[{"text":"Here are your results."}]}}\n',
          ),
      };
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse,
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toBe('Here are your results.');
      expect(result.returnDisplay).toBe('Here are your results.');
    });

    it('should handle no search results found', async () => {
      const params = { query: 'no results query' };
      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue('data: {}\n'),
      };
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse,
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.llmContent).toBe(
        'No search results found. Please try a different query.',
      );
      expect(result.returnDisplay).toBe('No results found.');
    });

    it('should return a WEB_SEARCH_FAILED error on failure', async () => {
      const params = { query: 'error query' };
      const mockResponse = {
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('API Failure'),
      };
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse,
      );

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('API Failure');
      expect(result.llmContent).toContain('Error performing web search');
    });
  });
});
