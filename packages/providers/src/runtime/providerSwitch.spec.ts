import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'bun:test';
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';

const realProviderMutationsModule = {
  ...(await import('./providerMutations.js')),
};
void vi.mock('./providerMutations.js', () => ({
  ...realProviderMutationsModule,
  computeModelDefaults: vi.fn(() => ({})),
  normalizeProviderBaseUrl: vi.fn(),
  extractProviderBaseUrl: vi.fn(() => undefined),
  updateActiveProviderApiKey: vi.fn(),
}));

const realProviderAliasesModule = {
  ...(await import(
    '@vybestack/llxprt-code-providers/composition/providerAliases.js'
  )),
};

const realOauthProviderRegistrationModule = {
  ...(await import(
    '@vybestack/llxprt-code-providers/composition/oauth-provider-registration.js'
  )),
};

void vi.mock(
  '@vybestack/llxprt-code-providers/composition/providerAliases.js',
  () => ({
    ...realProviderAliasesModule,
    loadProviderAliasEntries: vi.fn(() => []),
  }),
);

void vi.mock(
  '@vybestack/llxprt-code-providers/composition/oauth-provider-registration.js',
  () => ({
    ...realOauthProviderRegistrationModule,
    ensureOAuthProviderRegistered: vi.fn(),
  }),
);

let switchInputs: [
  Config,
  SettingsService,
  never,
  never,
  undefined,
  () => Promise<void>,
  SessionSettingsOwner,
];

function stubSwitchInputs(
  oauthManager: unknown = null,
): [
  Config,
  SettingsService,
  never,
  never,
  undefined,
  () => Promise<void>,
  SessionSettingsOwner,
] {
  return [
    switchInputs[0],
    switchInputs[1],
    switchInputs[2],
    oauthManager as never,
    undefined,
    switchInputs[5],
    switchInputs[6],
  ];
}

const ownedFixtures: Array<{
  config: Config;
  settingsOwner: SessionSettingsOwner;
}> = [];
function ownSettings(
  config: Config,
  settings: SettingsService,
): SessionSettingsOwner {
  const owner = new SessionSettingsOwner(settings);
  owner.initializeProviderSelection(config.getProvider(), config.getModel());
  ownedFixtures.push({ config, settingsOwner: owner });
  return owner;
}

