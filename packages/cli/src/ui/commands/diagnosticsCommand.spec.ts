/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { diagnosticsCommand } from './diagnosticsCommand.js';
import type { CommandContext, MessageActionReturn } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import {
  MCPOAuthTokenStorage,
  type MCPOAuthCredentials,
} from '@vybestack/llxprt-code-core';
import type { OAuthToken } from '../../auth/types.js';

// Helper functions
function createTestToken(expiryInSeconds: number): OAuthToken {
  return {
    access_token: `test_token_${Date.now()}`,
    refresh_token: `refresh_token_${Date.now()}`,
    expiry: Math.floor(Date.now() / 1000) + expiryInSeconds,
    token_type: 'Bearer',
    scope: 'read write',
  };
}

function createMockTokenStore(providers: Record<string, OAuthToken | null>): {
  listBuckets: ReturnType<typeof vi.fn>;
  getToken: ReturnType<typeof vi.fn>;
  saveToken: ReturnType<typeof vi.fn>;
  removeToken: ReturnType<typeof vi.fn>;
  listProviders: ReturnType<typeof vi.fn>;
  getBucketStats: ReturnType<typeof vi.fn>;
} {
  return {
    listBuckets: vi.fn(async (provider: string) => {
      const token = providers[provider];
      return token ? ['default'] : [];
    }),
    getToken: vi.fn(async (provider: string) => providers[provider] || null),
    saveToken: vi.fn(),
    removeToken: vi.fn(),
    listProviders: vi.fn(async () =>
      Object.keys(providers).filter((p) => providers[p]),
    ),
    getBucketStats: vi.fn(async () => null),
  };
}

function createMCPCredentials(
  serverName: string,
  expiresAt?: number,
  opts?: { refreshToken?: string; scope?: string; tokenType?: string },
): MCPOAuthCredentials {
  return {
    serverName,
    token: {
      accessToken: `mcp_token_${serverName}`,
      refreshToken: opts?.refreshToken,
      expiresAt,
      tokenType: opts?.tokenType || 'Bearer',
      scope: opts?.scope,
    },
    updatedAt: Date.now(),
  };
}

// Hoisted mocks for RuntimeContext
const runtimeMocks = vi.hoisted(() => ({
  getRuntimeApiMock: vi.fn(),
}));

// Mock modules before imports
vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: runtimeMocks.getRuntimeApiMock,
}));

