/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'bun:test';
await import('ink-testing-library');
const ink = await import('../../../test-utils/real-ink.js');
void vi.mock('ink', () => ink);
// Provider status is unrelated to trust; keep the real footer and trust lifecycle.
const runtimeContext = await import('../contexts/RuntimeContext.js');
void vi.mock('../contexts/RuntimeContext.js', () => ({
  ...runtimeContext,
  useRuntimeApi: () => ({
    getActiveProviderStatus: () => ({ providerName: 'test' }),
  }),
}));
const { renderWithProviders, createMockSettings } = await import(
  '../../test-utils/render.js'
);
const { FooterRegion } = await import('./DefaultAppLayoutRegions.js');
const { useFolderTrust } = await import('../hooks/useFolderTrust.js');
const { Config, coreEvents } = await import('@vybestack/llxprt-code-core');
const { buildSlashCommandRuntime, buildUiRuntimeFromSource } = await import(
  '../cliUiRuntime.js'
);
const { createSettingsProfileStore } = await import(
  '../stores/settings/settingsStore.js'
);
const { SettingsProfileProvider } = await import(
  '../stores/settings/SettingsContext.js'
);
const { createDialogStore } = await import('../stores/dialog/dialogStore.js');
const { createDialogOpeners } = await import(
  '../stores/dialog/dialogOpeners.js'
);

function mountFooter(trustedFolder = true) {
  const settings = createMockSettings({ folderTrust: false });
  const config = new Config({
    sessionId: 'trust-footer',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test',
    trustedFolder,
  });
  const settingsStore = createSettingsProfileStore();
  const store = createDialogStore();
  const dialogs = createDialogOpeners(store);
  const uiRuntime = buildUiRuntimeFromSource(config);
  const slashCommandRuntime = buildSlashCommandRuntime(config);
  let ownerRenders = 0;
  function Owner() {
    ownerRenders++;
    useFolderTrust({ settings, config, store, dialogs, settingsStore });
    return (
      <FooterRegion
        uiRuntime={uiRuntime}
        slashCommandRuntime={slashCommandRuntime}
        settings={settings}
        startupWarnings={[]}
        version="test"
        nightly={false}
        mainControlsRef={{ current: null }}
        rootUiRef={{ current: null }}
        pendingHistoryItemRef={{ current: null }}
        contextFileNames={[]}
        updateInfo={null}
      />
    );
  }
  const view = renderWithProviders(
    <SettingsProfileProvider store={settingsStore}>
      <Owner />
    </SettingsProfileProvider>,
    { settings },
  );
  return { view, settingsStore, getOwnerRenders: () => ownerRenders };
}

describe('idle footer trust subscription', () => {
  it('shows initial runtime distrust and skips unchanged trust events', async () => {
    const { view, settingsStore } = mountFooter(false);
    try {
      await act(async () => {});
      expect(view.lastFrame()).toContain('(untrusted)');
      const initial = settingsStore.store.getState();
      await act(async () => {
        coreEvents.emitFolderTrustChanged(false);
      });
      expect(settingsStore.store.getState()).toBe(initial);
    } finally {
      view.unmount();
    }
  });

  it('updates the real warning for trust loss and gain without rerendering the owner', async () => {
    const { view, settingsStore, getOwnerRenders } = mountFooter();
    try {
      await act(async () => {});
      const renders = getOwnerRenders();
      const initial = settingsStore.store.getState();
      expect(view.lastFrame()).not.toContain('(untrusted)');
      await act(async () => {
        coreEvents.emitFolderTrustChanged(false);
      });
      expect(view.lastFrame()).toContain('(untrusted)');
      await act(async () => {
        coreEvents.emitFolderTrustChanged(true);
      });
      expect(view.lastFrame()).not.toContain('(untrusted)');
      expect(getOwnerRenders()).toBe(renders);
      expect(settingsStore.store.getState().tokenMetrics).toBe(
        initial.tokenMetrics,
      );
      expect(settingsStore.store.getState().settingsNonce).toBe(
        initial.settingsNonce,
      );
    } finally {
      view.unmount();
    }
    const afterUnmount = settingsStore.store.getState();
    coreEvents.emitFolderTrustChanged(false);
    expect(settingsStore.store.getState()).toBe(afterUnmount);
  });
});
