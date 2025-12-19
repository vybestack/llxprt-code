/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleWebFetchTool } from './google-web-fetch.js';
import { Config } from '../config/config.js';
import { IProvider } from '../providers/IProvider.js';
import { IProviderManager } from '../providers/IProviderManager.js';
import { ContentGeneratorConfig } from '../core/contentGenerator.js';
import * as fetchUtils from '../utils/fetch.js';

describe('GoogleWebFetchTool Integration Tests', () => {
  let webFetchTool: GoogleWebFetchTool;
  let mockConfig: Config;
  let mockAbortSignal: AbortSignal;
  let mockProviderManager: IProviderManager;
  let mockGeminiProvider: IProvider;
  let mockOpenAIProvider: IProvider;
  let mockAnthropicProvider: IProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create mock providers
    mockGeminiProvider = {
      name: 'gemini',
      getModels: vi.fn().mockResolvedValue([]),
      generateChatCompletion: vi.fn(),
      getServerTools: vi.fn().mockReturnValue(['web_fetch', 'web_search']),
      invokeServerTool: vi.fn(),
    } as unknown as IProvider;

    mockOpenAIProvider = {
      name: 'openai',
      getModels: vi.fn().mockResolvedValue([]),
      generateChatCompletion: vi.fn(),
      getServerTools: vi.fn().mockReturnValue([]), // OpenAI doesn't have server tools
      invokeServerTool: vi.fn(),
    } as unknown as IProvider;

    mockAnthropicProvider = {
      name: 'anthropic',
      getModels: vi.fn().mockResolvedValue([]),
      generateChatCompletion: vi.fn(),
      getServerTools: vi.fn().mockReturnValue([]), // Anthropic doesn't have server tools
      invokeServerTool: vi.fn(),
    } as unknown as IProvider;

    // Create mock provider manager
    mockProviderManager = {
      registerProvider: vi.fn(),
      setActiveProvider: vi.fn(),
      clearActiveProvider: vi.fn(),
      hasActiveProvider: vi.fn().mockReturnValue(true),
      getActiveProvider: vi.fn().mockReturnValue(mockGeminiProvider),
      getActiveProviderName: vi.fn().mockReturnValue('gemini'),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      listProviders: vi.fn().mockReturnValue(['gemini', 'openai', 'anthropic']),
      getServerToolsProvider: vi.fn().mockReturnValue(mockGeminiProvider),
      setServerToolsProvider: vi.fn(),
    } as unknown as IProviderManager;

    // Create mock config with provider manager
    mockConfig = {
      getContentGeneratorConfig: vi.fn().mockReturnValue({
        providerManager: mockProviderManager,
      } as ContentGeneratorConfig),
      getGeminiClient: vi.fn().mockReturnValue({
        generateContent: vi.fn(),
      }),
      getApprovalMode: vi.fn().mockReturnValue('auto_edit'),
      setApprovalMode: vi.fn(),
      getProxy: vi.fn().mockReturnValue(null),
    } as unknown as Config;

    webFetchTool = new GoogleWebFetchTool(mockConfig);
    mockAbortSignal = new AbortController().signal;
  });

  describe('Web-fetch with Gemini as active provider', () => {
    it('should successfully fetch content when Gemini is active', async () => {
      // Mock successful web fetch response
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'This is the fetched content from example.com' }],
              role: 'model',
            },
            urlContextMetadata: {
              urlMetadata: [
                {
                  retrievedUrl: 'https://example.com',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
                },
              ],
            },
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    title: 'Example Page',
                    uri: 'https://example.com',
                  },
                },
              ],
            },
          },
        ],
      };

      (
        mockGeminiProvider.invokeServerTool as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResponse);

      const invocation = webFetchTool.build({
        prompt: 'Summarize the content from https://example.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      expect(mockGeminiProvider.invokeServerTool).toHaveBeenCalledWith(
        'web_fetch',
        { prompt: 'Summarize the content from https://example.com' },
        { signal: mockAbortSignal },
      );

      expect(result.llmContent).toContain(
        'This is the fetched content from example.com',
      );
      expect(result.llmContent).toContain('Sources:');
      expect(result.llmContent).toContain(
        '[1] Example Page (https://example.com)',
      );
      expect(result.returnDisplay).toContain(
        'This is the fetched content from example.com',
      );
    });

    it('should handle multiple URLs in prompt', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Summary of both pages' }],
              role: 'model',
            },
            urlContextMetadata: {
              urlMetadata: [
                {
                  retrievedUrl: 'https://example1.com',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
                },
                {
                  retrievedUrl: 'https://example2.com',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
                },
              ],
            },
          },
        ],
      };

      (
        mockGeminiProvider.invokeServerTool as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResponse);

      const invocation = webFetchTool.build({
        prompt: 'Compare https://example1.com and https://example2.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      expect(result.llmContent).toContain('Summary of both pages');
      expect(result.returnDisplay).toContain('Summary of both pages');
    });
  });

  describe('Web-fetch with OpenAI as active provider', () => {
    beforeEach(() => {
      // Set OpenAI as active provider, but Gemini remains server tools provider
      (
        mockProviderManager.getActiveProvider as ReturnType<typeof vi.fn>
      ).mockReturnValue(mockOpenAIProvider);
      (
        mockProviderManager.getActiveProviderName as ReturnType<typeof vi.fn>
      ).mockReturnValue('openai');
      // Server tools provider should still be Gemini
      (
        mockProviderManager.getServerToolsProvider as ReturnType<typeof vi.fn>
      ).mockReturnValue(mockGeminiProvider);
    });

    it('should use Gemini for web-fetch even when OpenAI is active', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Content fetched via Gemini' }],
              role: 'model',
            },
            urlContextMetadata: {
              urlMetadata: [
                {
                  retrievedUrl: 'https://example.com',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
                },
              ],
            },
          },
        ],
      };

      (
        mockGeminiProvider.invokeServerTool as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResponse);

      const invocation = webFetchTool.build({
        prompt: 'Get content from https://example.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      // Should call Gemini's invokeServerTool, not OpenAI's
      expect(mockGeminiProvider.invokeServerTool).toHaveBeenCalled();
      expect(mockOpenAIProvider.invokeServerTool).not.toHaveBeenCalled();

      expect(result.llmContent).toContain('Content fetched via Gemini');
      expect(result.returnDisplay).toContain('Content fetched via Gemini');
    });
  });

  describe('Web-fetch with Anthropic as active provider', () => {
    beforeEach(() => {
      // Set Anthropic as active provider, but Gemini remains server tools provider
      (
        mockProviderManager.getActiveProvider as ReturnType<typeof vi.fn>
      ).mockReturnValue(mockAnthropicProvider);
      (
        mockProviderManager.getActiveProviderName as ReturnType<typeof vi.fn>
      ).mockReturnValue('anthropic');
      // Server tools provider should still be Gemini
      (
        mockProviderManager.getServerToolsProvider as ReturnType<typeof vi.fn>
      ).mockReturnValue(mockGeminiProvider);
    });

    it('should use Gemini for web-fetch even when Anthropic is active', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Anthropic user but Gemini fetched this' }],
              role: 'model',
            },
            urlContextMetadata: {
              urlMetadata: [
                {
                  retrievedUrl: 'https://example.com',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
                },
              ],
            },
          },
        ],
      };

      (
        mockGeminiProvider.invokeServerTool as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResponse);

      const invocation = webFetchTool.build({
        prompt: 'Analyze https://example.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      // Should call Gemini's invokeServerTool, not Anthropic's
      expect(mockGeminiProvider.invokeServerTool).toHaveBeenCalled();
      expect(mockAnthropicProvider.invokeServerTool).not.toHaveBeenCalled();

      expect(result.llmContent).toContain(
        'Anthropic user but Gemini fetched this',
      );
      expect(result.returnDisplay).toContain(
        'Anthropic user but Gemini fetched this',
      );
    });
  });

  describe('Missing Gemini authentication error handling', () => {
    it('should return error when no provider manager is available', async () => {
      // Mock config to return no provider manager
      (
        mockConfig.getContentGeneratorConfig as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        providerManager: null,
      } as unknown as ContentGeneratorConfig);

      const invocation = webFetchTool.build({
        prompt: 'Fetch https://example.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      expect(result.llmContent).toContain(
        'Web fetch requires a provider. Please use --provider gemini with authentication.',
      );
      expect(result.returnDisplay).toBe('Web fetch requires a provider.');
    });

    it('should return error when no server tools provider is configured', async () => {
      // Mock provider manager to return null for server tools provider
      (
        mockProviderManager.getServerToolsProvider as ReturnType<typeof vi.fn>
      ).mockReturnValue(null);

      const invocation = webFetchTool.build({
        prompt: 'Fetch https://example.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      expect(result.llmContent).toContain(
        'Web fetch requires Gemini provider to be configured. Please ensure Gemini is available with authentication.',
      );
      expect(result.returnDisplay).toBe('Web fetch requires Gemini provider.');
    });

    it('should return error when server tools provider does not support web_fetch', async () => {
      // Mock Gemini provider to not support web_fetch
      (
        mockGeminiProvider.getServerTools as ReturnType<typeof vi.fn>
      ).mockReturnValue(['web_search']); // Only web_search, no web_fetch

      const invocation = webFetchTool.build({
        prompt: 'Fetch https://example.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      expect(result.llmContent).toContain(
        'Web fetch is not available. The server tools provider does not support web fetch.',
      );
      expect(result.returnDisplay).toBe('Web fetch not available.');
    });
  });

  describe('Fallback to direct fetch for private IPs', () => {
    it('should fallback to direct fetch for localhost URLs', async () => {
      // Mock isPrivateIp to return true for localhost
      vi.spyOn(fetchUtils, 'isPrivateIp').mockReturnValue(true);
      // Mock fetchWithTimeout
      vi.spyOn(fetchUtils, 'fetchWithTimeout').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi
          .fn()
          .mockResolvedValue('<html><body>Local content</body></html>'),
      } as unknown as Response);

      const invocation = webFetchTool.build({
        prompt: 'Get content from http://localhost:3000',
      });
      const result = await invocation.execute(mockAbortSignal);

      // Should not call Gemini's invokeServerTool
      expect(mockGeminiProvider.invokeServerTool).not.toHaveBeenCalled();

      // Should contain error message about fallback
      expect(result.llmContent).toContain(
        'Private/local URLs cannot be processed with AI',
      );
      expect(result.llmContent).toContain('Content from http://localhost:3000');
      expect(result.llmContent).toContain('Local content');
    });

    it('should fallback to direct fetch for private IP ranges', async () => {
      // Mock isPrivateIp to return true for private IPs
      vi.spyOn(fetchUtils, 'isPrivateIp').mockReturnValue(true);
      // Mock fetchWithTimeout
      vi.spyOn(fetchUtils, 'fetchWithTimeout').mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi
          .fn()
          .mockResolvedValue(
            '<html><body>Private network content</body></html>',
          ),
      } as unknown as Response);

      const invocation = webFetchTool.build({
        prompt: 'Get content from http://192.168.1.100:8080',
      });
      const result = await invocation.execute(mockAbortSignal);

      // Should not call Gemini's invokeServerTool
      expect(mockGeminiProvider.invokeServerTool).not.toHaveBeenCalled();

      // Should contain error message about fallback
      expect(result.llmContent).toContain(
        'Private/local URLs cannot be processed with AI',
      );
      expect(result.llmContent).toContain(
        'Content from http://192.168.1.100:8080',
      );
      expect(result.llmContent).toContain('Private network content');
    });

    it('should handle fallback fetch errors gracefully', async () => {
      // Mock isPrivateIp to return true
      vi.spyOn(fetchUtils, 'isPrivateIp').mockReturnValue(true);
      // Mock fetchWithTimeout to fail
      vi.spyOn(fetchUtils, 'fetchWithTimeout').mockRejectedValue(
        new Error('Network error'),
      );

      const invocation = webFetchTool.build({
        prompt: 'Get content from http://localhost:3000',
      });
      const result = await invocation.execute(mockAbortSignal);

      expect(result.llmContent).toMatch(
        /Error: Error during fallback fetch for http:\/\/localhost:3000\/?: Network error/,
      );
      expect(result.returnDisplay).toMatch(
        /Error: Error during fallback fetch for http:\/\/localhost:3000\/?: Network error/,
      );
    });
  });

  describe('Error handling', () => {
    it('should handle server tool invocation errors', async () => {
      (
        mockGeminiProvider.invokeServerTool as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error('API key not configured'));
      // Mock isPrivateIp to return false so it doesn't fallback
      vi.spyOn(fetchUtils, 'isPrivateIp').mockReturnValue(false);

      const invocation = webFetchTool.build({
        prompt: 'Fetch https://example.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      expect(result.llmContent).toContain('Error during web fetch');
      expect(result.llmContent).toContain('API key not configured');
    });

    it('should handle URL retrieval failures', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: '' }],
              role: 'model',
            },
            urlContextMetadata: {
              urlMetadata: [
                {
                  retrievedUrl: 'https://example.com',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_FAILED',
                },
              ],
            },
          },
        ],
      };

      (
        mockGeminiProvider.invokeServerTool as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResponse);

      // Mock isPrivateIp to return false (not private, so should use server tool)
      vi.spyOn(fetchUtils, 'isPrivateIp').mockReturnValue(false);
      // Mock fetchWithTimeout for fallback
      vi.spyOn(fetchUtils, 'fetchWithTimeout').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response);

      const invocation = webFetchTool.build({
        prompt: 'Fetch https://example.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      // Should return no content found
      expect(result.llmContent).toContain('No content found');
    });
  });

  describe('Validation', () => {
    it('should reject empty prompt', () => {
      expect(() => webFetchTool.build({ prompt: '' })).toThrow(
        'cannot be empty',
      );
    });

    it('should reject prompt without URLs', () => {
      expect(() =>
        webFetchTool.build({ prompt: 'Just some text without any URLs' }),
      ).toThrow('must contain at least one valid URL');
    });

    it('should accept prompt with multiple URLs', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Processed multiple URLs' }],
              role: 'model',
            },
            urlContextMetadata: {
              urlMetadata: [
                {
                  retrievedUrl: 'https://example1.com',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
                },
                {
                  retrievedUrl: 'https://example2.com',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
                },
              ],
            },
          },
        ],
      };

      (
        mockGeminiProvider.invokeServerTool as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResponse);

      const invocation = webFetchTool.build({
        prompt: 'Compare https://example1.com and https://example2.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      expect(result.llmContent).toContain('Processed multiple URLs');
      expect(result.returnDisplay).toContain('Processed multiple URLs');
    });
  });

  describe('GitHub URL handling', () => {
    it('should convert GitHub blob URLs to raw URLs', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'GitHub file content' }],
              role: 'model',
            },
            urlContextMetadata: {
              urlMetadata: [
                {
                  retrievedUrl:
                    'https://raw.githubusercontent.com/user/repo/main/file.js',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
                },
              ],
            },
          },
        ],
      };

      (
        mockGeminiProvider.invokeServerTool as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResponse);

      const invocation = webFetchTool.build({
        prompt:
          'Get content from https://github.com/user/repo/blob/main/file.js',
      });
      const result = await invocation.execute(mockAbortSignal);

      // The tool should still pass the original prompt to the server
      expect(mockGeminiProvider.invokeServerTool).toHaveBeenCalledWith(
        'web_fetch',
        {
          prompt:
            'Get content from https://github.com/user/repo/blob/main/file.js',
        },
        { signal: mockAbortSignal },
      );

      expect(result.llmContent).toContain('GitHub file content');
    });
  });

  describe('Grounding metadata and citations', () => {
    it('should insert citation markers when grounding supports are provided', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'This is cited content from the webpage.' }],
              role: 'model',
            },
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    title: 'Source Page',
                    uri: 'https://example.com/source',
                  },
                },
              ],
              groundingSupports: [
                {
                  segment: {
                    startIndex: 0,
                    endIndex: 12,
                  },
                  groundingChunkIndices: [0],
                },
              ],
            },
            urlContextMetadata: {
              urlMetadata: [
                {
                  retrievedUrl: 'https://example.com/source',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
                },
              ],
            },
          },
        ],
      };

      (
        mockGeminiProvider.invokeServerTool as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResponse);

      const invocation = webFetchTool.build({
        prompt: 'Extract info from https://example.com/source',
      });
      const result = await invocation.execute(mockAbortSignal);

      // Should have citation marker inserted after 'cite' (at index 12)
      expect(result.llmContent).toContain('This is cite[1]d content');
      expect(result.llmContent).toContain('from the webpage.');
      expect(result.llmContent).toContain('Sources:');
      expect(result.llmContent).toContain(
        '[1] Source Page (https://example.com/source)',
      );
    });

    it('should handle response with null parts gracefully', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                null,
                { text: 'Valid content' },
                undefined,
                { text: ' continues' },
              ],
              role: 'model',
            },
            urlContextMetadata: {
              urlMetadata: [
                {
                  retrievedUrl: 'https://example.com',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
                },
              ],
            },
          },
        ],
      };

      (
        mockGeminiProvider.invokeServerTool as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockResponse);

      const invocation = webFetchTool.build({
        prompt: 'Fetch https://example.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      // getResponseText throws on null parts, so we get an error
      expect(result.llmContent).toContain('Error during web fetch');
      expect(result.llmContent).toContain('Cannot read properties of null');
    });
  });

  describe('Multiple providers edge cases', () => {
    it('should handle when provider manager has no server tools provider but active provider exists', async () => {
      // Set active provider to OpenAI, but no server tools provider
      (
        mockProviderManager.getActiveProvider as ReturnType<typeof vi.fn>
      ).mockReturnValue(mockOpenAIProvider);
      (
        mockProviderManager.getServerToolsProvider as ReturnType<typeof vi.fn>
      ).mockReturnValue(null);

      const invocation = webFetchTool.build({
        prompt: 'Fetch https://example.com',
      });
      const result = await invocation.execute(mockAbortSignal);

      expect(result.llmContent).toContain(
        'Web fetch requires Gemini provider to be configured',
      );
      expect(result.returnDisplay).toBe('Web fetch requires Gemini provider.');
    });

    it('should work correctly when switching between providers', async () => {
      // First request with Gemini active
      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Gemini fetched content' }],
              role: 'model',
            },
            urlContextMetadata: {
              urlMetadata: [
                {
                  retrievedUrl: 'https://example.com',
                  urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS',
                },
              ],
            },
          },
        ],
      };

      (
        mockGeminiProvider.invokeServerTool as ReturnType<typeof vi.fn>
      ).mockResolvedValue(geminiResponse);

      const invocation = webFetchTool.build({
        prompt: 'Fetch https://example.com',
      });
      let result = await invocation.execute(mockAbortSignal);

      expect(result.llmContent).toContain('Gemini fetched content');

      // Switch to OpenAI as active provider
      (
        mockProviderManager.getActiveProvider as ReturnType<typeof vi.fn>
      ).mockReturnValue(mockOpenAIProvider);
      (
        mockProviderManager.getActiveProviderName as ReturnType<typeof vi.fn>
      ).mockReturnValue('openai');

      // Second request should still use Gemini for server tools
      const invocation2 = webFetchTool.build({
        prompt: 'Fetch https://example.com again',
      });
      result = await invocation2.execute(mockAbortSignal);

      // Should still call Gemini's invokeServerTool
      expect(mockGeminiProvider.invokeServerTool).toHaveBeenCalledTimes(2);
      expect(mockOpenAIProvider.invokeServerTool).not.toHaveBeenCalled();
    });
  });

  describe('Tool description and getDescription', () => {
    it('should truncate long prompts in description', () => {
      const longPrompt =
        'Fetch and analyze ' +
        'https://example.com/very/long/url/path '.repeat(10);
      const invocation = webFetchTool.build({ prompt: longPrompt });
      const description = invocation.getDescription();

      expect(description).toContain(
        'Processing URLs and instructions from prompt:',
      );
      expect(description).toContain('...');
      expect(description.length).toBeLessThan(150);
    });

    it('should show full prompt for short prompts', () => {
      const shortPrompt = 'Fetch https://example.com';
      const invocation = webFetchTool.build({ prompt: shortPrompt });
      const description = invocation.getDescription();

      expect(description).toBe(
        `Processing URLs and instructions from prompt: "${shortPrompt}"`,
      );
    });
  });
});
