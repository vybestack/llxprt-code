/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createUiSessionOwner } from '../../__tests__/uiSessionOwner.js';
import { describe, it, expect } from 'bun:test';
import { ApprovalMode } from '@vybestack/llxprt-code-agents';
import { Config, Logger, MessageSenderType } from '@vybestack/llxprt-code-core';
import {
  buildSlashCommandRuntime,
  buildUiRuntimeFromSource,
  type UiRuntimeBareSource,
} from '../cliUiRuntime.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
    const adapter = buildSlashCommandRuntime(source, createUiSessionOwner());

    expect(adapter).not.toBe(source);
  });

  it('produces a plain object (not a Config subclass instance)', () => {
    const source = createProxySource();
    const adapter = buildSlashCommandRuntime(source, createUiSessionOwner());

    expect(Object.getPrototypeOf(adapter)).toBe(Object.prototype);
  });

  it('delegates method calls through to the source across capability slices', () => {
    const source = createProxySource();
    const owner = createUiSessionOwner();
    const adapter = buildSlashCommandRuntime(source, owner);

    expect((adapter.getSessionId as () => string)()).toBe(
      'delegated:getSessionId',
    );
    expect((adapter.getModel as () => string)()).toBe(owner.getModel());
    expect((adapter.getProvider as () => string)()).toBe(owner.getProvider());
    owner.setApprovalMode(ApprovalMode.YOLO);
    expect(adapter.getApprovalMode()).toBe(ApprovalMode.YOLO);
    adapter.setApprovalMode(ApprovalMode.DEFAULT);
    expect(owner.getApprovalMode()).toBe(ApprovalMode.DEFAULT);
    expect((adapter.getMaxSessionTurns as unknown as () => string)()).toBe(
      'delegated:getMaxSessionTurns',
    );
    expect((adapter.isInteractive as unknown as () => string)()).toBe(
      'delegated:isInteractive',
    );
  });

  it('writes the UI logger in the selected project directory without publishing a storage resource', async () => {
    const config = new Config({
      sessionId: 'ui-paths',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test',
    });
    const owner = createUiSessionOwner(config);
    const adapter = buildSlashCommandRuntime(config, owner);
    const logger = new Logger(adapter.getSessionId(), adapter.projectTempDir);
    try {
      await logger.logMessage(MessageSenderType.USER, 'selected-ui-path');
      expect(
        await readFile(join(config.projectTempDir, 'logs.json'), 'utf8'),
      ).toContain('selected-ui-path');
    } finally {
      await logger.close();
    }
    expect('storage' in adapter).toBe(false);
  });

  it('preserves the extensionEnablementManager property reference', () => {
    const source = createProxySource();
    const adapter = buildSlashCommandRuntime(source, createUiSessionOwner());

    expect(
      (adapter as unknown as Record<string, unknown>)
        .extensionEnablementManager,
    ).toStrictEqual({ id: 'mock-eem' });
  });

  it('does not expose a client factory from workspace capabilities', () => {
    const source = createProxySource();
    const adapter = buildSlashCommandRuntime(source, createUiSessionOwner());

    expect('getAgentClientFactory' in adapter).toBe(false);
  });
});

describe('buildSlashCommandRuntime image authority', () => {
  it('does not publish executable image capability on the flattened configuration runtime', () => {
    const source = createProxySource();
    const adapter = buildSlashCommandRuntime(source, createUiSessionOwner());
    expect('getRunImageOperation' in adapter).toBe(false);
    expect('imageBackendResolver' in adapter).toBe(false);
  });
});

describe('buildUiRuntimeFromSource', () => {
  it('subscribes to the retained MCP facade and does not listen to the application singleton', () => {
    const source = createProxySource();
    const owner = createUiSessionOwner();
    const listeners = new Set<() => void>();
    owner.mcp.subscribeStatus = (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    const runtime = buildUiRuntimeFromSource(source, owner);
    let notifications = 0;
    const unsubscribe = runtime.events.onMcpClientUpdate(() => {
      notifications += 1;
    });

    appEvents.emit(AppEvent.McpClientUpdate, new Map());
    expect(notifications).toBe(0);
    for (const listener of listeners) listener();
    unsubscribe();
    appEvents.emit(AppEvent.McpClientUpdate, new Map());

    for (const listener of listeners) listener();
    expect(notifications).toBe(1);
  });
});
