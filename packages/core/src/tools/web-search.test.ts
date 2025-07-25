/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSearchTool } from './web-search.js';
import { Config } from '../config/config.js';
import { GeminiClient } from '../core/client.js';

describe('WebSearchTool', () => {
  let webSearchTool: WebSearchTool;
  let mockConfig: Config;
  let mockGeminiClient: GeminiClient;
  let mockGenerateContent: ReturnType<typeof vi.fn>;
  let mockAbortSignal: AbortSignal;

  beforeEach(() => {
    mockGenerateContent = vi.fn();
    mockGeminiClient = {
      generateContent: mockGenerateContent,
      isInitialized: vi.fn(() => true), // Mock as initialized
    } as unknown as GeminiClient;

    const mockServerToolsProvider = {
      getServerTools: vi.fn(() => ['web_search']),
      invokeServerTool: mockGenerateContent,
    };

    mockConfig = {
      getGeminiClient: vi.fn(() => mockGeminiClient),
      getProvider: vi.fn(() => 'gemini'), // Default to gemini provider
      getContentGeneratorConfig: vi.fn(() => ({
        model: 'test-model',
        providerManager: {
          getServerToolsProvider: vi.fn(() => mockServerToolsProvider),
        },
      })),
    } as unknown as Config;

    webSearchTool = new WebSearchTool(mockConfig);
    mockAbortSignal = new AbortController().signal;
  });

  describe('execute', () => {
    it('should perform a web search and return results', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Search results about testing' }],
              role: 'model',
            },
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    title: 'Test Result 1',
                    uri: 'https://example.com/test1',
                  },
                },
                {
                  web: {
                    title: 'Test Result 2',
                    uri: 'https://example.com/test2',
                  },
                },
              ],
              groundingSupports: [
                {
                  segment: {
                    startIndex: 0,
                    endIndex: 14,
                  },
                  groundingChunkIndices: [0, 1],
                  confidenceScores: [0.9, 0.8],
                },
              ],
            },
          },
        ],
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await webSearchTool.execute(
        { query: 'test query' },
        mockAbortSignal,
      );

      expect(mockGenerateContent).toHaveBeenCalledWith(
        'web_search',
        { query: 'test query' },
        { signal: mockAbortSignal },
      );

      expect(result.llmContent).toContain(
        'Web search results for "test query"',
      );
      expect(result.llmContent).toContain('Search results'); // The citation markers are inserted
      expect(result.llmContent).toContain('about testing');
      expect(result.llmContent).toContain('Sources:');
      expect(result.llmContent).toContain('[1] Test Result 1');
      expect(result.llmContent).toContain('[2] Test Result 2');
      expect(result.sources).toHaveLength(2);
    });

    it('should handle empty search results', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: '' }],
              role: 'model',
            },
          },
        ],
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await webSearchTool.execute(
        { query: 'empty query' },
        mockAbortSignal,
      );

      expect(result.llmContent).toContain(
        'No search results or information found',
      );
      expect(result.returnDisplay).toBe('No information found.');
    });

    it('should handle errors during search', async () => {
      const mockError = new Error('API Error: Function call/response mismatch');
      mockGenerateContent.mockRejectedValue(mockError);

      const result = await webSearchTool.execute(
        { query: 'error query' },
        mockAbortSignal,
      );

      expect(result.llmContent).toContain('Error:');
      expect(result.llmContent).toContain(
        'API Error: Function call/response mismatch',
      );
      expect(result.returnDisplay).toBe('Error performing web search.');
    });

    it('should handle validation errors', () => {
      // Test validateParams directly since execute method has try-catch
      const error = webSearchTool.validateParams({ query: '' });
      expect(error).toBe("The 'query' parameter cannot be empty.");

      // Test whitespace-only query
      const whitespaceError = webSearchTool.validateParams({ query: '   ' });
      expect(whitespaceError).toBe("The 'query' parameter cannot be empty.");
    });

    it('should handle grounding supports without citations', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Search results without citations' }],
              role: 'model',
            },
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    title: 'Result',
                    uri: 'https://example.com',
                  },
                },
              ],
              // No groundingSupports
            },
          },
        ],
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await webSearchTool.execute(
        { query: 'no citations' },
        mockAbortSignal,
      );

      expect(result.llmContent).toContain('Search results without citations');
      expect(result.llmContent).toContain('Sources:');
      expect(result.llmContent).toContain('[1] Result');
      // Should not contain inline citations
      expect(result.llmContent).not.toMatch(/\[\d+\]Search/);
    });

    it('should use googleSearch tool in the correct format', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Test results' }],
              role: 'model',
            },
          },
        ],
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      await webSearchTool.execute(
        { query: 'test google search' },
        mockAbortSignal,
      );

      // Verify the web_search tool is passed correctly
      expect(mockGenerateContent).toHaveBeenCalledWith(
        'web_search',
        { query: 'test google search' },
        { signal: mockAbortSignal },
      );
    });

    it('should handle API errors related to function call/response mismatch', async () => {
      const mockError = new Error(
        'Please ensure that the number of function response parts is equal to the number of function call parts of the function call turn.',
      );
      mockGenerateContent.mockRejectedValue(mockError);

      const result = await webSearchTool.execute(
        { query: 'function mismatch test' },
        mockAbortSignal,
      );

      expect(result.llmContent).toContain('Error:');
      expect(result.llmContent).toContain('function response parts');
      expect(result.returnDisplay).toBe('Error performing web search.');
    });
  });

  describe('validateParams', () => {
    it('should accept valid query', () => {
      const error = webSearchTool.validateParams({ query: 'valid query' });
      expect(error).toBeNull();
    });

    it('should reject empty query', () => {
      const error = webSearchTool.validateParams({ query: '' });
      expect(error).toBe("The 'query' parameter cannot be empty.");
    });

    it('should reject whitespace-only query', () => {
      const error = webSearchTool.validateParams({ query: '   ' });
      expect(error).toBe("The 'query' parameter cannot be empty.");
    });
  });

  describe('getDescription', () => {
    it('should return description with query', () => {
      const description = webSearchTool.getDescription({
        query: 'test search',
      });
      expect(description).toBe('Searching the web for: "test search"');
    });
  });

  describe('authentication', () => {
    it('should handle when Gemini client is not initialized', async () => {
      // Mock isInitialized to return false
      (
        mockGeminiClient.isInitialized as ReturnType<typeof vi.fn>
      ).mockReturnValue(false);

      // Mock getContentGeneratorConfig to return undefined (no auth)
      mockConfig.getContentGeneratorConfig = vi.fn(() => undefined);
      mockConfig.refreshAuth = vi.fn();

      const result = await webSearchTool.execute(
        { query: 'test query' },
        mockAbortSignal,
      );

      expect(result.llmContent).toContain('Web search requires a provider');
      expect(result.returnDisplay).toBe('Web search requires a provider.');
    });

    it('should handle when server tools provider is not available', async () => {
      // Mock getServerToolsProvider to return null
      mockConfig.getContentGeneratorConfig = vi.fn(() => ({
        model: 'test-model',
        providerManager: {
          registerProvider: vi.fn(),
          setActiveProvider: vi.fn(),
          clearActiveProvider: vi.fn(),
          hasActiveProvider: vi.fn(() => false),
          getActiveProvider: vi.fn(),
          getActiveProviderName: vi.fn(() => ''),
          getAvailableModels: vi.fn(async () => []),
          listProviders: vi.fn(() => []),
          getServerToolsProvider: vi.fn(() => null),
          setServerToolsProvider: vi.fn(),
        },
      }));

      const result = await webSearchTool.execute(
        { query: 'test query' },
        mockAbortSignal,
      );

      expect(result.llmContent).toContain(
        'Web search requires Gemini provider',
      );
      expect(result.returnDisplay).toBe('Web search requires Gemini provider.');
    });
  });
});
