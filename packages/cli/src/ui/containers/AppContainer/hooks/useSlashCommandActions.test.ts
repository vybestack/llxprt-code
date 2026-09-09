/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import { renderHook } from '../../../../test-utils/render.js';
import { useSlashCommandActions } from './useSlashCommandActions.js';
import { createDialogStore } from '../../../stores/dialog/dialogStore.js';
import type { DialogOpeners } from '../../../stores/dialog/dialogOpeners.js';
import { createDialogOpeners } from '../../../stores/dialog/dialogOpeners.js';
import { SubagentView } from '../../../components/SubagentManagement/types.js';

const createCallback = () => vi.fn();

function baseCallbacks() {
  return {
    openPrivacyNotice: createCallback(),
    openModelsDialog: createCallback(),
    openPoliciesDialog: createCallback(),
    openProviderDialog: createCallback(),
    openLoadProfileDialog: createCallback(),
    openCreateProfileDialog: createCallback(),
    openProfileListDialog: createCallback(),
    viewProfileDetail: createCallback(),
    openProfileEditor: createCallback(),
    quitHandler: createCallback(),
    setDebugMessage: createCallback(),
    toggleCorgiMode: createCallback(),
    toggleDebugProfiler: createCallback(),
    dispatchExtensionStateUpdate: createCallback(),
    addConfirmUpdateExtensionRequest: createCallback(),
    welcomeActions: { resetAndReopen: createCallback() },
    openSessionBrowserDialog: createCallback(),
  };
}

function withRealStoreDialogs() {
  const store = createDialogStore();
  const dialogs = createDialogOpeners(store);
  return { store, dialogs };
}

