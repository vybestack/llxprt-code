/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseProvider } from '@vybestack/llxprt-code-providers/BaseProvider.js';
import type { GenerateChatOptions } from '@vybestack/llxprt-code-providers/IProvider.js';
import type { IContent } from '../../../services/history/IContent.js';
import type { CompressionProviderResult } from '../types.js';
import { CompressionProfileNotFoundError } from '../types.js';
import type { RuntimeProvider as IProvider } from '../../../runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '../../../runtime/contracts/RuntimeProviderChat.js';
import type { AgentRuntimeContext } from '../../../runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '../../../runtime/providerRuntimeContext.js';
import { SettingsService } from '../../../settings/SettingsService.js';
import type { ContentGenerator } from '../../contentGenerator.js';
import type { Config } from '../../../config/config.js';
import type { Profile, StandardProfile } from '../../../types/modelParams.js';
import { ChatSession } from '../../chatSession.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { HistoryService } from '../../../services/history/HistoryService.js';

const { mockProviderKeyStorageGetKey } = vi.hoisted(() => ({
  mockProviderKeyStorageGetKey: vi.fn<[string], Promise<string | null>>(),
}));

vi.mock('../../../storage/provider-key-storage.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../storage/provider-key-storage.js')
    >();
  return {
    ...actual,
    getProviderKeyStorage: () => ({
      getKey: mockProviderKeyStorageGetKey,
    }),
  };
});

class NormalizingProvider extends BaseProvider {
  readonly capturedOptions: GenerateChatOptions[] = [];
  readonly capturedAuthTokens: Array<string | undefined> = [];

  constructor(name: string, apiKey?: string) {
    super({ name, supportsOAuth: false, apiKey });
  }

  protected override supportsOAuth(): boolean {
    return false;
  }

  async getModels() {
    return [];
  }

  getDefaultModel(): string {
    return 'fake-model';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(): Promise<unknown> {
    return {};
  }

  protected async *generateChatCompletionWithOptions(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.capturedOptions.push(options);
    this.capturedAuthTokens.push(options.resolved?.authToken);
    yield {
      speaker: 'ai' as const,
      blocks: [{ type: 'text' as const, text: 'profile summary' }],
    };
  }
}

function createFakeProvider(
  name: string,
  summaryText = 'default summary',
  optionsCapture?: { options: RuntimeGenerateChatOptions[] },
): IProvider {
  return {
    name,
    getModels: async () => [],
    getDefaultModel: () => 'fake-model',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
    async *generateChatCompletion(options: RuntimeGenerateChatOptions) {
      optionsCapture?.options.push(options);
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: summaryText }],
      };
    },
  };
}

function makeEphemerals(
  compressionProfile?: string,
  compressionVerification = false,
): AgentRuntimeContext['ephemerals'] {
  return {
    compressionThreshold: () => 0.1,
    contextLimit: () => 100000,
    preserveThreshold: () => 0.2,
    topPreserveThreshold: () => 0.2,
    toolFormatOverride: () => undefined,
    compressionStrategy: () => 'one-shot',
    compressionProfile: () => compressionProfile,
    densityReadWritePruning: () => false,
    densityFileDedupe: () => false,
    densityRecencyPruning: () => false,
    densityRecencyRetention: () => 2,
    densityCompressHeadroom: () => 0,
    densityOptimizeThreshold: () => undefined,
    compressionVerification: () => compressionVerification,
    reasoning: {
      enabled: () => false,
      includeInContext: () => false,
      includeInResponse: () => false,
      format: () => 'native',
      stripFromContext: () => 'none',
      effort: () => undefined,
      maxTokens: () => undefined,
      adaptiveThinking: () => undefined,
    },
  };
}

function makeRuntimeContext(options: {
  providerName: string;
  model: string;
  providerRuntime: ProviderRuntimeContext;
  activeProvider: IProvider;
  providers?: Record<string, IProvider>;
  compressionProfile?: string;
  compressionVerification?: boolean;
}): AgentRuntimeContext {
  const providers = options.providers ?? {
    [options.activeProvider.name]: options.activeProvider,
  };
  return {
    state: {
      runtimeId: options.providerRuntime.runtimeId ?? 'session-runtime',
      provider: options.providerName,
      model: options.model,
      sessionId: 'session-id',
      updatedAt: Date.now(),
    },
    history: new HistoryService(),
    ephemerals: makeEphemerals(
      options.compressionProfile,
      options.compressionVerification,
    ),
    telemetry: {},
    provider: {
      getActiveProvider: () => options.activeProvider,
      setActiveProvider: vi.fn(),
      getProviderByName: (name: string) => providers[name],
    },
    tools: {},
    providerRuntime: options.providerRuntime,
  } as AgentRuntimeContext;
}

