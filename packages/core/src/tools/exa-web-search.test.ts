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

  /**
   * Integration tests for tool key URL parameter injection.
   * Uses vi.doMock on tool-key-storage to control resolveKey() return values.
   * Behavioral assertions are on the fetch URL (with or without ?exaApiKey=).
   *
   * @plan PLAN-20260206-TOOLKEY.P10
   */
  describe('API key integration', () => {
    const abortSignal = new AbortController().signal;
    let resolveKeyMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.clearAllMocks();

      // Mock tool-key-storage module to control resolveKey() return values.
      // This follows the same pattern as the existing node-fetch mock in this file.
      // This is NOT mock theater — the behavioral output under test is the fetch URL.
      resolveKeyMock = vi.fn().mockResolvedValue(null);
      const mockInstance = { resolveKey: resolveKeyMock };
      vi.doMock('./tool-key-storage.js', () => ({
        ToolKeyStorage: vi.fn().mockImplementation(() => mockInstance),
        getToolKeyStorage: vi.fn().mockReturnValue(mockInstance),
      }));

      // Re-import to pick up the mock
      const mod = await import('./exa-web-search.js');
      const ExaWebSearchToolFresh = mod.ExaWebSearchTool;

      config = {
        llm: {
          apiKey: 'test-api-key',
          model: 'gemini-pro',
        },
      } as unknown as Config;

      tool = new ExaWebSearchToolFresh(config);
    });

    /** @plan PLAN-20260206-TOOLKEY.P10 @requirement REQ-004.1 */
    it('should append exaApiKey query parameter when key is available', async () => {
      resolveKeyMock.mockResolvedValue('sk-test-key');

      const mockResponse = {
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(
            'data: {"result":{"content":[{"text":"Results"}]}}\n',
          ),
      };
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse,
      );

      const invocation = tool.build({ query: 'test query' });
      await invocation.execute(abortSignal);

      const fetchCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(fetchCall[0]).toBe('https://mcp.exa.ai/mcp?exaApiKey=sk-test-key');
    });

    /** @plan PLAN-20260206-TOOLKEY.P10 @requirement REQ-004.3 */
    it('should use base URL without query parameter when no key configured', async () => {
      resolveKeyMock.mockResolvedValue(null);

      const mockResponse = {
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(
            'data: {"result":{"content":[{"text":"Results"}]}}\n',
          ),
      };
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse,
      );

      const invocation = tool.build({ query: 'test query' });
      await invocation.execute(abortSignal);

      const fetchCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(fetchCall[0]).toBe('https://mcp.exa.ai/mcp');
    });

    /** @plan PLAN-20260206-TOOLKEY.P10 @requirement REQ-004.4 */
    it('should resolve key fresh on each invocation', async () => {
      // First invocation: no key
      resolveKeyMock.mockResolvedValue(null);

      const mockResponse = {
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(
            'data: {"result":{"content":[{"text":"Results"}]}}\n',
          ),
      };
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse,
      );

      const invocation1 = tool.build({ query: 'first query' });
      await invocation1.execute(abortSignal);

      const firstFetchUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(firstFetchUrl).toBe('https://mcp.exa.ai/mcp');

      // Second invocation: key now available
      resolveKeyMock.mockResolvedValue('new-key');
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse,
      );

      const invocation2 = tool.build({ query: 'second query' });
      await invocation2.execute(abortSignal);

      const secondFetchUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock
        .calls[1][0];
      expect(secondFetchUrl).toBe('https://mcp.exa.ai/mcp?exaApiKey=new-key');
    });

    /** @plan PLAN-20260206-TOOLKEY.P10 @requirement REQ-004.1 */
    it('should URL-encode the API key in query parameter', async () => {
      resolveKeyMock.mockResolvedValue('key+with/special=chars');

      const mockResponse = {
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(
            'data: {"result":{"content":[{"text":"Results"}]}}\n',
          ),
      };
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockResponse,
      );

      const invocation = tool.build({ query: 'test query' });
      await invocation.execute(abortSignal);

      const fetchCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const expectedKey = encodeURIComponent('key+with/special=chars');
      expect(fetchCall[0]).toBe(
        `https://mcp.exa.ai/mcp?exaApiKey=${expectedKey}`,
      );
    });
  });
});
