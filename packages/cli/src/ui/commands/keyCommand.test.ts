/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { keyCommand } from './keyCommand';
import { type CommandContext } from './types';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { AuthType } from '@vybestack/llxprt-code-core';

describe('keyCommand', () => {
  let mockContext: CommandContext;
  let mockProvider: {
    name: string;
    setApiKey?: ReturnType<typeof vi.fn>;
    isPaidMode?: ReturnType<typeof vi.fn>;
  };
  let mockProviderManager: {
    getActiveProvider: ReturnType<typeof vi.fn>;
  };
  let mockConfig: {
    getProviderManager: ReturnType<typeof vi.fn>;
    setEphemeralSetting: ReturnType<typeof vi.fn>;
    refreshAuth: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockProvider = {
      name: 'test-provider',
      setApiKey: vi.fn(),
      isPaidMode: vi.fn().mockReturnValue(true),
    };

    mockProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue(mockProvider),
    };

    mockConfig = {
      getProviderManager: vi.fn().mockReturnValue(mockProviderManager),
      setEphemeralSetting: vi.fn(),
      refreshAuth: vi.fn(),
    };

    mockContext = createMockCommandContext();
    mockContext.services.config = mockConfig;
  });

  it('should set API key when provided', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    const testApiKey = 'test-api-key-12345';
    const result = await keyCommand.action(mockContext, testApiKey);

    expect(mockProvider.setApiKey).toHaveBeenCalledWith(testApiKey);
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

    expect(mockProvider.setApiKey).toHaveBeenCalledWith('');
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

    expect(mockProvider.setApiKey).toHaveBeenCalledWith('');
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

    // Test with no config
    mockContext.services.config = undefined;

    const result = await keyCommand.action(mockContext, 'invalid-key');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'No configuration available',
    });
  });

  it('should handle providers that do not support API keys', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    mockProvider.setApiKey = undefined;

    const result = await keyCommand.action(mockContext, 'test-key');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: `Provider 'test-provider' does not support API key updates`,
    });
  });

  it('should show free mode message for Gemini provider when removing key', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    mockProvider.name = 'gemini';
    mockProvider.isPaidMode = vi.fn().mockReturnValue(false);

    const result = await keyCommand.action(mockContext, '');

    expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
      AuthType.LOGIN_WITH_GOOGLE,
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: `API key removed for provider 'gemini'\n✅ You are now in FREE MODE - using OAuth authentication`,
    });
  });

  it('should refresh auth for Gemini provider when setting key', async () => {
    if (!keyCommand.action) {
      throw new Error('keyCommand must have an action.');
    }

    mockProvider.name = 'gemini';

    const result = await keyCommand.action(mockContext, 'test-key');

    expect(mockConfig.refreshAuth).toHaveBeenCalledWith(AuthType.USE_GEMINI);
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: `API key updated for provider 'gemini'\n⚠️  You are now in PAID MODE - API usage will be charged to your account`,
    });
  });
});
