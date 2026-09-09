/**
 * @license
 * Copyright 2025 Vybestack LLC
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

function testDialogsHook() {
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
  const dialogs: DialogOpeners = {
    permissions: { open: openSpy.permissions, close: closeSpy.permissions },
    logging: { open: openSpy.logging, close: closeSpy.logging },
    subagent: { open: openSpy.subagent, close: closeSpy.subagent },
  };
  return { dialogs, openSpy, closeSpy };
}

describe('useSlashCommandActions', () => {
  it('maps all provided callbacks into slash command action surface', () => {
    const { dialogs } = testDialogsHook();
    const callbacks = {
      openAuthDialog: createCallback(),
      openThemeDialog: createCallback(),
      openEditorDialog: createCallback(),
      openPrivacyNotice: createCallback(),
      openSettingsDialog: createCallback(),
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
      dialogs,
    };

    const { result } = renderHook(() => useSlashCommandActions(callbacks));

    expect(result.current.openAuthDialog).toBe(callbacks.openAuthDialog);
    expect(result.current.openThemeDialog).toBe(callbacks.openThemeDialog);
    expect(result.current.openEditorDialog).toBe(callbacks.openEditorDialog);
    expect(result.current.openPrivacyNotice).toBe(callbacks.openPrivacyNotice);
    expect(result.current.openSettingsDialog).toBe(
      callbacks.openSettingsDialog,
    );
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
    const { dialogs, openSpy, closeSpy } = testDialogsHook();
    const callbacks = {
      openAuthDialog: createCallback(),
      openThemeDialog: createCallback(),
      openEditorDialog: createCallback(),
      openPrivacyNotice: createCallback(),
      openSettingsDialog: createCallback(),
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
      dialogs,
    };

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

  it('returns stable identity when dependencies are unchanged', () => {
    const { dialogs } = testDialogsHook();
    const callbacks = {
      openAuthDialog: createCallback(),
      openThemeDialog: createCallback(),
      openEditorDialog: createCallback(),
      openPrivacyNotice: createCallback(),
      openSettingsDialog: createCallback(),
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
      dialogs,
    };

    const { result, rerender } = renderHook(() =>
      useSlashCommandActions(callbacks),
    );

    const firstValue = result.current;
    rerender();

    expect(result.current).toBe(firstValue);
  });

  it('routes open/close through openers built from a real store', () => {
    const store = createDialogStore();
    const dialogs = createDialogOpeners(store);
    const params = callbacksWithRealStore(dialogs);
    const { result } = renderHook(() => useSlashCommandActions(params));

    result.current.openPermissionsDialog();
    expect(store.store.getState().requests).toHaveLength(1);
    result.current.closePermissionsDialog();
    expect(store.store.getState().requests).toHaveLength(0);

    result.current.openLoggingDialog({ entries: [1] });
    expect(store.store.getState().requests).toHaveLength(1);
    result.current.closeLoggingDialog();
    expect(store.store.getState().requests).toHaveLength(0);
  });
});

function callbacksWithRealStore(dialogs: DialogOpeners) {
  return {
    openAuthDialog: createCallback(),
    openThemeDialog: createCallback(),
    openEditorDialog: createCallback(),
    openPrivacyNotice: createCallback(),
    openSettingsDialog: createCallback(),
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
    dialogs,
  };
}
