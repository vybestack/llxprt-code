import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import {
  createProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
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
  let originalContext: ReturnType<
    typeof getActiveProviderRuntimeContext
  > | null;

  beforeEach(() => {
    try {
      originalContext = getActiveProviderRuntimeContext();
    } catch {
      originalContext = null;
    }
  });

  afterEach(() => {
    if (originalContext) {
      setActiveProviderRuntimeContext(originalContext);
    }
  });

  it('derives model and responses mode from SettingsService', () => {
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

    const runtimeContext = createProviderRuntimeContext({
      settingsService,
      config,
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const info = getOpenAIProviderInfo(providerManager);
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

    const runtimeContext = createProviderRuntimeContext({
      settingsService,
      config,
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const info = getOpenAIProviderInfo();
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

    const runtimeContext = createProviderRuntimeContext({
      settingsService,
      config,
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const info = getOpenAIProviderInfo(providerManager);
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

    const runtimeContext = createProviderRuntimeContext({
      settingsService,
      config,
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const info = getOpenAIProviderInfo(providerManager);
    expect(info.provider).not.toBeNull();
    expect(info.conversationCache).toBe(conversationCache);
  });

  it('uses shouldUseResponses to determine responses API mode when no explicit mode is configured', () => {
    const settingsService = new SettingsService();
    settingsService.set('model', 'custom-model');

    const providerStub: OpenAIProviderLike = {
      name: 'openai',
      shouldUseResponses: vi.fn(() => true),
    };
    const providerManager = createProviderManagerStub(providerStub);

    const config = createRuntimeConfigStub(settingsService, {
      getProvider: () => 'openai',
      getProviderManager: () => providerManager,
      getModel: () => 'custom-model',
    });

    const runtimeContext = createProviderRuntimeContext({
      settingsService,
      config,
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const info = getOpenAIProviderInfo(providerManager);
    expect(info.isResponsesAPI).toBe(true);
    expect(providerStub.shouldUseResponses).toHaveBeenCalledWith(
      'custom-model',
    );
  });

  it('routes gpt-5.4-mini to the Responses API by default', () => {
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

    const runtimeContext = createProviderRuntimeContext({
      settingsService,
      config,
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const info = getOpenAIProviderInfo(providerManager);
    expect(info.currentModel).toBe('gpt-5.4-mini');
    expect(info.isResponsesAPI).toBe(true);
  });
});