describe('useSlashCommandActions', () => {
  it('maps all provided callbacks into slash command action surface', () => {
    const { dialogs } = withRealStoreDialogs();
    const callbacks = { ...baseCallbacks(), dialogs };

    const { result } = renderHook(() => useSlashCommandActions(callbacks));

    expect(result.current.openPrivacyNotice).toBe(callbacks.openPrivacyNotice);
    expect(result.current.openModelsDialog).toBe(callbacks.openModelsDialog);
    expect(result.current.openPoliciesDialog).toBe(
      callbacks.openPoliciesDialog,
    );
    expect(result.current.openProviderDialog).toBe(
      callbacks.openProviderDialog,
    );
    expect(result.current.openLoadProfileDialog).toBe(
      callbacks.openLoadProfileDialog,
    );
    expect(result.current.openCreateProfileDialog).toBe(
      callbacks.openCreateProfileDialog,
    );
    expect(result.current.openProfileListDialog).toBe(
      callbacks.openProfileListDialog,
    );
    expect(result.current.viewProfileDetail).toBe(callbacks.viewProfileDetail);
    expect(result.current.openProfileEditor).toBe(callbacks.openProfileEditor);
    expect(result.current.quit).toBe(callbacks.quitHandler);
    expect(result.current.setDebugMessage).toBe(callbacks.setDebugMessage);
    expect(result.current.toggleCorgiMode).toBe(callbacks.toggleCorgiMode);
    expect(result.current.toggleDebugProfiler).toBe(
      callbacks.toggleDebugProfiler,
    );
    expect(result.current.dispatchExtensionStateUpdate).toBe(
      callbacks.dispatchExtensionStateUpdate,
    );
    expect(result.current.addConfirmUpdateExtensionRequest).toBe(
      callbacks.addConfirmUpdateExtensionRequest,
    );
    expect(result.current.openWelcomeDialog).toBe(
      callbacks.welcomeActions.resetAndReopen,
    );
    expect(result.current.openSessionBrowserDialog).toBe(
      callbacks.openSessionBrowserDialog,
    );
  });

  it('routes permissions/logging/subagent open/close through the dialogs object', () => {
    const openSpy = {
      permissions: createCallback(),
      logging: createCallback(),
      subagent: createCallback(),
    };
    const closeSpy = {
      permissions: createCallback(),
      logging: createCallback(),
      subagent: createCallback(),
    };
    const { dialogs } = withRealStoreDialogs();
    const spiedDialogs: DialogOpeners = {
      ...dialogs,
      permissions: { open: openSpy.permissions, close: closeSpy.permissions },
      logging: { open: openSpy.logging, close: closeSpy.logging },
      subagent: { open: openSpy.subagent, close: closeSpy.subagent },
    };
    const callbacks = { ...baseCallbacks(), dialogs: spiedDialogs };

    const { result } = renderHook(() => useSlashCommandActions(callbacks));

    expect(result.current.openPermissionsDialog).toBeDefined();
    expect(result.current.closePermissionsDialog).toBeDefined();
    expect(result.current.openLoggingDialog).toBeDefined();
    expect(result.current.closeLoggingDialog).toBeDefined();
    expect(result.current.openSubagentDialog).toBeDefined();
    expect(result.current.closeSubagentDialog).toBeDefined();

    result.current.openPermissionsDialog();
    expect(openSpy.permissions).toHaveBeenCalledWith({});
    result.current.closePermissionsDialog();
    expect(closeSpy.permissions).toHaveBeenCalledTimes(1);

    result.current.openLoggingDialog({ entries: [1, 2] });
    expect(openSpy.logging).toHaveBeenCalledWith({ entries: [1, 2] });
    result.current.openLoggingDialog();
    expect(openSpy.logging).toHaveBeenCalledWith({ entries: [] });
    result.current.closeLoggingDialog();
    expect(closeSpy.logging).toHaveBeenCalledTimes(1);

    result.current.openSubagentDialog({ initialView: SubagentView.LIST });
    expect(openSpy.subagent).toHaveBeenCalledWith({
      initialView: SubagentView.LIST,
    });
    result.current.closeSubagentDialog();
    expect(closeSpy.subagent).toHaveBeenCalledTimes(1);
  });

  it('routes auth/theme/editor/settings opens through the dialogs object', () => {
    const openSpy = {
      auth: createCallback(),
      theme: createCallback(),
      editor: createCallback(),
      settings: createCallback(),
    };
    const { dialogs } = withRealStoreDialogs();
    const spiedDialogs: DialogOpeners = {
      ...dialogs,
      auth: { open: openSpy.auth, close: createCallback() },
      theme: { open: openSpy.theme, close: createCallback() },
      editor: { open: openSpy.editor, close: createCallback() },
      settings: { open: openSpy.settings, close: createCallback() },
    };
    const callbacks = { ...baseCallbacks(), dialogs: spiedDialogs };

    const { result } = renderHook(() => useSlashCommandActions(callbacks));

    result.current.openAuthDialog();
    expect(openSpy.auth).toHaveBeenCalledWith({});
    result.current.openThemeDialog();
    expect(openSpy.theme).toHaveBeenCalledWith({});
    result.current.openEditorDialog();
    expect(openSpy.editor).toHaveBeenCalledWith({});
    result.current.openSettingsDialog();
    expect(openSpy.settings).toHaveBeenCalledWith({});
  });

  it('returns stable identity when dependencies are unchanged', () => {
    const { dialogs } = withRealStoreDialogs();
    const callbacks = { ...baseCallbacks(), dialogs };

    const { result, rerender } = renderHook(() =>
      useSlashCommandActions(callbacks),
    );

    const firstValue = result.current;
    rerender();

    expect(result.current).toBe(firstValue);
  });

  it('routes open/close through openers built from a real store', () => {
    const { store, dialogs } = withRealStoreDialogs();
    const params = { ...baseCallbacks(), dialogs };
    const { result } = renderHook(() => useSlashCommandActions(params));

    result.current.openPermissionsDialog();
    expect(store.store.getState().requests).toHaveLength(1);
    result.current.closePermissionsDialog();
    expect(store.store.getState().requests).toHaveLength(0);

    result.current.openLoggingDialog({ entries: [1] });
    expect(store.store.getState().requests).toHaveLength(1);
    result.current.closeLoggingDialog();
    expect(store.store.getState().requests).toHaveLength(0);

    result.current.openAuthDialog();
    expect(store.store.getState().requests).toHaveLength(1);
    dialogs.auth.close();
    expect(store.store.getState().requests).toHaveLength(0);
  });
});
