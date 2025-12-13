/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251213issue490
 * @phase Phase 5: Auth Command Bucket Support
 * TDD Tests for OAuth Bucket Extensions to Auth Command
 *
 * These tests MUST be written FIRST and FAIL initially (RED phase).
 * Implementation comes after tests are written and failing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthCommandExecutor } from '../authCommand.js';
import { OAuthManager } from '../../../auth/oauth-manager.js';
import { CommandContext } from '../types.js';

// Mock OAuth manager for bucket operations
const mockOAuthManager = {
  registerProvider: vi.fn(),
  toggleOAuthEnabled: vi.fn(),
  isOAuthEnabled: vi.fn(),
  isAuthenticated: vi.fn(),
  getAuthStatus: vi.fn(),
  getToken: vi.fn(),
  getOAuthToken: vi.fn(),
  peekStoredToken: vi.fn(),
  getSupportedProviders: vi.fn().mockReturnValue(['anthropic', 'gemini', 'qwen']),
  getHigherPriorityAuth: vi.fn(),
  logout: vi.fn(),
  authenticate: vi.fn(),
  getAuthStatusWithBuckets: vi.fn(),
  setSessionBucket: vi.fn(),
  clearSessionBucket: vi.fn(),
  getSessionBucket: vi.fn(),
  logoutAllBuckets: vi.fn(),
  listBuckets: vi.fn(),
} as unknown as OAuthManager;

describe('Phase 5: Auth Command Bucket Support - Login with Bucket', () => {
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

  describe('Login to specific bucket', () => {
    it('should login to specific bucket when bucket name provided', async () => {
      // Given: User wants to login to work@company.com bucket
      const mockAuthenticate = vi.fn().mockResolvedValue(undefined);
      (mockOAuthManager.authenticate as unknown) = mockAuthenticate;

      // When: User enters /auth anthropic login work@company.com
      const result = await executor.execute(mockContext, 'anthropic login work@company.com');

      // Then: Should trigger OAuth with bucket parameter
      expect(mockAuthenticate).toHaveBeenCalledWith('anthropic', 'work@company.com');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('work@company.com'),
      });
    });

    it('should login to default bucket if not provided', async () => {
      // Given: User wants to login but didn't specify bucket
      const mockAuthenticate = vi.fn().mockResolvedValue(undefined);
      (mockOAuthManager.authenticate as unknown) = mockAuthenticate;

      // When: User enters /auth anthropic login (without bucket)
      const result = await executor.execute(mockContext, 'anthropic login');

      // Then: Should authenticate without bucket (uses default)
      expect(mockAuthenticate).toHaveBeenCalledWith('anthropic', undefined);
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Successfully authenticated'),
      });
    });

    it('should login to default bucket when bucket is "default"', async () => {
      // Given: User explicitly specifies default bucket
      const mockAuthenticate = vi.fn().mockResolvedValue(undefined);
      (mockOAuthManager.authenticate as unknown) = mockAuthenticate;

      // When: User enters /auth anthropic login default
      const result = await executor.execute(mockContext, 'anthropic login default');

      // Then: Should authenticate to default bucket
      expect(mockAuthenticate).toHaveBeenCalledWith('anthropic', 'default');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('default'),
      });
    });

    it('should handle authentication failure gracefully', async () => {
      // Given: Authentication will fail
      const mockAuthenticate = vi.fn().mockRejectedValue(new Error('OAuth flow cancelled'));
      (mockOAuthManager.authenticate as unknown) = mockAuthenticate;

      // When: User attempts to login
      const result = await executor.execute(mockContext, 'anthropic login work@company.com');

      // Then: Should return error message
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('OAuth flow cancelled'),
      });
    });

    it('should validate provider before login', async () => {
      // Given: Invalid provider specified
      const mockGetSupported = vi.fn().mockReturnValue(['anthropic', 'gemini', 'qwen']);
      (mockOAuthManager.getSupportedProviders as unknown) = mockGetSupported;

      // When: User tries to login with invalid provider
      const result = await executor.execute(mockContext, 'invalid-provider login bucket1');

      // Then: Should return provider validation error
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Unknown provider: invalid-provider'),
      });
    });
  });

  describe('Login command argument parsing', () => {
    it('should parse login with bucket correctly', async () => {
      // Given: Various bucket name formats
      const testCases = [
        'anthropic login work@company.com',
        'anthropic login personal@gmail.com',
        'anthropic login team-shared',
        'anthropic login ci-service',
      ];

      const mockAuthenticate = vi.fn().mockResolvedValue(undefined);
      (mockOAuthManager.authenticate as unknown) = mockAuthenticate;

      for (const args of testCases) {
        mockAuthenticate.mockClear();
        const parts = args.split(/\s+/);
        const expectedBucket = parts[2];

        // When: User executes login with bucket
        await executor.execute(mockContext, args);

        // Then: Should parse bucket name correctly
        expect(mockAuthenticate).toHaveBeenCalledWith('anthropic', expectedBucket);
      }
    });

    it('should handle whitespace in login commands', async () => {
      // Given: Login command with extra whitespace
      const mockAuthenticate = vi.fn().mockResolvedValue(undefined);
      (mockOAuthManager.authenticate as unknown) = mockAuthenticate;

      // When: User enters command with extra spaces
      await executor.execute(mockContext, '  anthropic   login   work@company.com  ');

      // Then: Should trim and parse correctly
      expect(mockAuthenticate).toHaveBeenCalledWith('anthropic', 'work@company.com');
    });
  });
});

