import { Config as RealConfig } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService as RealSettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
let initializeClient = async (): Promise<void> => {};

import { OAuthManager } from '../auth/oauth-manager.js';
import {
  MemoryTokenStore,
  createTestProvider,
} from '../auth/__tests__/behavioral/test-utils.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const realProviderAliasesModule = {
  ...(await import('../composition/providerAliases.js')),
};
const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

const { aliasEntries } = {
  aliasEntries: [] as Array<Record<string, unknown>>,
};

const {
  StubSettingsService: StubSettingsServiceClass,
  StubConfig: StubConfigClass,
  StubProvider: StubProviderClass,
} = (() => {
  const StubSettingsService = RealSettingsService;

  const StubConfig = RealConfig;

  class StubProvider {
    name: string;
    defaultModel = 'gpt-4o';
    providerConfig: { baseUrl?: string } = {};

    constructor(name: string) {
      this.name = name;
    }

    getDefaultModel(): string {
      return this.defaultModel;
    }
  }

  return { StubSettingsService, StubConfig, StubProvider };
})();

type StubSettingsServiceInstance = InstanceType<
  typeof StubSettingsServiceClass
>;
type StubConfigInstance = InstanceType<typeof StubConfigClass>;
type StubProviderInstance = InstanceType<typeof StubProviderClass>;

const StubSettingsService = StubSettingsServiceClass;
const StubConfig = StubConfigClass;
const StubProvider = StubProviderClass;

const providers: Record<string, StubProviderInstance> = {
  openai: new StubProvider('openai'),
  qwenvercel: new StubProvider('qwenvercel'),
  gemini: new StubProvider('gemini'),
  claudecode: new StubProvider('claudecode'),
  openrouter: new StubProvider('openrouter'),
  codex: new StubProvider('codex'),
};

let activeProviderName = 'openai';

const mockProviderManager = {
  listProviders: vi.fn(() => Object.keys(providers)),
  getActiveProviderName: vi.fn(() => activeProviderName),
  getActiveProvider: vi.fn(() => providers[activeProviderName]),
  setActiveProvider: vi.fn(async (name: string) => {
    activeProviderName = name;
  }),
  getProviderByName: (name: string) => providers[name],
  getAvailableModels: vi.fn(async () => [{ id: 'model-a' }, { id: 'model-b' }]),
  setConfig: vi.fn(),
  prepareStatelessProviderInvocation: vi.fn(),
};

let stubSettingsService: StubSettingsServiceInstance;
let stubConfig: StubConfigInstance;

void vi.mock('../composition/providerAliases.js', () => {
  const actual = realProviderAliasesModule;
  return {
    ...actual,
    loadProviderAliasEntries: () => aliasEntries,
  };
});

void vi.mock('@vybestack/llxprt-code-core', () => {
  const actual = realLlxprtCodeCoreModule;

  return {
    ...actual,
    SettingsService: StubSettingsServiceClass,
    Config: StubConfigClass,
    createProviderRuntimeContext: (context: {
      settingsService: StubSettingsServiceInstance;
      config?: StubConfigInstance;
      runtimeId?: string;
      metadata?: Record<string, unknown>;
    }) => context,
  };
});

const { switchActiveProvider } = await import('./index.js');

const mockOAuthManager = new OAuthManager(new MemoryTokenStore());
mockOAuthManager.registerProvider(createTestProvider('claudecode'));
const oauthEnabled = vi
  .spyOn(mockOAuthManager, 'isOAuthEnabled')
  .mockReturnValue(false);

function stubSwitchInputs(): [
  Parameters<typeof switchActiveProvider>[2],
  Parameters<typeof switchActiveProvider>[3],
  Parameters<typeof switchActiveProvider>[4],
  Parameters<typeof switchActiveProvider>[5],
  undefined,
  () => Promise<void>,
  Parameters<typeof switchActiveProvider>[8],
] {
  return [
    stubConfig,
    stubSettingsService,
    mockProviderManager as never,
    mockOAuthManager as never,
    undefined,
    initializeClient,
    settingsOwner,
  ];
}

const debugLoggerWarnSpy = vi
  .spyOn(DebugLogger.prototype, 'warn')
  .mockImplementation(() => {});

/**
 * Helper to push the Claude Code alias entry with modelDefaults (config-driven).
 * This mirrors the structure of the real claudecode.config file.
 */
