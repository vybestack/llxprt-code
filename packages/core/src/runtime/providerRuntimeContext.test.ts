/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type { Config } from '../config/config.js';
import { createProviderRuntimeContext } from './providerRuntimeContext.js';

describe('createProviderRuntimeContext', () => {
  it('builds a context from explicitly injected config and identity', () => {
    const mockConfig = {
      getSessionId: () => 'runtime-test',
    } as unknown as Config;
    const context = createProviderRuntimeContext({
      config: mockConfig,
      runtimeId: 'injected-runtime',
      metadata: { source: 'unit-test' },
    });

    expect(context.config).toBe(mockConfig);
    expect(context.runtimeId).toBe('injected-runtime');
    expect(context.metadata).toStrictEqual({ source: 'unit-test' });
    expect('settingsService' in context).toBe(false);
  });

  it('constructs contexts without a settings service', () => {
    expect(createProviderRuntimeContext({}).runtimeId).toBeUndefined();
    expect(createProviderRuntimeContext().runtimeId).toBeUndefined();
    expect('settingsService' in createProviderRuntimeContext()).toBe(false);
  });

  it('does not publish media or file services through the runtime context', () => {
    const context = createProviderRuntimeContext({ runtimeId: 'request-data' });
    expect('mediaResolver' in context).toBe(false);
    expect('requestMediaBudgetBytes' in context).toBe(false);
    expect('providerFileBindings' in context).toBe(false);
    expect('providerFileLifecycle' in context).toBe(false);
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
    expect('settingsService' in mod.createProviderRuntimeContext({})).toBe(
      false,
    );
  });

  it('keeps the constructed context untouched by later context creations', () => {
    const first = createProviderRuntimeContext({ runtimeId: 'first' });
    const second = createProviderRuntimeContext({ runtimeId: 'second' });
    expect(first.runtimeId).toBe('first');
    expect(second.runtimeId).toBe('second');
    expect(first).not.toBe(second);
  });
});
