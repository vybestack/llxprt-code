/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider - getModels.
 * Split from AnthropicProvider.test.ts for max-lines compliance.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  setupAnthropicProvider,
  type AnthropicTestSetup,
} from './test-utils/anthropicProviderTestSetup.js';

// Shared mock instance for messages.create - using vi.hoisted so it's
// available when vi.mock factories run.
const mockMessagesCreate = vi.hoisted(() => vi.fn());

// Mock the ToolFormatter
vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    toProviderFormat: vi.fn((tools: unknown[], format: string) => {
      if (format === 'anthropic') {
        return tools.map((tool) => {
          const t = tool as {
            function: {
              name: string;
              description?: string;
              parameters: unknown;
            };
          };
          return {
            name: t.function.name,
            description: t.function.description ?? '',
            input_schema: { type: 'object', ...t.function.parameters },
          };
        });
      }
      return tools;
    }),
    fromProviderFormat: vi.fn((rawToolCall: unknown, format: string) => {
      if (format === 'anthropic') {
        const tc = rawToolCall as {
          id: string;
          name: string;
          input?: unknown;
        };
        return [
          {
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: tc.input != null ? JSON.stringify(tc.input) : '',
            },
          },
        ];
      }
      return [rawToolCall];
    }),
    convertToolDeclarationsToAnthropic: vi.fn(() => []),
    convertToolDeclarationsToFormat: vi.fn(() => undefined),
  })),
}));

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
}));

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
    beta: {
      models: {
        list: vi.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            const models = [
              { id: 'claude-opus-4-20250514', display_name: 'Claude 4 Opus' },
              {
                id: 'claude-sonnet-4-20250514',
                display_name: 'Claude 4 Sonnet',
              },
              {
                id: 'claude-3-7-opus-20250115',
                display_name: 'Claude 3.7 Opus',
              },
              {
                id: 'claude-3-7-sonnet-20250115',
                display_name: 'Claude 3.7 Sonnet',
              },
              {
                id: 'claude-3-5-sonnet-20241022',
                display_name: 'Claude 3.5 Sonnet',
              },
              {
                id: 'claude-3-5-haiku-20241022',
                display_name: 'Claude 3.5 Haiku',
              },
              { id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus' },
              {
                id: 'claude-3-sonnet-20240229',
                display_name: 'Claude 3 Sonnet',
              },
              { id: 'claude-3-haiku-20240307', display_name: 'Claude 3 Haiku' },
            ];
            for (const model of models) {
              yield model;
            }
          },
        }),
      },
    },
  })),
}));

