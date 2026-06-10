/**
 * Tests for issue #276: AnthropicProvider OAuth token behavior through public APIs
 *
 * Verifies that AnthropicProvider behaves correctly with OAuth tokens vs API keys
 * through public APIs only (getModels, generateChatCompletion).
 * OAuth tokens (sk-ant-oat*) trigger: hardcoded model list, tool name prefixing,
 * OAuth beta headers, SDK authToken construction. API keys trigger: API-fetched
 * models, no tool prefixing, no OAuth headers, SDK apiKey construction.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import {
  createProviderWithRuntime,
  createRuntimeConfigStub,
} from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { OAUTH_MODELS } from './AnthropicModelData.js';

vi.mock('@vybestack/llxprt-code-core/tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    toProviderFormat: vi.fn((tools: unknown[]) => tools),
    fromProviderFormat: vi.fn((rawToolCall: unknown) => [rawToolCall]),
    convertGeminiToAnthropic: vi.fn(() => []),
    convertGeminiToFormat: vi.fn(() => undefined),
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

/**
 * Track Anthropic SDK constructor calls so we can assert on authToken vs apiKey
 * without touching protected methods or using type assertions.
 */
const sdkConstructorCalls: Array<Record<string, unknown>> = [];

const mockBetaModelsList = vi.fn();

const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    sdkConstructorCalls.push({ ...opts });
    return {
      _options: opts,
      messages: {
        create: mockMessagesCreate,
      },
      beta: {
        models: {
          list: mockBetaModelsList,
        },
      },
    };
  }),
}));

/** Create a non-streaming response from Anthropic SDK */
function nonStreamingResponse(text = 'response') {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  const entries = Object.entries(value);
  if (entries.every(([, entryValue]) => typeof entryValue === 'string')) {
    return Object.fromEntries(entries);
  }

  return undefined;
}

function lastSdkConstructorOptions(): {
  authToken?: string;
  apiKey?: string;
  defaultHeaders?: Record<string, string>;
  dangerouslyAllowBrowser?: boolean;
} {
  const last = sdkConstructorCalls[sdkConstructorCalls.length - 1];
  return {
    authToken: typeof last.authToken === 'string' ? last.authToken : undefined,
    apiKey: typeof last.apiKey === 'string' ? last.apiKey : undefined,
    defaultHeaders: toStringRecord(last.defaultHeaders),
    dangerouslyAllowBrowser:
      typeof last.dangerouslyAllowBrowser === 'boolean'
        ? last.dangerouslyAllowBrowser
        : undefined,
  };
}

function resetSdkTracking() {
  sdkConstructorCalls.length = 0;
}

