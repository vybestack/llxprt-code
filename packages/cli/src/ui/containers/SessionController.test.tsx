/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionController, SessionContext, type SessionContextType } from './SessionController.js';
import { MessageType } from '../types.js';

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
  loadHierarchicalGeminiMemory: vi.fn(() => Promise.resolve({
    memoryContent: 'test memory content',
    fileCount: 1,
  })),
}));

describe('SessionController', () => {
  let mockConfig: {
    getModel: ReturnType<typeof vi.fn>;
    getDebugMode: ReturnType<typeof vi.fn>;
    getFileService: ReturnType<typeof vi.fn>;
    getExtensionContextFilePaths: ReturnType<typeof vi.fn>;
    setUserMemory: ReturnType<typeof vi.fn>;
    setGeminiMdFileCount: ReturnType<typeof vi.fn>;
    setFlashFallbackHandler: ReturnType<typeof vi.fn>;
    setQuotaErrorOccurred: ReturnType<typeof vi.fn>;
    setModel: ReturnType<typeof vi.fn>;
    getUserTier: ReturnType<typeof vi.fn>;
  };

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
  });

  it('should provide history management functions', () => {
    let contextValue: SessionContextType | undefined;
    
    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
      <SessionController config={mockConfig}>
        <TestComponent />
      </SessionController>
    );

    expect(contextValue).toBeDefined();
    expect(contextValue!.history).toEqual([]);
    expect(typeof contextValue!.addItem).toBe('function');
    expect(typeof contextValue!.clearItems).toBe('function');
    expect(typeof contextValue!.loadHistory).toBe('function');
  });

  it('should add items to history', () => {
    let contextValue: SessionContextType | undefined;
    
    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
      <SessionController config={mockConfig}>
        <TestComponent />
      </SessionController>
    );

    act(() => {
      contextValue!.addItem(
        { type: MessageType.USER, text: 'Test message' },
        Date.now()
      );
    });

    expect(contextValue!.history).toHaveLength(1);
    expect(contextValue!.history[0].type).toBe(MessageType.USER);
    expect(contextValue!.history[0].text).toBe('Test message');
  });

  it('should clear history items', () => {
    let contextValue: SessionContextType | undefined;
    
    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
      <SessionController config={mockConfig}>
        <TestComponent />
      </SessionController>
    );

    act(() => {
      contextValue!.addItem(
        { type: MessageType.USER, text: 'Test message' },
        Date.now()
      );
      contextValue!.clearItems();
    });

    expect(contextValue!.history).toHaveLength(0);
  });

  it('should trigger payment mode banner on provider switch', async () => {
    const providerModule = await import('../../providers/providerManagerInstance.js');
    const mockGetProviderManager = vi.mocked(providerModule.getProviderManager);
    
    // Start with gemini provider in free mode
    mockGetProviderManager.mockReturnValue({
      hasActiveProvider: () => true,
      getActiveProvider: vi.fn(() => ({
        name: 'gemini',
        getCurrentModel: () => 'gemini-model',
        isPaidMode: () => false,
      })),
    } as ReturnType<typeof providerModule.getProviderManager>);

    let contextValue: SessionContextType | undefined;
    
    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
      <SessionController config={mockConfig}>
        <TestComponent />
      </SessionController>
    );

    // Add a history item to simulate non-startup state
    act(() => {
      contextValue!.addItem(
        { type: MessageType.USER, text: 'Test' },
        Date.now()
      );
    });

    // Switch to paid provider
    const mockProviderManager = mockGetProviderManager();
    (mockProviderManager.getActiveProvider as ReturnType<typeof vi.fn>).mockReturnValue({
      name: 'anthropic',
      getCurrentModel: () => 'claude-model',
      isPaidMode: () => true,
    });

    act(() => {
      contextValue!.checkPaymentModeChange();
    });

    await waitFor(() => {
      expect(contextValue!.sessionState.transientWarnings).toHaveLength(1);
      expect(contextValue!.sessionState.transientWarnings[0]).toContain('PAID MODE');
      expect(contextValue!.sessionState.transientWarnings[0]).toContain('anthropic');
    });
  });

  it('should handle memory refresh', async () => {
    let contextValue: SessionContextType | undefined;
    
    const TestComponent = () => {
      contextValue = React.useContext(SessionContext);
      return null;
    };

    render(
      <SessionController config={mockConfig}>
        <TestComponent />
      </SessionController>
    );

    await act(async () => {
      await contextValue!.performMemoryRefresh();
    });

    expect(mockConfig.setUserMemory).toHaveBeenCalledWith('test memory content');
    expect(mockConfig.setGeminiMdFileCount).toHaveBeenCalledWith(1);
    
    // Check that info messages were added to history
    const infoMessages = contextValue!.history.filter((item) => item.type === MessageType.INFO);
    expect(infoMessages).toHaveLength(2);
    expect(infoMessages[0].text).toContain('Refreshing hierarchical memory');
    expect(infoMessages[1].text).toContain('Memory refreshed successfully');
  });
});