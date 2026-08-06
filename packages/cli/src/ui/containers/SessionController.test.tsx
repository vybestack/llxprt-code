/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';

// Mock before imports
// SessionController reads the runtime bridge both as a hook and via the
// module-level accessor. The real provider resolves the CLI runtime scope,
// which this container test does not establish.
vi.mock('../contexts/RuntimeContext.js', () => {
  // resolveModelIdentity formats from status.providerName + status.modelName.
  // Without modelName the identity collapses to the bare provider name, which
  // is why this mock has to carry both.
  const status = {
    providerName: 'test-provider',
    modelName: 'test-model',
    isPaidMode: false,
  };
  // Exposed so tests can drive a provider/model change: the component reads
  // identity from the runtime, not from config.getModel().
  const setStatus = (next: {
    providerName?: string;
    modelName?: string;
    isPaidMode?: boolean;
  }) => {
    if (next.providerName !== undefined)
      status.providerName = next.providerName;
    if (next.modelName !== undefined) status.modelName = next.modelName;
    if (next.isPaidMode !== undefined) status.isPaidMode = next.isPaidMode;
  };
  const api = {
    __setStatusForTesting: setStatus,
    getActiveProviderStatus: () => status,
    getActiveProfileName: () => undefined,
    getCliProviderManager: () => undefined,
  };
  return {
    useRuntimeApi: () => api,
    getRuntimeApi: () => api,
  };
});

vi.mock('../hooks/useHistoryManager.js', () => ({
  useHistory: vi.fn(() => ({
    history: [],
    addItem: vi.fn(),
    updateItem: vi.fn(),
    clearItems: vi.fn(),
    loadHistory: vi.fn(),
  })),
}));

// Don't mock AppDispatchContext - use the real implementation

import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import {
  SessionController,
  SessionContext,
  type SessionContextType,
} from './SessionController.js';
import { MessageType } from '../types.js';
import type { Config } from '@vybestack/llxprt-code-core';
// import { AppAction } from '../reducers/appReducer.js';
import { useHistory } from '../hooks/useHistoryManager.js';

// Get references to the mocked functions
const mockHistoryManager = useHistory as Mock<typeof useHistory>;

// Mock dependencies
vi.mock(
  '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js',
  () => ({
    getProviderManager: vi.fn(() => ({
      hasActiveProvider: () => true,
      getActiveProvider: () => ({
        name: 'test-provider',
        getCurrentModel: () => 'test-model',
        isPaidMode: () => false,
      }),
    })),
  }),
);

vi.mock('../../config/environmentLoader.js', () => ({
  loadHierarchicalLlxprtMemory: vi.fn(() =>
    Promise.resolve({
      memoryContent: 'test memory content',
      fileCount: 1,
    }),
  ),
}));

export const loadSettings = vi.fn((_dir) => ({
  merged: {
    loadMemoryFromIncludeDirectories: false,
    ui: { memoryImportFormat: 'tree' },
  },
}));

vi.mock('../../config/settings.js', () => ({
  loadSettings,
}));

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
  return {
    ...actual,
  };
});

