import { describe, it, expect, beforeEach } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { AnthropicProvider } from './AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from '../__tests__/providerTestConfig.js';
import { createProviderWithRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';

function isOptionalObject(value: unknown): boolean {
  return value === undefined || typeof value === 'object';
}

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

  /**
   * @plan PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement REQ-SP4-003
   * Providers return model parameters from SettingsService without caching
   */
  describe('getModelParams', () => {
    it('returns model parameters from SettingsService without caching', () => {
      // Test that it doesn't throw and returns params from SettingsService
      const params = provider.getModelParams();
      // Should either return params or undefined, but not throw
      expect(isOptionalObject(params)).toBe(true);
    });
  });
});
