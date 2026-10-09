/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2616 PR A: providerRuntimeContext is explicit-only.
 *
 * The module must construct contexts solely from the init the caller
 * supplies. The former ambient surface (module-level activeContext
 * pointer, set/clear/peek/get accessors, and the defaultRuntimeStateFactory
 * fallback) is deleted — importing the module registers no factory and
 * mutates no module state.
 */

import { describe, it, expect } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Config } from '../config/config.js';
import { createProviderRuntimeContext } from './providerRuntimeContext.js';

describe('createProviderRuntimeContext', () => {
  it('builds a context from explicitly injected settings and config', () => {
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

    expect(context.settingsService).toBe(injectedSettings);
    expect(context.config).toBe(mockConfig);
    expect(context.runtimeId).toBe('injected-runtime');
    expect(context.metadata).toStrictEqual({ source: 'unit-test' });
  });

  it('throws MissingRuntimeProviderError when settingsService is absent', () => {
    expect(() => createProviderRuntimeContext({})).toThrow(
      /MissingProviderRuntimeError\(provider-runtime\)/,
    );
    expect(() => createProviderRuntimeContext()).toThrow(
      /MissingProviderRuntimeError.*requires settings/,
    );
  });

  it('carries the optional carrier fields it is given', () => {
    const settings = new SettingsService();
    const context = createProviderRuntimeContext({
      settingsService: settings,
      runtimeId: 'carrier-fields',
      requestMediaBudgetBytes: 1024,
    });

    expect(context.requestMediaBudgetBytes).toBe(1024);
  });

  it('exposes no ambient surface on the module namespace', async () => {
    const mod = await import('./providerRuntimeContext.js');

    const deletedSymbols = [
      'setActiveProviderRuntimeContext',
      'clearActiveProviderRuntimeContext',
      'peekActiveProviderRuntimeContext',
      'getActiveProviderRuntimeContext',
      'setProviderRuntimeStateFactory',
    ];

    for (const symbol of deletedSymbols) {
      expect(symbol in mod).toBe(false);
    }

    // The surviving factory is null by construction: creating a context
    // without settings fails even after the module (and any import-time
    // side effects it may once have had) has fully loaded.
    expect(() => createProviderRuntimeContext({})).toThrow(
      /MissingProviderRuntimeError/,
    );
  });

  it('keeps the constructed context untouched by later context creations', () => {
    const first = createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: 'first',
    });
    const second = createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: 'second',
    });

    expect(first.runtimeId).toBe('first');
    expect(second.runtimeId).toBe('second');
    expect(first.settingsService).not.toBe(second.settingsService);
  });
});
