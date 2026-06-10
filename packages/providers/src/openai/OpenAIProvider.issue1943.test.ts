/**
 * @issue #1943 - OpenAI providers ignore explicit toolFormat override for kimi model names
 *
 * Behavioral tests for OpenAIProvider.getToolFormat() honoring provider
 * toolFormat overrides from SettingsService before falling back to model-name
 * auto-detection.
 *
 * These tests verify that:
 * 1. When a toolFormat override is set (e.g. 'openai'), it is used even for kimi models
 * 2. When override is 'auto' or absent, auto-detection based on model name kicks in
 * 3. The provider name is correctly used for override lookup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import {
  SettingsService,
  registerSettingsService,
  resetSettingsService,
} from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

function createTestConfig(settingsService: SettingsService): Config {
  const noop = () => {};
  return {
    getSettingsService: () => settingsService,
    getEphemeralSettings: () => ({}),
    getEphemeralSetting: () => undefined,
    setEphemeralSetting: noop,
    getModel: () => 'gpt-4o',
    setModel: noop,
    getConversationLoggingEnabled: () => false,
    setConversationLoggingEnabled: noop,
    getTelemetryLogPromptsEnabled: () => false,
    setTelemetryLogPromptsEnabled: noop,
    getUsageStatisticsEnabled: () => false,
    setUsageStatisticsEnabled: noop,
    getDebugMode: () => false,
    setDebugMode: noop,
    isInteractive: () => false,
    getSessionId: () => 'test-session',
    setSessionId: noop,
    getFlashFallbackMode: () => 'off',
    setFlashFallbackMode: noop,
    getProvider: () => 'openai',
    setProvider: noop,
    getProviderSettings: () => ({}),
    setProviderSettings: noop,
    getProviderConfig: () => ({}),
    setProviderConfig: noop,
    resetProvider: noop,
    resetProviderSettings: noop,
    resetProviderConfig: noop,
    getActiveWorkspace: () => undefined,
    setActiveWorkspace: noop,
    clearActiveWorkspace: noop,
    getExtensionConfig: () => ({}),
    setExtensionConfig: noop,
    getFeatures: () => ({}),
    setFeatures: noop,
    setProviderManager: noop,
    getProviderManager: () => undefined,
    getProviderSetting: () => undefined,
    getUserMemory: () => '',
    getJitMemoryForPath: () => Promise.resolve(''),
    setUserMemory: noop,
    getQuotaErrorOccurred: () => false,
    setQuotaErrorOccurred: noop,
    getLlxprtMdFilePaths: () => [],
    getLlxprtMdFileCount: () => 0,
    getCoreMemoryFileCount: () => 0,
  } as unknown as Config;
}

describe('OpenAIProvider.getToolFormat() - override vs auto-detection (issue #1943)', () => {
  let settingsService: SettingsService;
  let runtime: ProviderRuntimeContext;

  beforeEach(() => {
    settingsService = new SettingsService();
    const config = createTestConfig(settingsService);
    runtime = createProviderRuntimeContext({
      settingsService,
      config,
      runtimeId: 'test.openai.runtime',
      metadata: { source: 'test' },
    });
    setActiveProviderRuntimeContext(runtime);
    registerSettingsService(settingsService);
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    resetSettingsService();
  });

  it('returns "openai" override for a kimi model when provider toolFormat is set to "openai"', () => {
    settingsService.setProviderSetting('openai', 'toolFormat', 'openai');
    const provider = new OpenAIProvider('test-key');
    vi.spyOn(provider, 'getModel').mockReturnValue('moonshot-v1-kimi-k2');

    expect(provider.getToolFormat()).toBe('openai');
  });

  it('auto-detects "kimi" format when provider toolFormat is "auto"', () => {
    settingsService.setProviderSetting('openai', 'toolFormat', 'auto');
    const provider = new OpenAIProvider('test-key');
    vi.spyOn(provider, 'getModel').mockReturnValue('moonshot-v1-kimi-k2');

    expect(provider.getToolFormat()).toBe('kimi');
  });

  it('auto-detects "kimi" format when no toolFormat override is set', () => {
    const provider = new OpenAIProvider('test-key');
    vi.spyOn(provider, 'getModel').mockReturnValue('moonshot-v1-kimi-k2');

    expect(provider.getToolFormat()).toBe('kimi');
  });

  it('auto-detects "mistral" format for mistral model when no override is set', () => {
    const provider = new OpenAIProvider('test-key');
    vi.spyOn(provider, 'getModel').mockReturnValue('mistral-large-latest');

    expect(provider.getToolFormat()).toBe('mistral');
  });

  it('returns explicit "kimi" override even for a standard openai model', () => {
    settingsService.setProviderSetting('openai', 'toolFormat', 'kimi');
    const provider = new OpenAIProvider('test-key');
    vi.spyOn(provider, 'getModel').mockReturnValue('gpt-4o');

    expect(provider.getToolFormat()).toBe('kimi');
  });

  it('returns "openai" by default for standard models', () => {
    const provider = new OpenAIProvider('test-key');
    vi.spyOn(provider, 'getModel').mockReturnValue('gpt-4o');

    expect(provider.getToolFormat()).toBe('openai');
  });

  it('returns "qwen" for GLM models by auto-detection', () => {
    const provider = new OpenAIProvider('test-key');
    vi.spyOn(provider, 'getModel').mockReturnValue('openai:hf:zai-org/GLM-4.6');

    expect(provider.getToolFormat()).toBe('qwen');
  });

  it('returns "openai" for GLM models when override is set to "openai"', () => {
    settingsService.setProviderSetting('openai', 'toolFormat', 'openai');
    const provider = new OpenAIProvider('test-key');
    vi.spyOn(provider, 'getModel').mockReturnValue('openai:hf:zai-org/GLM-4.6');

    expect(provider.getToolFormat()).toBe('openai');
  });
});
