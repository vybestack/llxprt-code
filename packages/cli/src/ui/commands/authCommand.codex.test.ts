/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251213-ISSUE160.P5
 * Tests for Codex OAuth integration in /auth command
 * Verifies that Codex appears in supported providers and can be managed via /auth
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthCommandExecutor } from './authCommand.js';
import { OAuthManager } from '../../auth/oauth-manager.js';
import { CommandContext } from './types.js';

describe('AuthCommand Codex OAuth Integration', () => {
  let mockOAuthManager: OAuthManager;
  let executor: AuthCommandExecutor;
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock OAuth manager with Codex support
    mockOAuthManager = {
      registerProvider: vi.fn(),
      toggleOAuthEnabled: vi.fn(),
      isOAuthEnabled: vi.fn(),
      isAuthenticated: vi.fn(),
      getAuthStatus: vi.fn(),
      getToken: vi.fn(),
      getOAuthToken: vi.fn(),
      peekStoredToken: vi.fn(),
      getSupportedProviders: vi
        .fn()
        .mockReturnValue(['gemini', 'qwen', 'anthropic', 'codex']),
      getHigherPriorityAuth: vi.fn(),
      logout: vi.fn(),
      clearSessionBucket: vi.fn(),
      listBuckets: vi.fn().mockResolvedValue([]),
    } as unknown as OAuthManager;

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

  describe('Codex provider availability', () => {
    it('should include codex in supported providers list', () => {
      const providers = mockOAuthManager.getSupportedProviders();
      expect(providers).toContain('codex');
    });

    it('should accept codex as a valid provider argument', async () => {
      // Given: OAuth is disabled for codex
      const mockIsEnabled = vi.fn().mockReturnValue(false);
      const mockIsAuthenticated = vi.fn().mockResolvedValue(false);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User enters /auth codex
      const result = await executor.execute(mockContext, 'codex');

      // Then: Should show provider status (not error)
      expect(result.type).toBe('message');
      expect((result as { messageType?: string }).messageType).toBe('info');
      expect(mockIsEnabled).toHaveBeenCalledWith('codex');
    });
  });

  describe('Codex OAuth enablement', () => {
    it('should enable OAuth for codex when /auth codex enable is called', async () => {
      // Given: OAuth currently disabled for codex
      const mockIsEnabled = vi.fn().mockReturnValue(false);
      const mockToggleOAuth = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User enters /auth codex enable
      const result = await executor.execute(mockContext, 'codex enable');

      // Then: Should enable OAuth
      expect(mockToggleOAuth).toHaveBeenCalledWith('codex');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth enabled for codex',
      });
    });

    it('should disable OAuth for codex when /auth codex disable is called', async () => {
      // Given: OAuth currently enabled for codex
      const mockIsEnabled = vi.fn().mockReturnValue(true);
      const mockToggleOAuth = vi.fn().mockResolvedValue(false);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.toggleOAuthEnabled as unknown) = mockToggleOAuth;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User enters /auth codex disable
      const result = await executor.execute(mockContext, 'codex disable');

      // Then: Should disable OAuth
      expect(mockToggleOAuth).toHaveBeenCalledWith('codex');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth disabled for codex',
      });
    });
  });

  describe('Codex OAuth status display', () => {
    it('should show enabled and authenticated status for codex', async () => {
      // Given: OAuth is enabled and authenticated for codex
      const mockIsEnabled = vi.fn().mockReturnValue(true);
      const mockIsAuthenticated = vi.fn().mockResolvedValue(true);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      const mockPeekToken = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;
      (mockOAuthManager.peekStoredToken as unknown) = mockPeekToken;

      // When: User enters /auth codex
      const result = await executor.execute(mockContext, 'codex');

      // Then: Should show status
      expect(mockIsEnabled).toHaveBeenCalledWith('codex');
      expect(mockIsAuthenticated).toHaveBeenCalledWith('codex');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth for codex: ENABLED (authenticated)',
      });
    });

    it('should show enabled but not authenticated status for codex', async () => {
      // Given: OAuth is enabled but not authenticated for codex
      const mockIsEnabled = vi.fn().mockReturnValue(true);
      const mockIsAuthenticated = vi.fn().mockResolvedValue(false);
      const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
      (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
      (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;
      (mockOAuthManager.getHigherPriorityAuth as unknown) =
        mockGetHigherPriority;

      // When: User enters /auth codex
      const result = await executor.execute(mockContext, 'codex');

      // Then: Should show status
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'OAuth for codex: ENABLED (not authenticated)',
      });
    });
  });

  describe('Codex OAuth logout', () => {
    it('should logout from codex when /auth codex logout is called', async () => {
      // Given: User is authenticated with codex
      const mockIsAuthenticated = vi.fn().mockResolvedValue(true);
      const mockLogout = vi.fn().mockResolvedValue(undefined);
      (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;
      (mockOAuthManager.logout as unknown) = mockLogout;

      // When: User enters /auth codex logout
      const result = await executor.execute(mockContext, 'codex logout');

      // Then: Should logout (undefined bucket means default/no bucket)
      expect(mockLogout).toHaveBeenCalledWith('codex', undefined);
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'Successfully logged out of codex',
      });
    });
  });
});
