/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  SessionController,
  SessionContext,
  type SessionContextType,
} from './SessionController.js';
import { MessageType } from '../types.js';
import { useAppDispatch } from '../contexts/AppDispatchContext.js';
import {
  UserTierId,
  isProQuotaExceededError,
  isGenericQuotaExceededError,
  Config,
} from '@vybestack/llxprt-code-core';
import { IProvider } from '../../providers/IProvider.js';
import { AppAction } from '../reducers/appReducer.js';

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
  loadHierarchicalGeminiMemory: vi.fn(() =>
    Promise.resolve({
      memoryContent: 'test memory content',
      fileCount: 1,
    }),
  ),
}));

vi.mock('llxprt-code-core', async () => {
  const actual = await vi.importActual('llxprt-code-core');
  return {
    ...actual,
    isProQuotaExceededError: vi.fn(() => false),
    isGenericQuotaExceededError: vi.fn(() => false),
  };
});

const mockAddItem = vi.fn();
const mockUpdateItem = vi.fn();
const mockClearItems = vi.fn();
const mockLoadHistory = vi.fn();

vi.mock('../hooks/useHistoryManager.js', () => ({
  useHistory: () => ({
    history: [],
    addItem: mockAddItem,
    updateItem: mockUpdateItem,
    clearItems: mockClearItems,
    loadHistory: mockLoadHistory,
  }),
}));

