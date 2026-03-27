/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { useSlashCommandActions } from './useSlashCommandActions.js';

const createCallback = () => vi.fn();

describe('useSlashCommandActions', () => {
  it('maps all provided callbacks into slash command action surface', () => {
    const callbacks = {
      openAuthDialog: createCallback(),
      openThemeDialog: createCallback(),
      openEditorDialog: createCallback(),
      openPrivacyNotice: createCallback(),
      openSettingsDialog: createCallback(),
      openLoggingDialog: createCallback(),
      openSubagentDialog: createCallback(),
      openModelsDialog: createCallback(),
      openPermissionsDialog: createCallback(),
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

    const { result } = renderHook(() => useSlashCommandActions(callbacks));

    expect(result.current.openAuthDialog).toBe(callbacks.openAuthDialog);
    expect(result.current.openThemeDialog).toBe(callbacks.openThemeDialog);
    expect(result.current.openEditorDialog).toBe(callbacks.openEditorDialog);
    expect(result.current.openPrivacyNotice).toBe(callbacks.openPrivacyNotice);
    expect(result.current.openSettingsDialog).toBe(
      callbacks.openSettingsDialog,
    );
    expect(result.current.openLoggingDialog).toBe(callbacks.openLoggingDialog);
    expect(result.current.openSubagentDialog).toBe(
      callbacks.openSubagentDialog,
    );
    expect(result.current.openModelsDialog).toBe(callbacks.openModelsDialog);
    expect(result.current.openPermissionsDialog).toBe(
      callbacks.openPermissionsDialog,
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

  it('returns stable identity when dependencies are unchanged', () => {
    const callbacks = {
      openAuthDialog: createCallback(),
      openThemeDialog: createCallback(),
      openEditorDialog: createCallback(),
      openPrivacyNotice: createCallback(),
      openSettingsDialog: createCallback(),
      openLoggingDialog: createCallback(),
      openSubagentDialog: createCallback(),
      openModelsDialog: createCallback(),
      openPermissionsDialog: createCallback(),
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

    const { result, rerender } = renderHook(() =>
      useSlashCommandActions(callbacks),
    );

    const firstValue = result.current;
    rerender();

    expect(result.current).toBe(firstValue);
  });
});
