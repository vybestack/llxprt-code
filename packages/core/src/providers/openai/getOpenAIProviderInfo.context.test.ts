import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../settings/SettingsService.js';
import {
  createProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';
import { getOpenAIProviderInfo } from './getOpenAIProviderInfo.js';
import type { ProviderManager } from '../ProviderManager.js';

const createProviderManagerStub = (provider: unknown): ProviderManager =>
  ({
    hasActiveProvider: () => true,
    getActiveProviderName: () => 'openai',
    getActiveProvider: () => provider,
  }) as unknown as ProviderManager;

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

    const providerStub = {
      name: 'openai',
      getConversationCache: vi.fn(() => ({ id: 'cache' })),
      shouldUseResponses: vi.fn(() => false),
    };
    const providerManager = createProviderManagerStub(providerStub);

    const configStub = {
      getProvider: () => 'openai',
      getProviderManager: () => providerManager,
      getModel: () => 'config-model',
    } as unknown as {
      getProvider(): string;
      getProviderManager(): ProviderManager;
      getModel(): string;
    };

    const runtimeContext = createProviderRuntimeContext({
      settingsService,
      config: configStub,
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const info = getOpenAIProviderInfo(providerManager);
    expect(info.currentModel).toBe('settings-model');
    expect(info.isResponsesAPI).toBe(true);
    expect(info.conversationCache).toEqual({ id: 'cache' });
    expect(providerStub.shouldUseResponses).not.toHaveBeenCalled();
  });

  it('falls back to runtime config when SettingsService lacks model', () => {
    const settingsService = new SettingsService();
    const providerManager = null;
    const configStub = {
      getProvider: () => 'openai',
      getProviderManager: () => providerManager,
      getModel: () => 'config-model',
    } as unknown as {
      getProvider(): string;
      getProviderManager(): null;
      getModel(): string;
    };

    const runtimeContext = createProviderRuntimeContext({
      settingsService,
      config: configStub,
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const info = getOpenAIProviderInfo();
    expect(info.currentModel).toBe('config-model');
    expect(info.provider).toBeNull();
  });

  it('returns default info when active provider is not OpenAI', () => {
    const settingsService = new SettingsService();
    const providerManager = {
      hasActiveProvider: () => true,
      getActiveProviderName: () => 'anthropic',
    } as unknown as ProviderManager;

    const configStub = {
      getProvider: () => 'anthropic',
      getProviderManager: () => providerManager,
    } as unknown as {
      getProvider(): string;
      getProviderManager(): ProviderManager;
    };

    const runtimeContext = createProviderRuntimeContext({
      settingsService,
      config: configStub,
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const info = getOpenAIProviderInfo(providerManager);
    expect(info.currentModel).toBeNull();
    expect(info.provider).toBeNull();
    expect(info.isResponsesAPI).toBe(false);
  });
});
