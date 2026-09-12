/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import { act } from 'react';
import {
  createMockSettings,
  renderHook,
} from '../../../../test-utils/render.js';
import { createMockCommandContext } from '../../../../test-utils/mockCommandContext.js';
import { AppDispatchProvider } from '../../../contexts/AppDispatchContext.js';
import { useThemeCommand } from '../../../hooks/useThemeCommand.js';
import { processSlashCommand } from '../../../hooks/slashCommandHandlers.js';
import { themeCommand } from '../../../commands/themeCommand.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { createSettingsProfileStore } from '../../../stores/settings/settingsStore.js';
import { createTurnStore } from '../../../stores/turn/turnStore.js';

import { useSlashCommandActions } from './useSlashCommandActions.js';
import { createDialogStore } from '../../../stores/dialog/dialogStore.js';
import type { DialogOpeners } from '../../../stores/dialog/dialogOpeners.js';
import { createDialogOpeners } from '../../../stores/dialog/dialogOpeners.js';
import { SubagentView } from '../../../components/SubagentManagement/types.js';

const createCallback = () => vi.fn();

function baseCallbacks() {
  return {
    openThemeDialog: createCallback(),
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
  };
}

function withRealStoreDialogs() {
  const store = createDialogStore();
  const dialogs = createDialogOpeners(store);
  return { store, dialogs };
}

describe('useSlashCommandActions', () => {
  it('reports NO_COLOR without requesting a theme dialog through slash dispatch', async () => {
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    const { store, dialogs } = withRealStoreDialogs();
    const turn = createTurnStore();
    const settingsStore = createSettingsProfileStore();
    const settings = createMockSettings({ ui: { theme: 'Dracula' } });
    const { result, unmount } = renderHook(
      () => {
        const theme = useThemeCommand(
          settings,
          dialogs,
          turn.commands.addItem,
          settingsStore.commands.setThemeError,
        );
        return useSlashCommandActions({
          ...baseCallbacks(),
          dialogs,
          openThemeDialog: theme.openThemeDialog,
        });
      },
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={() => {}}>{children}</AppDispatchProvider>
        ),
      },
    );
    try {
      await act(async () => {
        await processSlashCommand(
          {
            commands: [themeCommand],
            config: null,
            commandContext: createMockCommandContext(),
            actions: { ...result.current, openSubagentDialog: () => {} },
            addItem: turn.commands.addItem,
            addMessage: () => {},
            setIsProcessing: () => {},
            setLocalIsProcessing: () => {},
            setPendingItem: () => {},
            setSessionShellAllowlist: () => {},
            setConfirmationRequest: () => {},
            confirmationLogger: new DebugLogger('test'),
            slashCommandLogger: new DebugLogger('test'),
            beginSlashCommandAction: () => new AbortController(),
            endSlashCommandAction: () => {},
          },
          '/theme',
        );
      });
      expect(
        turn.store
          .getState()
          .history.some(
            (item) => item.type === 'info' && item.text.includes('NO_COLOR'),
          ),
      ).toBe(true);
      expect(store.store.getState().requests).toHaveLength(0);
    } finally {
      unmount();
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
  });

  it('maps all provided callbacks into slash command action surface', () => {
    const { dialogs } = withRealStoreDialogs();
    const callbacks = { ...baseCallbacks(), dialogs };

    const { result } = renderHook(() => useSlashCommandActions(callbacks));

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

    result.current.openLoggingDialog({
      entries: [{ timestamp: '2026-09-11', type: 'request', provider: 'test' }],
    });
    expect(openSpy.logging).toHaveBeenCalledWith({
      entries: [{ timestamp: '2026-09-11', type: 'request', provider: 'test' }],
    });
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

  it('routes auth/editor/settings opens through the dialogs object', () => {
    const openSpy = {
      auth: createCallback(),
      editor: createCallback(),
      settings: createCallback(),
    };
    const { dialogs } = withRealStoreDialogs();
    const spiedDialogs: DialogOpeners = {
      ...dialogs,
      auth: { open: openSpy.auth, close: createCallback() },
      editor: { open: openSpy.editor, close: createCallback() },
      settings: { open: openSpy.settings, close: createCallback() },
    };
    const callbacks = { ...baseCallbacks(), dialogs: spiedDialogs };

    const { result } = renderHook(() => useSlashCommandActions(callbacks));

    result.current.openAuthDialog();
    expect(openSpy.auth).toHaveBeenCalledWith({});

    result.current.openEditorDialog();
    expect(openSpy.editor).toHaveBeenCalledWith({});
    result.current.openSettingsDialog();
    expect(openSpy.settings).toHaveBeenCalledWith({});
  });

  it('routes privacy/models/policies/session-browser opens through the dialogs object', () => {
    const openSpy = {
      privacy: createCallback(),
      models: createCallback(),
      policies: createCallback(),
      sessionBrowser: createCallback(),
    };
    const { dialogs } = withRealStoreDialogs();
    const spiedDialogs: DialogOpeners = {
      ...dialogs,
      privacy: { open: openSpy.privacy, close: createCallback() },
      models: { open: openSpy.models, close: createCallback() },
      policies: { open: openSpy.policies, close: createCallback() },
      sessionBrowser: {
        open: openSpy.sessionBrowser,
        close: createCallback(),
      },
    };
    const callbacks = { ...baseCallbacks(), dialogs: spiedDialogs };

    const { result } = renderHook(() => useSlashCommandActions(callbacks));

    result.current.openPrivacyNotice();
    expect(openSpy.privacy).toHaveBeenCalledWith({});
    result.current.openModelsDialog();
    expect(openSpy.models).toHaveBeenCalledWith({});
    result.current.openModelsDialog({ initialSearch: 'gemini' });
    expect(openSpy.models).toHaveBeenCalledWith({ initialSearch: 'gemini' });
    result.current.openPoliciesDialog();
    expect(openSpy.policies).toHaveBeenCalledWith({});
    result.current.openSessionBrowserDialog();
    expect(openSpy.sessionBrowser).toHaveBeenCalledWith({});
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

    result.current.openLoggingDialog({
      entries: [{ timestamp: '2026-09-11', type: 'request', provider: 'test' }],
    });
    expect(store.store.getState().requests).toHaveLength(1);
    result.current.closeLoggingDialog();
    expect(store.store.getState().requests).toHaveLength(0);

    result.current.openAuthDialog();
    expect(store.store.getState().requests).toHaveLength(1);
    dialogs.auth.close();
    expect(store.store.getState().requests).toHaveLength(0);
  });
});

describe('logging data boundary', () => {
  it('rejects malformed external log records before opening a dialog', () => {
    const { store, dialogs } = withRealStoreDialogs();
    const { result, unmount } = renderHook(() =>
      useSlashCommandActions({ ...baseCallbacks(), dialogs }),
    );
    try {
      expect(() =>
        result.current.openLoggingDialog({
          entries: [{ timestamp: '2026-09-11', type: 'request', provider: 42 }],
        }),
      ).toThrow('Expected string, received number');
      expect(store.store.getState().requests).toHaveLength(0);
      result.current.openLoggingDialog({
        entries: [
          { timestamp: '2026-09-11', type: 'request', provider: 'test' },
        ],
      });
      expect(store.store.getState().requests).toStrictEqual([
        {
          kind: 'logging',
          payload: {
            entries: [
              { timestamp: '2026-09-11', type: 'request', provider: 'test' },
            ],
          },
        },
      ]);
    } finally {
      unmount();
    }
  });
});
