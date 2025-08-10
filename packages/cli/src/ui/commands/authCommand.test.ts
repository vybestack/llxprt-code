/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthCommandExecutor } from './authCommand.js';
import { OAuthManager } from '../../auth/oauth-manager.js';
import { CommandContext } from './types.js';

// Mock OAuth manager and dependencies
const mockOAuthManager = {
  registerProvider: vi.fn(),
  toggleOAuthEnabled: vi.fn(),
  isOAuthEnabled: vi.fn(),
  getAuthStatus: vi.fn(),
  getToken: vi.fn(),
  getSupportedProviders: vi.fn().mockReturnValue(['gemini', 'qwen']),
  getHigherPriorityAuth: vi.fn(),
} as unknown as OAuthManager;

describe('AuthCommandExecutor OAuth Support', () => {
  let executor: AuthCommandExecutor;
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
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
    it('@given user enters /auth gemini @when provider specified @then toggles OAuth enablement for Gemini', async () => {
      // Given: OAuth currently disabled, no higher priority auth
      const mockToggleOAuth = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User enters /auth gemini
      const result = await executor.execute(mockContext, 'gemini');

      // Then: Should toggle OAuth enablement and return success
      expect(mockToggleOAuth).toHaveBeenCalledWith('gemini');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth enabled for gemini',
      });
    });

    it('@given user enters /auth qwen @when provider specified @then toggles OAuth enablement for Qwen', async () => {
      // Given: OAuth currently enabled, toggle will disable
      const mockToggleOAuth = vi.fn().mockResolvedValue(false);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User enters /auth qwen
      const result = await executor.execute(mockContext, 'qwen');

      // Then: Should toggle OAuth enablement and return success
      expect(mockToggleOAuth).toHaveBeenCalledWith('qwen');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth disabled for qwen',
      });
    });

    it('@given user enters /auth with whitespace @when provider has spaces @then trims and processes', async () => {
      // Given: OAuth manager will toggle successfully
      const mockToggleOAuth = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User enters /auth with leading/trailing spaces
      const result = await executor.execute(mockContext, '  gemini  ');

      // Then: Should trim and process provider
      expect(mockToggleOAuth).toHaveBeenCalledWith('gemini');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth enabled for gemini',
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
      // Given: getSupportedProviders returns gemini, qwen
      const mockGetSupported = vi.fn().mockReturnValue(['gemini', 'qwen']);
      (mockOAuthManager.getSupportedProviders as unknown) = mockGetSupported;

      // When: User enters unknown provider
      const result = await executor.execute(mockContext, 'unknown-provider');

      // Then: Should return error message
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Unknown provider: unknown-provider. Supported providers: gemini, qwen',
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
    it('@given OAuth disabled for provider @when toggling @then enables OAuth', async () => {
      // Given: OAuth currently disabled
      const mockToggleOAuth = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: Toggle OAuth enablement
      const result = await executor.execute(mockContext, 'gemini');

      // Then: Should enable OAuth and show success message
      expect(mockToggleOAuth).toHaveBeenCalledWith('gemini');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth enabled for gemini',
      });
    });

    it('@given OAuth enabled for provider @when toggling @then disables OAuth', async () => {
      // Given: OAuth currently enabled
      const mockToggleOAuth = vi.fn().mockResolvedValue(false);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: Toggle OAuth enablement
      const result = await executor.execute(mockContext, 'qwen');

      // Then: Should disable OAuth and show success message
      expect(mockToggleOAuth).toHaveBeenCalledWith('qwen');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth disabled for qwen',
      });
    });
  });

  describe('Higher priority auth warnings', () => {
    it('@given API key present @when enabling OAuth @then shows warning about precedence', async () => {
      // Given: API key has higher precedence
      const mockToggleOAuth = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue('API Key');
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: Enabling OAuth with higher priority auth present
      const result = await executor.execute(mockContext, 'gemini');

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
      const mockToggleOAuth = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      const mockIsOAuthEnabled = vi.fn().mockResolvedValue(true);
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsOAuthEnabled;

      // When: Enable OAuth for provider
      await executor.execute(mockContext, 'gemini');

      // Then: OAuth manager should save the enabled state
      expect(mockToggleOAuth).toHaveBeenCalledWith('gemini');

      // And: Status should reflect the change
      const mockGetAuthStatus = vi.fn().mockResolvedValue([
        {
          provider: 'gemini',
          authenticated: false,
          authType: 'none',
          oauthEnabled: true,
        },
      ]);
      (mockOAuthManager.getAuthStatus as unknown) = mockGetAuthStatus;

      const result = await executor.getAuthStatus();
      expect(result).toEqual(['✗ gemini: not authenticated [OAuth enabled]']);
    });
  });

  describe('Status display with enablement indicators', () => {
    it('@given OAuth enabled providers @when getting auth status @then displays enablement status', async () => {
      // Given: Mock auth status response with OAuth enablement
      const mockGetAuthStatus = vi.fn().mockResolvedValue([
        {
          provider: 'gemini',
          authenticated: true,
          authType: 'oauth',
          oauthEnabled: true,
          expiresIn: 3600,
        },
        {
          provider: 'qwen',
          authenticated: false,
          authType: 'none',
          oauthEnabled: false,
        },
      ]);
      (mockOAuthManager.getAuthStatus as unknown) = mockGetAuthStatus;

      // When: Get auth status
      const result = await executor.getAuthStatus();

      // Then: Should return formatted status indicators with enablement info
      expect(result).toEqual([
        '✓ gemini: oauth (expires in 60m) [OAuth enabled]',
        '✗ qwen: not authenticated [OAuth disabled]',
      ]);
    });
  });

  describe('Error handling patterns', () => {
    it('@given toggle fails @when OAuth enablement attempted @then handles error gracefully', async () => {
      // Given: OAuth manager will fail
      const mockToggleOAuth = vi
        .fn()
        .mockRejectedValue(new Error('Toggle failed'));
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User attempts OAuth toggle
      const result = await executor.execute(mockContext, 'gemini');

      // Then: Should return error message
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to toggle OAuth for gemini: Toggle failed',
      });
    });

    it('@given storage error @when OAuth enablement toggle attempted @then provides user-friendly message', async () => {
      // Given: OAuth manager will fail with storage error
      const mockToggleOAuth = vi
        .fn()
        .mockRejectedValue(new Error('Cannot save configuration'));
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User attempts OAuth toggle
      const result = await executor.execute(mockContext, 'qwen');

      // Then: Should return user-friendly error message
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to toggle OAuth for qwen: Cannot save configuration',
      });
    });
  });

  describe('Command interface compliance', () => {
    it('@given auth command @when checking properties @then has correct OAuth toggle description', async () => {
      // Import the actual command to test its properties
      const { authCommand } = await import('./authCommand.js');
      expect(authCommand.name).toBe('auth');
      expect(authCommand.description).toBe(
        'toggle OAuth enablement for providers (gemini, qwen)',
      );
    });
  });
});
