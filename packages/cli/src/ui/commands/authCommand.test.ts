/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthCommandExecutor } from './authCommand.js';
import { OAuthManager } from '../../auth/oauth-manager.js';
import { CommandContext } from './types.js';

// Mock OAuth manager and dependencies
const peekStoredTokenMock = vi.fn();
const getOAuthTokenMock = vi.fn();
const mockOAuthManager = {
  registerProvider: vi.fn(),
  toggleOAuthEnabled: vi.fn(),
  isOAuthEnabled: vi.fn(),
  isAuthenticated: vi.fn(),
  getAuthStatus: vi.fn(),
  getToken: vi.fn(),
  getOAuthToken: getOAuthTokenMock,
  peekStoredToken: peekStoredTokenMock,
  getSupportedProviders: vi
    .fn()
    .mockReturnValue(['gemini', 'qwen', 'anthropic', 'codex']),
  getHigherPriorityAuth: vi.fn(),
  logout: vi.fn(),
} as unknown as OAuthManager;

describe('AuthCommandExecutor OAuth Support', () => {
  let executor: AuthCommandExecutor;
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    peekStoredTokenMock.mockReset();
    getOAuthTokenMock.mockReset();
    executor = new AuthCommandExecutor(mockOAuthManager);
    mockContext = {
      services: {
        config: null,
        settings: {} as never,
        git: undefined,
        logger: {} as never,
      },
      ui: {} as never,
      session: {} as never,
    };
  });

  describe('@requirement REQ-001: OAuth-only authentication menu', () => {
    it('@given user enters /auth @when no provider specified @then shows OAuth menu only', async () => {
      // When: User enters /auth without provider
      const result = await executor.execute(mockContext);

      // Then: Should show OAuth dialog
      expect(result).toEqual({
        type: 'dialog',
        dialog: 'auth',
      });
    });

    it('@given OAuth menu displayed @when menu shown @then no API key options visible', async () => {
      // When: User enters /auth without provider
      const result = await executor.execute(mockContext);

      // Then: Should return dialog action (OAuth-only architecture)
      expect(result).toEqual({
        type: 'dialog',
        dialog: 'auth',
      });
    });
  });

  describe('@requirement REQ-005: Direct provider OAuth enablement', () => {
    it('@given user enters /auth gemini @when provider specified without action @then shows provider status', async () => {
      // Given: OAuth is enabled and authenticated for gemini
      const mockIsEnabled = vi.fn().mockReturnValue(true);
      const mockIsAuthenticated = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      peekStoredTokenMock.mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User enters /auth gemini (without action)
      const result = await executor.execute(mockContext, 'gemini');

      // Then: Should show provider status
      expect(mockIsEnabled).toHaveBeenCalledWith('gemini');
      expect(mockIsAuthenticated).toHaveBeenCalledWith('gemini');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth for gemini: ENABLED (authenticated)',
      });
      expect(peekStoredTokenMock).toHaveBeenCalledWith('gemini');
      expect(getOAuthTokenMock).not.toHaveBeenCalled();
    });

    it('@given stored OAuth token @when provider status requested @then shows expiry without refreshing token', async () => {
      vi.useFakeTimers();
      try {
        const now = new Date('2025-01-01T00:00:00.000Z');
        vi.setSystemTime(now);

        const mockIsEnabled = vi.fn().mockReturnValue(true);
        const mockIsAuthenticated = vi.fn().mockResolvedValue(true);
        const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
        const expirySeconds = Math.floor(Date.now() / 1000) + 7200; // 2 hours later
        peekStoredTokenMock.mockResolvedValue({
          access_token: 'stored-token',
          token_type: 'Bearer',
          expiry: expirySeconds,
        });
        (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
        (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;
        (mockOAuthManager.getHigherPriorityAuth as unknown) =
          mockGetHigherPriority;

        const result = await executor.execute(mockContext, 'gemini');

        expect(result).toEqual({
          type: 'message',
          messageType: 'info',
          content:
            'gemini OAuth: Enabled and authenticated\n' +
            'Token expires: 2025-01-01T02:00:00.000Z\n' +
            'Time remaining: 2h 0m\n' +
            'Use /auth gemini logout to sign out',
        });
        expect(peekStoredTokenMock).toHaveBeenCalledWith('gemini');
        expect(getOAuthTokenMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('@given user enters /auth gemini enable @when provider specified with action @then toggles OAuth enablement for Gemini', async () => {
      // Given: OAuth currently disabled, no higher priority auth
      const mockIsEnabled = vi.fn().mockReturnValue(false);
      const mockToggleOAuth = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User enters /auth gemini enable
      const result = await executor.execute(mockContext, 'gemini enable');

      // Then: Should toggle OAuth enablement and return success
      expect(mockToggleOAuth).toHaveBeenCalledWith('gemini');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth enabled for gemini',
      });
    });

    it('@given user enters /auth qwen disable @when provider specified with action @then disables OAuth for Qwen', async () => {
      // Given: OAuth currently enabled, disable will toggle it off
      const mockIsEnabled = vi.fn().mockReturnValue(true);
      const mockToggleOAuth = vi.fn().mockResolvedValue(false);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User enters /auth qwen disable
      const result = await executor.execute(mockContext, 'qwen disable');

      // Then: Should toggle OAuth enablement and return success
      expect(mockToggleOAuth).toHaveBeenCalledWith('qwen');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth disabled for qwen',
      });
    });

    it('@given user enters /auth with whitespace @when provider has spaces @then shows status for provider', async () => {
      // Given: OAuth manager will return status successfully
      const mockIsEnabled = vi.fn().mockReturnValue(false);
      const mockIsAuthenticated = vi.fn().mockResolvedValue(false);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User enters /auth with leading/trailing spaces
      const result = await executor.execute(mockContext, '  gemini  ');

      // Then: Should trim and show provider status
      expect(mockIsEnabled).toHaveBeenCalledWith('gemini');
      expect(mockIsAuthenticated).toHaveBeenCalledWith('gemini');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth for gemini: DISABLED',
      });
    });

    it('@given user enters /auth gemini invalid @when invalid action specified @then returns error', async () => {
      // When: User enters invalid action
      const result = await executor.execute(mockContext, 'gemini invalid');

      // Then: Should return error message
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Invalid action: invalid. Use enable, disable, login, logout, status, or switch',
      });
    });
  });

  describe('@requirement REQ-001.2: No API key setup in menu', () => {
    it('@given auth menu displayed @when checking options @then API key setup not present', async () => {
      // Given: OAuth-only architecture is in place
      expect(executor).toBeInstanceOf(AuthCommandExecutor);

      // When: Execute without provider (shows menu)
      const result = await executor.execute(mockContext);

      // Then: Should return dialog action (OAuth-only, no API key options)
      expect(result).toEqual({
        type: 'dialog',
        dialog: 'auth',
      });
    });
  });

  describe('Provider validation', () => {
    it('@given unknown provider @when provider not supported @then returns error message', async () => {
      // Given: getSupportedProviders returns gemini, qwen, anthropic, codex
      const mockGetSupported = vi
        .fn()
        .mockReturnValue(['gemini', 'qwen', 'anthropic', 'codex']);
      (mockOAuthManager.getSupportedProviders as unknown) = mockGetSupported;

      // When: User enters unknown provider
      const result = await executor.execute(mockContext, 'unknown-provider');

      // Then: Should return error message
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Unknown provider: unknown-provider. Supported providers: gemini, qwen, anthropic, codex',
      });
    });

    it('@given empty provider string @when trimmed to empty @then shows menu', async () => {
      // When: User enters empty or whitespace-only provider
      const result = await executor.execute(mockContext, '   ');

      // Then: Should show OAuth menu
      expect(result).toEqual({
        type: 'dialog',
        dialog: 'auth',
      });
    });
  });

  describe('OAuth manager integration', () => {
    it('@given OAuth manager provided @when executor created @then stores manager reference', () => {
      // Then: Executor should store OAuth manager
      expect(executor).toBeInstanceOf(AuthCommandExecutor);
      // We can't directly test private members, but we verify constructor doesn't throw
    });
  });

  describe('OAuth enablement toggle behavior', () => {
    it('@given OAuth disabled for provider @when enabling @then enables OAuth', async () => {
      // Given: OAuth currently disabled
      const mockIsEnabled = vi.fn().mockReturnValue(false);
      const mockToggleOAuth = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: Enable OAuth
      const result = await executor.execute(mockContext, 'gemini enable');

      // Then: Should enable OAuth and show success message
      expect(mockToggleOAuth).toHaveBeenCalledWith('gemini');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth enabled for gemini',
      });
    });

    it('@given OAuth enabled for provider @when disabling @then disables OAuth', async () => {
      // Given: OAuth currently enabled
      const mockIsEnabled = vi.fn().mockReturnValue(true);
      const mockToggleOAuth = vi.fn().mockResolvedValue(false);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: Disable OAuth
      const result = await executor.execute(mockContext, 'qwen disable');

      // Then: Should disable OAuth and show success message
      expect(mockToggleOAuth).toHaveBeenCalledWith('qwen');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth disabled for qwen',
      });
    });

    it('@given OAuth already enabled @when trying to enable @then shows already enabled message', async () => {
      // Given: OAuth already enabled for provider
      const mockIsEnabled = vi.fn().mockReturnValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: Try to enable already enabled OAuth
      const result = await executor.execute(mockContext, 'gemini enable');

      // Then: Should show already enabled message
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth for gemini is already enabled',
      });
    });

    it('@given OAuth already disabled @when trying to disable @then shows already disabled message', async () => {
      // Given: OAuth already disabled for provider
      const mockIsEnabled = vi.fn().mockReturnValue(false);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: Try to disable already disabled OAuth
      const result = await executor.execute(mockContext, 'qwen disable');

      // Then: Should show already disabled message
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth for qwen is already disabled',
      });
    });
  });

  describe('Higher priority auth warnings', () => {
    it('@given API key present @when enabling OAuth @then shows warning about precedence', async () => {
      // Given: API key has higher precedence and OAuth is currently disabled
      const mockIsEnabled = vi.fn().mockReturnValue(false);
      const mockToggleOAuth = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue('API Key');
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: Enabling OAuth with higher priority auth present
      const result = await executor.execute(mockContext, 'gemini enable');

      // Then: Should show warning about precedence
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'OAuth enabled for gemini (Note: API Key will take precedence)',
      });
    });
  });

  describe('OAuth enablement persistence', () => {
    it('@given OAuth enablement toggled @when checking status later @then reflects saved state', async () => {
      // Given: OAuth can be enabled and status retrieved
      const mockIsEnabled = vi.fn().mockReturnValue(false);
      const mockToggleOAuth = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: Enable OAuth for provider
      await executor.execute(mockContext, 'gemini enable');

      // Then: OAuth manager should save the enabled state
      expect(mockToggleOAuth).toHaveBeenCalledWith('gemini');

      // And: Status should reflect the change
      const mockGetAuthStatus = vi.fn().mockResolvedValue([
        {
          provider: 'gemini',
          authenticated: false,
          oauthEnabled: true,
        },
      ]);
      (mockOAuthManager.getAuthStatus as unknown) = mockGetAuthStatus;

      const result = await executor.getAuthStatus();
      expect(result).toEqual(['[] gemini: not authenticated [OAuth enabled]']);
    });
  });

  describe('Status display with enablement indicators', () => {
    it('@given OAuth enabled providers @when getting auth status @then displays enablement status', async () => {
      // Given: Mock auth status response with OAuth enablement
      const mockGetAuthStatus = vi.fn().mockResolvedValue([
        {
          provider: 'gemini',
          authenticated: true,
          oauthEnabled: true,
          expiresIn: 3600,
        },
        {
          provider: 'qwen',
          authenticated: false,
          oauthEnabled: false,
        },
      ]);
      (mockOAuthManager.getAuthStatus as unknown) = mockGetAuthStatus;

      // When: Get auth status
      const result = await executor.getAuthStatus();

      // Then: Should return formatted status indicators with enablement info
      expect(result).toEqual([
        '[[OK]] gemini: authenticated (expires in 60m) [OAuth enabled]',
        '[] qwen: not authenticated [OAuth disabled]',
      ]);
    });
  });

  describe('Error handling patterns', () => {
    it('@given toggle fails @when OAuth enablement attempted @then handles error gracefully', async () => {
      // Given: OAuth manager will fail
      const mockIsEnabled = vi.fn().mockReturnValue(false);
      const mockToggleOAuth = vi
        .fn()
        .mockRejectedValue(new Error('Toggle failed'));
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User attempts OAuth enable
      const result = await executor.execute(mockContext, 'gemini enable');

      // Then: Should return error message
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to enable OAuth for gemini: Toggle failed',
      });
    });

    it('@given storage error @when OAuth enablement disable attempted @then provides user-friendly message', async () => {
      // Given: OAuth manager will fail with storage error
      const mockIsEnabled = vi.fn().mockReturnValue(true);
      const mockToggleOAuth = vi
        .fn()
        .mockRejectedValue(new Error('Cannot save configuration'));
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User attempts OAuth disable
      const result = await executor.execute(mockContext, 'qwen disable');

      // Then: Should return user-friendly error message
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to disable OAuth for qwen: Cannot save configuration',
      });
    });
  });

  describe('Command interface compliance', () => {
    it('@given auth command @when checking properties @then has correct OAuth description', async () => {
      // Import the actual command to test its properties
      const { authCommand } = await import('./authCommand.js');
      expect(authCommand.name).toBe('auth');
      expect(authCommand.description).toBe(
        'Manage OAuth authentication for providers',
      );
    });
  });
});