function pushClaudeCodeAlias(overrides?: {
  defaultModel?: string;
  ephemeralSettings?: Record<string, unknown>;
  modelDefaults?: Array<{
    pattern: string;
    ephemeralSettings: Record<string, unknown>;
  }>;
}): void {
  aliasEntries.push({
    alias: 'claudecode',
    source: 'builtin',
    filePath: '/fake/claudecode.config',
    config: {
      baseProvider: 'anthropic',
      defaultModel: overrides?.defaultModel ?? 'claude-opus-4-6',
      ephemeralSettings: overrides?.ephemeralSettings ?? {
        maxOutputTokens: 40000,
      },
      modelDefaults: overrides?.modelDefaults ?? [
        {
          pattern: 'claude-(opus|sonnet|haiku)',
          ephemeralSettings: {
            'reasoning.enabled': true,
            'reasoning.adaptiveThinking': true,
            'reasoning.includeInContext': true,
          },
        },
        {
          pattern: 'claude-opus-4-6',
          ephemeralSettings: {
            'reasoning.effort': 'high',
          },
        },
      ],
    },
  });
}

describe('Provider alias defaults (model + ephemerals)', () => {
  afterEach(async () => {
    const retiring = retainedRoots.splice(0);
    await Promise.all(
      retiring.map(async (root) => {
        await root.settingsOwner.dispose();
        await root.config.dispose();
      }),
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    initializeClient = async () => {};

    stubSettingsService = new StubSettingsService();
    stubConfig = new StubConfig({
      sessionId: 'alias-defaults-fixture',
      model: '',
      provider: 'openai',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
    });
    settingsOwner = new SessionSettingsOwner(stubSettingsService);
    settingsOwner.initializeProviderSelection('openai', '');
    retainedRoots.push({ config: stubConfig, settingsOwner });
    activeProviderName = 'openai';

    aliasEntries.length = 0;
    aliasEntries.push({
      alias: 'qwenvercel',
      source: 'builtin',
      filePath: '/fake/qwenvercel.config',
      config: {
        baseProvider: 'openaivercel',
        baseUrl: 'https://portal.qwen.ai/v1',
        defaultModel: 'qwen3-coder-plus',
        ephemeralSettings: {
          'context-limit': 200000,
          max_tokens: 50000,
        },
      },
    });

    providers.qwenvercel.defaultModel = 'gpt-4o';
    providers.qwenvercel.providerConfig.baseUrl = 'https://portal.qwen.ai/v1';

    providers.claudecode.defaultModel = 'claude-opus-4-6';
    providers.openrouter.defaultModel = 'gpt-4o';
    providers.codex.defaultModel = 'gpt-5.6-sol';
  });

  afterEach(() => {
    debugLoggerWarnSpy.mockReset();
    vi.clearAllMocks();
  });

  describe('sandbox-base-url and requires-auth propagation from alias config', () => {
    it('propagates sandbox-base-url from alias config to settings service', async () => {
      aliasEntries.push({
        alias: 'openrouter',
        source: 'builtin',
        filePath: '/fake/openrouter.config',
        config: {
          baseProvider: 'openai',
          defaultModel: 'gpt-4o',
          'sandbox-base-url': 'http://host.docker.internal:1234/v1/',
        },
      });

      await switchActiveProvider('openrouter', {}, ...stubSwitchInputs());

      expect(
        stubSettingsService.getProviderSettings('openrouter')[
          'sandbox-base-url'
        ],
      ).toBe('http://host.docker.internal:1234/v1/');
    });

    it('propagates requires-auth false from alias config to settings service', async () => {
      aliasEntries.push({
        alias: 'openrouter',
        source: 'builtin',
        filePath: '/fake/openrouter.config',
        config: {
          baseProvider: 'openai',
          defaultModel: 'gpt-4o',
          'requires-auth': false,
        },
      });

      await switchActiveProvider('openrouter', {}, ...stubSwitchInputs());

      expect(
        stubSettingsService.getProviderSettings('openrouter')['requires-auth'],
      ).toBe(false);
    });

    it('propagates both sandbox-base-url and requires-auth together', async () => {
      aliasEntries.push({
        alias: 'openrouter',
        source: 'builtin',
        filePath: '/fake/openrouter.config',
        config: {
          baseProvider: 'openai',
          defaultModel: 'gpt-4o',
          'sandbox-base-url': 'http://host.docker.internal:8080/v1/',
          'requires-auth': false,
        },
      });

      await switchActiveProvider('openrouter', {}, ...stubSwitchInputs());

      const settings = stubSettingsService.getProviderSettings('openrouter');
      expect(settings['sandbox-base-url']).toBe(
        'http://host.docker.internal:8080/v1/',
      );
      expect(settings['requires-auth']).toBe(false);
    });

    it('does not set sandbox-base-url when alias config omits it', async () => {
      aliasEntries.push({
        alias: 'openrouter',
        source: 'builtin',
        filePath: '/fake/openrouter.config',
        config: {
          baseProvider: 'openai',
          defaultModel: 'gpt-4o',
        },
      });

      await switchActiveProvider('openrouter', {}, ...stubSwitchInputs());

      expect(
        stubSettingsService.getProviderSettings('openrouter')[
          'sandbox-base-url'
        ],
      ).toBeUndefined();
    });

    it('does not set requires-auth when alias config omits it', async () => {
      aliasEntries.push({
        alias: 'openrouter',
        source: 'builtin',
        filePath: '/fake/openrouter.config',
        config: {
          baseProvider: 'openai',
          defaultModel: 'gpt-4o',
        },
      });

      await switchActiveProvider('openrouter', {}, ...stubSwitchInputs());

      expect(
        stubSettingsService.getProviderSettings('openrouter')['requires-auth'],
      ).toBeUndefined();
    });
  });

  describe('Claude Code OAuth maxOutputTokens respect (Issue #1769)', () => {
    const enableOAuth = () => oauthEnabled.mockReturnValue(true);
    const disableOAuth = () => oauthEnabled.mockReturnValue(false);

    it('should restore maxOutputTokens and not inject max_tokens=10000 when user had maxOutputTokens configured', async () => {
      pushClaudeCodeAlias();
      enableOAuth();

      settingsOwner.writeUserParameter('maxOutputTokens', 40000);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('maxOutputTokens')).toBe(40000);
      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();

      disableOAuth();
    });

    it('should prefer explicit max_tokens over maxOutputTokens when both are set', async () => {
      pushClaudeCodeAlias();
      enableOAuth();

      settingsOwner.writeUserParameter('max_tokens', 50000);
      settingsOwner.writeUserParameter('maxOutputTokens', 40000);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('max_tokens')).toBe(50000);

      disableOAuth();
    });

    it('should not inject max_tokens default when neither max_tokens nor maxOutputTokens is set (Issue #1769)', async () => {
      pushClaudeCodeAlias();
      enableOAuth();

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();

      disableOAuth();
    });

    it('should treat maxOutputTokens=0 as not configured and use default', async () => {
      pushClaudeCodeAlias();
      enableOAuth();

      settingsOwner.writeUserParameter('maxOutputTokens', 0);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();

      disableOAuth();
    });

    it('should treat negative maxOutputTokens as not configured and use default', async () => {
      pushClaudeCodeAlias();
      enableOAuth();

      settingsOwner.writeUserParameter('maxOutputTokens', -1);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();

      disableOAuth();
    });

    it('should treat non-numeric maxOutputTokens as not configured and use default', async () => {
      pushClaudeCodeAlias();
      enableOAuth();

      settingsOwner.writeUserParameter('maxOutputTokens', '40000');

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();

      disableOAuth();
    });
    describe('Codex alias image-resize defaults propagation @issue:3477', () => {
      it.each(['gpt-5.6-sol', 'gpt-5.10', 'gpt-6'])(
        '%s under codex alias gets image-resize.maxLongEdge 2000',
        async (model) => {
          aliasEntries.push({
            alias: 'codex',
            source: 'builtin',
            filePath: '/fake/codex.config',
            config: {
              baseProvider: 'openai-responses',
              'base-url': 'https://chatgpt.com/backend-api/codex',
              defaultModel: model,
              ephemeralSettings: {
                'context-limit': 262144,
                'prompt-caching': '24h',
                'reasoning.effort': 'medium',
              },
              modelDefaults: [
                {
                  pattern: '^gpt-',
                  ephemeralSettings: {
                    'image-resize.maxLongEdge': 2048,
                    'image-resize.maxShortEdge': 2048,
                    'image-resize.maxPixels': 1572864,
                  },
                },
                {
                  pattern: '^gpt-5[.](?:[2-9]|[1-9][0-9]+)',
                  ephemeralSettings: {
                    'image-resize.maxLongEdge': 2000,
                    'image-resize.maxShortEdge': 2000,
                  },
                },
                {
                  pattern: '^gpt-(?:[6-9]|[1-9][0-9]+)',
                  ephemeralSettings: {
                    'image-resize.maxLongEdge': 2000,
                    'image-resize.maxShortEdge': 2000,
                  },
                },
              ],
            },
          });

          await switchActiveProvider('codex', {}, ...stubSwitchInputs());

          settingsOwner.captureNamedParameters();
          expect(
            settingsOwner.readNamedParameter('image-resize.maxLongEdge'),
          ).toBe(2000);
          expect(
            settingsOwner.readNamedParameter('image-resize.maxShortEdge'),
          ).toBe(2000);
        },
      );
    });
  });
});

let settingsOwner: SessionSettingsOwner;
const retainedRoots: Array<{
  config: RealConfig;
  settingsOwner: SessionSettingsOwner;
}> = [];
