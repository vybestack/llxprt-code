/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import type { CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import {
  MCPOAuthTokenStorage,
  type MCPOAuthCredentials,
} from '@vybestack/llxprt-code-core';
import type { TokenStorage } from '@vybestack/llxprt-code-mcp';
import type { OAuthToken } from '@vybestack/llxprt-code-providers/auth.js';

export function createTestToken(expiryInSeconds: number): OAuthToken {
  return {
    access_token: `test_token_${Date.now()}`,
    refresh_token: `refresh_token_${Date.now()}`,
    expiry: Math.floor(Date.now() / 1000) + expiryInSeconds,
    token_type: 'Bearer',
    scope: 'read write',
  };
}

export function createMockTokenStore(
  providers: Record<string, OAuthToken | null>,
): {
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
    getToken: vi.fn(async (provider: string) => providers[provider] ?? null),
    saveToken: vi.fn(),
    removeToken: vi.fn(),
    listProviders: vi.fn(async () =>
      Object.keys(providers).filter((p) => providers[p]),
    ),
    getBucketStats: vi.fn(async () => null),
  };
}

export function createMCPCredentials(
  serverName: string,
  expiresAt?: number,
  opts?: { refreshToken?: string; scope?: string; tokenType?: string },
): MCPOAuthCredentials {
  const tokenType = opts?.tokenType ?? 'Bearer';
  return {
    serverName,
    token: {
      accessToken: `mcp_token_${serverName}`,
      refreshToken: opts?.refreshToken,
      expiresAt,
      tokenType,
      scope: opts?.scope,
    },
    updatedAt: Date.now(),
  };
}

export interface DiagnosticsTestSetup {
  mockContext: CommandContext;
  mockTokenStore: Map<string, MCPOAuthCredentials>;
  originalTokenStore: TokenStorage;
}

export function setupDiagnosticsTest(): DiagnosticsTestSetup {
  const originalTokenStore = MCPOAuthTokenStorage.getTokenStore();
  const mockTokenStore = new Map<string, MCPOAuthCredentials>();

  const mockStorage = {
    async getAllCredentials() {
      return new Map(mockTokenStore);
    },
    async getCredentials(serverName: string) {
      return mockTokenStore.get(serverName) ?? null;
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

  MCPOAuthTokenStorage.setTokenStore(mockStorage);

  const mockContext = createMockCommandContext({
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

  return { mockContext, mockTokenStore, originalTokenStore };
}

export function teardownDiagnosticsTest(setup: DiagnosticsTestSetup): void {
  MCPOAuthTokenStorage.setTokenStore(setup.originalTokenStore);
  setup.mockTokenStore.clear();
  vi.restoreAllMocks();
}
