/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  buildSlashCommandRuntime,
  buildUiRuntimeFromSource,
  type UiRuntimeBareSource,
} from '../cliUiRuntime.js';
import { AppEvent, appEvents } from '../../utils/events.js';

/**
 * Creates a Proxy-based mock that satisfies the UiRuntimeBareSource structural
 * type. Every method returns a sentinel string so we can verify delegation.
 */
function createProxySource(
  overrides: Record<string, unknown> = {},
): UiRuntimeBareSource {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string | symbol) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in overrides) return overrides[prop];
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

  it('delegates method calls through to the source across capability slices', () => {
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
    expect((adapter.getMaxSessionTurns as unknown as () => string)()).toBe(
      'delegated:getMaxSessionTurns',
    );
    expect((adapter.isInteractive as unknown as () => string)()).toBe(
      'delegated:isInteractive',
    );
  });

  it('preserves the storage property reference', () => {
    const source = createProxySource();
    const adapter = buildSlashCommandRuntime(source);

    expect(
      (adapter as unknown as Record<string, unknown>).storage,
    ).toStrictEqual({
      id: 'mock-storage',
    });
  });

  it('preserves the extensionEnablementManager property reference', () => {
    const source = createProxySource();
    const adapter = buildSlashCommandRuntime(source);

    expect(
      (adapter as unknown as Record<string, unknown>)
        .extensionEnablementManager,
    ).toStrictEqual({ id: 'mock-eem' });
  });

  it('supports absent optional agent-client factory helpers', () => {
    const source = createProxySource({ getAgentClientFactory: undefined });
    const adapter = buildSlashCommandRuntime(source);

    expect(adapter.getAgentClientFactory?.()).toBeUndefined();
  });
});

describe('buildSlashCommandRuntime image capability', () => {
  /**
   * `/image` reaches the runner through `config.getRunImageOperation()` on the
   * FLATTENED slash-command runtime. The flattening spreads
   * `Object.values(capabilities)`, so a capability exposed as a bare function
   * rather than inside a slice object contributes no own enumerable properties
   * and disappears silently — the command then reports "no image backend
   * configured" even when one is wired.
   */
  it('forwards getRunImageOperation through the flattened runtime', () => {
    const runner = () =>
      Promise.resolve({ absoluteOutputPath: '/tmp/out.png' });
    const source = createProxySource({
      getRunImageOperation: () => runner,
    });

    const adapter = buildSlashCommandRuntime(source);

    expect(typeof adapter.getRunImageOperation).toBe('function');
    expect(adapter.getRunImageOperation?.()).toBe(runner);
  });

  it('omits getRunImageOperation when the source does not expose it', () => {
    const source = createProxySource({ getRunImageOperation: undefined });
    const adapter = buildSlashCommandRuntime(source);

    expect(adapter.getRunImageOperation).toBeUndefined();
  });
});

describe('buildUiRuntimeFromSource', () => {
  it('uses the application event singleton when the source has no emitter', () => {
    const source = createProxySource({
      getExtensionEvents: () => undefined,
    });
    const runtime = buildUiRuntimeFromSource(source);
    let notifications = 0;
    const unsubscribe = runtime.events.onMcpClientUpdate(() => {
      notifications += 1;
    });

    appEvents.emit(AppEvent.McpClientUpdate, new Map());
    unsubscribe();
    appEvents.emit(AppEvent.McpClientUpdate, new Map());

    expect(notifications).toBe(1);
  });
});