describe('AnthropicProvider', () => {
  let provider: AnthropicTestSetup['provider'];

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = setupAnthropicProvider();
    provider = setup.provider;
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });
  describe('getModels', () => {
    it('should return a list of Anthropic models including latest aliases', async () => {
      const models = await provider.getModels();

      expect(models).toHaveLength(11); // 2 latest aliases + 9 specific versions

      // Check for latest aliases
      expect(models.some((m) => m.id === 'claude-opus-4-latest')).toBe(true);
      expect(models.some((m) => m.id === 'claude-sonnet-4-latest')).toBe(true);

      // Check for Claude 4 models
      expect(models.some((m) => m.id === 'claude-opus-4-20250514')).toBe(true);
      expect(models.some((m) => m.id === 'claude-sonnet-4-20250514')).toBe(
        true,
      );

      // Check for Claude 3.7 models
      expect(models.some((m) => m.id === 'claude-3-7-opus-20250115')).toBe(
        true,
      );
      expect(models.some((m) => m.id === 'claude-3-7-sonnet-20250115')).toBe(
        true,
      );

      // Check that all models have correct provider
      models.forEach((model) => {
        expect(model.provider).toBe('anthropic');
        expect(model.supportedToolFormats).toContain('anthropic');
      });
    });

    it('should include Claude Opus 4.5 models in OAuth model list', async () => {
      // Create provider with OAuth token to get the OAuth-specific model list
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      const models = await oauthProvider.getModels();
      const modelIds = models.map((m) => m.id);

      // Verify Claude Opus 4.5 dated model is present
      expect(modelIds).toContain('claude-opus-4-5-20251101');

      // Verify Claude Opus 4.5 rolling alias is present
      expect(modelIds).toContain('claude-opus-4-5');

      // Verify the models have correct properties
      const opus45Dated = models.find(
        (m) => m.id === 'claude-opus-4-5-20251101',
      );
      expect(opus45Dated).toBeDefined();
      expect(opus45Dated?.name).toBe('Claude Opus 4.5');
      expect(opus45Dated?.provider).toBe('anthropic');
      expect(opus45Dated?.supportedToolFormats).toContain('anthropic');
      expect(opus45Dated?.contextWindow).toBe(500000);
      expect(opus45Dated?.maxOutputTokens).toBe(32000);

      const opus45Alias = models.find((m) => m.id === 'claude-opus-4-5');
      expect(opus45Alias).toBeDefined();
      expect(opus45Alias?.name).toBe('Claude Opus 4.5');
      expect(opus45Alias?.provider).toBe('anthropic');
      expect(opus45Alias?.supportedToolFormats).toContain('anthropic');
      expect(opus45Alias?.contextWindow).toBe(500000);
      expect(opus45Alias?.maxOutputTokens).toBe(32000);
    });

    it('should include Claude Opus 4.6 model in OAuth model list', async () => {
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      const models = await oauthProvider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(modelIds).toContain('claude-opus-4-6');

      const opus46 = models.find((m) => m.id === 'claude-opus-4-6');
      expect(opus46).toBeDefined();
      expect(opus46?.name).toBe('Claude Opus 4.6');
      expect(opus46?.contextWindow).toBe(200000);
      expect(opus46?.maxOutputTokens).toBe(32000);
    });

    it('should include Claude Opus 4.8 model in OAuth model list', async () => {
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      const models = await oauthProvider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(modelIds).toContain('claude-opus-4-8');

      const opus48 = models.find((m) => m.id === 'claude-opus-4-8');
      expect(opus48).toBeDefined();
      expect(opus48?.name).toBe('Claude Opus 4.8');
      expect(opus48?.contextWindow).toBe(200000);
      expect(opus48?.maxOutputTokens).toBe(32000);
    });

    it('should include Claude Fable 5 model in OAuth model list @issue:2328', async () => {
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat01-fable-test-token',
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat01-fable-test-token',
      );

      const models = await oauthProvider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(modelIds).toContain('claude-fable-5');

      const fable5 = models.find((m) => m.id === 'claude-fable-5');
      expect(fable5).toBeDefined();
      expect(fable5?.name).toBe('Claude Fable 5');
      expect(fable5?.provider).toBe('anthropic');
      expect(fable5?.supportedToolFormats).toContain('anthropic');
      expect(fable5?.contextWindow).toBe(200000);
      expect(fable5?.maxOutputTokens).toBe(40000);
    });

    it('returns OAUTH_MODELS (incl. Fable 5) for an OAuth-enabled provider without resolving a live token @issue:2328', async () => {
      // Mirrors the real OAuth-only runtime: OAuth is the configured auth and
      // getAuthToken() resolves with includeOAuth: false -> '' (no API key).
      // The static OAuth list must be returned without a live token, otherwise
      // OAuth accounts fall through to DEFAULT_MODELS and Fable is hidden.
      const oauthManager = {
        isOAuthEnabled: (provider: string) => provider === 'anthropic',
      } as unknown as ConstructorParameters<typeof AnthropicProvider>[3];
      const oauthProvider = new AnthropicProvider(
        undefined,
        undefined,
        TEST_PROVIDER_CONFIG,
        oauthManager,
      );

      // No OAuth token resolves at model-list time for OAuth-only accounts.
      const getAuthTokenSpy = vi.spyOn(oauthProvider, 'getAuthToken');
      getAuthTokenSpy.mockResolvedValue('');

      const models = await oauthProvider.getModels();
      const modelIds = models.map((m) => m.id);

      // Fable surfaces without resolving a token.
      expect(modelIds).toContain('claude-fable-5');
      // The curated OAuth list is returned, not DEFAULT_MODELS: the bare alias
      // claude-opus-4-5 exists only in OAUTH_MODELS.
      expect(modelIds).toContain('claude-opus-4-5');
      // No live token was resolved (no unwanted OAuth refresh at list time).
      expect(getAuthTokenSpy).not.toHaveBeenCalled();
    });

    it('should NOT include Claude Fable 5 in default list when auth is unavailable @issue:2328', async () => {
      const noAuthProvider = new AnthropicProvider(
        undefined,
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      vi.spyOn(noAuthProvider, 'getAuthToken').mockResolvedValue(undefined);

      const models = await noAuthProvider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(modelIds).not.toContain('claude-fable-5');
    });

    it('should include Claude Opus 4.6 model in default list when auth is unavailable', async () => {
      const noAuthProvider = new AnthropicProvider(
        undefined,
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      vi.spyOn(noAuthProvider, 'getAuthToken').mockResolvedValue(undefined);

      const models = await noAuthProvider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(modelIds).toContain('claude-opus-4-6');

      const opus46 = models.find((m) => m.id === 'claude-opus-4-6');
      expect(opus46?.contextWindow).toBe(200000);
      expect(opus46?.maxOutputTokens).toBe(32000);
    });

    it('should include Claude Opus 4.8 model in default list when auth is unavailable', async () => {
      const noAuthProvider = new AnthropicProvider(
        undefined,
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      vi.spyOn(noAuthProvider, 'getAuthToken').mockResolvedValue(undefined);

      const models = await noAuthProvider.getModels();
      const modelIds = models.map((m) => m.id);

      expect(modelIds).toContain('claude-opus-4-8');

      const opus48 = models.find((m) => m.id === 'claude-opus-4-8');
      expect(opus48).toBeDefined();
      expect(opus48?.name).toBe('Claude Opus 4.8');
      expect(opus48?.contextWindow).toBe(200000);
      expect(opus48?.maxOutputTokens).toBe(32000);
    });

    it('should return models with correct structure', async () => {
      const models = await provider.getModels();

      models.forEach((model) => {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('provider');
        expect(model).toHaveProperty('supportedToolFormats');
        expect(model.provider).toBe('anthropic');
        expect(model.supportedToolFormats).toContain('anthropic');
      });
    });
  });
});
