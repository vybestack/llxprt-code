/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ExtensionAutoUpdater,
  type ExtensionAutoUpdateSettings,
  type ExtensionAutoUpdateStateStore,
  type ExtensionUpdateHistoryEntry,
} from './extensionAutoUpdater.js';
import { ExtensionUpdateState } from '../ui/state/extensions.js';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';

function createExtension(name: string): GeminiCLIExtension {
  return {
    name,
    version: '1.0.0',
    path: `/tmp/${name}`,
    contextFiles: [],
    installMetadata: {
      source: `https://example.com/${name}.git`,
      type: 'git',
    },
    isActive: true,
  };
}

function createMemoryStateStore(
  initial: Record<string, ExtensionUpdateHistoryEntry> = {},
) {
  let state: Record<string, ExtensionUpdateHistoryEntry> = { ...initial };
  const baseStore: ExtensionAutoUpdateStateStore = {
    read: vi.fn(async () => state),
    write: vi.fn(async (next: Record<string, ExtensionUpdateHistoryEntry>) => {
      state = JSON.parse(JSON.stringify(next));
    }),
  };
  return {
    ...baseStore,
    snapshot: () => state,
  };
}

function createUpdaterOptions(
  overrides: Partial<ExtensionAutoUpdateSettings> = {},
) {
  return {
    settings: { enabled: true, ...overrides },
  };
}

describe('ExtensionAutoUpdater', () => {
  it('skips checks when disabled', async () => {
    const loader = vi.fn();
    const checker = vi.fn();
    const store = createMemoryStateStore();
    const updater = new ExtensionAutoUpdater({
      ...createUpdaterOptions({ enabled: false }),
      extensionLoader: loader,
      updateChecker: checker,
      stateStore: store,
    });

    await updater.checkNow();

    expect(loader).not.toHaveBeenCalled();
    expect(checker).not.toHaveBeenCalled();
    expect(store.read).not.toHaveBeenCalled();
  });

  it('performs immediate updates when available', async () => {
    const extension = createExtension('sample');
    const loader = vi.fn(async () => [extension]);
    const checker = vi.fn(async (_ext, setUpdateState) => {
      setUpdateState(ExtensionUpdateState.UPDATE_AVAILABLE);
    });
    const updateExecutor = vi.fn(async () => ({
      name: extension.name,
      originalVersion: '1.0.0',
      updatedVersion: '1.0.1',
    }));
    const store = createMemoryStateStore();
    const messages: Array<{ level: string; message: string }> = [];
    const updater = new ExtensionAutoUpdater({
      ...createUpdaterOptions({ installMode: 'immediate' }),
      extensionLoader: loader,
      updateChecker: checker,
      updateExecutor,
      stateStore: store,
      notify: (message, level) => messages.push({ message, level }),
      now: () => 1000,
    });

    await updater.checkNow();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(checker).toHaveBeenCalledTimes(1);
    expect(updateExecutor).toHaveBeenCalledTimes(1);
    expect(messages.some((msg) => msg.message.includes('updated'))).toBe(true);
    const snapshot = store.snapshot() as Record<string, { state: string }>;
    expect(snapshot['sample'].state).toBe(
      ExtensionUpdateState.UPDATED_NEEDS_RESTART,
    );
  });

  it('queues updates for restart mode and installs on the next run', async () => {
    const extension = createExtension('queue');
    const loader = vi.fn(async () => [extension]);
    let callCount = 0;
    const checker = vi.fn(async (_ext, setUpdateState) => {
      callCount++;
      if (callCount === 1) {
        setUpdateState(ExtensionUpdateState.UPDATE_AVAILABLE);
      } else {
        setUpdateState(ExtensionUpdateState.UP_TO_DATE);
      }
    });
    const updateExecutor = vi.fn(async () => ({
      name: extension.name,
      originalVersion: '1.0.0',
      updatedVersion: '1.0.1',
    }));
    const store = createMemoryStateStore();
    const updater = new ExtensionAutoUpdater({
      ...createUpdaterOptions({ installMode: 'on-restart' }),
      extensionLoader: loader,
      updateChecker: checker,
      updateExecutor,
      stateStore: store,
      now: () => 2000,
    });

    await updater.checkNow();
    expect(updateExecutor).not.toHaveBeenCalled();
    let snapshot = store.snapshot() as Record<
      string,
      { pendingInstall: boolean }
    >;
    expect(snapshot['queue'].pendingInstall).toBe(true);

    await updater.checkNow();
    expect(updateExecutor).toHaveBeenCalledTimes(1);
    snapshot = store.snapshot() as Record<string, { pendingInstall: boolean }>;
    expect(snapshot['queue'].pendingInstall).toBe(false);
  });

  it('emits notifications for manual mode without auto-installing', async () => {
    const extension = createExtension('manual');
    const loader = vi.fn(async () => [extension]);
    const checker = vi.fn(async (_ext, setUpdateState) => {
      setUpdateState(ExtensionUpdateState.UPDATE_AVAILABLE);
    });
    const updateExecutor = vi.fn();
    const store = createMemoryStateStore();
    const messages: Array<{ level: string; message: string }> = [];
    const updater = new ExtensionAutoUpdater({
      ...createUpdaterOptions({ installMode: 'manual' }),
      extensionLoader: loader,
      updateChecker: checker,
      updateExecutor,
      stateStore: store,
      notify: (message, level) => messages.push({ message, level }),
      now: () => 3000,
    });

    await updater.checkNow();

    expect(updateExecutor).not.toHaveBeenCalled();
    expect(
      messages.some((msg) => msg.message.includes('Update available')),
    ).toBe(true);
  });
});
