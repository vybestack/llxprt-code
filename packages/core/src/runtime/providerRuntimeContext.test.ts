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
  });

  it('throws when no active context is registered', () => {
    expect(() => getActiveProviderRuntimeContext()).toThrow(
      /MissingProviderRuntimeError\(provider-runtime\)/,
    );
    expect(peekActiveProviderRuntimeContext()).toBeNull();
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

  it('clears the active runtime context when the settings singleton resets', () => {
    const injectedSettings = new SettingsService();

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({ settingsService: injectedSettings }),
    );

    expect(getActiveProviderRuntimeContext().settingsService).toBe(
      injectedSettings,
    );
    expect(getSettingsService()).toBe(injectedSettings);

    resetSettingsService();

    expect(peekActiveProviderRuntimeContext()).toBeNull();
    expect(() => getActiveProviderRuntimeContext()).toThrow(
      /MissingProviderRuntimeError\(provider-runtime\)/,
    );
  });
});