describe('SessionController', () => {
  let mockConfig: Partial<Config>;

  beforeEach(() => {
    mockConfig = {
      getModel: vi.fn(() => 'test-model'),
      getDebugMode: vi.fn(() => false),
      getFileService: vi.fn(),
      getExtensionContextFilePaths: vi.fn(() => []),
      setUserMemory: vi.fn(),
      setGeminiMdFileCount: vi.fn(),
      setFlashFallbackHandler: vi.fn(),
      setQuotaErrorOccurred: vi.fn(),
      setModel: vi.fn(),
      getUserTier: vi.fn(() => Promise.resolve(undefined)),
    };

    // Reset mocks
    mockAddItem.mockReset();
    mockUpdateItem.mockReset();
    mockClearItems.mockReset();
    mockLoadHistory.mockReset();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should provide session context properly', () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
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
  });

  it('should integrate appReducer and provide dispatch context', () => {
    const TestComponent = () => {
      const dispatch = useAppDispatch();
      return <div>{dispatch ? 'Dispatch available' : 'No dispatch'}</div>;
    };

    const { lastFrame } = render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    expect(lastFrame()).toContain('Dispatch available');
  });

  it('should handle ADD_ITEM actions and call addItem on the session', async () => {
    mockAddItem.mockReturnValue(1);

    let appDispatch: React.Dispatch<AppAction> | null = null;

    const TestComponent = () => {
      appDispatch = useAppDispatch();
      return null;
    };

    render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    const itemData = { type: MessageType.USER, text: 'Test message' };
    const baseTimestamp = Date.now();

    act(() => {
      appDispatch?.({ type: 'ADD_ITEM', payload: { itemData, baseTimestamp } });
    });

    await waitFor(() => {
      expect(mockAddItem).toHaveBeenCalledWith(itemData, baseTimestamp);
    });
  });

  it('should handle payment mode changes properly', async () => {
    const providerModule = await import(
      '../../providers/providerManagerInstance.js'
    );
    const mockGetProviderManager = vi.mocked(providerModule.getProviderManager);

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    // Start with free mode
    expect(contextValue!.sessionState.isPaidMode).toBe(false);
    expect(contextValue!.sessionState.transientWarnings).toHaveLength(0);

    // Add history item to simulate non-startup state
    vi.mocked(providerModule.getProviderManager)().hasActiveProvider = () =>
      true;
    vi.mocked(providerModule.getProviderManager)().getActiveProvider = () => ({
      name: 'test-provider',
      getCurrentModel: () => 'test-model',
      isPaidMode: () => false,
    });

    // Mock useHistory to return a non-empty history
    const historyModule = await import('../hooks/useHistoryManager.js');
    vi.mocked(historyModule.useHistory).mockReturnValue({
      history: [{ id: 1, type: MessageType.USER, text: 'Test' }],
      addItem: mockAddItem,
      updateItem: mockUpdateItem,
      clearItems: mockClearItems,
      loadHistory: mockLoadHistory,
    });

    // Switch to paid mode
    mockGetProviderManager.mockReturnValue({
      hasActiveProvider: () => true,
      getActiveProvider: () => ({
        name: 'anthropic',
        getCurrentModel: () => 'claude-model',
        isPaidMode: () => true,
      }) as Partial<IProvider> as IProvider,
    } as ReturnType<typeof providerModule.getProviderManager>);

    act(() => {
      contextValue!.checkPaymentModeChange();
    });

    await waitFor(() => {
      expect(contextValue!.sessionState.transientWarnings).toHaveLength(1);
      expect(contextValue!.sessionState.transientWarnings[0]).toContain(
        'PAID MODE',
      );
      expect(contextValue!.sessionState.transientWarnings[0]).toContain(
        'anthropic',
      );
    });
  });

  it('should handle memory refresh successfully', async () => {
    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    await act(async () => {
      await contextValue!.performMemoryRefresh();
    });

    expect(mockConfig.setUserMemory).toHaveBeenCalledWith(
      'test memory content',
    );
    expect(mockConfig.setGeminiMdFileCount).toHaveBeenCalledWith(1);

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
  });

  it('should handle memory refresh errors', async () => {
    const configModule = await import('../../config/config.js');
    vi.mocked(configModule.loadHierarchicalGeminiMemory).mockRejectedValueOnce(
      new Error('Memory load failed'),
    );

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    await act(async () => {
      await contextValue!.performMemoryRefresh();
    });

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
  });

  it('should sync user tier when not authenticating', async () => {
    mockConfig.getUserTier?.mockResolvedValue(UserTierId.STANDARD);

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
      <SessionController config={mockConfig as Config} isAuthenticating={false}>
        <TestComponent />
      </SessionController>,
    );

    await waitFor(() => {
      expect(mockConfig.getUserTier).toHaveBeenCalled();
      expect(contextValue!.sessionState.userTier).toBe(UserTierId.STANDARD);
    });
  });

  it('should not sync user tier when authenticating', async () => {
    render(
      <SessionController config={mockConfig as Config} isAuthenticating={true}>
        <div>Test</div>
      </SessionController>,
    );

    await waitFor(() => {
      expect(mockConfig.getUserTier).not.toHaveBeenCalled();
    });
  });

  it('should set up flash fallback handler for quota errors', async () => {
    type FlashFallbackHandler = (
      originalModel: string,
      fallbackModel: string,
      error: Error,
    ) => Promise<void>;
    
    let flashFallbackHandler: FlashFallbackHandler | null = null;
    mockConfig.setFlashFallbackHandler?.mockImplementation((handler) => {
      flashFallbackHandler = handler;
    });

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    expect(mockConfig.setFlashFallbackHandler).toHaveBeenCalled();

    // Test pro quota error handling with paid tier
    act(() => {
      contextValue!.dispatch({
        type: 'SET_USER_TIER',
        payload: UserTierId.STANDARD,
      });
    });

    const mockError = new Error('Quota exceeded');
    vi.mocked(isProQuotaExceededError).mockReturnValue(true);

    await act(async () => {
      await flashFallbackHandler?.(
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        mockError,
      );
    });

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
    expect(mockConfig.setModel).toHaveBeenCalledWith('gemini-2.5-flash');
  });

  it('should handle model changes via polling', async () => {
    vi.useFakeTimers();

    const providerModule = await import(
      '../../providers/providerManagerInstance.js'
    );
    const mockGetProviderManager = vi.mocked(providerModule.getProviderManager);

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
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
      getActiveProvider: () => ({
        name: 'new-provider',
        getCurrentModel: () => 'new-model',
        isPaidMode: () => false,
      }) as Partial<IProvider> as IProvider,
    } as ReturnType<typeof providerModule.getProviderManager>);

    // Advance timer to trigger the interval
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    await waitFor(() => {
      expect(contextValue!.sessionState.currentModel).toBe(
        'new-provider:new-model',
      );
    });

    vi.useRealTimers();
  });

  it('should handle UPDATE_ITEM action', async () => {
    let appDispatch: React.Dispatch<AppAction> | null = null;

    const TestComponent = () => {
      appDispatch = useAppDispatch();
      return null;
    };

    render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    const updatedItem = { id: 1, type: MessageType.USER, text: 'Updated' };

    act(() => {
      appDispatch?.({ type: 'UPDATE_ITEM', payload: updatedItem });
    });

    const historyModule = await import('../hooks/useHistoryManager.js');
    const historyReturn = vi.mocked(historyModule.useHistory).mock.results[0]
      ?.value as ReturnType<typeof historyModule.useHistory>;

    await waitFor(() => {
      expect(historyReturn.updateItem).toHaveBeenCalledWith(updatedItem);
    });
  });

  it('should handle generic quota errors correctly', async () => {
    type FlashFallbackHandler = (
      originalModel: string,
      fallbackModel: string,
      error: Error,
    ) => Promise<void>;
    
    let flashFallbackHandler: FlashFallbackHandler | null = null;
    mockConfig.setFlashFallbackHandler?.mockImplementation((handler) => {
      flashFallbackHandler = handler;
    });

    render(
      <SessionController config={mockConfig as Config}>
        <div>Test</div>
      </SessionController>,
    );

    const mockError = new Error('Generic quota error');
    vi.mocked(isProQuotaExceededError).mockReturnValue(false);
    vi.mocked(isGenericQuotaExceededError).mockReturnValue(true);

    const historyModule = await import('../hooks/useHistoryManager.js');
    vi.mocked(historyModule.useHistory).mockReturnValue({
      history: [],
      addItem: mockAddItem,
      updateItem: mockUpdateItem,
      clearItems: mockClearItems,
      loadHistory: mockLoadHistory,
    });

    await act(async () => {
      await flashFallbackHandler?.(
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        mockError,
      );
    });

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining('quota limit'),
      }),
      expect.any(Number),
    );
    expect(mockConfig.setQuotaErrorOccurred).toHaveBeenCalledWith(true);
    expect(mockConfig.setModel).not.toHaveBeenCalled();
  });

  it('should handle warnings from appReducer', async () => {
    let contextValue: SessionContextType | undefined;
    let appDispatch: React.Dispatch<AppAction> | null = null;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      appDispatch = useAppDispatch();
      return null;
    };

    render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    const warningKey = 'test-warning';
    const warningMessage = 'This is a test warning';

    act(() => {
      appDispatch?.({
        type: 'SET_WARNING',
        payload: { key: warningKey, message: warningMessage },
      });
    });

    await waitFor(() => {
      expect(contextValue!.appState.warnings.get(warningKey)).toBe(
        warningMessage,
      );
    });

    act(() => {
      appDispatch?.({
        type: 'CLEAR_WARNING',
        payload: warningKey,
      });
    });

    await waitFor(() => {
      expect(contextValue!.appState.warnings.has(warningKey)).toBe(false);
    });
  });

  it('should handle dialog actions from appReducer', async () => {
    let contextValue: SessionContextType | undefined;
    let appDispatch: React.Dispatch<AppAction> | null = null;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      appDispatch = useAppDispatch();
      return null;
    };

    render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    // Open dialog
    act(() => {
      appDispatch?.({
        type: 'OPEN_DIALOG',
        payload: 'theme',
      });
    });

    await waitFor(() => {
      expect(contextValue!.appState.openDialogs.theme).toBe(true);
    });

    // Close dialog
    act(() => {
      appDispatch?.({
        type: 'CLOSE_DIALOG',
        payload: 'theme',
      });
    });

    await waitFor(() => {
      expect(contextValue!.appState.openDialogs.theme).toBe(false);
    });
  });

  it('should handle error actions from appReducer', async () => {
    let contextValue: SessionContextType | undefined;
    let appDispatch: React.Dispatch<AppAction> | null = null;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      appDispatch = useAppDispatch();
      return null;
    };

    render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    const errorMessage = 'Test error message';

    act(() => {
      appDispatch?.({
        type: 'SET_AUTH_ERROR',
        payload: errorMessage,
      });
    });

    await waitFor(() => {
      expect(contextValue!.appState.errors.auth).toBe(errorMessage);
    });

    act(() => {
      appDispatch?.({
        type: 'SET_AUTH_ERROR',
        payload: null,
      });
    });

    await waitFor(() => {
      expect(contextValue!.appState.errors.auth).toBe(null);
    });
  });

  it('should handle free mode quota errors', async () => {
    type FlashFallbackHandler = (
      originalModel: string,
      fallbackModel: string,
      error: Error,
    ) => Promise<void>;
    
    let flashFallbackHandler: FlashFallbackHandler | null = null;
    mockConfig.setFlashFallbackHandler?.mockImplementation((handler) => {
      flashFallbackHandler = handler;
    });

    let contextValue: SessionContextType | undefined;

    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
      <SessionController config={mockConfig as Config}>
        <TestComponent />
      </SessionController>,
    );

    // Ensure we're in free tier
    act(() => {
      contextValue!.dispatch({
        type: 'SET_USER_TIER',
        payload: UserTierId.FREE,
      });
    });

    const mockError = new Error('Quota exceeded');
    vi.mocked(isProQuotaExceededError).mockReturnValue(true);

    await act(async () => {
      await flashFallbackHandler?.(
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        mockError,
      );
    });

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.INFO,
        text: expect.stringContaining(
          'You have reached your free usage limit',
        ),
      }),
      expect.any(Number),
    );
    expect(mockConfig.setQuotaErrorOccurred).toHaveBeenCalledWith(true);
    expect(mockConfig.setModel).toHaveBeenCalledWith('gemini-2.5-flash');
  });
});