import { Config as RealConfig } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService as RealSettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
let initializeClient = async (): Promise<void> => {};
/**
 * @requirement:Issue-181 Issue-1769
 * Test suite for Claude Code OAuth default settings
 *
 * Verifies that when switching to Claude Code provider with OAuth (subscription mode),
 * user-set values for context_limit, max_tokens, and maxOutputTokens are preserved.
 * Hardcoded defaults have been removed (Issue #1769); defaults now come from
 * the claudecode.config alias ephemeralSettings instead.
 * This applies when either:
 * - authOnly=true is set (explicit OAuth mode), OR
 * - oauthManager.isOAuthEnabled('claudecode') returns true (OAuth is actively being used)
 */

import { OAuthManager } from '../auth/oauth-manager.js';
import {
  MemoryTokenStore,
  createTestProvider,
} from '../auth/__tests__/behavioral/test-utils.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};
const realProviderAliasesModule = {
  ...(await import(
    '@vybestack/llxprt-code-providers/composition/providerAliases.js'
  )),
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
    model = 'model-a';
    baseUrl: string | undefined;
    defaultModel = 'default-model';

    constructor(name: string) {
      this.name = name;
    }

    getDefaultModel(): string {
      return this.defaultModel;
    }

    getBaseURL(): string | undefined {
      return this.baseUrl;
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
  anthropic: new StubProvider('anthropic'),
  claudecode: new StubProvider('claudecode'),
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

void vi.mock(
  '@vybestack/llxprt-code-providers/composition/providerAliases.js',
  () => {
    const actual = realProviderAliasesModule;
    return {
      ...actual,
      loadProviderAliasEntries: () => [],
    };
  },
);

const { switchActiveProvider } = await import('./index.js');

let mockOAuthEnabledForClaudeCode = false;

const mockOAuthManager = new OAuthManager(new MemoryTokenStore());
mockOAuthManager.registerProvider(createTestProvider('claudecode'));
vi.spyOn(mockOAuthManager, 'isOAuthEnabled').mockImplementation(
  (provider) => provider === 'claudecode' && mockOAuthEnabledForClaudeCode,
);

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

describe('Claude Code OAuth defaults (Issue #181)', () => {
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
    mockOAuthEnabledForClaudeCode = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('when switching to Claude Code with authOnly=true', () => {
    it('should NOT inject hardcoded context-limit default (Issue #1769)', async () => {
      settingsOwner.writeUserParameter('authOnly', true);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('context-limit')).toBeUndefined();
    });

    it('should NOT inject hardcoded max_tokens default (Issue #1769)', async () => {
      settingsOwner.writeUserParameter('authOnly', true);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();
    });

    it('should restore maxOutputTokens when previously set and no explicit max_tokens (Issue #1769)', async () => {
      settingsOwner.writeUserParameter('authOnly', true);
      settingsOwner.writeUserParameter('maxOutputTokens', 40000);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('maxOutputTokens')).toBe(40000);
      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();
    });

    it('should NOT override existing context_limit ephemeral setting', async () => {
      settingsOwner.writeUserParameter('authOnly', true);
      settingsOwner.writeUserParameter('context-limit', 150000);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('context-limit')).toBe(150000);
    });

    it('should NOT override existing max_tokens ephemeral setting', async () => {
      settingsOwner.writeUserParameter('authOnly', true);
      settingsOwner.writeUserParameter('max_tokens', 8192);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('max_tokens')).toBe(8192);
    });
  });

  describe('when switching to Claude Code with authOnly=false', () => {
    it('should NOT set default context_limit when authOnly is false', async () => {
      // Arrange: authOnly disabled (API key mode)
      settingsOwner.writeUserParameter('authOnly', false);

      // Act: Switch to Claude Code provider
      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      // Assert: context_limit should NOT be set
      expect(settingsOwner.readNamedParameter('context-limit')).toBeUndefined();
    });

    it('should NOT set default max_tokens when authOnly is false', async () => {
      // Arrange: authOnly disabled (API key mode)
      settingsOwner.writeUserParameter('authOnly', false);

      // Act: Switch to Claude Code provider
      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      // Assert: max_tokens should NOT be set
      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();
    });
  });

  describe('when switching to Claude Code with authOnly undefined', () => {
    it('should NOT set defaults when authOnly is undefined and OAuth not enabled', async () => {
      // Arrange: authOnly not set (default behavior), OAuth not enabled
      // (don't set authOnly at all)

      // Act: Switch to Claude Code provider
      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      // Assert: No defaults should be applied
      expect(settingsOwner.readNamedParameter('context-limit')).toBeUndefined();
      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();
    });
  });

  describe('when switching to Claude Code with OAuth enabled (via oauthManager)', () => {
    it('should NOT inject hardcoded context-limit default (Issue #1769)', async () => {
      mockOAuthEnabledForClaudeCode = true;

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('context-limit')).toBeUndefined();
    });

    it('should NOT inject hardcoded max_tokens default (Issue #1769)', async () => {
      mockOAuthEnabledForClaudeCode = true;

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();
    });

    it('should restore maxOutputTokens when previously set and no explicit max_tokens (Issue #1769)', async () => {
      mockOAuthEnabledForClaudeCode = true;
      settingsOwner.writeUserParameter('maxOutputTokens', 40000);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('maxOutputTokens')).toBe(40000);
      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();
    });

    it('should NOT override existing context_limit when OAuth is enabled', async () => {
      mockOAuthEnabledForClaudeCode = true;
      settingsOwner.writeUserParameter('context-limit', 150000);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('context-limit')).toBe(150000);
    });

    it('should NOT override existing max_tokens when OAuth is enabled', async () => {
      mockOAuthEnabledForClaudeCode = true;
      settingsOwner.writeUserParameter('max_tokens', 8192);

      await switchActiveProvider('claudecode', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('max_tokens')).toBe(8192);
    });
  });

  describe('when switching to non-Claude Code providers', () => {
    it('should NOT set defaults for OpenAI even with authOnly=true', async () => {
      // Arrange: authOnly enabled but switching to OpenAI
      settingsOwner.writeUserParameter('authOnly', true);
      activeProviderName = 'claudecode'; // Start from claudecode

      // Act: Switch to OpenAI
      await switchActiveProvider('openai', {}, ...stubSwitchInputs());

      // Assert: No Claude Code-specific defaults should be set
      expect(settingsOwner.readNamedParameter('context-limit')).toBeUndefined();
      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();
    });

    it('does not apply OAuth defaults to API-key-only anthropic', async () => {
      mockOAuthEnabledForClaudeCode = true;
      activeProviderName = 'claudecode';

      await switchActiveProvider('anthropic', {}, ...stubSwitchInputs());

      expect(settingsOwner.readNamedParameter('context-limit')).toBeUndefined();
      expect(settingsOwner.readNamedParameter('max_tokens')).toBeUndefined();
      expect(
        settingsOwner.readNamedParameter('maxOutputTokens'),
      ).toBeUndefined();
    });
  });
});

let settingsOwner: SessionSettingsOwner;
const retainedRoots: Array<{
  config: RealConfig;
  settingsOwner: SessionSettingsOwner;
}> = [];
