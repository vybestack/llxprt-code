import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-core';
import { AnthropicProvider } from './AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { createProviderWithRuntime } from '../../test-utils/runtime.js';

describe('AnthropicProvider - modelParams', () => {
  let provider: AnthropicProvider;
  let settingsService: SettingsService;

  beforeEach(() => {
    settingsService = new SettingsService();
    ({ provider } = createProviderWithRuntime<AnthropicProvider>(
      () =>
        new AnthropicProvider('test-api-key', undefined, TEST_PROVIDER_CONFIG),
      {
        settingsService,
        runtimeId: 'anthropic.modelParams.test',
        metadata: { source: 'AnthropicProvider.modelParams.test.ts' },
      },
    ));
    provider.setRuntimeSettingsService(settingsService);
  });

  describe('getModelParams', () => {
    it('returns undefined when no parameters are configured', () => {
      expect(provider.getModelParams()).toBeUndefined();
    });

    it('reads core parameters from SettingsService', () => {
      const service = (
        provider as unknown as {
          resolveSettingsService: () => SettingsService;
        }
      ).resolveSettingsService();
      service.setProviderSetting('anthropic', 'temperature', 0.7);
      service.setProviderSetting('anthropic', 'top_p', 0.9);

      expect(provider.getModelParams()).toMatchObject({
        temperature: 0.7,
        top_p: 0.9,
      });
    });

    it('includes provider specific parameters alongside standard ones', () => {
      const service = (
        provider as unknown as {
          resolveSettingsService: () => SettingsService;
        }
      ).resolveSettingsService();
      service.setProviderSetting('anthropic', 'temperature', 0.65);
      service.setProviderSetting('anthropic', 'max_tokens', 4096);
      service.setProviderSetting('anthropic', 'stop_sequences', ['\n\n']);

      expect(provider.getModelParams()).toMatchObject({
        temperature: 0.65,
        max_tokens: 4096,
        stop_sequences: ['\n\n'],
      });
    });

    it('reflects subsequent updates applied to the settings service', () => {
      const service = (
        provider as unknown as {
          resolveSettingsService: () => SettingsService;
        }
      ).resolveSettingsService();
      service.setProviderSetting('anthropic', 'temperature', 0.2);
      expect(provider.getModelParams()).toMatchObject({ temperature: 0.2 });

      service.setProviderSetting('anthropic', 'temperature', 0.55);
      service.setProviderSetting('anthropic', 'top_p', 0.91);

      expect(provider.getModelParams()).toMatchObject({
        temperature: 0.55,
        top_p: 0.91,
      });
    });
  });
});
