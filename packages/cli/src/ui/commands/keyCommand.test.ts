/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { keyCommand } from './keyCommand';
import { type CommandContext } from './types';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import * as providerConfigUtils from '../../providers/providerConfigUtils.js';

// Mock the providerConfigUtils
vi.mock('../../providers/providerConfigUtils.js', () => ({
  setProviderApiKey: vi.fn().mockResolvedValue({
    success: true,
    message: 'API key updated successfully',
  }),
}));

// Mock the getProviderManager
vi.mock('../../providers/providerManagerInstance.js', () => ({
  getProviderManager: vi.fn().mockReturnValue({
    getActiveProvider: vi.fn().mockReturnValue({
      name: 'test-provider',
    }),
  }),
}));

describe('keyCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockCommandContext();
  });

  it('should set API key when provided', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    const testApiKey = 'test-api-key-12345';
    const result = await keyCommand.action(mockContext, testApiKey);

    expect(providerConfigUtils.setProviderApiKey).toHaveBeenCalledWith(
      expect.any(Object), // providerManager
      mockContext.services.settings,
      testApiKey,
      mockContext.services.config ?? undefined,
    );

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'API key updated successfully',
    });
  });

  it('should remove API key when empty string is provided', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    const result = await keyCommand.action(mockContext, '');

    expect(providerConfigUtils.setProviderApiKey).toHaveBeenCalledWith(
      expect.any(Object), // providerManager
      mockContext.services.settings,
      '',
      mockContext.services.config ?? undefined,
    );

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'API key updated successfully',
    });
  });

  it('should remove API key when "none" is provided', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    const result = await keyCommand.action(mockContext, 'none');

    expect(providerConfigUtils.setProviderApiKey).toHaveBeenCalledWith(
      expect.any(Object), // providerManager
      mockContext.services.settings,
      'none',
      mockContext.services.config ?? undefined,
    );

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'API key updated successfully',
    });
  });

  it('should handle errors gracefully', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    (providerConfigUtils.setProviderApiKey as Mock).mockResolvedValueOnce({
      success: false,
      message: 'Failed to set API key',
    });

    const result = await keyCommand.action(mockContext, 'invalid-key');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Failed to set API key',
    });
  });

  it('should trigger payment mode check when successful and callback is available', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    const mockCheckPaymentModeChange = vi.fn();
    const extendedContext = {
      ...mockContext,
      checkPaymentModeChange: mockCheckPaymentModeChange,
    } as CommandContext & { checkPaymentModeChange: () => void };

    vi.useFakeTimers();

    await keyCommand.action(extendedContext, 'api-key-123');

    expect(mockCheckPaymentModeChange).not.toHaveBeenCalled();

    // Fast-forward the timer
    vi.advanceTimersByTime(100);

    expect(mockCheckPaymentModeChange).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('should not trigger payment mode check when unsuccessful', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    (providerConfigUtils.setProviderApiKey as Mock).mockResolvedValueOnce({
      success: false,
      message: 'Failed to set API key',
    });

    const mockCheckPaymentModeChange = vi.fn();
    const extendedContext = {
      ...mockContext,
      checkPaymentModeChange: mockCheckPaymentModeChange,
    } as CommandContext & { checkPaymentModeChange: () => void };

    vi.useFakeTimers();

    await keyCommand.action(extendedContext, 'invalid-key');

    vi.advanceTimersByTime(100);

    expect(mockCheckPaymentModeChange).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