describe('Phase 5: Auth Command Bucket Support - Logout with Bucket', () => {
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

  describe('Logout from specific bucket', () => {
    it('should logout from specific bucket only', async () => {
      // Given: User has multiple buckets authenticated
      const mockLogout = vi.fn().mockResolvedValue(undefined);
      const mockIsAuthenticated = vi.fn().mockResolvedValue(true);
      (mockOAuthManager.logout as unknown) = mockLogout;
      (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;

      // When: User logs out from specific bucket
      const result = await executor.execute(mockContext, 'anthropic logout work@company.com');

      // Then: Should remove only that bucket
      expect(mockLogout).toHaveBeenCalledWith('anthropic', 'work@company.com');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('work@company.com'),
      });
    });

    it('should logout from all buckets with --all flag', async () => {
      // Given: User has multiple buckets authenticated
      const mockLogoutAll = vi.fn().mockResolvedValue(undefined);
      (mockOAuthManager.logoutAllBuckets as unknown) = mockLogoutAll;

      // When: User logs out with --all flag
      const result = await executor.execute(mockContext, 'anthropic logout --all');

      // Then: Should remove all buckets for provider
      expect(mockLogoutAll).toHaveBeenCalledWith('anthropic');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('all buckets'),
      });
    });

    it('should show error for non-existent bucket', async () => {
      // Given: User tries to logout from non-existent bucket
      const mockLogout = vi.fn().mockRejectedValue(new Error('Bucket not found'));
      const mockIsAuthenticated = vi.fn().mockResolvedValue(false);
      (mockOAuthManager.logout as unknown) = mockLogout;
      (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;

      // When: User attempts logout from non-existent bucket
      const result = await executor.execute(mockContext, 'anthropic logout nonexistent');

      // Then: Should return error message
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Bucket not found'),
      });
    });

    it('should clear session bucket on logout', async () => {
      // Given: User has session bucket set and logs out
      const mockLogout = vi.fn().mockResolvedValue(undefined);
      const mockClearSession = vi.fn();
      const mockIsAuthenticated = vi.fn().mockResolvedValue(true);
      (mockOAuthManager.logout as unknown) = mockLogout;
      (mockOAuthManager.clearSessionBucket as unknown) = mockClearSession;
      (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;

      // When: User logs out from bucket
      await executor.execute(mockContext, 'anthropic logout work@company.com');

      // Then: Should clear session bucket if it matches
      expect(mockClearSession).toHaveBeenCalledWith('anthropic');
    });
  });

  describe('Logout command parsing', () => {
    it('should distinguish logout bucket from --all flag', async () => {
      // Given: Different logout command formats
      const mockLogout = vi.fn().mockResolvedValue(undefined);
      const mockLogoutAll = vi.fn().mockResolvedValue(undefined);
      const mockIsAuthenticated = vi.fn().mockResolvedValue(true);
      (mockOAuthManager.logout as unknown) = mockLogout;
      (mockOAuthManager.logoutAllBuckets as unknown) = mockLogoutAll;
      (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;

      // When: User logs out from specific bucket
      await executor.execute(mockContext, 'anthropic logout mybucket');
      // Then: Should call logout with bucket
      expect(mockLogout).toHaveBeenCalledWith('anthropic', 'mybucket');
      expect(mockLogoutAll).not.toHaveBeenCalled();

      mockLogout.mockClear();
      mockLogoutAll.mockClear();

      // When: User logs out all buckets
      await executor.execute(mockContext, 'anthropic logout --all');
      // Then: Should call logoutAllBuckets
      expect(mockLogoutAll).toHaveBeenCalledWith('anthropic');
      expect(mockLogout).not.toHaveBeenCalled();
    });
  });
});