function makeContentGenerator(): ContentGenerator {
  return {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn(),
    embedContent: vi.fn(),
  } as unknown as ContentGenerator;
}

function makeConfig(
  profileManager?: ReturnType<typeof makeProfileManager>,
): Config {
  return {
    getProfileManager: () => profileManager,
    getEnableHooks: () => false,
  } as Config;
}

function makeProfileManager(profileInput: Profile | Record<string, Profile>) {
  const isSingleProfile = 'version' in profileInput;
  const profiles: Partial<Record<string, Profile>> = isSingleProfile
    ? {}
    : profileInput;
  return {
    loadProfile: vi.fn(async (profileName: string) => {
      if (isSingleProfile) {
        return profileInput;
      }
      const profile = profiles[profileName];
      if (!profile) {
        throw new Error(`Profile '${profileName}' not found`);
      }
      return profile;
    }),
    load: vi.fn(),
    applyLoadedProfile: vi.fn(
      async (
        profileName: string,
        loadedProfile: StandardProfile,
        settings: SettingsService,
      ) => {
        settings.setCurrentProfileName(profileName);
        settings.set('activeProvider', loadedProfile.provider);
        settings.setProviderSetting(
          loadedProfile.provider,
          'model',
          loadedProfile.model,
        );
      },
    ),
  };
}

async function runOneShotCompression(
  runtimeContext: AgentRuntimeContext,
): Promise<void> {
  const chat = new ChatSession(runtimeContext, makeContentGenerator());
  for (let i = 0; i < 8; i++) {
    chat.addHistory({
      role: i % 2 === 0 ? 'user' : 'model',
      parts: [{ text: `message ${i}` }],
    });
  }
  await chat.performCompression('compression-test', { bypassCooldown: true });
}

function standardProfile(
  overrides: Partial<StandardProfile> = {},
): StandardProfile {
  return {
    version: 1,
    type: 'standard',
    provider: 'profile-provider',
    model: 'profile-model',
    modelParams: {
      temperature: 0.7,
      max_tokens: 2048,
      top_p: 0.9,
    },
    ephemeralSettings: {},
    ...overrides,
  };
}

