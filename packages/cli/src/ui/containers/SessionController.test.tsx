/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock before imports
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
import { MessageType, type HistoryItem } from '../types.js';
import {
  UserTierId,
  isProQuotaExceededError,
  isGenericQuotaExceededError,
  Config,
} from '@vybestack/llxprt-code-core';
import { IProvider } from '../../providers/IProvider.js';
// import { AppAction } from '../reducers/appReducer.js';
import { useHistory } from '../hooks/useHistoryManager.js';

// Get references to the mocked functions
const mockHistoryManager = vi.mocked(useHistory);

// Mock dependencies
vi.mock('../../providers/providerManagerInstance.js', () => ({
  getProviderManager: vi.fn(() => ({
    hasActiveProvider: () => true,
    getActiveProvider: () => ({
      name: 'test-provider',
      getCurrentModel: () => 'test-model',
      isPaidMode: () => false,
    }),
  })),
}));

vi.mock('../../config/config.js', () => ({
  loadHierarchicalLlxprtMemory: vi.fn(() =>
    Promise.resolve({
      memoryContent: 'test memory content',
      fileCount: 1,
    }),
  ),
}));

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
  return {
    ...actual,
    isProQuotaExceededError: vi.fn(() => false),
    isGenericQuotaExceededError: vi.fn(() => false),
  };
});

