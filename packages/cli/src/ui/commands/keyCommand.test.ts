/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { keyCommand } from './keyCommand';
import { type CommandContext } from './types';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

describe('keyCommand', () => {
  let mockContext: CommandContext;
  let mockActiveProvider: {
    name: string;
    setApiKey?: (key: string) => void;
    isPaidMode?: () => boolean;
  };
  let mockProviderManager: {
    getActiveProvider: () => typeof mockActiveProvider;
    getActiveProviderName: () => string;
  };
  let mockConfig: {
    getProviderManager: () => typeof mockProviderManager;
    setEphemeralSetting: (key: string, value: unknown) => void;
    refreshAuth: (authType: string) => Promise<void>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock active provider
    mockActiveProvider = {
      name: 'test-provider',
      setApiKey: vi.fn(),
      isPaidMode: vi.fn().mockReturnValue(true),
    };

    // Create mock provider manager
    mockProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue(mockActiveProvider),
    };

    // Create mock config with provider manager
    mockConfig = {
      getProviderManager: vi.fn().mockReturnValue(mockProviderManager),
      setEphemeralSetting: vi.fn(),
      refreshAuth: vi.fn(),
      getSettingsService: vi.fn().mockReturnValue(null), // Return null to use fallback behavior
    };

    mockContext = createMockCommandContext({
      services: {
        config: mockConfig,
      },
    } as Parameters<typeof createMockCommandContext>[0]);
  });

  it('should set API key when provided', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    const testApiKey = 'test-api-key-12345';
    const result = await keyCommand.action(mockContext, testApiKey);

    expect(mockActiveProvider.setApiKey).toHaveBeenCalledWith(testApiKey);
    expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
      'auth-key',
      testApiKey,
    );

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: `API key updated for provider 'test-provider'\n⚠️  You are now in PAID MODE - API usage will be charged to your account`,
    });
  });

  it('should remove API key when empty string is provided', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    const result = await keyCommand.action(mockContext, '');

    expect(mockActiveProvider.setApiKey).toHaveBeenCalledWith('');
    expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
      'auth-key',
      undefined,
    );

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: `API key removed for provider 'test-provider'`,
    });
  });

  it('should remove API key when "none" is provided', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    const result = await keyCommand.action(mockContext, 'none');

    expect(mockActiveProvider.setApiKey).toHaveBeenCalledWith('');
    expect(mockConfig.setEphemeralSetting).toHaveBeenCalledWith(
      'auth-key',
      undefined,
    );

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: `API key removed for provider 'test-provider'`,
    });
  });

  it('should handle errors gracefully', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    // Mock a provider that doesn't support setApiKey
    mockActiveProvider.setApiKey = undefined;

    const result = await keyCommand.action(mockContext, 'invalid-key');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: `Provider 'test-provider' does not support API key updates`,
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

    // Mock a provider that doesn't support setApiKey
    mockActiveProvider.setApiKey = undefined;

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
