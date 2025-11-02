/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P03
 * @requirement:REQ-SP-002.1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsService } from '../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  setProviderRuntimeContextFallback,
} from './providerRuntimeContext.js';
import {
  getSettingsService,
  resetSettingsService,
} from '../settings/settingsServiceInstance.js';
import type { Config } from '../config/config.js';

describe('providerRuntimeContext', () => {
  beforeEach(() => {
    resetSettingsService();
    clearActiveProviderRuntimeContext();
    setProviderRuntimeContextFallback(() =>
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'fallback-runtime',
        metadata: { source: 'test-fallback' },
      }),
    );
  });

  it('returns singleton-backed fallback when no active context is registered', () => {
    const fallbackContext = getActiveProviderRuntimeContext();
    const singletonInstance = getSettingsService();

    expect(fallbackContext.settingsService).toBe(singletonInstance);
    expect(peekActiveProviderRuntimeContext()).toBe(fallbackContext);
  });

  it('returns explicitly registered context with injected settings and config', () => {
    const injectedSettings = new SettingsService();
    const mockConfig = {
      getSessionId: () => 'runtime-test',
    } as unknown as Config;

    const context = createProviderRuntimeContext({
      settingsService: injectedSettings,
      config: mockConfig,
      runtimeId: 'injected-runtime',
      metadata: { source: 'unit-test' },
    });

    setActiveProviderRuntimeContext(context);

    const active = getActiveProviderRuntimeContext();
    expect(active).toBe(context);
    expect(active.settingsService).toBe(injectedSettings);
    expect(active.config).toBe(mockConfig);
    expect(getSettingsService()).toBe(injectedSettings);
  });

  it('re-hydrates singleton fallback after reset', () => {
    const injectedSettings = new SettingsService();

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({ settingsService: injectedSettings }),
    );

    expect(getActiveProviderRuntimeContext().settingsService).toBe(
      injectedSettings,
    );
    expect(getSettingsService()).toBe(injectedSettings);

    resetSettingsService();

    const fallbackContext = getActiveProviderRuntimeContext();
    const singletonInstance = getSettingsService();
    expect(fallbackContext.settingsService).toBe(singletonInstance);
    expect(singletonInstance).not.toBe(injectedSettings);
  });
});
