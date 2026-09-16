/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import { act } from 'react';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationFileWriter } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
import {
  createMockSettings,
  renderHook,
  renderWithProviders,
} from '../../../../test-utils/render.js';
import { createMockCommandContext } from '../../../../test-utils/mockCommandContext.js';
import { AppDispatchProvider } from '../../../contexts/AppDispatchContext.js';
import { useThemeCommand } from '../../../hooks/useThemeCommand.js';
import { processSlashCommand } from '../../../hooks/slashCommandHandlers.js';
import { SubagentManager } from '@vybestack/llxprt-code-core';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { subagentCommand } from '../../../commands/subagentCommand.js';
import { LoggingDialog } from '../../../components/LoggingDialog.js';
import { useEditorSettings } from '../../../hooks/useEditorSettings.js';
import { themeCommand } from '../../../commands/themeCommand.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { createSettingsProfileStore } from '../../../stores/settings/settingsStore.js';
import { createTurnStore } from '../../../stores/turn/turnStore.js';

import {
  useCommandContext,
  useManagers,
} from '../../../hooks/slashCommandProcessorSupport.js';
import { useSlashCommandActions } from './useSlashCommandActions.js';
import { createDialogStore } from '../../../stores/dialog/dialogStore.js';
import type { DialogOpeners } from '../../../stores/dialog/dialogOpeners.js';
import { createDialogOpeners } from '../../../stores/dialog/dialogOpeners.js';
import { SubagentView } from '../../../components/SubagentManagement/types.js';

const createCallback = () => vi.fn();

