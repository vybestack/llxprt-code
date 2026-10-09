/**
 * @plan PLAN-20260608-ISSUE1588.P07
 * @requirement REQ-TEST-001.2
 *
 * Provider vertical-slice integration test.
 *
 * Production entrypoint exercised:
 *   BaseProvider constructor → stores the explicitly injected SettingsService
 *   BaseProvider.getModel() → resolveSettingsService() → reads model from that service
 *   BaseProvider.getBaseURL() → resolveSettingsService() → reads base-url from that service
 *
 * Issue #2616: there is no process-wide settings singleton to register into.
 * The sentinel SettingsService is constructed here and handed to the
 * BaseProvider constructor explicitly; the assertions prove the provider
 * reads model/base-url from the very instance it was given.
 */

import { describe, it, expect } from 'bun:test';

import { SettingsService } from '@vybestack/llxprt-code-settings';

import { BaseProvider } from '../../BaseProvider.js';
import type { BaseProviderConfig } from '../../BaseProvider.js';

/**
 * Minimal concrete provider for testing BaseProvider settings behavior.
 */
class TestProvider extends BaseProvider {
  constructor(
    config?: Partial<BaseProviderConfig>,
    settingsService?: SettingsService,
  ) {
    super(
      {
        name: 'test-provider',
        apiKey: 'test-api-key',
        ...config,
      },
      undefined,
      undefined,
      settingsService,
    );
  }

  protected override getDefaultModel(): string {
    return 'test-default-model';
  }

  protected override supportsOAuth(): boolean {
    return false;
  }

  // Expose protected methods for testing
  override getModel(): string {
    return super.getModel();
  }

  override getBaseURL(): string | undefined {
    return super.getBaseURL();
  }
}

describe('Provider vertical-slice — explicit settings service integration', () => {
  it('reads model from the injected sentinel SettingsService', () => {
    // Arrange: a sentinel SettingsService with a known model value
    const sentinel = new SettingsService();
    sentinel.set('model', 'sentinel-model-value');

    // Act: construct the provider with the sentinel injected explicitly
    const provider = new TestProvider(undefined, sentinel);

    // Production entrypoint: BaseProvider.getModel() → resolveSettingsService()
    // → sentinel.get('model')
    const model = provider.getModel();

    expect(model).toBe('sentinel-model-value');
  });

  it('reads base-url from the injected sentinel SettingsService', () => {
    // Arrange: a sentinel with a known base-url
    const sentinel = new SettingsService();
    sentinel.set('base-url', 'https://sentinel.example.com/api');

    // Act: construct the provider with the sentinel injected explicitly
    const provider = new TestProvider(undefined, sentinel);

    // Production entrypoint: BaseProvider.getBaseURL() → resolveSettingsService()
    // → sentinel.get('base-url')
    const baseURL = provider.getBaseURL();

    expect(baseURL).toBe('https://sentinel.example.com/api');
  });

  it('reads provider-specific model from the injected sentinel SettingsService', () => {
    // Arrange: sentinel with provider-specific settings
    const sentinel = new SettingsService();
    sentinel.set('providers.test-provider.model', 'provider-specific-model');

    // Act
    const provider = new TestProvider(undefined, sentinel);
    const model = provider.getModel();

    expect(model).toBe('provider-specific-model');
  });
});
