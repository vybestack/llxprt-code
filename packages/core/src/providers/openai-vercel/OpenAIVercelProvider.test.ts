/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P02
 * @requirement REQ-OAV-001 - Provider Name and Registration
 * @plan PLAN-20251127-OPENAIVERCEL.P07
 * @requirement REQ-OAV-003 - Authentication Support
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import { BaseProvider } from '../BaseProvider.js';
import { IProvider } from '../IProvider.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { createProviderWithRuntime } from '../../test-utils/runtime.js';
import type { ProviderRuntimeContext } from '../../runtime/providerRuntimeContext.js';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';
import { AuthenticationError } from './errors.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';
import { SettingsService } from '../../settings/SettingsService.js';
import { type IProviderConfig } from '../types/IProviderConfig.js';

describe('OpenAIVercelProvider', () => {
  describe('Provider Registration (REQ-OAV-001)', () => {
    it('should exist as a class', () => {
      expect(OpenAIVercelProvider).toBeDefined();
      expect(typeof OpenAIVercelProvider).toBe('function');
    });

    it('should be instantiable with an API key', () => {
      const provider = new OpenAIVercelProvider('test-api-key');
      expect(provider).toBeInstanceOf(OpenAIVercelProvider);
    });

    it('should be instantiable with API key and base URL', () => {
      const provider = new OpenAIVercelProvider(
        'test-api-key',
        'https://api.example.com',
      );
      expect(provider).toBeInstanceOf(OpenAIVercelProvider);
    });

    it('should be instantiable with API key, base URL, and config', () => {
      const provider = new OpenAIVercelProvider(
        'test-api-key',
        'https://api.example.com',
        TEST_PROVIDER_CONFIG,
      );
      expect(provider).toBeInstanceOf(OpenAIVercelProvider);
    });

    it('should extend BaseProvider', () => {
      const provider = new OpenAIVercelProvider('test-api-key');
      expect(provider).toBeInstanceOf(BaseProvider);
    });

    it('should implement IProvider interface', () => {
      const provider = new OpenAIVercelProvider(
        'test-api-key',
      ) as unknown as IProvider;

      // Check required IProvider methods exist
      expect(typeof provider.getModels).toBe('function');
      expect(typeof provider.generateChatCompletion).toBe('function');
      expect(typeof provider.getDefaultModel).toBe('function');
      expect(typeof provider.getServerTools).toBe('function');
      expect(typeof provider.invokeServerTool).toBe('function');
    });

    it('should have name property set to "openaivercel"', () => {
      const provider = new OpenAIVercelProvider('test-api-key');
      expect(provider.name).toBe('openaivercel');
    });
  });

  describe('Default Model (REQ-OAV-004)', () => {
    beforeEach(() => {
      vi.unstubAllEnvs();
    });

    it('should return default model when LLXPRT_DEFAULT_MODEL is not set', () => {
      vi.stubEnv('LLXPRT_DEFAULT_MODEL', '');
      const provider = new OpenAIVercelProvider('test-api-key');
      const defaultModel = provider.getDefaultModel();
      expect(defaultModel).toBe('gpt-4o');
    });

    it('should return LLXPRT_DEFAULT_MODEL when set', () => {
      vi.stubEnv('LLXPRT_DEFAULT_MODEL', 'custom-model');
      const provider = new OpenAIVercelProvider('test-api-key');
      const defaultModel = provider.getDefaultModel();
      expect(defaultModel).toBe('custom-model');
    });
  });

  describe('Server Tools', () => {
    it('should return empty array for getServerTools', () => {
      const provider = new OpenAIVercelProvider('test-api-key');
      const serverTools = provider.getServerTools();
      expect(serverTools).toEqual([]);
    });

    it('should throw error for invokeServerTool', async () => {
      const provider = new OpenAIVercelProvider('test-api-key');
      await expect(provider.invokeServerTool('some-tool', {})).rejects.toThrow(
        "Server tool 'some-tool' not supported",
      );
    });
  });

  describe('Model Listing (REQ-OAV-004)', () => {
    let originalFetch: typeof fetch | undefined;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        // @ts-expect-error test cleanup
        delete global.fetch;
      }
    });

    it('should return an array from getModels', async () => {
      // Avoid accidental live network calls to the default OpenAI base URL in
      // unit tests. If fetch hangs, Vitest will time out and fail this test.
      const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
      vi.stubGlobal('fetch', fetchMock);

      const provider = new OpenAIVercelProvider('test-api-key');
      const models = await provider.getModels();
      expect(Array.isArray(models)).toBe(true);
    });

    describe('remote model fetch', () => {
      it('fetches models from the API when baseURL and auth are available', async () => {
        const settingsService = new SettingsService();
        settingsService.set('activeProvider', 'openaivercel');

        const provider = new OpenAIVercelProvider(
          'live-key',
          'https://api.example.com/v1',
          { settingsService },
        );

        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            data: [
              {
                id: 'custom-model',
                name: 'Custom Model',
                context_window: 4096,
              },
            ],
          }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const models = await provider.getModels();

        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.example.com/v1/models',
          {
            headers: {
              Authorization: 'Bearer live-key',
            },
          },
        );
        expect(models).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'custom-model',
              provider: 'openaivercel',
              contextWindow: 4096,
              supportedToolFormats: ['openai'],
            }),
          ]),
        );
      });

      it('falls back to static list when fetch fails', async () => {
        const settingsService = new SettingsService();
        settingsService.set('activeProvider', 'openaivercel');

        const provider = new OpenAIVercelProvider(
          'live-key',
          'https://api.example.com/v1',
          { settingsService },
        );

        const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
        vi.stubGlobal('fetch', fetchMock);

        const models = await provider.getModels();

        expect(models).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'gpt-4o', provider: 'openaivercel' }),
          ]),
        );
      });
    });
  });

  describe('OAuth Support', () => {
    it('supports Qwen OAuth when forced via config', () => {
      const oauthManager = {
        getToken: vi.fn(async () => null),
        isAuthenticated: vi.fn(async () => false),
      };

      const providerConfig = { forceQwenOAuth: true } as IProviderConfig & {
        forceQwenOAuth: true;
      };
      const provider = new OpenAIVercelProvider(
        undefined,
        'https://api.example.com/v1',
        providerConfig,
        oauthManager,
      );

      const supportsOAuth = (
        provider as unknown as { supportsOAuth: () => boolean }
      ).supportsOAuth();
      expect(supportsOAuth).toBe(true);

      const baseProviderConfig = (
        provider as unknown as {
          baseProviderConfig?: {
            isOAuthEnabled?: boolean;
            oauthProvider?: string;
          };
        }
      ).baseProviderConfig;
      expect(baseProviderConfig?.isOAuthEnabled).toBe(true);
      expect(baseProviderConfig?.oauthProvider).toBe('qwen');
    });

    it('supports Qwen OAuth when the base URL is a Qwen endpoint', () => {
      const oauthManager = {
        getToken: vi.fn(async () => null),
        isAuthenticated: vi.fn(async () => false),
      };

      const provider = new OpenAIVercelProvider(
        undefined,
        'https://portal.qwen.ai/v1',
        undefined,
        oauthManager,
      );

      const supportsOAuth = (
        provider as unknown as { supportsOAuth: () => boolean }
      ).supportsOAuth();
      expect(supportsOAuth).toBe(true);
    });

    it('does not treat schemeless non-Qwen URLs containing Qwen substrings as Qwen endpoints', () => {
      const oauthManager = {
        getToken: vi.fn(async () => null),
        isAuthenticated: vi.fn(async () => false),
      };

      const provider = new OpenAIVercelProvider(
        undefined,
        'evil.com/dashscope.aliyuncs.com',
        undefined,
        oauthManager,
      );

      const supportsOAuth = (
        provider as unknown as { supportsOAuth: () => boolean }
      ).supportsOAuth();
      expect(supportsOAuth).toBe(false);

      const baseProviderConfig = (
        provider as unknown as {
          baseProviderConfig?: {
            isOAuthEnabled?: boolean;
            oauthProvider?: string;
          };
        }
      ).baseProviderConfig;
      expect(baseProviderConfig?.isOAuthEnabled).toBe(false);
      expect(baseProviderConfig?.oauthProvider).toBeUndefined();
    });

    it('does not support OAuth for non-Qwen endpoints by default', () => {
      const provider = new OpenAIVercelProvider(
        'test-api-key',
        'https://api.openai.com/v1',
      );
      const supportsOAuth = (
        provider as unknown as { supportsOAuth: () => boolean }
      ).supportsOAuth();
      expect(supportsOAuth).toBe(false);
    });
  });

  describe('Qwen Chat Role Compatibility', () => {
    let originalFetch: typeof fetch | undefined;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (originalFetch) {
        global.fetch = originalFetch;
      } else {
        // @ts-expect-error test cleanup
        delete global.fetch;
      }
    });

    it('sends system role (not developer) to Qwen chat completions', async () => {
      const settingsService = new SettingsService();
      settingsService.set('activeProvider', 'openaivercel');

      const provider = new OpenAIVercelProvider(
        'test-api-key',
        'https://portal.qwen.ai/v1',
        { settingsService },
      );

      let observedRoles: string[] | undefined;
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url;

          if (!url.includes('/chat/completions')) {
            throw new Error(`Unexpected URL: ${url}`);
          }

          const parsedBody = JSON.parse(String(init?.body ?? '{}')) as {
            messages?: Array<{ role?: string }>;
            model?: string;
          };
          const roles = (parsedBody.messages ?? []).map(
            (msg) => msg.role ?? '',
          );
          observedRoles = roles;

          if (roles.includes('developer')) {
            return new Response(
              JSON.stringify({
                error: {
                  message:
                    "developer is not one of ['system', 'assistant', 'user', 'tool', 'function'] - 'messages.[0].role'",
                },
              }),
              { status: 400, headers: { 'content-type': 'application/json' } },
            );
          }

          return new Response(
            JSON.stringify({
              id: 'chatcmpl-test',
              object: 'chat.completion',
              created: 0,
              model: parsedBody.model ?? 'qwen3-coder-plus',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Hello from Qwen' },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      );

      vi.stubGlobal('fetch', fetchMock);

      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'Hi' }] },
        ],
        settings: settingsService,
        resolved: { streaming: false, model: 'qwen3-coder-plus' },
      });

      const iterator = provider.generateChatCompletion(options);
      const results: unknown[] = [];
      for await (const chunk of iterator) {
        results.push(chunk);
      }

      expect(fetchMock).toHaveBeenCalled();
      expect(observedRoles).toBeDefined();
      expect(observedRoles).not.toContain('developer');
      expect(observedRoles?.[0]).toBe('system');
      expect(results.length).toBeGreaterThan(0);
    });
  });
});

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P07
 * @requirement REQ-OAV-003 - Authentication Support
 */
