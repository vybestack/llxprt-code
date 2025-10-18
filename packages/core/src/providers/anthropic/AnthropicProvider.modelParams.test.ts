import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SettingsService,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { AnthropicProvider } from './AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';

describe('AnthropicProvider - modelParams', () => {
  let provider: AnthropicProvider;
  let settingsService: SettingsService;

  beforeEach(() => {
    settingsService = new SettingsService();
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService,
        runtimeId: 'anthropic.modelParams.test',
        metadata: { source: 'AnthropicProvider.modelParams.test.ts' },
      }),
    );

    provider = new AnthropicProvider(
      'test-api-key',
      undefined,
      TEST_PROVIDER_CONFIG,
    );
    provider.setRuntimeSettingsService(settingsService);
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  describe('getModelParams', () => {
    it('returns undefined when no parameters are configured', () => {
      expect(provider.getModelParams()).toBeUndefined();
    });

    it('reads core parameters from SettingsService', () => {
      settingsService.setProviderSetting('anthropic', 'temperature', 0.7);
      settingsService.setProviderSetting('anthropic', 'top_p', 0.9);

      expect(provider.getModelParams()).toEqual({
        temperature: 0.7,
        top_p: 0.9,
      });
    });

    it('includes provider specific parameters alongside standard ones', () => {
      settingsService.setProviderSetting('anthropic', 'temperature', 0.65);
      settingsService.setProviderSetting('anthropic', 'max_tokens', 4096);
      settingsService.setProviderSetting('anthropic', 'stop_sequences', [
        '\n\n',
      ]);

      expect(provider.getModelParams()).toEqual({
        temperature: 0.65,
        max_tokens: 4096,
        stop_sequences: ['\n\n'],
      });
    });

    it('reflects subsequent updates applied to the settings service', () => {
      settingsService.setProviderSetting('anthropic', 'temperature', 0.2);
      expect(provider.getModelParams()).toEqual({ temperature: 0.2 });

      settingsService.setProviderSetting('anthropic', 'temperature', 0.55);
      settingsService.setProviderSetting('anthropic', 'top_p', 0.91);

      expect(provider.getModelParams()).toEqual({
        temperature: 0.55,
        top_p: 0.91,
      });
    });
  });
});
