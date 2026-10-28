/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createUiSessionOwner } from '../../__tests__/uiSessionOwner.js';
import { describe, it, expect } from 'bun:test';
import { ApprovalMode } from '@vybestack/llxprt-code-agents';
import { Config, Logger, MessageSenderType } from '@vybestack/llxprt-code-core';
import { buildUiRuntimeFromSource } from '../../__tests__/ui-runtime-composition-fixture.js';
import type { UiRuntimeBareSource } from '../cliUiRuntime.js';
import { buildUiPortsForTest } from '../../__tests__/slash-command-runtime-fixture.js';
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

describe('the interactive command ports', () => {
  it('builds the ports from the runtime instead of returning it', async () => {
    const source = createProxySource();
    const ports = buildUiPortsForTest(source, await createUiSessionOwner());

    for (const port of Object.values(ports)) {
      expect(port).not.toBe(source);
    }
  });

  it('produces plain objects (not a Config subclass instance)', async () => {
    const source = createProxySource();
    const ports = buildUiPortsForTest(source, await createUiSessionOwner());

    for (const port of Object.values(ports)) {
      expect(Object.getPrototypeOf(port)).toBe(Object.prototype);
    }
  });

  it('delegates each read through to the source it was built from', async () => {
    const source = createProxySource();
    const owner = await createUiSessionOwner();
    const ports = buildUiPortsForTest(source, owner);

    expect(
      (ports.commandRegistry.getEnableHooksUI as unknown as () => string)(),
    ).toBe('delegated:getEnableHooksUI');
    expect(ports.fileCommands.getTargetDir()).toBe('delegated:getTargetDir');
    expect(ports.chatCommands.getProjectRoot()).toBe(
      'delegated:getProjectRoot',
    );
    expect(ports.containerRuntime.getModel()).toBe(owner.getModel());
    expect(ports.slashCommandPorts.about?.getProvider()).toBe(
      owner.getProvider(),
    );
    owner.setApprovalMode(ApprovalMode.YOLO);
    expect(ports.approval.getApprovalMode()).toBe(ApprovalMode.YOLO);
  });

  it('writes the UI logger in the selected project directory without publishing a storage resource', async () => {
    const config = new Config({
      sessionId: 'ui-paths',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test',
    });
    const owner = await createUiSessionOwner(config);
    const ports = buildUiPortsForTest(config, owner);
    const logger = new Logger(
      ports.browserSession.getSessionId(),
      ports.chatCommands.projectTempDir,
    );
    try {
      await logger.logMessage(MessageSenderType.USER, 'selected-ui-path');
      expect(
        await readFile(join(config.projectTempDir, 'logs.json'), 'utf8'),
      ).toContain('selected-ui-path');
    } finally {
      await logger.close();
    }
    for (const port of Object.values(ports)) {
      expect('storage' in port).toBe(false);
    }
  });

  it('preserves the extensionEnablementManager property reference', async () => {
    const source = createProxySource();
    const ports = buildUiPortsForTest(source, await createUiSessionOwner());

    expect(
      ports.commandRegistry.extensionEnablementManager as unknown,
    ).toStrictEqual({ id: 'mock-eem' });
  });

  it('does not expose a client factory from the workspace reads', async () => {
    const source = createProxySource();
    const ports = buildUiPortsForTest(source, await createUiSessionOwner());

    for (const port of Object.values(ports)) {
      expect('getAgentClientFactory' in port).toBe(false);
    }
  });
});

describe('the interactive command ports image authority', () => {
  it('does not publish executable image capability on any port', async () => {
    const source = createProxySource();
    const ports = buildUiPortsForTest(source, await createUiSessionOwner());
    for (const port of Object.values(ports)) {
      expect('getRunImageOperation' in port).toBe(false);
      expect('imageBackendResolver' in port).toBe(false);
    }
  });
});

describe('buildUiRuntimeFromSource', () => {
  it('subscribes to the retained MCP facade and does not listen to the application singleton', async () => {
    const source = createProxySource();
    const owner = await createUiSessionOwner();
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
