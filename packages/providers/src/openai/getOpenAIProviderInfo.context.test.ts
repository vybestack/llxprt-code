import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { ConversationCache } from './ConversationCache.js';
import {
  getOpenAIProviderInfo,
  type OpenAIProviderInfoSource,
  type OpenAIProviderLike,
} from './getOpenAIProviderInfo.js';

const createProviderManagerStub = (
  provider: OpenAIProviderLike | undefined,
): OpenAIProviderInfoSource => ({
  hasActiveProvider: () => true,
  getActiveProviderName: () => 'openai',
  getActiveProvider: () => provider,
});

describe('getOpenAIProviderInfo runtime integration', () => {
  it('derives model and responses mode from the explicit runtime SettingsService', () => {
    const settingsService = new SettingsService();
    settingsService.set('model', 'settings-model');
    settingsService.setProviderSetting('openai', 'apiMode', 'responses');

    const conversationCache = new ConversationCache();
    const providerStub: OpenAIProviderLike = {
      name: 'openai',
      getConversationCache: () => conversationCache,
      shouldUseResponses: vi.fn(() => false),
    };
    const providerManager = createProviderManagerStub(providerStub);

    const config = createRuntimeConfigStub(settingsService, {
      getProvider: () => 'openai',
      getProviderManager: () => providerManager,
      getModel: () => 'config-model',
    });

    const info = getOpenAIProviderInfo(
      { settingsService, config },
      providerManager,
    );
    expect(info.currentModel).toBe('settings-model');
    expect(info.isResponsesAPI).toBe(true);
    expect(info.conversationCache).toBe(conversationCache);
    expect(providerStub.shouldUseResponses).not.toHaveBeenCalled();
  });

  it('falls back to runtime config when SettingsService lacks model', () => {
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService, {
      getProvider: () => 'openai',
      getProviderManager: () => null,
      getModel: () => 'config-model',
    });

    const info = getOpenAIProviderInfo({ settingsService, config });
    expect(info.currentModel).toBe('config-model');
    expect(info.provider).toBeNull();
  });

  it('returns default info when active provider is not OpenAI', () => {
    const settingsService = new SettingsService();
    const providerManager: OpenAIProviderInfoSource = {
      hasActiveProvider: () => true,
      getActiveProviderName: () => 'anthropic',
      getActiveProvider: () => undefined,
    };

    const config = createRuntimeConfigStub(settingsService, {
      getProvider: () => 'anthropic',
      getProviderManager: () => providerManager,
    });

    const info = getOpenAIProviderInfo(
      { settingsService, config },
      providerManager,
    );
    expect(info.currentModel).toBeNull();
    expect(info.provider).toBeNull();
    expect(info.isResponsesAPI).toBe(false);
  });

  it('resolves conversationCache from the optional conversationCache field when getConversationCache is absent', () => {
    const settingsService = new SettingsService();
    settingsService.set('model', 'gpt-4o');

    // Provider exposes ONLY the optional `conversationCache` field (no
    // getConversationCache method), exercising that fallback branch.
    const conversationCache = new ConversationCache();
    const providerStub: OpenAIProviderLike = {
      name: 'openai',
      conversationCache,
    };
    const providerManager = createProviderManagerStub(providerStub);

    const config = createRuntimeConfigStub(settingsService, {
      getProvider: () => 'openai',
      getProviderManager: () => providerManager,
      getModel: () => 'gpt-4o',
    });

    const info = getOpenAIProviderInfo(
      { settingsService, config },
      providerManager,
    );
    expect(info.provider).not.toBeNull();
    expect(info.conversationCache).toBe(conversationCache);
  });

  it('uses shouldUseResponses to determine responses API mode for supported-but-not-required models', () => {
    const settingsService = new SettingsService();
    settingsService.set('model', 'gpt-5.4');

    const providerStub: OpenAIProviderLike = {
      name: 'openai',
      shouldUseResponses: vi.fn(() => true),
    };
    const providerManager = createProviderManagerStub(providerStub);

    const config = createRuntimeConfigStub(settingsService, {
      getProvider: () => 'openai',
      getProviderManager: () => providerManager,
      getModel: () => 'gpt-5.4',
    });

    const info = getOpenAIProviderInfo(
      { settingsService, config },
      providerManager,
    );
    expect(info.isResponsesAPI).toBe(true);
    expect(providerStub.shouldUseResponses).toHaveBeenCalledWith('gpt-5.4');
  });

  it('keeps gpt-5.4-mini on Chat Completions by default (supports but does not require Responses)', () => {
    const settingsService = new SettingsService();
    settingsService.set('model', 'gpt-5.4-mini');

    const providerStub: OpenAIProviderLike = {
      name: 'openai',
    };
    const providerManager = createProviderManagerStub(providerStub);

    const config = createRuntimeConfigStub(settingsService, {
      getProvider: () => 'openai',
      getProviderManager: () => providerManager,
      getModel: () => 'gpt-5.4-mini',
    });

    const info = getOpenAIProviderInfo(
      { settingsService, config },
      providerManager,
    );
    expect(info.currentModel).toBe('gpt-5.4-mini');
    expect(info.isResponsesAPI).toBe(false);
  });

  it.each([
    'gpt-5.6',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.7-sol',
    'gpt-6.0-terra-latest',
    'gpt-7.2-luna-20270115',
  ])('routes GPT named tier model %s to Responses by default', (model) => {
    const settingsService = new SettingsService();
    settingsService.set('model', model);
    const providerStub: OpenAIProviderLike = { name: 'openai' };
    const providerManager = createProviderManagerStub(providerStub);
    const config = createRuntimeConfigStub(settingsService, {
      getProvider: () => 'openai',
      getProviderManager: () => providerManager,
      getModel: () => model,
    });

    const info = getOpenAIProviderInfo(
      { settingsService, config },
      providerManager,
    );

    expect(info.isResponsesAPI).toBe(true);
  });

  it.each(['gpt-5.6-solar', 'gpt-5.6-sol-preview', 'vendor-gpt-5.6-sol'])(
    'does not route GPT named tier lookalike %s to Responses',
    (model) => {
      const settingsService = new SettingsService();
      settingsService.set('model', model);
      const providerStub: OpenAIProviderLike = { name: 'openai' };
      const providerManager = createProviderManagerStub(providerStub);
      const config = createRuntimeConfigStub(settingsService, {
        getProvider: () => 'openai',
        getProviderManager: () => providerManager,
        getModel: () => model,
      });

      const info = getOpenAIProviderInfo(
        { settingsService, config },
        providerManager,
      );

      expect(info.isResponsesAPI).toBe(false);
    },
  );

  it('reports Responses=false when provider.getBaseURL() is a custom URL, even if provider settings claim canonical', () => {
    const settingsService = new SettingsService();
    settingsService.set('model', 'gpt-5.6');
    // Stale settings-based base-url that disagrees with the provider instance
    settingsService.setProviderSetting(
      'openai',
      'base-url',
      'https://api.openai.com/v1',
    );

    const providerStub: OpenAIProviderLike = {
      name: 'openai',
      getBaseURL: () => 'https://custom.proxy.com/v1',
    };
    const providerManager = createProviderManagerStub(providerStub);
    const config = createRuntimeConfigStub(settingsService, {
      getProvider: () => 'openai',
      getProviderManager: () => providerManager,
      getModel: () => 'gpt-5.6',
    });

    const info = getOpenAIProviderInfo(
      { settingsService, config },
      providerManager,
    );
    // Execution would route to Chat Completions for custom URL, so UI
    // must agree — the provider instance base URL wins over settings.
    expect(info.isResponsesAPI).toBe(false);
  });

  it('reports Responses=true when provider.getBaseURL() is canonical (global custom base-url is ignored)', () => {
    const settingsService = new SettingsService();
    settingsService.set('model', 'gpt-5.6');
    // Global ephemeral base-url that disagrees with provider instance
    settingsService.set('base-url', 'https://custom.global.com/v1');

    const providerStub: OpenAIProviderLike = {
      name: 'openai',
      getBaseURL: () => 'https://api.openai.com/v1',
    };
    const providerManager = createProviderManagerStub(providerStub);
    const config = createRuntimeConfigStub(settingsService, {
      getProvider: () => 'openai',
      getProviderManager: () => providerManager,
      getModel: () => 'gpt-5.6',
    });

    const info = getOpenAIProviderInfo(
      { settingsService, config },
      providerManager,
    );
    // Provider instance base URL is canonical → Responses, matching execution
    expect(info.isResponsesAPI).toBe(true);
  });

  it('falls back to settings base-url when provider lacks getBaseURL()', () => {
    const settingsService = new SettingsService();
    settingsService.set('model', 'gpt-5.6');
    settingsService.setProviderSetting(
      'openai',
      'base-url',
      'https://custom.proxy.com/v1',
    );

    const providerStub: OpenAIProviderLike = { name: 'openai' };
    const providerManager = createProviderManagerStub(providerStub);
    const config = createRuntimeConfigStub(settingsService, {
      getProvider: () => 'openai',
      getProviderManager: () => providerManager,
      getModel: () => 'gpt-5.6',
    });

    const info = getOpenAIProviderInfo(
      { settingsService, config },
      providerManager,
    );
    // No getBaseURL on stub → falls back to settings which is custom → false
    expect(info.isResponsesAPI).toBe(false);
  });

  describe('explicit mode overrides (unified transport policy @issue:2483)', () => {
    it('explicit apiMode=responses forces Responses for gpt-5.5 on canonical', () => {
      const settingsService = new SettingsService();
      settingsService.set('model', 'gpt-5.5');
      settingsService.setProviderSetting('openai', 'apiMode', 'responses');

      const providerStub: OpenAIProviderLike = { name: 'openai' };
      const providerManager = createProviderManagerStub(providerStub);
      const config = createRuntimeConfigStub(settingsService, {
        getProvider: () => 'openai',
        getProviderManager: () => providerManager,
        getModel: () => 'gpt-5.5',
      });

      const info = getOpenAIProviderInfo(
        { settingsService, config },
        providerManager,
      );
      expect(info.isResponsesAPI).toBe(true);
    });

    it('explicit apiMode=responses forces Responses for gpt-5.6 on custom endpoint', () => {
      const settingsService = new SettingsService();
      settingsService.set('model', 'gpt-5.6');
      settingsService.setProviderSetting('openai', 'apiMode', 'responses');
      settingsService.setProviderSetting(
        'openai',
        'base-url',
        'https://custom.proxy.com/v1',
      );

      const providerStub: OpenAIProviderLike = { name: 'openai' };
      const providerManager = createProviderManagerStub(providerStub);
      const config = createRuntimeConfigStub(settingsService, {
        getProvider: () => 'openai',
        getProviderManager: () => providerManager,
        getModel: () => 'gpt-5.6',
      });

      const info = getOpenAIProviderInfo(
        { settingsService, config },
        providerManager,
      );
      expect(info.isResponsesAPI).toBe(true);
    });

    it('explicit apiMode=chat keeps gpt-5.5 on Chat Completions', () => {
      const settingsService = new SettingsService();
      settingsService.set('model', 'gpt-5.5');
      settingsService.setProviderSetting('openai', 'apiMode', 'chat');

      const providerStub: OpenAIProviderLike = {
        name: 'openai',
        shouldUseResponses: vi.fn(() => true),
      };
      const providerManager = createProviderManagerStub(providerStub);
      const config = createRuntimeConfigStub(settingsService, {
        getProvider: () => 'openai',
        getProviderManager: () => providerManager,
        getModel: () => 'gpt-5.5',
      });

      const info = getOpenAIProviderInfo(
        { settingsService, config },
        providerManager,
      );
      expect(info.isResponsesAPI).toBe(false);
      // shouldUseResponses should NOT be called when explicit mode is set
      expect(providerStub.shouldUseResponses).not.toHaveBeenCalled();
    });

    it('explicit apiMode=chat CANNOT force gpt-5.6 to Chat on canonical (impossible override ignored)', () => {
      const settingsService = new SettingsService();
      settingsService.set('model', 'gpt-5.6');
      settingsService.setProviderSetting('openai', 'apiMode', 'chat');

      const providerStub: OpenAIProviderLike = { name: 'openai' };
      const providerManager = createProviderManagerStub(providerStub);
      const config = createRuntimeConfigStub(settingsService, {
        getProvider: () => 'openai',
        getProviderManager: () => providerManager,
        getModel: () => 'gpt-5.6',
      });

      const info = getOpenAIProviderInfo(
        { settingsService, config },
        providerManager,
      );
      // GPT-5.6 on canonical requires Responses — Chat override impossible
      expect(info.isResponsesAPI).toBe(true);
    });

    it('global responses-mode=chat is honored as fallback', () => {
      const settingsService = new SettingsService();
      settingsService.set('model', 'gpt-5.5');
      settingsService.set('responses-mode', 'chat');

      const providerStub: OpenAIProviderLike = {
        name: 'openai',
        shouldUseResponses: vi.fn(() => true),
      };
      const providerManager = createProviderManagerStub(providerStub);
      const config = createRuntimeConfigStub(settingsService, {
        getProvider: () => 'openai',
        getProviderManager: () => providerManager,
        getModel: () => 'gpt-5.5',
      });

      const info = getOpenAIProviderInfo(
        { settingsService, config },
        providerManager,
      );
      expect(info.isResponsesAPI).toBe(false);
    });

    it('openaiResponsesEnabled=true forces Responses for gpt-5.6 on custom endpoint', () => {
      const settingsService = new SettingsService();
      settingsService.set('model', 'gpt-5.6');
      settingsService.set('openaiResponsesEnabled', true);
      settingsService.setProviderSetting(
        'openai',
        'base-url',
        'https://custom.proxy.com/v1',
      );

      const providerStub: OpenAIProviderLike = { name: 'openai' };
      const providerManager = createProviderManagerStub(providerStub);
      const config = createRuntimeConfigStub(settingsService, {
        getProvider: () => 'openai',
        getProviderManager: () => providerManager,
        getModel: () => 'gpt-5.6',
      });

      const info = getOpenAIProviderInfo(
        { settingsService, config },
        providerManager,
      );
      expect(info.isResponsesAPI).toBe(true);
    });
  });

  describe('UI and execution agree on effective openaiResponsesEnabled @issue:2483', () => {
    it('uses the effective value reported by the provider instance', () => {
      const settingsService = new SettingsService();
      settingsService.set('model', 'gpt-5.5');
      settingsService.set('openaiResponsesEnabled', true);
      settingsService.setProviderSetting(
        'openai',
        'base-url',
        'https://custom.proxy.com/v1',
      );

      const providerStub: OpenAIProviderLike = {
        name: 'openai',
        getBaseURL: () => 'https://custom.proxy.com/v1',
        getOpenaiResponsesEnabled: () => true,
      };
      const providerManager = createProviderManagerStub(providerStub);
      const config = createRuntimeConfigStub(settingsService, {
        getProvider: () => 'openai',
        getProviderManager: () => providerManager,
        getModel: () => 'gpt-5.5',
      });

      const info = getOpenAIProviderInfo(
        { settingsService, config },
        providerManager,
      );
      expect(info.isResponsesAPI).toBe(true);
    });

    it('falls back to settings openaiResponsesEnabled when provider lacks the method', () => {
      const settingsService = new SettingsService();
      settingsService.set('model', 'gpt-5.5');
      settingsService.set('openaiResponsesEnabled', false);
      settingsService.setProviderSetting(
        'openai',
        'base-url',
        'https://custom.proxy.com/v1',
      );

      const providerStub: OpenAIProviderLike = {
        name: 'openai',
        getBaseURL: () => 'https://custom.proxy.com/v1',
      };
      const providerManager = createProviderManagerStub(providerStub);
      const config = createRuntimeConfigStub(settingsService, {
        getProvider: () => 'openai',
        getProviderManager: () => providerManager,
        getModel: () => 'gpt-5.5',
      });

      const info = getOpenAIProviderInfo(
        { settingsService, config },
        providerManager,
      );
      // No provider method → settings false → Chat Completions
      expect(info.isResponsesAPI).toBe(false);
    });
  });
});