describe('SessionController', () => {
  let mockConfig: Partial<Config>;
  let mockAddItem: ReturnType<typeof vi.fn>;
  let mockUpdateItem: ReturnType<typeof vi.fn>;
  let mockClearItems: ReturnType<typeof vi.fn>;
  let mockLoadHistory: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // The runtime status mock is mutable so tests can drive provider, model and
    // paid-mode changes; reset it so those changes do not leak between tests.
    const runtimeModuleForReset = await import('../contexts/RuntimeContext.js');
    (
      runtimeModuleForReset.getRuntimeApi() as unknown as {
        __setStatusForTesting: (next: {
          providerName?: string;
          modelName?: string;
          isPaidMode?: boolean;
        }) => void;
      }
    ).__setStatusForTesting({
      providerName: 'test-provider',
      modelName: 'test-model',
      isPaidMode: false,
    });
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockAddItem = vi.fn();
    mockUpdateItem = vi.fn();
    mockClearItems = vi.fn();
    mockLoadHistory = vi.fn();

    mockHistoryManager.mockReturnValue({
      history: [],
      addItem: mockAddItem,
      updateItem: mockUpdateItem,
      clearItems: mockClearItems,
      loadHistory: mockLoadHistory,
    });

    mockConfig = {
      getModel: vi.fn(() => 'test-model'),
      getDebugMode: vi.fn(() => false),
      getFileService: vi.fn(),
      getExtensionContextFilePaths: vi.fn(() => []),
      // The memory refresh now passes the loaded extensions through to
      // loadHierarchicalLlxprtMemory; without this the refresh throws before
      // reaching it.
      getExtensions: vi.fn(() => []),
      getFolderTrust: vi.fn(() => true),
      getUserMemory: vi.fn(() => 'test memory content'),
      setUserMemory: vi.fn(),
      setLlxprtMdFileCount: vi.fn(),
      setModel: vi.fn(),
      getWorkingDir: vi.fn(() => process.cwd()),
      shouldLoadMemoryFromIncludeDirectories: vi.fn(() => false),
      getWorkspaceContext: vi.fn(() => ({
        getDirectories: vi.fn(() => [process.cwd()]),
      })),
      getFileFilteringOptions: vi.fn(() => ({})),
    } as unknown as Partial<Config>;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should provide session context properly', () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    expect(contextValue).toBeDefined();
    expect(contextValue!.history).toStrictEqual([]);
    expect(typeof contextValue!.addItem).toBe('function');
    expect(typeof contextValue!.updateItem).toBe('function');
    expect(typeof contextValue!.clearItems).toBe('function');
    expect(typeof contextValue!.loadHistory).toBe('function');
    expect(typeof contextValue!.checkPaymentModeChange).toBe('function');
    expect(typeof contextValue!.performMemoryRefresh).toBe('function');
    expect(contextValue!.sessionState).toBeDefined();
    expect(contextValue!.dispatch).toBeDefined();
    expect(contextValue!.appState).toBeDefined();
    expect(contextValue!.appDispatch).toBeDefined();

    unmount();
  });

  it('should integrate appReducer and provide dispatch context', () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return React.createElement(
        Text,
        null,
        contextValue?.appDispatch ? 'Dispatch available' : 'No dispatch',
      );
    };

    const { lastFrame, unmount } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    expect(lastFrame()).toContain('Dispatch available');
    unmount();
  });

  it('should handle ADD_ITEM actions and call addItem on the session', () => {
    mockAddItem.mockReturnValue(1);

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount, rerender } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    const itemData = { type: MessageType.USER, text: 'Test message' };
    const baseTimestamp = Date.now();

    // Use appDispatch from the context
    contextValue?.appDispatch({
      type: 'ADD_ITEM',
      payload: { itemData, baseTimestamp },
    });

    // Force a re-render to trigger effects
    rerender(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    // The effect should have run synchronously after the re-render
    expect(mockAddItem).toHaveBeenCalledWith(itemData, baseTimestamp);

    unmount();
  });

  it('should handle payment mode changes properly', async () => {
    // Mock useHistory to return a non-empty history
    mockHistoryManager.mockReturnValue({
      history: [{ id: 1, type: MessageType.USER, text: 'Test' }],
      addItem: mockAddItem,
      updateItem: mockUpdateItem,
      clearItems: mockClearItems,
      loadHistory: mockLoadHistory,
    });

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount, rerender } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    // Start with free mode
    expect(contextValue!.sessionState.isPaidMode).toBe(false);
    expect(contextValue!.sessionState.transientWarnings).toHaveLength(0);

    // Switch to paid mode with Gemini provider (only Gemini shows warnings).
    // SessionController reads isPaidMode from the runtime status snapshot, so
    // the change has to be driven there rather than through the provider
    // manager.
    const paidRuntimeModule = await import('../contexts/RuntimeContext.js');
    (
      paidRuntimeModule.getRuntimeApi() as unknown as {
        __setStatusForTesting: (next: {
          providerName?: string;
          modelName?: string;
          isPaidMode?: boolean;
        }) => void;
      }
    ).__setStatusForTesting({
      providerName: 'gemini',
      modelName: 'gemini-model',
      isPaidMode: true,
    });

    // Call checkPaymentModeChange
    contextValue!.checkPaymentModeChange();

    // Re-render to get updated state
    rerender(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    // The state should update synchronously after calling checkPaymentModeChange
    expect(contextValue!.sessionState.transientWarnings).toHaveLength(1);
    expect(contextValue!.sessionState.transientWarnings[0]).toContain(
      'PAID MODE',
    );
    expect(contextValue!.sessionState.transientWarnings[0]).toContain('Gemini');

    unmount();
  });

  it('should handle memory refresh successfully', async () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    await contextValue!.performMemoryRefresh();

    expect(mockConfig.setUserMemory).toHaveBeenCalledWith(
      'test memory content',
    );
    expect(mockConfig.setLlxprtMdFileCount).toHaveBeenCalledWith(1);

    // Check that info messages were added
    expect(mockAddItem).toHaveBeenCalledTimes(2);
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('Refreshing hierarchical memory'),
      }),
      expect.any(Number),
    );
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('Memory refreshed successfully'),
      }),
      expect.any(Number),
    );

    unmount();
  });

  it('should handle memory refresh errors', async () => {
    const envLoaderModule = await import('../../config/environmentLoader.js');
    (
      envLoaderModule.loadHierarchicalLlxprtMemory as Mock<
        typeof envLoaderModule.loadHierarchicalLlxprtMemory
      >
    ).mockRejectedValueOnce(new Error('Memory load failed'));

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    await contextValue!.performMemoryRefresh();

    // Check that error message was added
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ERROR,
        text: expect.stringContaining(
          'Error refreshing memory: Memory load failed',
        ),
      }),
      expect.any(Number),
    );

    unmount();
  });

  it('should call loadHierarchicalLlxprtMemory with config.getWorkingDir()', async () => {
    const customWorkingDir = '/custom/working/directory';
    (mockConfig.getWorkingDir as ReturnType<typeof vi.fn>).mockReturnValue(
      customWorkingDir,
    );

    expect(customWorkingDir).not.toBe(process.cwd());

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    await contextValue!.performMemoryRefresh();

    const envLoaderModule = await import('../../config/environmentLoader.js');
    const mockLoadHierarchicalLlxprtMemory =
      envLoaderModule.loadHierarchicalLlxprtMemory as Mock<
        typeof envLoaderModule.loadHierarchicalLlxprtMemory
      >;
    const settingsModule = await import('../../config/settings.js');
    const loadSettingsMock = settingsModule.loadSettings as Mock<
      typeof settingsModule.loadSettings
    >;

    expect(loadSettingsMock).toHaveBeenCalledWith(customWorkingDir);
    // The subject of this test is the working directory that is passed, not
    // the full argument list: pinning every position made it fail on an
    // optional parameter that is now undefined, which expect.anything() does
    // not match.
    expect(mockLoadHierarchicalLlxprtMemory).toHaveBeenCalled();
    expect(mockLoadHierarchicalLlxprtMemory.mock.calls[0][0]).toBe(
      customWorkingDir,
    );

    expect(mockLoadHierarchicalLlxprtMemory).not.toHaveBeenCalledWith(
      process.cwd(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    unmount();
  });

  it('should call loadSettings with config.getWorkingDir() on memory refresh', async () => {
    const customWorkingDir = '/custom/working/dir';
    (mockConfig.getWorkingDir as ReturnType<typeof vi.fn>).mockReturnValue(
      customWorkingDir,
    );

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    await contextValue!.performMemoryRefresh();

    const settingsModule = await import('../../config/settings.js');
    const loadSettingsMock = settingsModule.loadSettings as Mock<
      typeof settingsModule.loadSettings
    >;

    expect(loadSettingsMock).toHaveBeenCalledWith(customWorkingDir);

    unmount();
  });

  it('should handle model changes via events (not polling)', async () => {
    const { coreEvents } = await import('@vybestack/llxprt-code-core');

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount, rerender } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    expect(contextValue!.sessionState.currentModel).toBe(
      'test-provider:test-model',
    );

    // Change the model
    (mockConfig.getModel as ReturnType<typeof vi.fn>).mockReturnValue(
      'new-model',
    );
    const runtimeModule = await import('../contexts/RuntimeContext.js');
    (
      runtimeModule.getRuntimeApi() as unknown as {
        __setStatusForTesting: (next: {
          providerName?: string;
          modelName?: string;
          isPaidMode?: boolean;
        }) => void;
      }
    ).__setStatusForTesting({
      providerName: 'new-provider',
      modelName: 'new-model',
    });

    // Emit event instead of advancing timer
    coreEvents.emitModelChanged('new-model');

    // Re-render to get updated state
    rerender(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    // The event should have updated the state
    expect(contextValue!.sessionState.currentModel).toBe(
      'new-provider:new-model',
    );

    unmount();
  });

  it('does not use setInterval polling', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const TestComponent = () => {
      React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    // No 1-second polling intervals should be created
    const pollingIntervals = setIntervalSpy.mock.calls.filter(
      ([, delay]) => delay === 1000,
    );
    expect(pollingIntervals).toHaveLength(0);
    setIntervalSpy.mockRestore();
    unmount();
  });

  it('should handle UPDATE_ITEM action', async () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    const itemId = 1;
    const updateData = { type: MessageType.USER, text: 'Updated' };

    contextValue!.updateItem(itemId, updateData);

    // Allow microtasks to complete
    await Promise.resolve();

    expect(mockUpdateItem).toHaveBeenCalledWith(itemId, updateData);

    unmount();
  });

  it('should handle warnings from appReducer', async () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount, rerender } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    const warningKey = 'test-warning';
    const warningMessage = 'This is a test warning';

    // Use the appDispatch from context
    contextValue?.appDispatch({
      type: 'SET_WARNING',
      payload: { key: warningKey, message: warningMessage },
    });

    // Re-render to get updated state
    rerender(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    expect(contextValue!.appState.warnings.get(warningKey)).toBe(
      warningMessage,
    );

    contextValue?.appDispatch({
      type: 'CLEAR_WARNING',
      payload: warningKey,
    });

    rerender(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    expect(contextValue!.appState.warnings.has(warningKey)).toBe(false);

    unmount();
  });

  it('should handle dialog actions from appReducer', async () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount, rerender } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    // Open dialog
    contextValue?.appDispatch({
      type: 'OPEN_DIALOG',
      payload: 'theme',
    });

    // Re-render to get updated state
    rerender(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    expect(contextValue!.appState.openDialogs.theme).toBe(true);

    // Close dialog
    contextValue?.appDispatch({
      type: 'CLOSE_DIALOG',
      payload: 'theme',
    });

    rerender(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    expect(contextValue!.appState.openDialogs.theme).toBe(false);

    unmount();
  });

  it('should handle error actions from appReducer', async () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount, rerender } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    const errorMessage = 'Test error message';

    contextValue?.appDispatch({
      type: 'SET_AUTH_ERROR',
      payload: errorMessage,
    });

    // Re-render to get updated state
    rerender(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    expect(contextValue!.appState.errors.auth).toBe(errorMessage);

    contextValue?.appDispatch({
      type: 'SET_AUTH_ERROR',
      payload: null,
    });

    rerender(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    expect(contextValue!.appState.errors.auth).toBe(null);

    unmount();
  });
});