describe('diagnosticsCommand OAuth token display', () => {
  let mockContext: CommandContext;
  let mockTokenStore: Map<string, MCPOAuthCredentials>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let originalTokenStore: any;

  beforeEach(() => {
    // Save original token store
    originalTokenStore = MCPOAuthTokenStorage.getTokenStore();

    // Create a simple in-memory token store
    mockTokenStore = new Map<string, MCPOAuthCredentials>();

    const mockStorage = {
      async getAllCredentials() {
        return new Map(mockTokenStore);
      },
      async getCredentials(serverName: string) {
        return mockTokenStore.get(serverName) || null;
      },
      async setCredentials(credentials: MCPOAuthCredentials) {
        mockTokenStore.set(credentials.serverName, credentials);
      },
      async deleteCredentials(serverName: string) {
        mockTokenStore.delete(serverName);
      },
      async listServers() {
        return Array.from(mockTokenStore.keys());
      },
      async clearAll() {
        mockTokenStore.clear();
      },
    };

    // Replace the token store with our mock
    MCPOAuthTokenStorage.setTokenStore(mockStorage);

    mockContext = createMockCommandContext({
      services: {
        config: {
          getDebugMode: vi.fn(() => false),
          getApprovalMode: vi.fn(() => 'off'),
          getIdeMode: vi.fn(() => false),
          getIdeClient: vi.fn(() => null),
          getMcpServers: vi.fn(() => ({})),
          getMcpServerCommand: vi.fn(() => null),
          getUserMemory: vi.fn(() => null),
          getLlxprtMdFileCount: vi.fn(() => 0),
          getToolRegistry: vi.fn(async () => ({
            getAllTools: () => [],
          })),
        },
        settings: {
          merged: {
            ui: {
              theme: 'default',
              usageStatisticsEnabled: false,
            },
            defaultProfile: 'none',
            sandbox: 'disabled',
          },
        },
      },
    });
  });

  afterEach(() => {
    // Restore original token store
    if (originalTokenStore) {
      MCPOAuthTokenStorage.setTokenStore(originalTokenStore);
    }
    mockTokenStore.clear();
    vi.restoreAllMocks();
  });

  describe('Provider Token Display', () => {
    it('displays authenticated provider with expiring token', async () => {
      const expiryInSeconds = 7200; // 2 hours
      const mockToken = createTestToken(expiryInSeconds);

      const mockTokenStore = {
        listBuckets: vi.fn(async () => ['default']),
        getToken: vi.fn(async () => mockToken),
        saveToken: vi.fn(),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => ['github']),
        getBucketStats: vi.fn(async () => null),
      };

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => mockToken),
        getTokenStore: vi.fn(() => mockTokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('github:');
      expect(messageResult.content).toContain('Status: Authenticated');
      expect(messageResult.content).toMatch(/Time Remaining: [12]h [0-5]?\d?m/);
    });

    it('displays provider with token expiring soon (< 1 hour)', async () => {
      const expiryInSeconds = 2700; // 45 minutes
      const mockToken = createTestToken(expiryInSeconds);

      const mockTokenStore = {
        listBuckets: vi.fn(async () => ['default']),
        getToken: vi.fn(async () => mockToken),
        saveToken: vi.fn(),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => ['github']),
        getBucketStats: vi.fn(async () => null),
      };

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => mockToken),
        getTokenStore: vi.fn(() => mockTokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toMatch(/Time Remaining: 0h 4[4-5]m/);
    });

    it('displays provider as not authenticated when no token', async () => {
      const mockTokenStore = {
        listBuckets: vi.fn(async () => []),
        getToken: vi.fn(async () => null),
        saveToken: vi.fn(),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
      };

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => false),
        peekStoredToken: vi.fn(async () => null),
        getTokenStore: vi.fn(() => mockTokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      // With bucket implementation, providers with no buckets are not shown
      expect(messageResult.content).not.toContain('github:');
      expect(messageResult.content).not.toContain('Provider Tokens');
    });

    it('displays multiple providers with mixed authentication states', async () => {
      const authenticatedToken = createTestToken(3600); // 1 hour

      const mockTokenStore = {
        listBuckets: vi.fn(async (provider: string) =>
          provider === 'github' ? ['default'] : [],
        ),
        getToken: vi.fn(async (provider: string) =>
          provider === 'github' ? authenticatedToken : null,
        ),
        saveToken: vi.fn(),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => ['github']),
        getBucketStats: vi.fn(async () => null),
      };

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github', 'gitlab']),
        isAuthenticated: vi.fn(
          async (provider: string) => provider === 'github',
        ),
        peekStoredToken: vi.fn(async (provider: string) =>
          provider === 'github' ? authenticatedToken : null,
        ),
        getTokenStore: vi.fn(() => mockTokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('github:');
      expect(messageResult.content).toContain('Status: Authenticated');
      // With bucket implementation, gitlab with no buckets is not shown
      expect(messageResult.content).not.toContain('gitlab:');
    });

    it('handles provider with token but no refresh token', async () => {
      const mockToken = {
        access_token: 'test_token',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
        scope: 'read',
      };

      const mockTokenStore = {
        listBuckets: vi.fn(async () => ['default']),
        getToken: vi.fn(async () => mockToken),
        saveToken: vi.fn(),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => ['github']),
        getBucketStats: vi.fn(async () => null),
      };

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => mockToken),
        getTokenStore: vi.fn(() => mockTokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('Refresh Token: None');
    });
  });

  describe('MCP Token Display', () => {
    it('displays MCP server tokens with expiry information', async () => {
      const expiresAt = Date.now() + 3600000; // 1 hour
      const credentials = createMCPCredentials('test-server', expiresAt);
      mockTokenStore.set('test-server', credentials);

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => []),
        isAuthenticated: vi.fn(async () => false),
        peekStoredToken: vi.fn(async () => null),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('MCP Server Tokens');
      expect(messageResult.content).toContain('test-server:');
      expect(messageResult.content).toContain('Status: Valid');
    });

    it('displays expired MCP token', async () => {
      const expiresAt = Date.now() - 3600000; // 1 hour ago
      const credentials = createMCPCredentials('test-server', expiresAt);
      mockTokenStore.set('test-server', credentials);

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => []),
        isAuthenticated: vi.fn(async () => false),
        peekStoredToken: vi.fn(async () => null),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('Status: Expired');
    });

    it('displays MCP token without expiry', async () => {
      const credentials = createMCPCredentials('test-server');
      mockTokenStore.set('test-server', credentials);

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => []),
        isAuthenticated: vi.fn(async () => false),
        peekStoredToken: vi.fn(async () => null),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('test-server:');
      expect(messageResult.content).toContain('Status: Valid');
      expect(messageResult.content).not.toContain('Expires:');
    });

    it('displays MCP token metadata (scope, tokenType)', async () => {
      const expiresAt = Date.now() + 3600000;
      const credentials = createMCPCredentials('test-server', expiresAt, {
        scope: 'read write execute',
        tokenType: 'Bearer',
      });
      mockTokenStore.set('test-server', credentials);

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => []),
        isAuthenticated: vi.fn(async () => false),
        peekStoredToken: vi.fn(async () => null),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('Token Type: Bearer');
      expect(messageResult.content).toContain('Scopes: read write execute');
    });

    it('handles multiple MCP servers', async () => {
      const expiresAt = Date.now() + 3600000;
      const credentials1 = createMCPCredentials('server-1', expiresAt);
      const credentials2 = createMCPCredentials('server-2', expiresAt);
      mockTokenStore.set('server-1', credentials1);
      mockTokenStore.set('server-2', credentials2);

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => []),
        isAuthenticated: vi.fn(async () => false),
        peekStoredToken: vi.fn(async () => null),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('server-1:');
      expect(messageResult.content).toContain('server-2:');
    });
  });

  describe('Integration', () => {
    it('displays both provider and MCP tokens together', async () => {
      const providerToken = createTestToken(3600);
      const mcpExpiresAt = Date.now() + 3600000;

      const credentials = createMCPCredentials('mcp-server', mcpExpiresAt);
      mockTokenStore.set('mcp-server', credentials);

      const tokenStore = createMockTokenStore({ github: providerToken });

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => providerToken),
        getTokenStore: vi.fn(() => tokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('Provider Tokens');
      expect(messageResult.content).toContain('github:');
      expect(messageResult.content).toContain('MCP Server Tokens');
      expect(messageResult.content).toContain('mcp-server:');
    });

    it('displays no tokens message when neither exists', async () => {
      const tokenStore = createMockTokenStore({});

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => []),
        isAuthenticated: vi.fn(async () => false),
        peekStoredToken: vi.fn(async () => null),
        getTokenStore: vi.fn(() => tokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('No OAuth tokens configured');
      expect(messageResult.content).not.toContain('Provider Tokens');
      expect(messageResult.content).not.toContain('MCP Server Tokens');
    });

    it('displays only provider tokens when no MCP tokens', async () => {
      const providerToken = createTestToken(3600);

      const tokenStore = createMockTokenStore({ github: providerToken });

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => providerToken),
        getTokenStore: vi.fn(() => tokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('Provider Tokens');
      expect(messageResult.content).toContain('github:');
      expect(messageResult.content).not.toContain('MCP Server Tokens');
    });

    it('displays only MCP tokens when no provider tokens', async () => {
      const mcpExpiresAt = Date.now() + 3600000;
      const credentials = createMCPCredentials('mcp-server', mcpExpiresAt);
      mockTokenStore.set('mcp-server', credentials);

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => []),
        isAuthenticated: vi.fn(async () => false),
        peekStoredToken: vi.fn(async () => null),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('MCP Server Tokens');
      expect(messageResult.content).toContain('mcp-server:');
      expect(messageResult.content).not.toContain('Provider Tokens');
    });
  });

  describe('Time Calculation Edge Cases', () => {
    it('correctly calculates time for token expiring in exactly 1 hour', async () => {
      const mockToken = createTestToken(3600); // Exactly 1 hour

      const tokenStore = createMockTokenStore({ github: mockToken });

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => mockToken),
        getTokenStore: vi.fn(() => tokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toMatch(/Time Remaining: [01]h [0-5]?\d?m/);
    });

    it('correctly handles token expiring in less than 1 minute', async () => {
      const mockToken = createTestToken(30); // 30 seconds

      const tokenStore = createMockTokenStore({ github: mockToken });

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => mockToken),
        getTokenStore: vi.fn(() => tokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('0h 0m');
    });

    it('prevents negative time display for expired tokens', async () => {
      const mockToken = createTestToken(-3600); // Expired 1 hour ago

      const tokenStore = createMockTokenStore({ github: mockToken });

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => mockToken),
        getTokenStore: vi.fn(() => tokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('0h 0m');
    });

    it('correctly floors fractional minutes', async () => {
      const mockToken = createTestToken(2730); // 45.5 minutes

      const tokenStore = createMockTokenStore({ github: mockToken });

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => mockToken),
        getTokenStore: vi.fn(() => tokenStore),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('0h 45m');
    });
  });

  describe('Error Handling', () => {
    it('gracefully handles when OAuthManager is null', async () => {
      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => null),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('No OAuth tokens configured');
    });

    it('gracefully handles when peekStoredToken throws', async () => {
      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => ['github']),
        isAuthenticated: vi.fn(async () => true),
        peekStoredToken: vi.fn(async () => {
          throw new Error('Token store error');
        }),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('OAuth Tokens');
    });

    it('gracefully handles when MCP getAllCredentials throws', async () => {
      // Create a mock storage that throws an error
      const errorStorage = {
        async getAllCredentials() {
          throw new Error('MCP storage error');
        },
        async getCredentials() {
          throw new Error('MCP storage error');
        },
        async setCredentials() {
          throw new Error('MCP storage error');
        },
        async deleteCredentials() {
          throw new Error('MCP storage error');
        },
        async listServers() {
          throw new Error('MCP storage error');
        },
        async clearAll() {
          throw new Error('MCP storage error');
        },
      };

      MCPOAuthTokenStorage.setTokenStore(errorStorage);

      const mockOAuthManager = {
        getSupportedProviders: vi.fn(() => []),
        isAuthenticated: vi.fn(async () => false),
        peekStoredToken: vi.fn(async () => null),
      };

      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => mockOAuthManager),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('OAuth Tokens');
    });

    it('OAuth section failure does not break rest of diagnostics', async () => {
      runtimeMocks.getRuntimeApiMock.mockReturnValue({
        getRuntimeDiagnosticsSnapshot: vi.fn(() => ({
          providerName: 'test-provider',
          modelName: 'test-model',
          profileName: 'test-profile',
          modelParams: {},
          ephemeralSettings: {},
        })),
        getActiveProviderStatus: vi.fn(() => ({
          providerName: 'test-provider',
        })),
        getCliProviderManager: vi.fn(() => ({
          getProviderByName: vi.fn(() => null),
        })),
        getCliOAuthManager: vi.fn(() => {
          throw new Error('OAuth manager error');
        }),
      });

      const result = await diagnosticsCommand.action?.(mockContext, '');

      expect(result?.type).toBe('message');
      const messageResult = result as MessageActionReturn;
      expect(messageResult.messageType).toBe('info');
      expect(messageResult.content).toContain('Provider Information');
      expect(messageResult.content).toContain('System Information');
      expect(messageResult.content).toContain(
        'Unable to retrieve OAuth token information',
      );
    });
  });
});