describe('Issue #276: OAuth token behavior through public APIs', () => {
  let runtimeContext: ProviderRuntimeContext;
  let settingsService: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSdkTracking();
    mockBetaModelsList.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          id: 'claude-sonnet-4-5-20250929',
          display_name: 'Claude Sonnet 4.5',
        };
      },
    });

    const result = createProviderWithRuntime<AnthropicProvider>(
      ({ settingsService: svc }) => {
        svc.set('auth-key', 'test-api-key');
        svc.set('activeProvider', 'anthropic');
        svc.setProviderSetting('anthropic', 'streaming', 'disabled');
        return new AnthropicProvider(
          'test-api-key',
          undefined,
          TEST_PROVIDER_CONFIG,
        );
      },
      {
        runtimeId: 'anthropic.issue276.test',
        metadata: { source: 'AnthropicProvider.issue276.test.ts' },
      },
    );

    runtimeContext = result.runtime;
    settingsService = result.settingsService;
    runtimeContext.config ??= createRuntimeConfigStub(settingsService);
    runtimeContext.config.getEphemeralSettings = () => ({
      ...settingsService.getAllGlobalSettings(),
      ...settingsService.getProviderSettings('anthropic'),
    });

    setActiveProviderRuntimeContext(runtimeContext);
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  const buildCallOptions = (
    contents: IContent[],
    overrides: Omit<ProviderCallOptionsInit, 'providerName' | 'contents'> = {},
  ) =>
    createProviderCallOptions({
      providerName: 'anthropic',
      contents,
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ...overrides,
    });

  describe('getModels: OAuth token returns hardcoded model list', () => {
    it('returns the OAUTH_MODELS list when authenticated with an OAuth token', async () => {
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      const models = await oauthProvider.getModels();

      const oauthModelIds = OAUTH_MODELS.map((m) => m.id);
      const returnedModelIds = models.map((m) => m.id);
      expect(returnedModelIds).toStrictEqual(oauthModelIds);
      models.forEach((model) => {
        expect(model.provider).toBe('anthropic');
      });
    });

    it('does not call client.beta.models.list when using an OAuth token', async () => {
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      await oauthProvider.getModels();

      expect(mockBetaModelsList).not.toHaveBeenCalled();
    });

    it('fetches models from the API when authenticated with a regular API key', async () => {
      const apiProvider = new AnthropicProvider(
        'test-api-key',
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      const models = await apiProvider.getModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.id === 'claude-sonnet-4-5-20250929')).toBe(
        true,
      );
      const oauthModelIds = OAUTH_MODELS.map((m) => m.id);
      const returnedModelIds = models.map((m) => m.id);

      expect(returnedModelIds).not.toStrictEqual(oauthModelIds);
    });

    it('calls client.beta.models.list when using a regular API key', async () => {
      const apiProvider = new AnthropicProvider(
        'test-api-key',
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      await apiProvider.getModels();

      expect(mockBetaModelsList).toHaveBeenCalled();
    });

    it('returns default models with empty-string auth token when no auth is available', async () => {
      const noAuthProvider = new AnthropicProvider(
        '',
        undefined,
        TEST_PROVIDER_CONFIG,
      );

      const models = await noAuthProvider.getModels();
      expect(models.length).toBeGreaterThan(0);
      models.forEach((model) => {
        expect(model.provider).toBe('anthropic');
      });
    });
  });

  describe('generateChatCompletion: SDK construction uses correct auth mode', () => {
    it('constructs SDK with authToken and no apiKey for OAuth tokens, plus OAuth beta defaultHeaders', async () => {
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            streaming: 'disabled',
          }),
        },
      );

      const callOptions = buildCallOptions(
        [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Test OAuth' }],
          },
        ],
        {
          resolved: {
            authToken: 'sk-ant-oat-test-token',
            model: 'claude-sonnet-4-5-20250929',
          },
        },
      );

      mockMessagesCreate.mockResolvedValueOnce(nonStreamingResponse());

      const generator = oauthProvider.generateChatCompletion(callOptions);
      await generator.next();

      const sdkOpts = lastSdkConstructorOptions();
      expect(sdkOpts.authToken).toBe('sk-ant-oat-test-token');
      expect(sdkOpts.apiKey).toBeUndefined();

      expect(sdkOpts.defaultHeaders).toBeDefined();
      const betaHeader = sdkOpts.defaultHeaders?.['anthropic-beta'];
      expect(typeof betaHeader === 'string').toBe(true);
      expect(betaHeader).toContain('oauth-2025-04-20');
    });

    it('constructs SDK with apiKey and no authToken for regular API keys, without OAuth beta headers', async () => {
      const apiProvider = new AnthropicProvider('test-api-key', undefined, {
        ...TEST_PROVIDER_CONFIG,
        getEphemeralSettings: () => ({
          streaming: 'disabled',
        }),
      });

      const callOptions = buildCallOptions(
        [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Test API key' }],
          },
        ],
        {
          resolved: {
            authToken: 'test-api-key',
            model: 'claude-sonnet-4-5-20250929',
          },
        },
      );

      mockMessagesCreate.mockResolvedValueOnce(nonStreamingResponse());

      const generator = apiProvider.generateChatCompletion(callOptions);
      await generator.next();

      const sdkOpts = lastSdkConstructorOptions();
      expect(sdkOpts.apiKey).toBe('test-api-key');
      expect(sdkOpts.authToken).toBeUndefined();

      const betaHeader = sdkOpts.defaultHeaders?.['anthropic-beta'];
      expect(
        typeof betaHeader === 'string' &&
          betaHeader.includes('oauth-2025-04-20'),
      ).toBe(false);
    });
  });

  describe('generateChatCompletion: OAuth token prefixes tool names', () => {
    it('sends tool names prefixed with llxprt_ when using an OAuth token', async () => {
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            streaming: 'disabled',
          }),
        },
      );

      const callOptions = buildCallOptions(
        [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Test' }],
          },
        ],
        {
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'read_file',
                  description: 'Read a file',
                  parametersJsonSchema: { type: 'object', properties: {} },
                },
              ],
            },
          ],
          resolved: {
            authToken: 'sk-ant-oat-test-token',
            model: 'claude-sonnet-4-5-20250929',
          },
        },
      );

      mockMessagesCreate.mockResolvedValueOnce(nonStreamingResponse());

      const generator = oauthProvider.generateChatCompletion(callOptions);
      await generator.next();

      const call = mockMessagesCreate.mock.calls[0];
      expect(call).toBeDefined();
      const requestBody = call[0];
      expect(requestBody.tools).toBeDefined();
      expect(requestBody.tools[0].name).toBe('llxprt_read_file');
    });

    it('sends tool names without prefix when using a regular API key', async () => {
      const apiProvider = new AnthropicProvider('test-api-key', undefined, {
        ...TEST_PROVIDER_CONFIG,
        getEphemeralSettings: () => ({
          streaming: 'disabled',
        }),
      });

      const callOptions = buildCallOptions(
        [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Test' }],
          },
        ],
        {
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'read_file',
                  description: 'Read a file',
                  parametersJsonSchema: { type: 'object', properties: {} },
                },
              ],
            },
          ],
          resolved: {
            authToken: 'test-api-key',
            model: 'claude-sonnet-4-5-20250929',
          },
        },
      );

      mockMessagesCreate.mockResolvedValueOnce(nonStreamingResponse());

      const generator = apiProvider.generateChatCompletion(callOptions);
      await generator.next();

      const call =
        mockMessagesCreate.mock.calls[mockMessagesCreate.mock.calls.length - 1];
      expect(call).toBeDefined();
      const requestBody = call[0];
      expect(requestBody.tools).toBeDefined();
      expect(requestBody.tools[0].name).toBe('read_file');
    });
  });

  describe('generateChatCompletion: OAuth token sets beta header in API call', () => {
    it('includes oauth-2025-04-20 in anthropic-beta header for OAuth requests', async () => {
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            streaming: 'disabled',
          }),
        },
      );

      const callOptions = buildCallOptions(
        [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Test' }],
          },
        ],
        {
          resolved: {
            authToken: 'sk-ant-oat-test-token',
            model: 'claude-sonnet-4-5-20250929',
          },
        },
      );

      mockMessagesCreate.mockResolvedValueOnce(nonStreamingResponse());

      const generator = oauthProvider.generateChatCompletion(callOptions);
      await generator.next();

      const call = mockMessagesCreate.mock.calls[0];
      const options = call[1];
      expect(options?.headers).toBeDefined();
      const headers = options.headers;
      const betaHeader = headers['anthropic-beta'];
      expect(
        typeof betaHeader === 'string' &&
          betaHeader.includes('oauth-2025-04-20'),
      ).toBe(true);
    });

    it('does not include oauth-2025-04-20 in anthropic-beta header for API key requests', async () => {
      const apiProvider = new AnthropicProvider('test-api-key', undefined, {
        ...TEST_PROVIDER_CONFIG,
        getEphemeralSettings: () => ({
          streaming: 'disabled',
        }),
      });

      settingsService.setProviderSetting('anthropic', 'prompt-caching', 'off');

      const callOptions = buildCallOptions(
        [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Test' }],
          },
        ],
        {
          resolved: {
            authToken: 'test-api-key',
            model: 'claude-sonnet-4-5-20250929',
          },
        },
      );

      mockMessagesCreate.mockResolvedValueOnce(nonStreamingResponse());

      const generator = apiProvider.generateChatCompletion(callOptions);
      await generator.next();

      const call =
        mockMessagesCreate.mock.calls[mockMessagesCreate.mock.calls.length - 1];
      const allOptions = call[1];
      const headers = allOptions?.headers;
      const betaHeader = headers?.['anthropic-beta'];
      const betaIncludesOAuth =
        typeof betaHeader === 'string' &&
        betaHeader.includes('oauth-2025-04-20');
      expect(betaIncludesOAuth).toBe(false);
    });
  });
});