describe('providerSwitch', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { config, settingsService, providerManager } = {
      config: new Config({
        sessionId: 'provider-switch-fixture',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        debugMode: false,
        provider: 'openai',
        model: 'gpt-4',
      }),
      settingsService: new SettingsService(),
      providerManager: {
        getActiveProviderName: vi.fn(() => 'openai'),
        setActiveProvider: vi.fn(),
        getActiveProvider: vi.fn(() => ({
          name: 'openai',
          getDefaultModel: vi.fn(() => 'gpt-4'),
          getModels: vi.fn(() => []),
        })),
        getProviderByName: vi.fn(() => ({
          name: 'gemini',
          getDefaultModel: vi.fn(() => 'gemini-2.0-flash'),
        })),
      },
    };
    switchInputs = [
      config,
      settingsService,
      providerManager as never,
      null as never,
      undefined,
      async () => {},
      ownSettings(config, settingsService),
    ];
  });

  afterEach(async () => {
    for (const root of ownedFixtures.splice(0)) {
      await root.settingsOwner.dispose();
      await root.config.dispose();
    }
    vi.restoreAllMocks();
  });

  describe('DEFAULT_PRESERVE_EPHEMERALS', () => {
    it('should include expected keys for context preservation', async () => {
      const { DEFAULT_PRESERVE_EPHEMERALS } = await import(
        './providerSwitch.js'
      );
      expect(DEFAULT_PRESERVE_EPHEMERALS).toContain('context-limit');
      expect(DEFAULT_PRESERVE_EPHEMERALS).toContain('max_tokens');
      expect(DEFAULT_PRESERVE_EPHEMERALS).toContain('streaming');
    });

    it('should be a readonly array', async () => {
      const { DEFAULT_PRESERVE_EPHEMERALS } = await import(
        './providerSwitch.js'
      );
      expect(Array.isArray(DEFAULT_PRESERVE_EPHEMERALS)).toBe(true);
    });
  });

  describe('switchActiveProvider', () => {
    it('should return unchanged result when switching to the same provider', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');

      const result = await switchActiveProvider(
        'openai',
        {},
        ...stubSwitchInputs(),
      );

      expect(result.changed).toBe(false);
      expect(result.previousProvider).toBe('openai');
      expect(result.nextProvider).toBe('openai');
      expect(result.infoMessages).toStrictEqual([]);
    });

    it('registers the claudecode OAuth identity for lazy authentication when switched directly', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const { ensureOAuthProviderRegistered } = await import(
        '../composition/index.js'
      );
      const oauthManager = {
        clearRetryHandlers: () => {},

        isOAuthEnabled: vi.fn(() => true),
      };

      await switchActiveProvider(
        'claudecode',
        {},
        ...stubSwitchInputs(oauthManager),
      );

      expect(ensureOAuthProviderRegistered).toHaveBeenCalledWith(
        'claudecode',
        oauthManager,
        undefined,
        undefined,
      );
      expect(ensureOAuthProviderRegistered).not.toHaveBeenCalledWith(
        'anthropic',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('does not register an OAuth identity for API-key-only anthropic', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const { ensureOAuthProviderRegistered } = await import(
        '../composition/index.js'
      );

      await switchActiveProvider('anthropic', {}, ...stubSwitchInputs());

      expect(ensureOAuthProviderRegistered).not.toHaveBeenCalled();
    });

    it('should throw error when provider name is empty string', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');

      await expect(
        switchActiveProvider('', {}, ...stubSwitchInputs()),
      ).rejects.toThrow('Provider name is required.');
    });

    it('should throw error when provider name is whitespace only', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');

      await expect(
        switchActiveProvider('   ', {}, ...stubSwitchInputs()),
      ).rejects.toThrow('Provider name is required.');
    });

    it('emits ModelProfileChanged with resolved model when modelToApply is empty', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');

      // computeModelDefaults mock returns {} so modelToApply stays empty.
      // getActiveModelName mock returns 'gpt-4' as fallback.
      await switchActiveProvider('gemini', {}, ...stubSwitchInputs());

      expect(emitSpy).toHaveBeenCalledTimes(1);
      const emitted = emitSpy.mock.calls[0][0];
      // Must NOT be empty string — should fall back to the active model
      expect(emitted.model).not.toBe('');
      expect(emitted.model).toBe('gpt-4');
      expect(emitted.displayLabel).not.toBe('');
    });

    it('does not emit empty model/displayLabel even when no default model exists', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');

      // Make the provider return no default model so modelToApply resolves to ''
      const { config, settingsService, providerManager } = {
        config: new Config({
          sessionId: 'provider-switch-fixture',
          targetDir: process.cwd(),
          cwd: process.cwd(),
          debugMode: false,
          provider: 'openai',
          model: '',
        }),
        settingsService: new SettingsService(),
        providerManager: {
          getActiveProviderName: vi.fn(() => 'openai'),
          setActiveProvider: vi.fn(),
          getActiveProvider: vi.fn(() => ({
            name: 'openai',
            getDefaultModel: vi.fn(() => undefined),
            getModels: vi.fn(() => []),
          })),
          getProviderByName: vi.fn(() => ({
            name: 'gemini',
            getDefaultModel: vi.fn(() => undefined),
          })),
        },
      };
      switchInputs = [
        config,
        settingsService,
        providerManager as never,
        null as never,
        undefined,
        async () => {},
        ownSettings(config, settingsService),
      ];

      await switchActiveProvider('gemini', {}, ...stubSwitchInputs());

      expect(emitSpy).toHaveBeenCalledTimes(1);
      const emitted = emitSpy.mock.calls[0][0];
      // Even with no default model, must not emit empty string
      expect(emitted.model).not.toBe('');
      expect(emitted.displayLabel).not.toBe('');
    });

    it('does not emit empty displayLabel when no profile and no modelToApply', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');

      await switchActiveProvider('gemini', {}, ...stubSwitchInputs());

      const emitted = emitSpy.mock.calls[0][0];
      expect(emitted.displayLabel).not.toBe('');
      // Falls back to active model name when no profile
      expect(emitted.displayLabel).toBe('gpt-4');
    });

    it('falls back to provider name when active model, config model, and provider default are all empty', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');
      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');

      // Override mocks so ALL model sources return empty.
      // Provider manager active name must differ from the target ('gemini')
      // so that switchActiveProvider actually performs a switch.
      const { config, settingsService, providerManager } = {
        config: new Config({
          sessionId: 'provider-switch-fixture',
          targetDir: process.cwd(),
          cwd: process.cwd(),
          debugMode: false,
          provider: 'openai',
          model: '',
        }),
        settingsService: new SettingsService(),
        providerManager: {
          getActiveProviderName: vi.fn(() => 'openai'),
          setActiveProvider: vi.fn(),
          getActiveProvider: vi.fn(() => ({
            name: 'openai',
            getDefaultModel: vi.fn(() => ''),
            getModels: vi.fn(() => []),
          })),
          getProviderByName: vi.fn(() => ({
            name: 'gemini',
            getDefaultModel: vi.fn(() => ''),
          })),
        },
      };
      switchInputs = [
        config,
        settingsService,
        providerManager as never,
        null as never,
        undefined,
        async () => {},
        ownSettings(config, settingsService),
      ];

      await switchActiveProvider('gemini', {}, ...stubSwitchInputs());

      expect(emitSpy).toHaveBeenCalledTimes(1);
      const emitted = emitSpy.mock.calls[0][0];
      // model must NEVER be empty — fallback chain ends with provider name
      expect(emitted.model).not.toBe('');
      expect(emitted.model).toBe('gemini');
      // displayLabel must NEVER be empty either
      expect(emitted.displayLabel).not.toBe('');
      expect(emitted.displayLabel).toBe('gemini');
    });

    it('does not use stale getActiveModelName when modelToApply is empty; prefers context-scoped config model', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');

      // modelToApply will be empty because provider has no default model.
      // config.getModel reflects the post-switch model.
      // getActiveModelName is STALE — returns the old provider's model.
      const { config, settingsService, providerManager } = {
        config: new Config({
          sessionId: 'provider-switch-fixture',
          targetDir: process.cwd(),
          cwd: process.cwd(),
          debugMode: false,
          provider: 'openai',
          model: 'gemini-2.0-flash',
        }),
        settingsService: new SettingsService(),
        providerManager: {
          getActiveProviderName: vi.fn(() => 'openai'),
          setActiveProvider: vi.fn(),
          // No default model → modelToApply resolves to ''
          getActiveProvider: vi.fn(() => ({
            name: 'gemini',
            getDefaultModel: vi.fn(() => ''),
            getModels: vi.fn(() => []),
          })),
          getProviderByName: vi.fn(() => ({
            name: 'gemini',
            getDefaultModel: vi.fn(() => ''),
          })),
        },
      };
      switchInputs = [
        config,
        settingsService,
        providerManager as never,
        null as never,
        undefined,
        async () => {
          switchInputs[6].chooseModel(config.getModel());
        },
        ownSettings(config, settingsService),
      ];
      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');
      await switchActiveProvider('gemini', {}, ...stubSwitchInputs());

      expect(emitSpy).toHaveBeenCalledTimes(1);
      const emitted = emitSpy.mock.calls[0][0];
      // Must NOT use stale 'gpt-4-stale' from the global accessor.
      // Should use context-scoped config model 'gemini-2.0-flash'.
      expect(emitted.model).not.toBe('gpt-4-stale');
      expect(emitted.model).toBe('gemini-2.0-flash');
    });

    it('multi-provider: emitting context-scoped model, not stale global, when switching from openai to anthropic', async () => {
      const { switchActiveProvider } = await import('./providerSwitch.js');

      const { config, settingsService, providerManager } = {
        config: new Config({
          sessionId: 'provider-switch-fixture',
          targetDir: process.cwd(),
          cwd: process.cwd(),
          debugMode: false,
          provider: 'openai',
          model: 'claude-sonnet',
        }),
        settingsService: new SettingsService(),
        providerManager: {
          getActiveProviderName: vi.fn(() => 'openai'),
          setActiveProvider: vi.fn(),
          // No default model → modelToApply resolves to ''
          getActiveProvider: vi.fn(() => ({
            name: 'anthropic',
            getDefaultModel: vi.fn(() => ''),
            getModels: vi.fn(() => []),
          })),
          getProviderByName: vi.fn(() => ({
            name: 'anthropic',
            getDefaultModel: vi.fn(() => ''),
          })),
        },
      };
      switchInputs = [
        config,
        settingsService,
        providerManager as never,
        null as never,
        undefined,
        async () => {
          switchInputs[6].chooseModel(config.getModel());
        },
        ownSettings(config, settingsService),
      ];
      const emitSpy = vi.spyOn(coreEvents, 'emitModelProfileChanged');
      await switchActiveProvider('anthropic', {}, ...stubSwitchInputs());

      const emitted = emitSpy.mock.calls[0][0];
      // Must use context-scoped model, not stale global
      expect(emitted.model).toBe('claude-sonnet');
      expect(emitted.providerName).toBe('anthropic');
    });
  });
});