describe('CompressionHandler provider resolution (issue #1972)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderKeyStorageGetKey.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ChatSession compression provider production path', () => {
    it('uses the session provider runtime and settings when compression.profile is unset', async () => {
      const capturedOptions: RuntimeGenerateChatOptions[] = [];
      const sessionSettings = new SettingsService();
      sessionSettings.set('activeProvider', 'session-provider');
      sessionSettings.setProviderSetting(
        'session-provider',
        'apiKey',
        'session-key',
      );
      const sessionRuntime: ProviderRuntimeContext = {
        settingsService: sessionSettings,
        config: makeConfig(),
        runtimeId: 'session-runtime',
        metadata: { source: 'session-runtime' },
      };
      const sessionProvider = createFakeProvider(
        'session-provider',
        'session summary',
        { options: capturedOptions },
      );
      const lookup = vi.fn((name: string) =>
        name === 'session-provider' ? sessionProvider : undefined,
      );
      const runtimeContext = {
        ...makeRuntimeContext({
          providerName: 'session-provider',
          model: 'session-model',
          providerRuntime: sessionRuntime,
          activeProvider: sessionProvider,
        }),
        provider: {
          getActiveProvider: () => sessionProvider,
          setActiveProvider: vi.fn(),
          getProviderByName: lookup,
        },
      } as AgentRuntimeContext;

      await runOneShotCompression(runtimeContext);

      expect(capturedOptions).toHaveLength(1);
      expect(capturedOptions[0]?.runtime).toBe(sessionRuntime);
      expect(capturedOptions[0]?.settings).toBe(sessionSettings);
      expect(capturedOptions[0]?.config).toBe(sessionRuntime.config);
      expect(lookup).toHaveBeenCalledWith('session-provider');
      expect(lookup).not.toHaveBeenCalledWith('compression');
      expect(lookup).not.toHaveBeenCalledWith('compression-default');
      expect(lookup).not.toHaveBeenCalledWith('default');
    });

    it('loads an explicit compression profile into isolated runtime settings', async () => {
      const profile = standardProfile({
        provider: 'profile-provider',
        model: 'profile-model',
        modelParams: {
          temperature: 0.6,
          max_tokens: 4096,
          top_p: 0.8,
        },
        ephemeralSettings: {
          'auth-key': 'profile-key',
          'auth-key-name': 'profile-key-name',
          'auth-keyfile': '~/profile-keyfile.json',
          apiKeyfile: '~/profile-api-keyfile.json',
          'base-url': 'https://profile.example.test',
          'sandbox-base-url': 'https://sandbox.example.test',
          'api-version': '2026-06-09',
          'custom-headers': { 'x-profile': 'true' },
          'requires-auth': true,
          authOnly: false,
          'tool-format': 'xml',
        },
        auth: { type: 'oauth', buckets: ['profile-bucket'] },
      });
      const profileManager = makeProfileManager(profile);
      const sessionSettings = new SettingsService();
      sessionSettings.set('activeProvider', 'session-provider');
      sessionSettings.setProviderSetting(
        'session-provider',
        'apiKey',
        'session-key',
      );
      const sessionRuntime: ProviderRuntimeContext = {
        settingsService: sessionSettings,
        config: makeConfig(profileManager),
        runtimeId: 'session-runtime',
        metadata: { source: 'session-runtime' },
      };
      const sessionProvider = createFakeProvider('session-provider');
      const profileProvider = new NormalizingProvider('profile-provider');

      await runOneShotCompression(
        makeRuntimeContext({
          providerName: 'session-provider',
          model: 'session-model',
          providerRuntime: sessionRuntime,
          activeProvider: sessionProvider,
          providers: {
            'session-provider': sessionProvider,
            'profile-provider': profileProvider,
          },
          compressionProfile: 'compression-profile',
        }),
      );

      expect(profileProvider.capturedOptions).toHaveLength(1);
      const options = profileProvider.capturedOptions[0];
      expect(options.runtime).not.toBe(sessionRuntime);
      const profileCallSettings = options.settings;
      expect(options.runtime?.settingsService).toBe(profileCallSettings);
      expect(options.config).toBe(sessionRuntime.config);
      expect(options.runtime?.runtimeId).toContain(
        'compression-profile:compression-profile',
      );
      expect(options.resolved).toMatchObject({
        model: 'profile-model',
        baseURL: 'https://profile.example.test',
        temperature: 0.6,
        maxTokens: 4096,
      });
      expect(profileProvider.capturedAuthTokens[0]).toBe('profile-key');

      expect(options.invocation?.runtimeId).toBe(options.runtime?.runtimeId);
      expect(options.invocation?.settings).toBe(profileCallSettings);
      expect(options.invocation?.customHeaders).toMatchObject({
        'x-profile': 'true',
      });
      expect(options.invocation?.getEphemeral('authOnly')).toBe(false);
      expect(
        options.invocation?.getProviderOverrides('profile-provider'),
      ).toMatchObject({
        apiKey: 'profile-key',
      });
      expect(options.metadata).toMatchObject({
        compressionProfile: 'compression-profile',
        compressionProvider: 'profile-provider',
      });
      expect(profileCallSettings?.getCurrentProfileName()).toBe(
        'compression-profile',
      );
      expect(profileCallSettings?.get('activeProvider')).toBe(
        'profile-provider',
      );
      expect(profileCallSettings?.get('model')).toBe('profile-model');
      expect(profileCallSettings?.get('auth-key')).toBe('profile-key');
      expect(profileCallSettings?.get('auth-key-name')).toBe(
        'profile-key-name',
      );
      expect(profileCallSettings?.get('auth-keyfile')).toBe(
        '~/profile-keyfile.json',
      );
      expect(profileCallSettings?.get('base-url')).toBe(
        'https://profile.example.test',
      );
      expect(profileCallSettings?.get('authOnly')).toBe(false);
      expect(
        profileCallSettings?.getProviderSettings('profile-provider'),
      ).toMatchObject({
        apiKey: 'profile-key',
        'auth-key': 'profile-key',
        'auth-key-name': 'profile-key-name',
        'auth-keyfile': '~/profile-keyfile.json',
        apiKeyfile: '~/profile-api-keyfile.json',
        'base-url': 'https://profile.example.test',
        'sandbox-base-url': 'https://sandbox.example.test',
        'api-version': '2026-06-09',
        'custom-headers': { 'x-profile': 'true' },
        model: 'profile-model',
        temperature: 0.6,
        maxTokens: 4096,
        topP: 0.8,
      });
      expect(profileProvider.capturedAuthTokens[0]).toBe('profile-key');
      expect(mockProviderKeyStorageGetKey).not.toHaveBeenCalled();
      expect(
        sessionSettings.getProviderSettings('session-provider'),
      ).toMatchObject({
        apiKey: 'session-key',
      });
    });

    it('resolves explicit profile named keys through provider normalization', async () => {
      mockProviderKeyStorageGetKey.mockResolvedValue('named-profile-key');
      const profile = standardProfile({
        provider: 'profile-provider',
        model: 'profile-model',
        ephemeralSettings: {
          'auth-key-name': 'stored-profile-key',
          'base-url': 'https://profile.example.test',
        },
      });
      const profileManager = makeProfileManager(profile);
      const sessionSettings = new SettingsService();
      sessionSettings.set('auth-key', 'session-key');
      sessionSettings.set('activeProvider', 'session-provider');
      const sessionRuntime: ProviderRuntimeContext = {
        settingsService: sessionSettings,
        config: makeConfig(profileManager),
        runtimeId: 'session-runtime',
        metadata: { source: 'session-runtime' },
      };
      const sessionProvider = createFakeProvider('session-provider');
      const profileProvider = new NormalizingProvider(
        'profile-provider',
        'constructor-key',
      );

      await runOneShotCompression(
        makeRuntimeContext({
          providerName: 'session-provider',
          model: 'session-model',
          providerRuntime: sessionRuntime,
          activeProvider: sessionProvider,
          providers: {
            'session-provider': sessionProvider,
            'profile-provider': profileProvider,
          },
          compressionProfile: 'named-key-profile',
        }),
      );

      expect(mockProviderKeyStorageGetKey).toHaveBeenCalledWith(
        'stored-profile-key',
      );
      expect(profileProvider.capturedAuthTokens[0]).toBe('named-profile-key');
      expect(profileProvider.capturedOptions[0]?.settings).not.toBe(
        sessionSettings,
      );
    });

    it('throws an actionable error when an explicit profile provider is unavailable', async () => {
      const profile = standardProfile({
        provider: 'missing-provider',
        model: 'profile-model',
      });
      const profileManager = makeProfileManager(profile);
      const sessionRuntime: ProviderRuntimeContext = {
        settingsService: new SettingsService(),
        config: makeConfig(profileManager),
        runtimeId: 'session-runtime',
        metadata: { source: 'session-runtime' },
      };
      const sessionProvider = createFakeProvider('session-provider');

      await expect(
        runOneShotCompression(
          makeRuntimeContext({
            providerName: 'session-provider',
            model: 'session-model',
            providerRuntime: sessionRuntime,
            activeProvider: sessionProvider,
            providers: { 'session-provider': sessionProvider },
            compressionProfile: 'missing-provider-profile',
          }),
        ),
      ).rejects.toThrow(CompressionProfileNotFoundError);
    });

    it('uses explicit load-balanced profile subprofiles instead of a registered session load-balancer', async () => {
      const loadBalancedProfile: Profile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-a', 'profile-b'],
        provider: '',
        model: 'load-balanced-model',
        modelParams: {},
        ephemeralSettings: {
          'base-url': 'https://load-balanced.example.test',
        },
      };
      const profileA = standardProfile({
        provider: 'profile-provider-a',
        model: 'profile-model-a',
        ephemeralSettings: {
          'auth-key': 'profile-a-key',
          'base-url': 'https://profile-a.example.test',
        },
      });
      const profileB = standardProfile({
        provider: 'profile-provider-b',
        model: 'profile-model-b',
        ephemeralSettings: {
          'auth-key': 'profile-b-key',
          'base-url': 'https://profile-b.example.test',
        },
      });
      const profileManager = makeProfileManager({
        'load-balanced-compression': loadBalancedProfile,
        'profile-a': profileA,
        'profile-b': profileB,
      });
      const sessionRuntime: ProviderRuntimeContext = {
        settingsService: new SettingsService(),
        config: makeConfig(profileManager),
        runtimeId: 'session-runtime',
        metadata: { source: 'session-runtime' },
      };
      const sessionProvider = createFakeProvider('session-provider');
      const registeredLoadBalancer = createFakeProvider(
        'load-balancer',
        'wrong load-balancer summary',
      );
      const providerA = new NormalizingProvider('profile-provider-a');
      const providerB = new NormalizingProvider('profile-provider-b');
      const lookup = vi.fn((name: string) => {
        if (name === 'load-balancer') return registeredLoadBalancer;
        if (name === 'profile-provider-a') return providerA;
        if (name === 'profile-provider-b') return providerB;
        return undefined;
      });
      const runtimeContext = {
        ...makeRuntimeContext({
          providerName: 'session-provider',
          model: 'session-model',
          providerRuntime: sessionRuntime,
          activeProvider: sessionProvider,
          providers: {
            'session-provider': sessionProvider,
            'load-balancer': registeredLoadBalancer,
            'profile-provider-a': providerA,
            'profile-provider-b': providerB,
          },
          compressionProfile: 'load-balanced-compression',
        }),
        provider: {
          getActiveProvider: () => sessionProvider,
          setActiveProvider: vi.fn(),
          getProviderByName: lookup,
        },
      } as AgentRuntimeContext;

      await runOneShotCompression(runtimeContext);

      expect(lookup).not.toHaveBeenCalledWith('load-balancer');
      expect(providerA.capturedOptions).toHaveLength(1);
      expect(providerB.capturedOptions).toHaveLength(0);
      expect(providerA.capturedOptions[0]?.resolved).toMatchObject({
        model: 'profile-model-a',
        baseURL: 'https://profile-a.example.test',
      });
      expect(providerA.capturedAuthTokens[0]).toBe('profile-a-key');
      expect(providerA.capturedOptions[0]?.metadata).toMatchObject({
        selectedCompressionProfile: 'profile-a',
      });
      expect(profileManager.applyLoadedProfile).toHaveBeenCalledWith(
        'profile-a',
        profileA,
        expect.any(SettingsService),
      );
    });

    it('rotates explicit load-balanced profile subprofiles across compression operations', async () => {
      const loadBalancedProfile: Profile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['profile-a', 'profile-b'],
        provider: '',
        model: 'load-balanced-model',
        modelParams: {},
        ephemeralSettings: {},
      };
      const profileA = standardProfile({
        provider: 'profile-provider-a',
        model: 'profile-model-a',
        ephemeralSettings: { 'auth-key': 'profile-a-key' },
      });
      const profileB = standardProfile({
        provider: 'profile-provider-b',
        model: 'profile-model-b',
        ephemeralSettings: { 'auth-key': 'profile-b-key' },
      });
      const profileManager = makeProfileManager({
        'load-balanced-compression': loadBalancedProfile,
        'profile-a': profileA,
        'profile-b': profileB,
      });
      const sessionProvider = createFakeProvider('session-provider');
      const providerA = new NormalizingProvider('profile-provider-a');
      const providerB = new NormalizingProvider('profile-provider-b');
      const runtimeContext = makeRuntimeContext({
        providerName: 'session-provider',
        model: 'session-model',
        providerRuntime: {
          settingsService: new SettingsService(),
          config: makeConfig(profileManager),
          runtimeId: 'session-runtime',
          metadata: { source: 'session-runtime' },
        },
        activeProvider: sessionProvider,
        providers: {
          'session-provider': sessionProvider,
          'profile-provider-a': providerA,
          'profile-provider-b': providerB,
        },
        compressionProfile: 'load-balanced-compression',
      });

      const chat = new ChatSession(runtimeContext, makeContentGenerator());
      for (let i = 0; i < 8; i++) {
        chat.addHistory({
          role: i % 2 === 0 ? 'user' : 'model',
          parts: [{ text: `first message ${i}` }],
        });
      }
      await chat.performCompression('first-compression', {
        bypassCooldown: true,
      });
      for (let i = 0; i < 8; i++) {
        chat.addHistory({
          role: i % 2 === 0 ? 'user' : 'model',
          parts: [{ text: `second message ${i}` }],
        });
      }
      await chat.performCompression('second-compression', {
        bypassCooldown: true,
      });

      expect(providerA.capturedOptions).toHaveLength(1);
      expect(providerB.capturedOptions).toHaveLength(1);
      expect(providerA.capturedOptions[0]?.resolved?.model).toBe(
        'profile-model-a',
      );
      expect(providerB.capturedOptions[0]?.resolved?.model).toBe(
        'profile-model-b',
      );
      expect(providerA.capturedAuthTokens[0]).toBe('profile-a-key');
      expect(providerB.capturedAuthTokens[0]).toBe('profile-b-key');
    });

    it('uses isolated profile runtime for the verification pass', async () => {
      const profile = standardProfile({
        provider: 'profile-provider',
        model: 'profile-model',
        ephemeralSettings: {
          'auth-key': 'profile-key',
          'base-url': 'https://profile.example.test',
        },
      });
      const profileManager = makeProfileManager(profile);
      const sessionSettings = new SettingsService();
      sessionSettings.set('auth-key', 'session-key');
      sessionSettings.set('activeProvider', 'session-provider');
      const sessionRuntime: ProviderRuntimeContext = {
        settingsService: sessionSettings,
        config: makeConfig(profileManager),
        runtimeId: 'session-runtime',
        metadata: { source: 'session-runtime' },
      };
      const sessionProvider = createFakeProvider('session-provider');
      const profileProvider = new NormalizingProvider('profile-provider');

      await runOneShotCompression(
        makeRuntimeContext({
          providerName: 'session-provider',
          model: 'session-model',
          providerRuntime: sessionRuntime,
          activeProvider: sessionProvider,
          providers: {
            'session-provider': sessionProvider,
            'profile-provider': profileProvider,
          },
          compressionProfile: 'verified-profile',
          compressionVerification: true,
        }),
      );

      expect(profileProvider.capturedOptions).toHaveLength(2);
      for (const option of profileProvider.capturedOptions) {
        expect(option.settings).not.toBe(sessionSettings);
        expect(option.runtime?.settingsService).toBe(option.settings);
        expect(option.metadata).toMatchObject({
          compressionProfile: 'verified-profile',
          compressionProvider: 'profile-provider',
        });
      }
      expect(profileProvider.capturedAuthTokens).toStrictEqual([
        'profile-key',
        'profile-key',
      ]);
    });
  });

  describe('buildCompressionContext.resolveProvider', () => {
    it('passes undefined through to providerResolver when called without a profile', async () => {
      const fakeProvider = createFakeProvider('session-provider');
      const capturedArgs: Array<string | undefined> = [];
      const fakeRuntime = {
        settingsService: {} as SettingsService,
        config: undefined,
        runtimeId: 'test',
      };
      const trackingResolver = (
        label: string | undefined,
      ): CompressionProviderResult => {
        capturedArgs.push(label);
        return { provider: fakeProvider, runtime: fakeRuntime };
      };

      const historyService = new HistoryService();
      vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(5000);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        100,
      );
      vi.spyOn(historyService, 'getCurated').mockReturnValue([]);

      const runtimeContext = {
        state: {
          runtimeId: 'test',
          provider: 'test-provider',
          model: 'test-model',
          sessionId: 'test-session',
          updatedAt: Date.now(),
        },
        ephemerals: {
          compressionVerification: () => false,
        },
        providerRuntime: {},
      } as unknown as AgentRuntimeContext;

      const handler = new CompressionHandler(
        runtimeContext,
        historyService,
        {},
        trackingResolver,
        async () => {},
      );

      const context = await handler.buildCompressionContext('test-prompt');

      const resolved = await context.resolveProvider();
      expect(resolved.provider.name).toBe('session-provider');
      expect(capturedArgs.at(-1)).toBeUndefined();

      await context.resolveProvider(undefined);
      expect(capturedArgs.at(-1)).toBeUndefined();

      expect(capturedArgs).not.toContain('compression');
      expect(capturedArgs).not.toContain('compression-default');
    });

    it('passes explicit profile name through unchanged', async () => {
      const fakeProvider = createFakeProvider('profile-provider');
      const capturedArgs: Array<string | undefined> = [];
      const fakeRuntime = {
        settingsService: {} as SettingsService,
        config: undefined,
        runtimeId: 'test',
      };
      const trackingResolver = (
        label: string | undefined,
      ): CompressionProviderResult => {
        capturedArgs.push(label);
        return { provider: fakeProvider, runtime: fakeRuntime };
      };

      const historyService = new HistoryService();
      vi.spyOn(historyService, 'getTotalTokens').mockReturnValue(5000);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        100,
      );
      vi.spyOn(historyService, 'getCurated').mockReturnValue([]);

      const runtimeContext = {
        state: {
          runtimeId: 'test',
          provider: 'test-provider',
          model: 'test-model',
          sessionId: 'test-session',
          updatedAt: Date.now(),
        },
        ephemerals: {
          compressionVerification: () => false,
        },
        providerRuntime: {},
      } as unknown as AgentRuntimeContext;

      const handler = new CompressionHandler(
        runtimeContext,
        historyService,
        {},
        trackingResolver,
        async () => {},
      );

      const context = await handler.buildCompressionContext('test-prompt');
      await context.resolveProvider('my-explicit-profile');

      expect(capturedArgs).toContain('my-explicit-profile');
    });
  });
});
