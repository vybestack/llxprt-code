/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from 'vitest';
import React, { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useEditorSettings } from './useEditorSettings.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { MessageType, type HistoryItem } from '../types.js';
import {
  type EditorType,
  checkHasEditorType,
  allowEditorTypeInSandbox,
} from '@vybestack/llxprt-code-core';
import { AppDispatchProvider } from '../contexts/AppDispatchContext.js';
import { type AppState, type AppAction } from '../reducers/appReducer.js';

import { SettingPaths } from '../../config/settingPaths.js';

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
  return {
    ...actual,
    checkHasEditorType: vi.fn(() => true),
    allowEditorTypeInSandbox: vi.fn(() => true),
  };
});

const mockCheckHasEditorType = vi.mocked(checkHasEditorType);
const mockAllowEditorTypeInSandbox = vi.mocked(allowEditorTypeInSandbox);

describe('useEditorSettings', () => {
  let mockLoadedSettings: LoadedSettings;
  let mockAppState: AppState;
  let mockAddItem: MockedFunction<
    (item: Omit<HistoryItem, 'id'>, timestamp: number) => void
  >;
  let mockDispatch: MockedFunction<React.Dispatch<AppAction>>;

  beforeEach(() => {
    vi.resetAllMocks();

    mockLoadedSettings = {
      setValue: vi.fn(),
    } as unknown as LoadedSettings;

    mockAppState = {
      openDialogs: {
        theme: false,
        auth: false,
        editor: false,
        provider: false,
        privacy: false,
        loadProfile: false,
        createProfile: false,
        profileList: false,
        profileDetail: false,
        profileEditor: false,
        tools: false,
        oauthCode: false,
      },
      warnings: new Map(),
      errors: {
        theme: null,
        auth: null,
        editor: null,
      },
      lastAddItemAction: null,
    };

    mockAddItem = vi.fn();
    mockDispatch = vi.fn();

    // Reset mock implementations to default
    mockCheckHasEditorType.mockReturnValue(true);
    mockAllowEditorTypeInSandbox.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with dialog closed', () => {
    const { result } = renderHook(
      () => useEditorSettings(mockLoadedSettings, mockAppState, mockAddItem),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    expect(result.current.isEditorDialogOpen).toBe(false);
  });

  it('should open editor dialog when openEditorDialog is called', () => {
    const { result } = renderHook(
      () => useEditorSettings(mockLoadedSettings, mockAppState, mockAddItem),
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

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'OPEN_DIALOG',
      payload: 'editor',
    });
  });

  it('should close editor dialog when exitEditorDialog is called', () => {
    const { result } = renderHook(
      () => useEditorSettings(mockLoadedSettings, mockAppState, mockAddItem),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

    act(() => {
      result.current.exitEditorDialog();
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'CLOSE_DIALOG',
      payload: 'editor',
    });
  });

  it('should handle editor selection successfully', () => {
    const { result } = renderHook(
      () => useEditorSettings(mockLoadedSettings, mockAppState, mockAddItem),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

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

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_EDITOR_ERROR',
      payload: null,
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'CLOSE_DIALOG',
      payload: 'editor',
    });
  });

  it('should handle clearing editor preference (undefined editor)', () => {
    const { result } = renderHook(
      () => useEditorSettings(mockLoadedSettings, mockAppState, mockAddItem),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={mockDispatch}>
            {children}
          </AppDispatchProvider>
        ),
      },
    );

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

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_EDITOR_ERROR',
      payload: null,
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'CLOSE_DIALOG',
      payload: 'editor',
    });
  });

  it('should handle different editor types', () => {
    const { result } = renderHook(
      () => useEditorSettings(mockLoadedSettings, mockAppState, mockAddItem),
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
      () => useEditorSettings(mockLoadedSettings, mockAppState, mockAddItem),
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
      () => useEditorSettings(mockLoadedSettings, mockAppState, mockAddItem),
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

    expect(mockLoadedSettings.setValue).not.toHaveBeenCalled();
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should not set preference for editors not allowed in sandbox', () => {
    const { result } = renderHook(
      () => useEditorSettings(mockLoadedSettings, mockAppState, mockAddItem),
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

    expect(mockLoadedSettings.setValue).not.toHaveBeenCalled();
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should handle errors during editor selection', () => {
    const { result } = renderHook(
      () => useEditorSettings(mockLoadedSettings, mockAppState, mockAddItem),
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
      mockLoadedSettings.setValue as MockedFunction<
        typeof mockLoadedSettings.setValue
      >
    ).mockImplementation(() => {
      throw new Error(errorMessage);
    });

    const editorType: EditorType = 'vscode';
    const scope = SettingScope.User;

    act(() => {
      result.current.handleEditorSelect(editorType, scope);
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_EDITOR_ERROR',
      payload: `Failed to set editor preference: Error: ${errorMessage}`,
    });
    expect(mockAddItem).not.toHaveBeenCalled();
  });
});
