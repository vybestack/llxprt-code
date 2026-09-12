/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { hasDialogRequest } from '../../test-utils/dialogStore.js';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'bun:test';
import type React from 'react';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useEditorSettings } from './useEditorSettings.js';
import type { LoadedSettings } from '../../config/settings.js';
import { SettingScope } from '../../config/settings.js';
import { MessageType, type HistoryItem } from '../types.js';
import {
  type EditorType,
  checkHasEditorType,
  allowEditorTypeInSandbox,
} from '@vybestack/llxprt-code-core';
import { AppDispatchProvider } from '../contexts/AppDispatchContext.js';
import { type AppAction } from '../reducers/appReducer.js';
import type { DialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';

import { createSettingsProfileStore } from '../stores/settings/settingsStore.js';
import { SettingPaths } from '../../config/settingPaths.js';

const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

void vi.mock('@vybestack/llxprt-code-core', () => {
  const actual = realLlxprtCodeCoreModule;
  return {
    ...actual,
    checkHasEditorType: vi.fn(() => true),
    allowEditorTypeInSandbox: vi.fn(() => true),
  };
});

const mockCheckHasEditorType = checkHasEditorType as Mock<
  typeof checkHasEditorType
>;
const mockAllowEditorTypeInSandbox = allowEditorTypeInSandbox as Mock<
  typeof allowEditorTypeInSandbox
>;

describe('useEditorSettings', () => {
  let settingsStore = createSettingsProfileStore();
  let mockLoadedSettings: LoadedSettings;
  let mockDialogs: DialogOpeners;
  let mockStore: ReturnType<typeof createDialogStore>;
  let mockAddItem: Mock<
    (item: Omit<HistoryItem, 'id'>, timestamp: number) => void
  >;
  let mockDispatch: Mock<React.Dispatch<AppAction>>;

  beforeEach(() => {
    vi.resetAllMocks();
    settingsStore = createSettingsProfileStore();

    mockLoadedSettings = {
      setValue: vi.fn(),
    } as unknown as LoadedSettings;

    mockStore = createDialogStore();
    mockDialogs = createDialogOpeners(mockStore);

    mockAddItem = vi.fn();
    mockDispatch = vi.fn();

    // Reset mock implementations to default
    mockCheckHasEditorType.mockReturnValue(true);
    mockAllowEditorTypeInSandbox.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears editor errors when exiting and opening a new dialog session', () => {
    const { result, unmount } = renderHook(() =>
      useEditorSettings(
        mockLoadedSettings,
        mockDialogs,
        mockAddItem,
        settingsStore.commands.setEditorError,
      ),
    );
    settingsStore.commands.setEditorError('Editor unavailable');
    act(() => result.current.exitEditorDialog());
    expect(settingsStore.store.getState().editorError).toBeNull();
    settingsStore.commands.setEditorError('Editor unavailable');
    act(() => result.current.openEditorDialog());
    expect(settingsStore.store.getState().editorError).toBeNull();
    unmount();
  });

  it('should initialize with dialog closed', () => {
    renderHook(
      () =>
        useEditorSettings(
          mockLoadedSettings,
          mockDialogs,
          mockAddItem,
          settingsStore.commands.setEditorError,
        ),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    expect(hasDialogRequest(mockStore, 'editor')).toBe(false);
  });

  it('should open editor dialog when openEditorDialog is called', () => {
    const { result } = renderHook(
      () =>
        useEditorSettings(
          mockLoadedSettings,
          mockDialogs,
          mockAddItem,
          settingsStore.commands.setEditorError,
        ),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    act(() => {
      result.current.openEditorDialog();
    });

    expect(hasDialogRequest(mockStore, 'editor')).toBe(true);
  });

  it('should close editor dialog when exitEditorDialog is called', () => {
    const { result } = renderHook(
      () =>
        useEditorSettings(
          mockLoadedSettings,
          mockDialogs,
          mockAddItem,
          settingsStore.commands.setEditorError,
        ),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    mockStore.commands.openDialog({ kind: 'editor', payload: {} });

    act(() => {
      result.current.exitEditorDialog();
    });

    expect(hasDialogRequest(mockStore, 'editor')).toBe(false);
  });

  it('should handle editor selection successfully', () => {
    const { result } = renderHook(
      () =>
        useEditorSettings(
          mockLoadedSettings,
          mockDialogs,
          mockAddItem,
          settingsStore.commands.setEditorError,
        ),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    mockStore.commands.openDialog({ kind: 'editor', payload: {} });

    const editorType: EditorType = 'vscode';
    const scope = SettingScope.User;

    act(() => {
      result.current.handleEditorSelect(editorType, scope);
    });

    expect(mockLoadedSettings.setValue).toHaveBeenCalledWith(
      scope,
      SettingPaths.General.PreferredEditor,
      editorType,
    );

    expect(mockAddItem).toHaveBeenCalledWith(
      {
        type: MessageType.INFO,
        text: 'Editor preference set to "vscode" in User settings.',
      },
      expect.any(Number),
    );

    expect(settingsStore.store.getState().editorError).toBe(null);
    expect(hasDialogRequest(mockStore, 'editor')).toBe(false);
  });

  it('should handle clearing editor preference (undefined editor)', () => {
    const { result } = renderHook(
      () =>
        useEditorSettings(
          mockLoadedSettings,
          mockDialogs,
          mockAddItem,
          settingsStore.commands.setEditorError,
        ),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    mockStore.commands.openDialog({ kind: 'editor', payload: {} });

    const scope = SettingScope.Workspace;

    act(() => {
      result.current.handleEditorSelect(undefined, scope);
    });

    expect(mockLoadedSettings.setValue).toHaveBeenCalledWith(
      scope,
      SettingPaths.General.PreferredEditor,
      undefined,
    );

    expect(mockAddItem).toHaveBeenCalledWith(
      {
        type: MessageType.INFO,
        text: 'Editor preference cleared in Workspace settings.',
      },
      expect.any(Number),
    );

    expect(settingsStore.store.getState().editorError).toBe(null);
    expect(hasDialogRequest(mockStore, 'editor')).toBe(false);
  });

  it('should handle different editor types', () => {
    const { result } = renderHook(
      () =>
        useEditorSettings(
          mockLoadedSettings,
          mockDialogs,
          mockAddItem,
          settingsStore.commands.setEditorError,
        ),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    const editorTypes: EditorType[] = ['cursor', 'windsurf', 'vim'];
    const scope = SettingScope.User;

    editorTypes.forEach((editorType) => {
      act(() => {
        result.current.handleEditorSelect(editorType, scope);
      });

      expect(mockLoadedSettings.setValue).toHaveBeenCalledWith(
        scope,
        SettingPaths.General.PreferredEditor,
        editorType,
      );

      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Editor preference set to "${editorType}" in User settings.`,
        },
        expect.any(Number),
      );
    });
  });

  it('should handle different setting scopes', () => {
    const { result } = renderHook(
      () =>
        useEditorSettings(
          mockLoadedSettings,
          mockDialogs,
          mockAddItem,
          settingsStore.commands.setEditorError,
        ),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    const editorType: EditorType = 'vscode';
    const scopes = [SettingScope.User, SettingScope.Workspace];

    scopes.forEach((scope) => {
      act(() => {
        result.current.handleEditorSelect(editorType, scope);
      });

      expect(mockLoadedSettings.setValue).toHaveBeenCalledWith(
        scope,
        SettingPaths.General.PreferredEditor,
        editorType,
      );

      expect(mockAddItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: `Editor preference set to "vscode" in ${scope} settings.`,
        },
        expect.any(Number),
      );
    });
  });

  it('should not set preference for unavailable editors', () => {
    const { result } = renderHook(
      () =>
        useEditorSettings(
          mockLoadedSettings,
          mockDialogs,
          mockAddItem,
          settingsStore.commands.setEditorError,
        ),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    mockCheckHasEditorType.mockReturnValue(false);

    const editorType: EditorType = 'vscode';
    const scope = SettingScope.User;

    act(() => {
      result.current.handleEditorSelect(editorType, scope);
    });

    expect(settingsStore.store.getState().editorError).toBe(
      'Editor "vscode" is unavailable.',
    );
    expect(mockLoadedSettings.setValue).not.toHaveBeenCalled();
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();

    act(() => result.current.exitEditorDialog());
    expect(settingsStore.store.getState().editorError).toBeNull();
    act(() => result.current.openEditorDialog());
    expect(hasDialogRequest(mockStore, 'editor')).toBe(true);
    expect(settingsStore.store.getState().editorError).toBeNull();
  });

  it('should not set preference for editors not allowed in sandbox', () => {
    const { result } = renderHook(
      () =>
        useEditorSettings(
          mockLoadedSettings,
          mockDialogs,
          mockAddItem,
          settingsStore.commands.setEditorError,
        ),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    mockAllowEditorTypeInSandbox.mockReturnValue(false);

    const editorType: EditorType = 'vscode';
    const scope = SettingScope.User;

    act(() => {
      result.current.handleEditorSelect(editorType, scope);
    });

    expect(settingsStore.store.getState().editorError).toBe(
      'Editor "vscode" is unavailable.',
    );
    expect(mockLoadedSettings.setValue).not.toHaveBeenCalled();
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();

    act(() => result.current.exitEditorDialog());
    expect(settingsStore.store.getState().editorError).toBeNull();
    act(() => result.current.openEditorDialog());
    expect(hasDialogRequest(mockStore, 'editor')).toBe(true);
    expect(settingsStore.store.getState().editorError).toBeNull();
  });

  it('should handle errors during editor selection', () => {
    const { result } = renderHook(
      () =>
        useEditorSettings(
          mockLoadedSettings,
          mockDialogs,
          mockAddItem,
          settingsStore.commands.setEditorError,
        ),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    const errorMessage = 'Failed to save settings';
    (
      mockLoadedSettings.setValue as Mock<typeof mockLoadedSettings.setValue>
    ).mockImplementation(() => {
      throw new Error(errorMessage);
    });

    const editorType: EditorType = 'vscode';
    const scope = SettingScope.User;

    act(() => {
      result.current.handleEditorSelect(editorType, scope);
    });

    expect(settingsStore.store.getState().editorError).toBe(
      `Failed to set editor preference: Error: ${errorMessage}`,
    );
    expect(mockAddItem).not.toHaveBeenCalled();
  });
});
