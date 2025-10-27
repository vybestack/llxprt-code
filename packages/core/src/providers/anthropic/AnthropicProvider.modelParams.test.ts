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

  /**
   * @plan PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement REQ-SP4-002
   * @project-plans/20251023stateless4/analysis/pseudocode/provider-cache-elimination.md lines 12-13
   * Providers must throw when attempting to memoize model parameters
   */
  describe('getModelParams', () => {
    it('throws ProviderCacheError when attempting to access memoized model parameters', () => {
      expect(() => provider.getModelParams()).toThrow(
        'ProviderCacheError("Attempted to memoize model parameters for anthropic")',
      );
    });
  });
});
