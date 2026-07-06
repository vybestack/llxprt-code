/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  buildSlashCommandRuntime,
  type UiRuntimeBareSource,
} from '../cliUiRuntime.js';

/**
 * Creates a Proxy-based mock that satisfies the UiRuntimeBareSource structural
 * type. Every method returns a sentinel string so we can verify delegation.
 */
function createProxySource(): UiRuntimeBareSource {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string | symbol) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'storage') return { id: 'mock-storage' };
      if (prop === 'extensionEnablementManager')
        return {
          id: 'mock-eem',
        };
      return () => `delegated:${String(prop)}`;
    },
  }) as unknown as UiRuntimeBareSource;
}

describe('buildSlashCommandRuntime', () => {
  it('breaks identity: the adapter is not the same object as the source', () => {
    const source = createProxySource();
    const adapter = buildSlashCommandRuntime(source);

    expect(adapter).not.toBe(source);
  });

  it('produces a plain object (not a Config subclass instance)', () => {
    const source = createProxySource();
    const adapter = buildSlashCommandRuntime(source);

    expect(Object.getPrototypeOf(adapter)).toBe(Object.prototype);
  });

  it('delegates method calls through to the source', () => {
    const source = createProxySource();
    const adapter = buildSlashCommandRuntime(source);

    expect((adapter.getSessionId as () => string)()).toBe(
      'delegated:getSessionId',
    );
    expect((adapter.getModel as () => string)()).toBe('delegated:getModel');
    expect((adapter.getProvider as () => string)()).toBe(
      'delegated:getProvider',
    );
    expect((adapter.getApprovalMode as () => string)()).toBe(
      'delegated:getApprovalMode',
    );
  });

  it('preserves the storage property reference', () => {
    const source = createProxySource();
    const adapter = buildSlashCommandRuntime(source);

    expect((adapter as unknown as Record<string, unknown>).storage).toStrictEqual({
      id: 'mock-storage',
    });
  });
});
