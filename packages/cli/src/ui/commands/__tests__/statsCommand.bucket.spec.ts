/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251213issue490
 * @phase Phase 7: Stats Buckets Command
 * TDD Tests for /stats buckets subcommand
 *
 * These tests MUST be written FIRST and FAIL initially (RED phase).
 * Implementation comes after tests are written and failing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { statsCommand } from '../statsCommand.js';
import type { CommandContext } from '../types.js';
import type { OAuthManager } from '../../../auth/oauth-manager.js';
import type { TokenStore } from '../../../auth/types.js';

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

describe('Phase 7: Stats Buckets Command - TDD Tests', () => {
  let mockContext: CommandContext;
  let mockTokenStore: TokenStore;
  let mockOAuthManager: OAuthManager;
  let addedItems: unknown[];

  beforeEach(() => {
    vi.clearAllMocks();
    addedItems = [];
    mockTokenStore = createMockTokenStore();
    mockOAuthManager = createMockOAuthManager();

    // Mock getTokenStore to return our mock
    (mockOAuthManager.getTokenStore as unknown) = vi
      .fn()
      .mockReturnValue(mockTokenStore);

    mockContext = {
      services: {
        config: null,
        settings: {} as never,
        git: undefined,
        logger: {} as never,
        oauthManager: mockOAuthManager,
      },
      ui: {
        addItem: vi.fn((item: unknown) => {
          addedItems.push(item);
        }),
      } as never,
      session: {
        stats: {
          sessionStartTime: new Date(),
        },
      } as never,
    };
  });

  describe('Bucket statistics display', () => {
    it('should show request count per bucket for single provider', async () => {
      // Given: Anthropic has two buckets with different request counts
      const mockBucketStats = [
        {
          bucket: 'default',
          requestCount: 47,
          percentage: 68.1,
          lastUsed: 1702512000000, // 2023-12-14
        },
        {
          bucket: 'work@company.com',
          requestCount: 22,
          percentage: 31.9,
          lastUsed: 1702598400000, // 2023-12-15
        },
      ];

      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') {
            return ['default', 'work@company.com'];
          }
          return [];
        });

      (mockTokenStore.getBucketStats as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string, bucket: string) => {
          if (provider === 'anthropic') {
            return mockBucketStats.find((s) => s.bucket === bucket);
          }
          return {
            bucket,
            requestCount: 0,
            percentage: 0,
            lastUsed: undefined,
          };
        });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      expect(bucketsSubCommand).toBeDefined();

      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Should display request counts and percentages
      expect(addedItems.length).toBeGreaterThan(0);
      const message = addedItems[0] as { type: string; text?: string };
      expect(message.type).toBe('info');
      expect(message.text).toContain('anthropic');
      expect(message.text).toContain('default');
      expect(message.text).toContain('47 requests');
      expect(message.text).toContain('68.1%');
      expect(message.text).toContain('work@company.com');
      expect(message.text).toContain('22 requests');
      expect(message.text).toContain('31.9%');
    });

    it('should show percentage of total requests per provider', async () => {
      // Given: Provider has multiple buckets with different usage
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default', 'personal@gmail.com']);

      (mockTokenStore.getBucketStats as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string, bucket: string) => {
          if (bucket === 'default') {
            return {
              bucket,
              requestCount: 75,
              percentage: 75.0,
              lastUsed: Date.now(),
            };
          }
          return {
            bucket,
            requestCount: 25,
            percentage: 25.0,
            lastUsed: Date.now(),
          };
        });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Percentages should sum to 100% per provider
      const message = addedItems[0] as { text?: string };
      expect(message.text).toContain('75.0%');
      expect(message.text).toContain('25.0%');
    });

    it('should show last used timestamp per bucket', async () => {
      // Given: Buckets with last-used timestamps
      const lastUsedTime = new Date('2023-12-15T10:30:00Z');
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);

      (mockTokenStore.getBucketStats as unknown) = vi.fn().mockResolvedValue({
        bucket: 'default',
        requestCount: 10,
        percentage: 100,
        lastUsed: lastUsedTime.getTime(),
      });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Should display last used timestamp
      const message = addedItems[0] as { text?: string };
      expect(message.text).toContain('Last used');
      // Should contain date or time representation
      expect(message.text).toMatch(/\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/);
    });
  });

  describe('Multi-provider display', () => {
    it('should group buckets by provider (anthropic, gemini, qwen)', async () => {
      // Given: Multiple providers with buckets
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') {
            return ['default', 'work@company.com'];
          }
          if (provider === 'gemini') {
            return ['default'];
          }
          if (provider === 'qwen') {
            return ['default', 'personal@gmail.com'];
          }
          return [];
        });

      (mockTokenStore.getBucketStats as unknown) = vi.fn().mockResolvedValue({
        bucket: 'default',
        requestCount: 10,
        percentage: 100,
        lastUsed: Date.now(),
      });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Should show sections for each provider
      const message = addedItems[0] as { text?: string };
      expect(message.text).toContain('### anthropic');
      expect(message.text).toContain('### gemini');
      expect(message.text).toContain('### qwen');
    });

    it('should show statistics for each providers buckets separately', async () => {
      // Given: Different providers with different bucket stats
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') {
            return ['default', 'work@company.com'];
          }
          if (provider === 'gemini') {
            return ['default'];
          }
          return [];
        });

      (mockTokenStore.getBucketStats as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string, bucket: string) => {
          if (provider === 'anthropic' && bucket === 'default') {
            return {
              bucket,
              requestCount: 47,
              percentage: 68.1,
              lastUsed: Date.now(),
            };
          }
          if (provider === 'anthropic' && bucket === 'work@company.com') {
            return {
              bucket,
              requestCount: 22,
              percentage: 31.9,
              lastUsed: Date.now(),
            };
          }
          if (provider === 'gemini' && bucket === 'default') {
            return {
              bucket,
              requestCount: 15,
              percentage: 100,
              lastUsed: Date.now(),
            };
          }
          return {
            bucket,
            requestCount: 0,
            percentage: 0,
            lastUsed: undefined,
          };
        });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Anthropic stats should be separate from Gemini stats
      const message = addedItems[0] as { text?: string };

      // Check anthropic section
      const anthropicSection = message.text!.split('### gemini')[0];
      expect(anthropicSection).toContain('default');
      expect(anthropicSection).toContain('47 requests');
      expect(anthropicSection).toContain('work@company.com');
      expect(anthropicSection).toContain('22 requests');

      // Check gemini section
      const geminiSection = message.text!.split('### gemini')[1];
      expect(geminiSection).toContain('default');
      expect(geminiSection).toContain('15 requests');
      expect(geminiSection).toContain('100');
    });

    it('should not show providers with no buckets', async () => {
      // Given: Only anthropic has buckets, others are empty
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') {
            return ['default'];
          }
          return [];
        });

      (mockTokenStore.getBucketStats as unknown) = vi.fn().mockResolvedValue({
        bucket: 'default',
        requestCount: 10,
        percentage: 100,
        lastUsed: Date.now(),
      });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Should only show anthropic, not gemini or qwen
      const message = addedItems[0] as { text?: string };
      expect(message.text).toContain('anthropic');
      expect(message.text).not.toContain('### gemini');
      expect(message.text).not.toContain('### qwen');
    });
  });

  describe('Empty states', () => {
    it('should show appropriate message when no bucket stats available', async () => {
      // Given: No buckets exist for any provider
      (mockTokenStore.listBuckets as unknown) = vi.fn().mockResolvedValue([]);

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Should show "no buckets" message
      const message = addedItems[0] as { type: string; text?: string };
      expect(message.type).toBe('info');
      expect(message.text).toContain('No OAuth buckets');
    });

    it('should show appropriate message when provider has no buckets', async () => {
      // Given: Anthropic has buckets but others don't
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') {
            return ['default'];
          }
          return [];
        });

      (mockTokenStore.getBucketStats as unknown) = vi.fn().mockResolvedValue({
        bucket: 'default',
        requestCount: 5,
        percentage: 100,
        lastUsed: Date.now(),
      });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Should only show providers with buckets
      const message = addedItems[0] as { text?: string };
      expect(message.text).toContain('anthropic');
      expect(message.text).not.toContain('gemini');
      expect(message.text).not.toContain('qwen');
    });

    it('should handle buckets with zero requests gracefully', async () => {
      // Given: Bucket exists but has never been used
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);

      (mockTokenStore.getBucketStats as unknown) = vi.fn().mockResolvedValue({
        bucket: 'default',
        requestCount: 0,
        percentage: 0,
        lastUsed: undefined,
      });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Should show bucket with 0 requests and "Never" for last used
      const message = addedItems[0] as { text?: string };
      expect(message.text).toContain('default');
      expect(message.text).toContain('0 requests');
      expect(message.text).toMatch(/Never|Not used/i);
    });
  });

  describe('Output format', () => {
    it('should match expected format with header and provider sections', async () => {
      // Given: Multiple providers with buckets
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string) => {
          if (provider === 'anthropic') {
            return ['default', 'work@company.com'];
          }
          if (provider === 'gemini') {
            return ['default'];
          }
          return [];
        });

      (mockTokenStore.getBucketStats as unknown) = vi
        .fn()
        .mockImplementation(async (provider: string, bucket: string) => {
          if (provider === 'anthropic' && bucket === 'default') {
            return {
              bucket,
              requestCount: 47,
              percentage: 68.1,
              lastUsed: Date.now(),
            };
          }
          if (provider === 'anthropic' && bucket === 'work@company.com') {
            return {
              bucket,
              requestCount: 22,
              percentage: 31.9,
              lastUsed: Date.now(),
            };
          }
          if (provider === 'gemini' && bucket === 'default') {
            return {
              bucket,
              requestCount: 15,
              percentage: 100,
              lastUsed: Date.now(),
            };
          }
          return {
            bucket,
            requestCount: 0,
            percentage: 0,
            lastUsed: undefined,
          };
        });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Output should match expected format
      const message = addedItems[0] as { text?: string };

      // Should have header
      expect(message.text).toMatch(/OAuth Bucket Statistics/i);

      // Should have markdown headings for providers
      expect(message.text).toContain('### anthropic');
      expect(message.text).toContain('### gemini');

      // Should use list format for buckets
      expect(message.text).toMatch(/- default:/);
      expect(message.text).toMatch(/- work@company\.com:/);

      // Should show stats with proper formatting
      expect(message.text).toContain('47 requests (68.1%)');
      expect(message.text).toContain('22 requests (31.9%)');
      expect(message.text).toContain('15 requests (100');
    });

    it('should format percentages with one decimal place', async () => {
      // Given: Buckets with various percentage values
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);

      (mockTokenStore.getBucketStats as unknown) = vi.fn().mockResolvedValue({
        bucket: 'default',
        requestCount: 33,
        percentage: 33.333333,
        lastUsed: Date.now(),
      });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Percentage should be formatted to 1 decimal place
      const message = addedItems[0] as { text?: string };
      expect(message.text).toContain('33.3%');
      expect(message.text).not.toContain('33.333333');
    });

    it('should format last used timestamp in readable format', async () => {
      // Given: Bucket with specific last used time
      const lastUsedTime = new Date('2023-12-15T14:30:00Z');
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue(['default']);

      (mockTokenStore.getBucketStats as unknown) = vi.fn().mockResolvedValue({
        bucket: 'default',
        requestCount: 10,
        percentage: 100,
        lastUsed: lastUsedTime.getTime(),
      });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Should show readable timestamp
      const message = addedItems[0] as { text?: string };
      expect(message.text).toMatch(/Last used:.*\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('Integration with TokenStore', () => {
    it('should call listBuckets for all supported providers', async () => {
      // Given: Mock supported providers
      const supportedProviders = ['anthropic', 'gemini', 'qwen'];
      (mockOAuthManager.getSupportedProviders as unknown) = vi
        .fn()
        .mockReturnValue(supportedProviders);
      (mockTokenStore.listBuckets as unknown) = vi.fn().mockResolvedValue([]);

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Should query all providers
      expect(mockTokenStore.listBuckets).toHaveBeenCalledWith('anthropic');
      expect(mockTokenStore.listBuckets).toHaveBeenCalledWith('gemini');
      expect(mockTokenStore.listBuckets).toHaveBeenCalledWith('qwen');
    });

    it('should call getBucketStats for each bucket', async () => {
      // Given: Provider with multiple buckets
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockResolvedValue([
          'default',
          'work@company.com',
          'personal@gmail.com',
        ]);

      (mockTokenStore.getBucketStats as unknown) = vi.fn().mockResolvedValue({
        bucket: 'default',
        requestCount: 0,
        percentage: 0,
        lastUsed: undefined,
      });

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Should query stats for each bucket
      expect(mockTokenStore.getBucketStats).toHaveBeenCalledWith(
        expect.any(String),
        'default',
      );
      expect(mockTokenStore.getBucketStats).toHaveBeenCalledWith(
        expect.any(String),
        'work@company.com',
      );
      expect(mockTokenStore.getBucketStats).toHaveBeenCalledWith(
        expect.any(String),
        'personal@gmail.com',
      );
    });
  });

  describe('Error handling', () => {
    it('should handle TokenStore errors gracefully', async () => {
      // Given: TokenStore throws an error
      (mockTokenStore.listBuckets as unknown) = vi
        .fn()
        .mockRejectedValue(new Error('Storage error'));

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(mockContext, '');

      // Then: Should show error message
      const message = addedItems[0] as { type: string; text?: string };
      expect(message.type).toBe('error');
      expect(message.text).toMatch(/error|failed/i);
    });

    it('should handle missing oauthManager gracefully', async () => {
      // Given: Context without oauthManager
      const contextWithoutOAuth = {
        ...mockContext,
        services: {
          ...mockContext.services,
          oauthManager: undefined,
        },
      };

      // When: User runs /stats buckets
      const bucketsSubCommand = statsCommand.subCommands?.find(
        (cmd) => cmd.name === 'buckets',
      );
      await bucketsSubCommand!.action!(contextWithoutOAuth, '');

      // Then: Should show info message
      const message = addedItems[0] as { type: string; text?: string };
      expect(message.type).toBe('info');
      expect(message.text).toMatch(/OAuth.*not available|not configured/i);
    });
  });
});