describe('Phase 5: Auth Command Bucket Support - Status with Buckets', () => {
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

  describe('Show all buckets in status', () => {
    it('should list all buckets with expiry info', async () => {
      // Given: User has multiple buckets authenticated
      const mockGetBucketsStatus = vi.fn().mockResolvedValue([
        {
          bucket: 'default',
          authenticated: true,
          expiry: Date.now() / 1000 + 3600, // 1 hour from now
          isSessionBucket: true,
        },
        {
          bucket: 'work@company.com',
          authenticated: true,
          expiry: Date.now() / 1000 + 7200, // 2 hours from now
          isSessionBucket: false,
        },
        {
          bucket: 'personal@gmail.com',
          authenticated: true,
          expiry: Date.now() / 1000 - 3600, // expired
          isSessionBucket: false,
        },
      ]);
      (mockOAuthManager.getAuthStatusWithBuckets as unknown) = mockGetBucketsStatus;

      // When: User checks status
      const result = await executor.execute(mockContext, 'anthropic status');

      // Then: Should show all buckets with expiry
      expect(mockGetBucketsStatus).toHaveBeenCalledWith('anthropic');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringMatching(/default.*work@company\.com.*personal@gmail\.com/s),
      });
    });

    it('should indicate active session bucket', async () => {
      // Given: User has session bucket set
      const mockGetBucketsStatus = vi.fn().mockResolvedValue([
        {
          bucket: 'default',
          authenticated: true,
          expiry: Date.now() / 1000 + 3600,
          isSessionBucket: false,
        },
        {
          bucket: 'work@company.com',
          authenticated: true,
          expiry: Date.now() / 1000 + 7200,
          isSessionBucket: true, // Active session bucket
        },
      ]);
      (mockOAuthManager.getAuthStatusWithBuckets as unknown) = mockGetBucketsStatus;

      // When: User checks status
      const result = await executor.execute(mockContext, 'anthropic status');

      // Then: Should mark active bucket
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringMatching(/work@company\.com.*active/),
      });
    });

    it('should show expiry dates for each bucket', async () => {
      // Given: Buckets with different expiry times
      const now = Date.now() / 1000;
      const mockGetBucketsStatus = vi.fn().mockResolvedValue([
        {
          bucket: 'bucket1',
          authenticated: true,
          expiry: now + 3600,
          isSessionBucket: false,
        },
        {
          bucket: 'bucket2',
          authenticated: true,
          expiry: now - 1800, // expired 30 min ago
          isSessionBucket: false,
        },
      ]);
      (mockOAuthManager.getAuthStatusWithBuckets as unknown) = mockGetBucketsStatus;

      // When: User checks status
      const result = await executor.execute(mockContext, 'anthropic status');

      // Then: Should display expiry information for both
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringMatching(/bucket1.*expires.*bucket2.*expired/s),
      });
    });

    it('should handle provider with no buckets', async () => {
      // Given: Provider has no authenticated buckets
      const mockGetBucketsStatus = vi.fn().mockResolvedValue([]);
      (mockOAuthManager.getAuthStatusWithBuckets as unknown) = mockGetBucketsStatus;

      // When: User checks status
      const result = await executor.execute(mockContext, 'anthropic status');

      // Then: Should show no buckets message
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('no buckets'),
      });
    });
  });

  describe('Status display formatting', () => {
    it('should format status output clearly', async () => {
      // Given: Multiple buckets with various states
      const mockGetBucketsStatus = vi.fn().mockResolvedValue([
        {
          bucket: 'default',
          authenticated: true,
          expiry: Date.now() / 1000 + 3600,
          isSessionBucket: true,
        },
        {
          bucket: 'work@company.com',
          authenticated: true,
          expiry: Date.now() / 1000 + 7200,
          isSessionBucket: false,
        },
      ]);
      (mockOAuthManager.getAuthStatusWithBuckets as unknown) = mockGetBucketsStatus;

      // When: User checks status
      const result = await executor.execute(mockContext, 'anthropic status');

      // Then: Should format clearly with provider name
      expect(result.type).toBe('message');
      const content = (result as { content: string }).content;
      expect(content).toContain('anthropic');
      expect(content).toContain('default');
      expect(content).toContain('work@company.com');
    });
  });
});