function baseCallbacks() {
  return {
    openThemeDialog: createCallback(),
    openEditorDialog: createCallback(),
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

  it('retains command-context identity for equal input fields and updates changed fields', () => {
    const { dialogs } = withRealStoreDialogs();
    const callbacks = { ...baseCallbacks(), dialogs };
    const context = createMockCommandContext();
    const turn = createTurnStore();
    const settings = createMockSettings({});
    const refreshStatic = () => {};
    const toggleVimEnabled = async () => false;
    const setCount = () => {};
    const setPendingItem = () => {};
    const reloadCommands = () => {};
    const allowlist = new Set<string>();
    const extensionsUpdateState: Parameters<
      typeof useCommandContext
    >[0]['extensionsUpdateState'] = new Map();
    const { result, rerender, unmount } = renderHook(
      ({ processing }) => {
        const managers = useManagers(null);
        const actions = useSlashCommandActions(callbacks);
        return useCommandContext({
          ...managers,
          config: null,
          agent: null,
          settings,
          addItem: turn.commands.addItem,
          clearItems: turn.commands.clearItems,
          loadHistory: turn.commands.loadHistory,
          refreshStatic,
          toggleVimEnabled,
          setLlxprtMdFileCount: setCount,
          actions,
          alternateBuffer: true,
          pendingItem: null,
          setPendingItem,
          sessionShellAllowlist: allowlist,
          localIsProcessing: processing,
          reloadCommands,
          extensionsUpdateState,
          todoContext: undefined,
          recordingIntegration: undefined,
          recordingSwapCallbacks: undefined,
          stats: {
            stats: context.session.stats,
            updateHistoryTokenCount: setCount,
          },
        });
      },
      { initialProps: { processing: false } },
    );
    const initial = result.current;
    rerender({ processing: false });
    expect(result.current).toBe(initial);
    rerender({ processing: true });
    expect(result.current).not.toBe(initial);
    expect(result.current.session.isProcessing).toBe(true);
    unmount();
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
    const callbacks = {
      ...baseCallbacks(),
      dialogs: spiedDialogs,
      openEditorDialog: () => spiedDialogs.editor.open({}),
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

    result.current.openSubagentDialog(SubagentView.LIST);
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
    const callbacks = {
      ...baseCallbacks(),
      dialogs: spiedDialogs,
      openEditorDialog: () => spiedDialogs.editor.open({}),
    };

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
    const callbacks = {
      ...baseCallbacks(),
      dialogs: spiedDialogs,
      openEditorDialog: () => spiedDialogs.editor.open({}),
    };

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
  it('opens writer-produced request, response and gitless tool records while skipping malformed input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'logs-2536-'));
    const { store, dialogs } = withRealStoreDialogs();
    const { result, unmount } = renderHook(() =>
      useSlashCommandActions({ ...baseCallbacks(), dialogs }),
    );
    try {
      const writer = new ConversationFileWriter(directory);
      await writer.writeRequest(
        'test',
        [
          {
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'hello' },
              { type: 'image', data: 'image' },
            ],
          },
        ],
        { conversationId: 'conversation' },
      );
      await writer.writeResponse('test', 'answer', {
        duration: 42,
        success: true,
        conversationId: 'conversation',
      });
      await writer.writeToolCall('test', 'read_file', {
        gitStats: null,
        success: true,
      });
      const [file] = await readdir(directory);
      const entries: unknown[] = (await readFile(join(directory, file), 'utf8'))
        .trim()
        .split('\n')
        .map((line): unknown => JSON.parse(line));
      result.current.openLoggingDialog({
        entries: [entries[0], { provider: 42 }, ...entries.slice(1)],
      });
      const request = store.store.getState().requests[0];
      if (request.kind !== 'logging')
        throw new Error('Expected logging dialog');
      expect(request.payload.entries).toHaveLength(3);
      expect(request.payload.entries[0].messages?.[0]).toMatchObject({
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'hello' },
          { type: 'image', data: 'image' },
        ],
      });
      expect(request.payload.entries[0].conversationId).toBe('conversation');
      expect(request.payload.entries[1]).toMatchObject({
        duration: 42,
        success: true,
        conversationId: 'conversation',
      });
      expect(request.payload.entries[2].gitStats).toBeNull();
      const view = renderWithProviders(
        <LoggingDialog entries={request.payload.entries} onClose={() => {}} />,
      );
      try {
        expect(view.lastFrame()).toContain('hello');
        expect(view.lastFrame()).toContain('answer');
        expect(view.lastFrame()).toContain('read_file');
      } finally {
        view.unmount();
      }
    } finally {
      unmount();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('preserves the positional subagent deep-link view and name', () => {
    const { store, dialogs } = withRealStoreDialogs();
    const { result, unmount } = renderHook(() =>
      useSlashCommandActions({ ...baseCallbacks(), dialogs }),
    );
    result.current.openSubagentDialog(SubagentView.SHOW, 'researcher');
    expect(store.store.getState().requests).toStrictEqual([
      {
        kind: 'subagent',
        payload: { initialView: SubagentView.SHOW, initialName: 'researcher' },
      },
    ]);
    unmount();
  });
});

describe('domain dialog routes', () => {
  it('opens the selected subagent through the real slash-command processor', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subagent-route-2536-'));
    const { store, dialogs } = withRealStoreDialogs();
    const turn = createTurnStore();
    const { result, unmount } = renderHook(() =>
      useSlashCommandActions({ ...baseCallbacks(), dialogs }),
    );
    try {
      const profiles = new ProfileManager(join(directory, 'profiles'));
      await profiles.saveProfile('testprofile', {
        version: 1,
        provider: 'openai',
        model: 'test',
        modelParams: {},
        ephemeralSettings: {},
      });
      const subagents = new SubagentManager(
        join(directory, 'subagents'),
        profiles,
      );
      await subagents.saveSubagent(
        'researcher',
        'testprofile',
        'Research the subject',
      );
      const context = createMockCommandContext();
      await processSlashCommand(
        {
          commands: [subagentCommand],
          config: null,
          commandContext: {
            ...context,
            services: { ...context.services, subagentManager: subagents },
          },
          actions: result.current,
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
        '/subagent show researcher',
      );
      expect(store.store.getState().requests).toStrictEqual([
        {
          kind: 'subagent',
          payload: {
            initialView: SubagentView.SHOW,
            initialName: 'researcher',
          },
        },
      ]);
    } finally {
      unmount();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('clears a stale editor banner when the slash opener starts a new session', () => {
    const { store, dialogs } = withRealStoreDialogs();
    const settings = createSettingsProfileStore({
      editorError: 'previous failure',
    });
    const loaded = createMockSettings({});
    const { result, unmount } = renderHook(() => {
      const editor = useEditorSettings(
        loaded,
        dialogs,
        () => {},
        settings.commands.setEditorError,
      );
      return useSlashCommandActions({
        ...baseCallbacks(),
        dialogs,
        openEditorDialog: editor.openEditorDialog,
      });
    });
    act(() => result.current.openEditorDialog());
    expect(settings.store.getState().editorError).toBeNull();
    expect(store.store.getState().requests).toStrictEqual([
      { kind: 'editor', payload: {} },
    ]);
    unmount();
  });
});
