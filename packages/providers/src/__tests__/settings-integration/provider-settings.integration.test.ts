/**
 * @plan PLAN-20260608-ISSUE1588.P07
 * @requirement REQ-TEST-001.2
 *
 * Provider vertical-slice integration test — TDD red phase.
 *
 * Production entrypoint exercised:
 *   BaseProvider constructor → calls getSettingsService() from
 *   @vybestack/llxprt-code-settings
 *   BaseProvider.getModel() → calls resolveSettingsService() → reads model from SettingsService
 *   BaseProvider.getBaseURL() → calls resolveSettingsService() → reads base-url from SettingsService
 *
 * The test registers a sentinel SettingsService using registerSettingsService()
 * from @vybestack/llxprt-code-settings, then exercises the real BaseProvider
 * constructor and getModel/getBaseURL paths. Because BaseProvider still imports
 * getSettingsService from @vybestack/llxprt-code-core (not from settings package),
 * the sentinel registered in the settings-package singleton is NOT visible to
 * BaseProvider's core import. This causes a behavioral failure: BaseProvider
 * creates its own fallback SettingsService instead of reading the sentinel.
 *
 * After P08 migration (BaseProvider imports getSettingsService from settings package),
 * both singletons converge and this test should pass.
 *
 * No old core ProviderRuntimeContext singleton is set up — this test uses
 * settings-only sentinel mechanism.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Settings-package imports — the intended post-migration source
import {
  SettingsService,
  registerSettingsService,
  resetSettingsService,
  getSettingsService as getSettingsServiceFromPkg,
} from '@vybestack/llxprt-code-settings';

import { BaseProvider } from '../../BaseProvider.js';
import type { BaseProviderConfig } from '../../BaseProvider.js';

/**
 * Minimal concrete provider for testing BaseProvider settings behavior.
 */
class TestProvider extends BaseProvider {
  constructor(config?: Partial<BaseProviderConfig>) {
    super(
      {
        name: 'test-provider',
        apiKey: 'test-api-key',
        ...config,
      },
      undefined,
      undefined,
      undefined, // No settingsService passed — forces fallback to getSettingsService()
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

describe('Provider vertical-slice — settings-package sentinel integration', () => {
  beforeEach(() => {
    resetSettingsService();
  });

  it('fails: BaseProvider reads model from settings-package sentinel when registered', () => {
    // Arrange: register a sentinel SettingsService with a known model value
    const sentinel = new SettingsService();
    sentinel.set('model', 'sentinel-model-value');
    registerSettingsService(sentinel);

    // Assert the settings-package singleton actually holds the sentinel
    const pkgService = getSettingsServiceFromPkg();
    expect(pkgService).toBe(sentinel);
    expect(pkgService.get('model')).toBe('sentinel-model-value');

    // Act: construct a TestProvider — BaseProvider constructor calls
    // getSettingsService() from @vybestack/llxprt-code-core (line 132)
    // Production entrypoint: BaseProvider constructor → getSettingsService()
    const provider = new TestProvider();

    // Read model — Production entrypoint: BaseProvider.getModel() → resolveSettingsService()
    // → SettingsService.get('model')
    const model = provider.getModel();

    // RED PHASE ASSERTION: After P08 migration, model should be 'sentinel-model-value'
    // because BaseProvider will import getSettingsService from the settings package,
    // making the registered sentinel visible.
    //
    // Before P08: BaseProvider imports getSettingsService from core, which has its
    // own separate singleton. The core singleton was reset, so BaseProvider falls back
    // to creating a new SettingsService (line 134) → model is 'test-default-model'.
    // This is the expected behavioral failure in TDD red phase.
    expect(model).toBe('sentinel-model-value');
  });

  it('fails: BaseProvider reads base-url from settings-package sentinel when registered', () => {
    // Arrange: register a sentinel with a known base-url
    const sentinel = new SettingsService();
    sentinel.set('base-url', 'https://sentinel.example.com/api');
    registerSettingsService(sentinel);

    // Assert the settings-package singleton holds the sentinel
    const pkgService = getSettingsServiceFromPkg();
    expect(pkgService).toBe(sentinel);
    expect(pkgService.get('base-url')).toBe('https://sentinel.example.com/api');

    // Act: construct TestProvider
    const provider = new TestProvider();

    // Read baseURL — Production entrypoint: BaseProvider.getBaseURL() → resolveSettingsService()
    // → SettingsService.get('base-url')
    const baseURL = provider.getBaseURL();

    // RED PHASE ASSERTION: After P08 migration, baseURL should be the sentinel value.
    // Before P08: core/settings-package singletons are separate → BaseProvider's
    // fallback SettingsService has no base-url → returns undefined.
    expect(baseURL).toBe('https://sentinel.example.com/api');
  });

  it('fails: BaseProvider reads provider-specific model from settings-package sentinel', () => {
    // Arrange: register sentinel with provider-specific settings
    const sentinel = new SettingsService();
    sentinel.set('providers.test-provider.model', 'provider-specific-model');
    registerSettingsService(sentinel);

    // Assert sentinel state
    const pkgService = getSettingsServiceFromPkg();
    expect(pkgService).toBe(sentinel);

    // Act
    const provider = new TestProvider();
    const model = provider.getModel();

    // RED PHASE: After P08, provider should see provider-specific model from sentinel.
    // Before P08: singletons diverge → fallback SettingsService → 'test-default-model'.
    expect(model).toBe('provider-specific-model');
  });
});