describe('Phase 5: Auth Command Bucket Support - Switch Bucket', () => {
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

  describe('Switch session bucket', () => {
    it('should switch to specified bucket', async () => {
      // Given: User wants to switch to work bucket
      const mockSetSession = vi.fn();
      const mockListBuckets = vi.fn().mockResolvedValue(['default', 'work@company.com', 'personal@gmail.com']);
      (mockOAuthManager.setSessionBucket as unknown) = mockSetSession;
      (mockOAuthManager.listBuckets as unknown) = mockListBuckets;

      // When: User switches bucket
      const result = await executor.execute(mockContext, 'anthropic switch work@company.com');

      // Then: Should set session bucket
      expect(mockSetSession).toHaveBeenCalledWith('anthropic', 'work@company.com');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('work@company.com'),
      });
    });

    it('should error on non-existent bucket', async () => {
      // Given: User tries to switch to non-existent bucket
      const mockListBuckets = vi.fn().mockResolvedValue(['default', 'work@company.com']);
      (mockOAuthManager.listBuckets as unknown) = mockListBuckets;

      // When: User switches to non-existent bucket
      const result = await executor.execute(mockContext, 'anthropic switch nonexistent');

      // Then: Should return error
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Bucket not found'),
      });
    });

    it('should not modify profile file', async () => {
      // Given: User switches bucket in session
      const mockSetSession = vi.fn();
      const mockListBuckets = vi.fn().mockResolvedValue(['default', 'work@company.com']);
      (mockOAuthManager.setSessionBucket as unknown) = mockSetSession;
      (mockOAuthManager.listBuckets as unknown) = mockListBuckets;

      // When: User switches bucket
      const result = await executor.execute(mockContext, 'anthropic switch work@company.com');

      // Then: Should only set session (no profile modification)
      expect(mockSetSession).toHaveBeenCalledWith('anthropic', 'work@company.com');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringMatching(/session.*temporary/i),
      });
    });

    it('should work without profile loaded', async () => {
      // Given: No profile is currently loaded
      const mockSetSession = vi.fn();
      const mockListBuckets = vi.fn().mockResolvedValue(['default', 'work@company.com']);
      (mockOAuthManager.setSessionBucket as unknown) = mockSetSession;
      (mockOAuthManager.listBuckets as unknown) = mockListBuckets;

      // When: User switches bucket
      const result = await executor.execute(mockContext, 'anthropic switch work@company.com');

      // Then: Should still work (session-level override)
      expect(mockSetSession).toHaveBeenCalledWith('anthropic', 'work@company.com');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('work@company.com'),
      });
    });
  });

  describe('Switch bucket validation', () => {
    it('should validate bucket exists before switching', async () => {
      // Given: Available buckets list
      const mockListBuckets = vi.fn().mockResolvedValue(['default', 'work@company.com']);
      (mockOAuthManager.listBuckets as unknown) = mockListBuckets;

      // When: User tries to switch to non-existent bucket
      const result = await executor.execute(mockContext, 'anthropic switch invalid-bucket');

      // Then: Should validate and error
      expect(mockListBuckets).toHaveBeenCalledWith('anthropic');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Bucket not found'),
      });
    });

    it('should list available buckets in error message', async () => {
      // Given: Available buckets
      const mockListBuckets = vi.fn().mockResolvedValue(['default', 'work@company.com', 'personal@gmail.com']);
      (mockOAuthManager.listBuckets as unknown) = mockListBuckets;

      // When: User tries invalid bucket
      const result = await executor.execute(mockContext, 'anthropic switch invalid');

      // Then: Should show available buckets
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringMatching(/Available buckets.*default.*work@company\.com.*personal@gmail\.com/),
      });
    });
  });

  describe('Switch command parsing', () => {
    it('should parse switch command correctly', async () => {
      // Given: Switch command with bucket name
      const mockSetSession = vi.fn();
      const mockListBuckets = vi.fn().mockResolvedValue(['default', 'mybucket']);
      (mockOAuthManager.setSessionBucket as unknown) = mockSetSession;
      (mockOAuthManager.listBuckets as unknown) = mockListBuckets;

      // When: User switches bucket
      await executor.execute(mockContext, 'anthropic switch mybucket');

      // Then: Should parse correctly
      expect(mockSetSession).toHaveBeenCalledWith('anthropic', 'mybucket');
    });

    it('should require bucket name for switch', async () => {
      // When: User enters switch without bucket name
      const result = await executor.execute(mockContext, 'anthropic switch');

      // Then: Should return error
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringMatching(/Bucket name required/i),
      });
    });
  });
});