describe('SessionController', () => {
  let mockConfig: Partial<Config>;
  let mockAddItem: ReturnType<
    typeof vi.fn<[Omit<HistoryItem, 'id'>, number], number>
  >;
  let mockUpdateItem: ReturnType<
    typeof vi.fn<
      [
        number,
        (
          | Partial<Omit<HistoryItem, 'id'>>
          | ((prevItem: HistoryItem) => Partial<Omit<HistoryItem, 'id'>>)
        ),
      ],
      void
    >
  >;
  let mockClearItems: ReturnType<typeof vi.fn<[], void>>;
  let mockLoadHistory: ReturnType<typeof vi.fn<[HistoryItem[]], void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useFakeTimers();

    // Reset the history manager mock with new function instances
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
      setUserMemory: vi.fn(),
      setLlxprtMdFileCount: vi.fn(),
      setFlashFallbackHandler: vi.fn(),
      setQuotaErrorOccurred: vi.fn(),
      setModel: vi.fn(),
      getUserTier: vi.fn(() => Promise.resolve(undefined)),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.clearAllTimers();
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
    expect(contextValue!.history).toEqual([]);
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
    const providerModule = await import(
      '../../providers/providerManagerInstance.js'
    );
    const mockGetProviderManager = vi.mocked(providerModule.getProviderManager);

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

    // Switch to paid mode with Gemini provider (only Gemini shows warnings)
    mockGetProviderManager.mockReturnValue({
      hasActiveProvider: () => true,
      getActiveProvider: () =>
        ({
          name: 'gemini',
          getCurrentModel: () => 'gemini-model',
          isPaidMode: () => true,
        }) as Partial<IProvider> as IProvider,
    } as ReturnType<typeof providerModule.getProviderManager>);

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
    const configModule = await import('../../config/config.js');
    vi.mocked(configModule.loadHierarchicalLlxprtMemory).mockRejectedValueOnce(
      new Error('Memory load failed'),
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

  it('should not sync user tier when authenticating', async () => {
    const { unmount } = render(
      <SessionController config={mockConfig as Config} isAuthenticating={true}>
        <div>Test</div>
      </SessionController>,
    );

    // Wait for any effects to run
    vi.runAllTimers();
    await Promise.resolve();

    expect(mockConfig.getUserTier).not.toHaveBeenCalled();

    unmount();
  });

  it('should set up flash fallback handler for quota errors', async () => {
    type FlashFallbackHandler = (
      currentModel: string,
      fallbackModel: string,
      error?: unknown,
    ) => Promise<boolean>;

    let flashFallbackHandler: FlashFallbackHandler | null = null;
    mockConfig.setFlashFallbackHandler?.mockImplementation((handler) => {
      flashFallbackHandler = handler;
    });

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

    expect(mockConfig.setFlashFallbackHandler).toHaveBeenCalled();

    // Test pro quota error handling with paid tier
    contextValue!.dispatch({
      type: 'SET_USER_TIER',
      payload: UserTierId.STANDARD,
    });

    const mockError = new Error('Quota exceeded');
    vi.mocked(isProQuotaExceededError).mockReturnValue(true);

    await flashFallbackHandler?.(
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      mockError,
    );

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining(
          'You have reached your daily gemini-2.5-pro quota limit',
        ),
      }),
      expect.any(Number),
    );
    expect(mockConfig.setQuotaErrorOccurred).toHaveBeenCalledWith(true);
    // Model should NOT be switched anymore
    expect(mockConfig.setModel).not.toHaveBeenCalled();

    unmount();
  });

  it('should handle model changes via polling', async () => {
    const providerModule = await import(
      '../../providers/providerManagerInstance.js'
    );
    const mockGetProviderManager = vi.mocked(providerModule.getProviderManager);

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
    mockConfig.getModel?.mockReturnValue('new-model');
    mockGetProviderManager.mockReturnValue({
      hasActiveProvider: () => true,
      getActiveProvider: () =>
        ({
          name: 'new-provider',
          getCurrentModel: () => 'new-model',
          isPaidMode: () => false,
        }) as Partial<IProvider> as IProvider,
    } as ReturnType<typeof providerModule.getProviderManager>);

    // Advance timer to trigger the interval
    vi.advanceTimersByTime(1100);

    // Re-render to get updated state
    rerender(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    // The polling should have updated the state
    expect(contextValue!.sessionState.currentModel).toBe(
      'new-provider:new-model',
    );

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

  it('should handle generic quota errors correctly', async () => {
    type FlashFallbackHandler = (
      currentModel: string,
      fallbackModel: string,
      error?: unknown,
    ) => Promise<boolean>;

    let flashFallbackHandler: FlashFallbackHandler | null = null;
    mockConfig.setFlashFallbackHandler?.mockImplementation((handler) => {
      flashFallbackHandler = handler;
    });

    let _contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      _contextValue = React.useContext(SessionContext);
      return null;
    };

    const { unmount } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    const mockError = new Error('Generic quota error');
    vi.mocked(isProQuotaExceededError).mockReturnValue(false);
    vi.mocked(isGenericQuotaExceededError).mockReturnValue(true);

    await flashFallbackHandler?.(
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      mockError,
    );

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('quota limit'),
      }),
      expect.any(Number),
    );
    expect(mockConfig.setQuotaErrorOccurred).toHaveBeenCalledWith(true);
    // Model should NOT be switched anymore
    expect(mockConfig.setModel).not.toHaveBeenCalled();

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

  it('should handle free mode quota errors', async () => {
    type FlashFallbackHandler = (
      currentModel: string,
      fallbackModel: string,
      error?: unknown,
    ) => Promise<boolean>;

    let flashFallbackHandler: FlashFallbackHandler | null = null;
    mockConfig.setFlashFallbackHandler?.mockImplementation((handler) => {
      flashFallbackHandler = handler;
    });

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

    // Ensure we're in free tier
    contextValue!.dispatch({
      type: 'SET_USER_TIER',
      payload: UserTierId.FREE,
    });

    const mockError = new Error('Quota exceeded');
    vi.mocked(isProQuotaExceededError).mockReturnValue(true);

    await flashFallbackHandler?.(
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      mockError,
    );

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining(
          'You have reached your daily gemini-2.5-pro quota limit',
        ),
      }),
      expect.any(Number),
    );
    expect(mockConfig.setQuotaErrorOccurred).toHaveBeenCalledWith(true);
    // Model should NOT be switched anymore
    expect(mockConfig.setModel).not.toHaveBeenCalled();

    unmount();
  });
});
