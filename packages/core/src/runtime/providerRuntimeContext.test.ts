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
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { resetSettingsService } from '@vybestack/llxprt-code-settings';
import type { Config } from '../config/config.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from './providerRuntimeContext.js';

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
  });

  it('core resetSettingsService does NOT clear provider runtime context (P06 single-owner)', () => {
    const injectedSettings = new SettingsService();

    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({ settingsService: injectedSettings }),
    );

    expect(getActiveProviderRuntimeContext().settingsService).toBe(
      injectedSettings,
    );

    // P06 single-owner: settings reset only clears the settings singleton,
    // NOT the provider runtime context. Only settingsRuntimeAdapter bridges both.
    resetSettingsService();

    // Provider runtime context is still active — core reset doesn't touch it
    expect(peekActiveProviderRuntimeContext()).not.toBeNull();
    expect(peekActiveProviderRuntimeContext()?.settingsService).toBe(
      injectedSettings,
    );

    // Explicitly clear runtime context for test isolation
    clearActiveProviderRuntimeContext();
    expect(peekActiveProviderRuntimeContext()).toBeNull();
  });
});
