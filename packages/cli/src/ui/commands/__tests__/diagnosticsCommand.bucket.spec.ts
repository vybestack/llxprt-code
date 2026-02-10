/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251213issue490
 * @phase Phase 8: Diagnostics Enhancement
 * TDD Tests for enhanced /diagnostics command with bucket support
 *
 * These tests MUST be written FIRST and FAIL initially (RED phase).
 * Implementation comes after tests are written and failing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { diagnosticsCommand } from '../diagnosticsCommand.js';
import type { CommandContext } from '../types.js';
import type { OAuthManager } from '../../../auth/oauth-manager.js';
import type { TokenStore, OAuthToken } from '../../../auth/types.js';

// Hoisted mocks for RuntimeContext
const runtimeMocks = vi.hoisted(() => ({
  getRuntimeApiMock: vi.fn(),
}));

// Mock modules before imports
vi.mock('../../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: runtimeMocks.getRuntimeApiMock,
}));

// Mock TokenStore for bucket operations
const createMockTokenStore = (): TokenStore => ({
  saveToken: vi.fn(),
  getToken: vi.fn(),
  removeToken: vi.fn(),
  listProviders: vi.fn(),
  listBuckets: vi.fn(),
  getBucketStats: vi.fn(),
  acquireRefreshLock: vi.fn(),
  releaseRefreshLock: vi.fn(),
});

// Mock OAuthManager
const createMockOAuthManager = (): OAuthManager =>
  ({
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
      .mockReturnValue(['anthropic', 'gemini', 'qwen']),
    getHigherPriorityAuth: vi.fn(),
    logout: vi.fn(),
    authenticate: vi.fn(),
    getAuthStatusWithBuckets: vi.fn(),
    setSessionBucket: vi.fn(),
    clearSessionBucket: vi.fn(),
    getSessionBucket: vi.fn(),
    logoutAllBuckets: vi.fn(),
    listBuckets: vi.fn(),
    getTokenStore: vi.fn(),
  }) as unknown as OAuthManager;

// Mock runtime API
const createMockRuntimeApi = () => ({
  getRuntimeDiagnosticsSnapshot: vi.fn().mockReturnValue({
    providerName: 'anthropic',
    modelName: 'claude-sonnet-4',
    profileName: 'test-profile',
    modelParams: {},
    ephemeralSettings: {},
  }),
  getActiveProviderStatus: vi.fn().mockReturnValue({
    providerName: 'anthropic',
  }),
  getCliProviderManager: vi.fn(),
  getCliOAuthManager: vi.fn(),
});