describe('Phase 5: Auth Command Bucket Support - Error Handling', () => {
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

  it('should handle bucket operation failures gracefully', async () => {
    // Given: OAuth manager will fail
    const mockAuthenticate = vi.fn().mockRejectedValue(new Error('Network error'));
    (mockOAuthManager.authenticate as unknown) = mockAuthenticate;

    // When: User attempts bucket login
    const result = await executor.execute(mockContext, 'anthropic login work@company.com');

    // Then: Should return user-friendly error
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: expect.stringContaining('Network error'),
    });
  });

  it('should provide actionable error messages', async () => {
    // Given: Invalid bucket name
    const mockListBuckets = vi.fn().mockResolvedValue(['default', 'bucket1']);
    (mockOAuthManager.listBuckets as unknown) = mockListBuckets;

    // When: User tries non-existent bucket
    const result = await executor.execute(mockContext, 'anthropic switch nonexistent');

    // Then: Should suggest valid options
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: expect.stringMatching(/available buckets/i),
    });
  });

  it('should handle empty bucket lists', async () => {
    // Given: Provider has no buckets
    const mockListBuckets = vi.fn().mockResolvedValue([]);
    (mockOAuthManager.listBuckets as unknown) = mockListBuckets;

    // When: User tries to switch bucket
    const result = await executor.execute(mockContext, 'anthropic switch somebucket');

    // Then: Should provide helpful error
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: expect.stringMatching(/no buckets.*authenticate first/i),
    });
  });
});

describe('Phase 5: Auth Command Bucket Support - Backward Compatibility', () => {
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

  it('should maintain existing logout behavior without bucket', async () => {
    // Given: User uses logout without bucket (existing behavior)
    const mockLogout = vi.fn().mockResolvedValue(undefined);
    const mockIsAuthenticated = vi.fn().mockResolvedValue(true);
    (mockOAuthManager.logout as unknown) = mockLogout;
    (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;

    // When: User logs out without bucket
    const result = await executor.execute(mockContext, 'anthropic logout');

    // Then: Should logout from default bucket
    expect(mockLogout).toHaveBeenCalledWith('anthropic', undefined);
    expect(result.type).toBe('message');
  });

  it('should maintain existing status behavior', async () => {
    // Given: User checks status (existing behavior)
    const mockIsEnabled = vi.fn().mockReturnValue(true);
    const mockIsAuthenticated = vi.fn().mockResolvedValue(true);
    const mockPeekToken = vi.fn().mockResolvedValue({
      access_token: 'token',
      expiry: Date.now() / 1000 + 3600,
      token_type: 'Bearer',
    });
    const mockGetHigherPriority = vi.fn().mockResolvedValue(null);
    (mockOAuthManager.isOAuthEnabled as unknown) = mockIsEnabled;
    (mockOAuthManager.isAuthenticated as unknown) = mockIsAuthenticated;
    (mockOAuthManager.peekStoredToken as unknown) = mockPeekToken;
    (mockOAuthManager.getHigherPriorityAuth as unknown) = mockGetHigherPriority;

    // When: User checks status without buckets
    const result = await executor.execute(mockContext, 'anthropic');

    // Then: Should show status (backward compatible)
    expect(result.type).toBe('message');
    expect((result as { messageType: string }).messageType).toBe('info');
  });
});