describe('Authentication (REQ-OAV-003)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let runtime: ProviderRuntimeContext;
  let settingsService: SettingsService;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear environment variables
    delete process.env.OPENAI_API_KEY;

    // Create runtime context with settings service
    const result = createProviderWithRuntime<OpenAIVercelProvider>(
      ({ settingsService: svc }) => {
        svc.set('activeProvider', 'openaivercel');
        return new OpenAIVercelProvider(undefined, undefined, {
          settingsService: svc,
        });
      },
    );

    runtime = result.runtime;
    settingsService = result.settingsService;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    clearActiveProviderRuntimeContext();
  });

  describe('API Key via Constructor', () => {
    it('should accept API key via constructor', async () => {
      const provider = new OpenAIVercelProvider(
        'constructor-api-key',
        undefined,
        {
          settingsService,
        },
      );

      setActiveProviderRuntimeContext(runtime);

      const token = await provider.getAuthToken();
      expect(token).toBe('constructor-api-key');
    });
  });

  describe('API Key from Environment Variable', () => {
    it('should read API key from OPENAI_API_KEY environment variable', async () => {
      process.env.OPENAI_API_KEY = 'env-api-key';

      const provider = new OpenAIVercelProvider(undefined, undefined, {
        settingsService,
      });

      setActiveProviderRuntimeContext(runtime);

      const token = await provider.getAuthToken();
      expect(token).toBe('env-api-key');
    });

    it('should throw when attempting to generate without any API key', async () => {
      const provider = new OpenAIVercelProvider(undefined, undefined, {
        settingsService,
      });

      setActiveProviderRuntimeContext(runtime);

      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ],
        settings: settingsService,
        runtime,
        resolved: { streaming: false },
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(AuthenticationError);
    });
  });

  describe('API Key from Keyfile (Settings)', () => {
    it('should use constructor key over settings', async () => {
      // Even if global settings have a key, constructor key wins
      settingsService.set('activeProvider', 'openaivercel');
      settingsService.set('auth-key', 'global-key');

      const provider = new OpenAIVercelProvider('constructor-key', undefined, {
        settingsService,
      });

      setActiveProviderRuntimeContext(runtime);

      const token = await provider.getAuthToken();
      expect(token).toBe('constructor-key');
    });
  });

  describe('API Key Precedence', () => {
    it('should prefer constructor over keyfile over environment', async () => {
      // Set all three sources
      process.env.OPENAI_API_KEY = 'env-api-key';
      settingsService.set('activeProvider', 'openaivercel');
      settingsService.set('auth-key', 'keyfile-api-key');

      const provider = new OpenAIVercelProvider(
        'constructor-api-key',
        undefined,
        {
          settingsService,
        },
      );

      setActiveProviderRuntimeContext(runtime);

      const token = await provider.getAuthToken();
      expect(token).toBe('constructor-api-key');
    });

    it('should prefer keyfile over environment when no constructor key', async () => {
      process.env.OPENAI_API_KEY = 'env-api-key';
      settingsService.set('activeProvider', 'openaivercel');
      settingsService.setProviderSetting(
        'openaivercel',
        'auth-key',
        'keyfile-api-key',
      );
      settingsService.setProviderSetting(
        'openaivercel',
        'apiKey',
        'keyfile-api-key',
      );
      settingsService.set('auth-key', 'keyfile-api-key');

      const provider = new OpenAIVercelProvider(undefined, undefined, {
        settingsService,
      });

      provider.setRuntimeSettingsService(settingsService);
      setActiveProviderRuntimeContext(runtime);

      const token = await provider.getAuthToken();
      expect(token).toBe('keyfile-api-key'); // Provider keyfile overrides env per precedence (provider, constructor, global, env, OAuth)
    });

    it('should use environment when no constructor key or keyfile', async () => {
      process.env.OPENAI_API_KEY = 'env-api-key';

      const provider = new OpenAIVercelProvider(undefined, undefined, {
        settingsService,
      });

      setActiveProviderRuntimeContext(runtime);

      const token = await provider.getAuthToken();
      expect(token).toBe('env-api-key');
    });
  });

  describe('Base URL Configuration', () => {
    it('should accept custom base URL via constructor config', () => {
      const customBaseURL = 'https://custom-openai.example.com/v1';
      const provider = new OpenAIVercelProvider('test-api-key', customBaseURL, {
        settingsService,
      });

      // Since baseURL is a constructor option, we verify it's accepted
      // The actual usage will be tested in implementation phases
      expect(provider).toBeInstanceOf(OpenAIVercelProvider);
    });

    it('should use default OpenAI base URL when none provided', () => {
      const provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      // Default base URL should be used (verified in implementation)
      expect(provider).toBeInstanceOf(OpenAIVercelProvider);
    });
  });

  describe('Authentication State', () => {
    it('should have hasNonOAuthAuthentication method', async () => {
      const provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      expect(typeof provider.hasNonOAuthAuthentication).toBe('function');
    });

    it('should return true from hasNonOAuthAuthentication when API key is set via constructor', async () => {
      const provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      setActiveProviderRuntimeContext(runtime);

      const isAuthenticated = await provider.hasNonOAuthAuthentication();
      expect(isAuthenticated).toBe(true);
    });

    // Note: Settings-based auth-key is tested in BaseProvider.test.ts
    // The OpenAIVercelProvider inherits this behavior from BaseProvider
    it('should inherit authentication resolution from BaseProvider', async () => {
      const provider = new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService,
      });

      setActiveProviderRuntimeContext(runtime);

      // Verify the provider has access to authentication methods
      expect(typeof provider.hasNonOAuthAuthentication).toBe('function');
      expect(typeof provider.getAuthToken).toBe('function');
    });

    it('should return true from hasNonOAuthAuthentication when API key is in environment', async () => {
      process.env.OPENAI_API_KEY = 'env-api-key';

      const provider = new OpenAIVercelProvider(undefined, undefined, {
        settingsService,
      });

      setActiveProviderRuntimeContext(runtime);

      const isAuthenticated = await provider.hasNonOAuthAuthentication();
      expect(isAuthenticated).toBe(true);
    });

    it('should return false from hasNonOAuthAuthentication when no API key is available', async () => {
      const provider = new OpenAIVercelProvider(undefined, undefined, {
        settingsService,
      });

      setActiveProviderRuntimeContext(runtime);

      const isAuthenticated = await provider.hasNonOAuthAuthentication();
      expect(isAuthenticated).toBe(false);
    });
  });
});