describe('Phase 8: Diagnostics Enhancement - TDD Tests', () => {
  let mockContext: CommandContext;
  let mockTokenStore: TokenStore;
  let mockOAuthManager: OAuthManager;
  let mockRuntimeApi: ReturnType<typeof createMockRuntimeApi>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTokenStore = createMockTokenStore();
    mockOAuthManager = createMockOAuthManager();

    // Mock getTokenStore to return our mock
    (mockOAuthManager.getTokenStore as unknown) = vi
      .fn()
      .mockReturnValue(mockTokenStore);

    mockRuntimeApi = createMockRuntimeApi();
    // Override getCliOAuthManager to return our mock
    mockRuntimeApi.getCliOAuthManager = vi
      .fn()
      .mockReturnValue(mockOAuthManager);

    // Set up runtime API mock
    runtimeMocks.getRuntimeApiMock.mockReturnValue(mockRuntimeApi);

    mockContext = {
      services: {
        config: {
          getDebugMode: () => false,
          getApprovalMode: () => 'off',
          getIdeMode: () => false,
          getIdeClient: () => null,
          getMcpServers: () => ({}),
          getMcpServerCommand: () => null,
          getUserMemory: () => null,
          getLlxprtMdFileCount: () => 0,
          getToolRegistry: async () => ({
            getAllTools: () => [],
          }),
        } as never,
        settings: {
          merged: {
            ui: {
              theme: 'default',
              usageStatisticsEnabled: false,
            },
            defaultProfile: 'test-profile',
            sandbox: 'disabled',
          },
        } as never,
        git: undefined,
        logger: {} as never,
        oauthManager: mockOAuthManager,
      },
      ui: {} as never,
      session: {} as never,
    };
  });

  describe('Expanded OAuth section - Multiple buckets per provider', () => {
    it('should show all buckets for a provider (not just single token)', async () => {
      // Given: Anthropic has multiple buckets
      const mockToken1: OAuthToken = {
        access_token: 'token1',
        refresh_token: 'refresh1',
        expiry: Date.now() / 1000 + 3600, // 1 hour from now
        token_type: 'Bearer',
      };

      const mockToken2: OAuthToken = {
        access_token: 'token2',
        refresh_token: 'refresh2',
        expiry: Date.now() / 1000 + 7200, // 2 hours from now
        token_type: 'Bearer',
      };

      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') {
            return ['default', 'work@company.com'];
          }
          return [];
        });

      (mockTokenStore.getToken as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string, bucket?: string) => {
          if (provider === 'anthropic' && bucket === 'default') {
            return mockToken1;
          }
          if (provider === 'anthropic' && bucket === 'work@company.com') {
            return mockToken2;
          }
          return null;
        });

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should show both buckets
      expect(result?.type).toBe('message');
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('## OAuth Tokens');
      expect(content).toContain('default');
      expect(content).toContain('work@company.com');
      expect(content).toContain('anthropic');
    });

    it('should show bucket count per provider', async () => {
      // Given: Anthropic has 2 buckets
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') {
            return ['default', 'work@company.com'];
          }
          return [];
        });

      (mockTokenStore.getToken as unknown) = vi.fn().mockResolvedValue({
        access_token: 'token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      });

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should show bucket count
      const content = (result as { content?: string }).content || '';
      expect(content).toMatch(/Buckets:\s*2/);
    });

    it('should show status (authenticated/expired) per bucket', async () => {
      // Given: One bucket authenticated, one expired
      const authenticatedToken: OAuthToken = {
        access_token: 'valid_token',
        refresh_token: 'refresh',
        expiry: Date.now() / 1000 + 3600, // Future
        token_type: 'Bearer',
      };

      const expiredToken: OAuthToken = {
        access_token: 'expired_token',
        expiry: Date.now() / 1000 - 3600, // Past
        token_type: 'Bearer',
      };

      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default', 'expired-bucket']);

      (mockTokenStore.getToken as unknown) = vi
        .fn()
        .mockImplementation(async (_provider: string, bucket?: string) => {
          if (bucket === 'default') return authenticatedToken;
          if (bucket === 'expired-bucket') return expiredToken;
          return null;
        });

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should show both statuses
      const content = (result as { content?: string }).content || '';
      expect(content).toMatch(/Status:\s*Authenticated/);
      expect(content).toMatch(/Status:\s*Expired/);
    });

    it('should show expiry time and remaining time per bucket', async () => {
      // Given: Token expiring in specific time
      const futureExpiry = Date.now() / 1000 + 3600 + 900; // 1h 15m from now
      const mockToken: OAuthToken = {
        access_token: 'token',
        refresh_token: 'refresh',
        expiry: futureExpiry,
        token_type: 'Bearer',
      };

      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);

      (mockTokenStore.getToken as unknown) = vi
        .fn()
        .mockResolvedValue(mockToken);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should show expiry date and remaining time
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('Expires:');
      expect(content).toMatch(/Time Remaining:\s*\d+h\s*\d+m/);
      expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO date format
    });

    it('should show refresh token availability per bucket', async () => {
      // Given: One bucket with refresh token, one without
      const tokenWithRefresh: OAuthToken = {
        access_token: 'token1',
        refresh_token: 'refresh_token_here',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      const tokenWithoutRefresh: OAuthToken = {
        access_token: 'token2',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['with-refresh', 'without-refresh']);

      (mockTokenStore.getToken as unknown) = vi
        .fn()
        .mockImplementation(async (_provider: string, bucket?: string) => {
          if (bucket === 'with-refresh') return tokenWithRefresh;
          if (bucket === 'without-refresh') return tokenWithoutRefresh;
          return null;
        });

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should show refresh token status for both
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('Refresh Token: Available');
      expect(content).toContain('Refresh Token: None');
    });
  });

  describe('Multi-provider bucket display', () => {
    it('should display buckets grouped by provider', async () => {
      // Given: Multiple providers with different buckets
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') return ['default', 'work@company.com'];
          if (provider === 'gemini') return ['default'];
          if (provider === 'qwen') return ['default', 'personal@gmail.com'];
          return [];
        });

      (mockTokenStore.getToken as unknown) = vi.fn().mockResolvedValue({
        access_token: 'token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      });

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should group by provider
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('anthropic:');
      expect(content).toContain('gemini:');
      expect(content).toContain('qwen:');
    });

    it('should show correct bucket count for each provider', async () => {
      // Given: Different bucket counts per provider
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') return ['default', 'work@company.com'];
          if (provider === 'gemini') return ['default'];
          return [];
        });

      (mockTokenStore.getToken as unknown) = vi.fn().mockResolvedValue({
        access_token: 'token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      });

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Each provider should show correct count
      const content = (result as { content?: string }).content || '';

      // Anthropic section should have 2 buckets
      const anthropicSection = content.split('gemini:')[0];
      expect(anthropicSection).toMatch(/Buckets:\s*2/);

      // Gemini section should have 1 bucket
      const geminiSection =
        content.split('gemini:')[1]?.split('qwen:')[0] ||
        content.split('gemini:')[1];
      if (geminiSection) {
        expect(geminiSection).toMatch(/Buckets:\s*1/);
      }
    });
  });

  describe('Provider Information section enhancement', () => {
    it('should show current OAuth bucket in provider info section', async () => {
      // Given: Current session bucket is set
      (mockOAuthManager.getSessionBucket as unknown) = vi
        .fn()
        .mockReturnValue('work@company.com');

      (mockTokenStore.listBuckets as unknown) = vi.fn().mockResolvedValue([]);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should show current bucket
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('## Provider Information');
      expect(content).toContain('OAuth Bucket: work@company.com');
    });

    it('should show "default" when no session bucket is set', async () => {
      // Given: No session bucket override
      (mockOAuthManager.getSessionBucket as unknown) = vi
        .fn()
        .mockReturnValue(undefined);
      (mockTokenStore.listBuckets as unknown) = vi.fn().mockResolvedValue([]);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should show default
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('## Provider Information');
      expect(content).toContain('OAuth Bucket: default');
    });

    it('should show bucket info for currently loaded profile', async () => {
      // Given: Profile loaded with specific bucket
      mockRuntimeApi.getRuntimeDiagnosticsSnapshot.mockReturnValue({
        providerName: 'anthropic',
        modelName: 'claude-sonnet-4',
        profileName: 'multi-bucket-profile',
        modelParams: {},
        ephemeralSettings: {},
      });

      (mockOAuthManager.getSessionBucket as unknown) = vi
        .fn()
        .mockReturnValue('work@company.com');
      (mockTokenStore.listBuckets as unknown) = vi.fn().mockResolvedValue([]);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should correlate profile with bucket
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('Current Profile: multi-bucket-profile');
      expect(content).toContain('OAuth Bucket: work@company.com');
    });
  });

  describe('Output format validation', () => {
    it('should match expected hierarchical format with provider and bucket sections', async () => {
      // Given: Provider with multiple buckets (use relative times to avoid flakiness)
      const futureExpiry1 = Date.now() / 1000 + 3600; // 1 hour from now
      const futureExpiry2 = Date.now() / 1000 + 7200; // 2 hours from now

      const token1: OAuthToken = {
        access_token: 'token1',
        refresh_token: 'refresh1',
        expiry: futureExpiry1,
        token_type: 'Bearer',
      };

      const token2: OAuthToken = {
        access_token: 'token2',
        refresh_token: 'refresh2',
        expiry: futureExpiry2,
        token_type: 'Bearer',
      };

      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') return ['default', 'work@company.com'];
          return [];
        });

      (mockTokenStore.getToken as unknown) = vi
        .fn()
        .mockImplementation(async (_provider: string, bucket?: string) => {
          if (bucket === 'default') return token1;
          if (bucket === 'work@company.com') return token2;
          return null;
        });

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Format should match specification
      const content = (result as { content?: string }).content || '';

      // Should have OAuth Tokens section
      expect(content).toContain('## OAuth Tokens');
      expect(content).toContain('### Provider Tokens');

      // Should have provider with buckets count
      expect(content).toMatch(/- anthropic:/);
      expect(content).toMatch(/Buckets:\s*2/);

      // Should have bucket details with proper indentation
      expect(content).toMatch(/- default:/);
      expect(content).toMatch(/- work@company\.com:/);

      // Each bucket should have Status, Expires, Time Remaining, Refresh Token
      expect(content).toMatch(/Status:\s*Authenticated/);
      expect(content).toMatch(/Expires:\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO date format
      expect(content).toMatch(/Time Remaining:\s*\d+h\s*\d+m/);
      expect(content).toContain('Refresh Token: Available');
    });

    it('should format time remaining in hours and minutes', async () => {
      // Given: Token expiring in exactly 23 hours and 15 minutes
      const expiry = Date.now() / 1000 + 23 * 3600 + 15 * 60;
      const mockToken: OAuthToken = {
        access_token: 'token',
        refresh_token: 'refresh',
        expiry,
        token_type: 'Bearer',
      };

      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);
      (mockTokenStore.getToken as unknown) = vi
        .fn()
        .mockResolvedValue(mockToken);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should format as "23h 15m"
      const content = (result as { content?: string }).content || '';
      expect(content).toMatch(/Time Remaining:\s*23h\s*1[45]m/); // Allow for 14-15m due to timing
    });

    it('should use indentation to show bucket hierarchy under providers', async () => {
      // Given: Multiple levels of information
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);
      (mockTokenStore.getToken as unknown) = vi.fn().mockResolvedValue({
        access_token: 'token',
        refresh_token: 'refresh',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      });

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Indentation should be consistent
      const content = (result as { content?: string }).content || '';

      // Provider at level 1 (-)
      expect(content).toMatch(/^- anthropic:/m);

      // Bucket count at level 2 (  -)
      expect(content).toMatch(/^ {2}- Buckets:/m);

      // Bucket name at level 2 (  -)
      expect(content).toMatch(/^ {2}- default:/m);

      // Bucket details at level 3 (    -)
      expect(content).toMatch(/^ {4}- Status:/m);
      expect(content).toMatch(/^ {4}- Expires:/m);
    });
  });

  describe('Empty states', () => {
    it('should show appropriate message when provider has no buckets', async () => {
      // Given: No buckets for any provider
      (mockTokenStore.listBuckets as unknown) = vi.fn().mockResolvedValue([]);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should show "no tokens" message
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('## OAuth Tokens');
      expect(content).toContain('No OAuth tokens configured');
    });

    it('should not show provider section if it has no buckets', async () => {
      // Given: Only anthropic has buckets
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') return ['default'];
          return [];
        });

      (mockTokenStore.getToken as unknown) = vi.fn().mockResolvedValue({
        access_token: 'token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      });

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should only show anthropic, not gemini or qwen
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('- anthropic:');
      expect(content).not.toContain('- gemini:');
      expect(content).not.toContain('- qwen:');
    });

    it('should handle missing token data gracefully', async () => {
      // Given: Bucket exists but token is null
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);
      (mockTokenStore.getToken as unknown) = vi.fn().mockResolvedValue(null);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should show bucket with "None" status or skip it
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('## OAuth Tokens');
      // Should either show "Status: None" or not show the bucket at all
      expect(result?.type).toBe('message');
    });
  });

  describe('Bucket status determination', () => {
    it('should mark token as "Authenticated" when not expired', async () => {
      // Given: Token expires in the future
      const futureToken: OAuthToken = {
        access_token: 'token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      };

      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);
      (mockTokenStore.getToken as unknown) = vi
        .fn()
        .mockResolvedValue(futureToken);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should show Authenticated
      const content = (result as { content?: string }).content || '';
      expect(content).toMatch(/Status:\s*Authenticated/);
      expect(content).not.toMatch(/Status:\s*Expired/);
    });

    it('should mark token as "Expired" when past expiry time', async () => {
      // Given: Token expired in the past
      const expiredToken: OAuthToken = {
        access_token: 'token',
        expiry: Date.now() / 1000 - 3600,
        token_type: 'Bearer',
      };

      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);
      (mockTokenStore.getToken as unknown) = vi
        .fn()
        .mockResolvedValue(expiredToken);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should show Expired
      const content = (result as { content?: string }).content || '';
      expect(content).toMatch(/Status:\s*Expired/);
      expect(content).not.toMatch(/Status:\s*Authenticated/);
    });

    it('should handle tokens expiring very soon (within seconds)', async () => {
      // Given: Token expires in 10 seconds
      const soonToken: OAuthToken = {
        access_token: 'token',
        expiry: Date.now() / 1000 + 10,
        token_type: 'Bearer',
      };

      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);
      (mockTokenStore.getToken as unknown) = vi
        .fn()
        .mockResolvedValue(soonToken);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should still show Authenticated (not expired yet)
      const content = (result as { content?: string }).content || '';
      expect(content).toMatch(/Status:\s*Authenticated/);
      expect(content).toMatch(/Time Remaining:\s*0h\s*0m/); // Less than 1 minute
    });
  });

  describe('Error handling', () => {
    it('should handle TokenStore errors gracefully', async () => {
      // Given: TokenStore throws an error
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockRejectedValue(new Error('Storage error'));

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should still return diagnostics with error indication
      expect(result?.type).toBe('message');
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('## OAuth Tokens');
      // Should show error or fallback message
    });

    it('should handle missing OAuthManager gracefully', async () => {
      // Given: No OAuthManager available
      const contextWithoutOAuth = {
        ...mockContext,
        services: {
          ...mockContext.services,
          oauthManager: undefined,
        },
      };

      // Also set runtime API to return null OAuthManager
      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        ...mockRuntimeApi,
        getCliOAuthManager: vi.fn().mockReturnValue(null),
      });

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(contextWithoutOAuth, '');

      // Then: Should show appropriate message
      expect(result?.type).toBe('message');
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('## OAuth Tokens');
      expect(content).toContain('No OAuth tokens configured');
    });

    it('should handle malformed token data gracefully', async () => {
      // Given: Token missing required fields
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);
      (mockTokenStore.getToken as unknown) = vi.fn().mockResolvedValue({
        access_token: 'token',
        // Missing expiry field
        token_type: 'Bearer',
      } as OAuthToken);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: Should handle gracefully
      expect(result?.type).toBe('message');
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('## OAuth Tokens');
    });
  });

  describe('Integration with existing diagnostics sections', () => {
    it('should preserve existing diagnostics sections', async () => {
      // Given: Standard diagnostics setup
      (mockTokenStore.listBuckets as unknown) = vi.fn().mockResolvedValue([]);

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: All standard sections should be present
      const content = (result as { content?: string }).content || '';
      expect(content).toContain('# LLxprt Diagnostics');
      expect(content).toContain('## Provider Information');
      expect(content).toContain('## Model Parameters');
      expect(content).toContain('## Ephemeral Settings');
      expect(content).toContain('## System Information');
      expect(content).toContain('## Settings');
      expect(content).toContain('## OAuth Tokens');
    });

    it('should show OAuth section after standard sections', async () => {
      // Given: Standard diagnostics setup
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);
      (mockTokenStore.getToken as unknown) = vi.fn().mockResolvedValue({
        access_token: 'token',
        expiry: Date.now() / 1000 + 3600,
        token_type: 'Bearer',
      });

      // When: User runs /diagnostics
      const result = await diagnosticsCommand.action!(mockContext, '');

      // Then: OAuth section should come after Provider Information
      const content = (result as { content?: string }).content || '';
      const providerIndex = content.indexOf('## Provider Information');
      const oauthIndex = content.indexOf('## OAuth Tokens');
      expect(oauthIndex).toBeGreaterThan(providerIndex);
    });
  });
});
