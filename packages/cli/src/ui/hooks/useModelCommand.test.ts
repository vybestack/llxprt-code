/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModelCommand } from './useModelCommand.js';
import { Config } from '@google/gemini-cli-core';
import { MessageType } from '../types.js';

describe('useModelCommand', () => {
  let mockConfig: Partial<Config>;
  const mockAddMessage = vi.fn();
  let mockGeminiClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGeminiClient = {
      updateModel: vi.fn().mockResolvedValue(undefined),
    };
    mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-2.5-pro'),
      setModel: vi.fn(),
      getGeminiClient: vi.fn().mockReturnValue(mockGeminiClient),
    };
  });

  it('should initialize with dialog closed', () => {
    const { result } = renderHook(() =>
      useModelCommand({ config: mockConfig as Config, addMessage: mockAddMessage })
    );

    expect(result.current.showModelDialog).toBe(false);
  });

  it('should open and close model dialog', () => {
    const { result } = renderHook(() =>
      useModelCommand({ config: mockConfig as Config, addMessage: mockAddMessage })
    );

    act(() => {
      result.current.openModelDialog();
    });

    expect(result.current.showModelDialog).toBe(true);

    act(() => {
      result.current.closeModelDialog();
    });

    expect(result.current.showModelDialog).toBe(false);
  });

  it('should handle model selection successfully', async () => {
    const { result } = renderHook(() =>
      useModelCommand({ config: mockConfig as Config, addMessage: mockAddMessage })
    );

    await act(async () => {
      await result.current.handleModelSelection('gemini-2.5-flash');
    });

    expect(mockConfig.setModel).toHaveBeenCalledWith('gemini-2.5-flash');
    expect(mockGeminiClient.updateModel).toHaveBeenCalledWith('gemini-2.5-flash');
    expect(mockAddMessage).toHaveBeenCalledWith({
      type: MessageType.INFO,
      content: 'Switched from gemini-2.5-pro to gemini-2.5-flash',
      timestamp: expect.any(Date),
    });
  });

  it('should handle selecting the same model', async () => {
    const { result } = renderHook(() =>
      useModelCommand({ config: mockConfig as Config, addMessage: mockAddMessage })
    );

    await act(async () => {
      await result.current.handleModelSelection('gemini-2.5-pro');
    });

    expect(mockConfig.setModel).not.toHaveBeenCalled();
    expect(mockGeminiClient.updateModel).not.toHaveBeenCalled();
    expect(mockAddMessage).toHaveBeenCalledWith({
      type: MessageType.INFO,
      content: 'Already using model: gemini-2.5-pro',
      timestamp: expect.any(Date),
    });
  });

  it('should handle null config', async () => {
    const { result } = renderHook(() =>
      useModelCommand({ config: null, addMessage: mockAddMessage })
    );

    await act(async () => {
      await result.current.handleModelSelection('gemini-2.5-flash');
    });

    expect(mockAddMessage).toHaveBeenCalledWith({
      type: MessageType.ERROR,
      content: 'Configuration not available',
      timestamp: expect.any(Date),
    });
  });

  it('should handle model update error', async () => {
    mockGeminiClient.updateModel.mockRejectedValue(new Error('Update failed'));

    const { result } = renderHook(() =>
      useModelCommand({ config: mockConfig as Config, addMessage: mockAddMessage })
    );

    await act(async () => {
      await result.current.handleModelSelection('gemini-2.5-flash');
    });

    expect(mockAddMessage).toHaveBeenCalledWith({
      type: MessageType.ERROR,
      content: 'Failed to switch model: Update failed',
      timestamp: expect.any(Date),
    });
  });
});