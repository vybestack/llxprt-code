/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useRewind } from './useRewind.js';
import * as rewindFileOps from '../utils/rewindFileOps.js';
import type { FileChangeStats } from '../utils/rewindFileOps.js';
import type {
  ConversationRecord,
  BaseMessageRecord,
} from '@vybestack/llxprt-code-core';

// Mock the dependency
vi.mock('../utils/rewindFileOps.js', () => ({
  calculateTurnStats: vi.fn(),
  calculateRewindImpact: vi.fn(),
}));

describe('useRewindLogic', () => {
  const mockUserMessage: BaseMessageRecord = {
    id: 'msg-1',
    role: 'user',
    content: 'Hello',
    timestamp: new Date(1000).toISOString(),
  };

  const mockModelMessage: BaseMessageRecord = {
    id: 'msg-2',
    role: 'model',
    content: 'Hi there',
    timestamp: new Date(1001).toISOString(),
  };

  const mockConversation: ConversationRecord = {
    id: 'conv-1',
    sessionId: 'conv-1',
    timestamp: new Date(1000).toISOString(),
    startTime: new Date(1000).toISOString(),
    lastUpdated: new Date(1001).toISOString(),
    messages: [mockUserMessage, mockModelMessage],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with no selection', () => {
    const { result } = renderHook(() => useRewind(mockConversation));

    expect(result.current.selectedMessageId).toBeNull();
    expect(result.current.confirmationStats).toBeNull();
  });

  it('should update state when a message is selected', () => {
    const mockStats: FileChangeStats = {
      fileCount: 1,
      addedLines: 5,
      removedLines: 0,
    };
    vi.mocked(rewindFileOps.calculateRewindImpact).mockReturnValue(mockStats);

    const { result } = renderHook(() => useRewind(mockConversation));

    act(() => {
      result.current.selectMessage('msg-1');
    });

    expect(result.current.selectedMessageId).toBe('msg-1');
    expect(result.current.confirmationStats).toStrictEqual(mockStats);
    expect(rewindFileOps.calculateRewindImpact).toHaveBeenCalledWith(
      mockConversation,
      mockUserMessage,
    );
  });

  it('should not update state if selected message is not found', () => {
    const { result } = renderHook(() => useRewind(mockConversation));

    act(() => {
      result.current.selectMessage('non-existent-id');
    });

    expect(result.current.selectedMessageId).toBeNull();
    expect(result.current.confirmationStats).toBeNull();
  });

  it('should clear selection correctly', () => {
    const mockStats: FileChangeStats = {
      fileCount: 1,
      addedLines: 5,
      removedLines: 0,
    };
    vi.mocked(rewindFileOps.calculateRewindImpact).mockReturnValue(mockStats);

    const { result } = renderHook(() => useRewind(mockConversation));

    // Select first
    act(() => {
      result.current.selectMessage('msg-1');
    });
    expect(result.current.selectedMessageId).toBe('msg-1');

    // Then clear
    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedMessageId).toBeNull();
    expect(result.current.confirmationStats).toBeNull();
  });

  it('should proxy getStats call to utility function', () => {
    const mockStats: FileChangeStats = {
      fileCount: 2,
      addedLines: 10,
      removedLines: 2,
    };
    vi.mocked(rewindFileOps.calculateTurnStats).mockReturnValue(mockStats);

    const { result } = renderHook(() => useRewind(mockConversation));

    const stats = result.current.getStats(mockUserMessage);

    expect(stats).toStrictEqual(mockStats);
    expect(rewindFileOps.calculateTurnStats).toHaveBeenCalledWith(
      mockConversation,
      mockUserMessage,
    );
  });
});
