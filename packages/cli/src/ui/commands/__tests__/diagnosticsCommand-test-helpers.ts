/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { CommandContext } from '../types.js';
import { createMockCommandContext } from '../../../__tests__/mockCommandContext.js';
// Imported from the MCP package rather than through the core re-export:
// diagnosticsTokens.ts imports it from '@vybestack/llxprt-code-mcp', and under
// Bun the two specifiers can resolve to different module instances, so the
// injected token store would otherwise not be the one the command reads.
import { KeychainTokenStorage } from '@vybestack/llxprt-code-mcp';
import type { MCPOAuthCredentials } from '@vybestack/llxprt-code-core';
import type { OAuthToken } from '@vybestack/llxprt-code-providers/auth.js';
import type { BucketStats } from '@vybestack/llxprt-code-auth';

import {
  discoverProviderBuckets,
  type OAuthBucketDiscoveryManager,
} from '../oauthBucketDiscovery.js';
import type { OAuthControl } from '../../contexts/OAuthControlContext.js';

type DiagnosticsSource = Omit<OAuthBucketDiscoveryManager, 'getTokenStore'> & {
  getSessionBucket(provider: string): string | undefined;
  getTokenStore(): {
    listBuckets(provider: string): Promise<string[]>;
    getBucketStats(
      provider: string,
      bucket: string,
    ): Promise<BucketStats | null>;
    getToken(provider: string, bucket: string): Promise<OAuthToken | null>;
  };
};

export function createDiagnosticsOAuthControl(
  source: () => DiagnosticsSource | null,
): OAuthControl {
  const manager = (): DiagnosticsSource => {
    const value = source();
    if (!value) throw new Error('OAuth unavailable');
    return value;
  };
  return {
    isAvailable: () => source() !== null,
    getSessionBucket: (provider) => manager().getSessionBucket(provider),
    discoverBuckets: (logger) => discoverProviderBuckets(manager(), logger),
    readStoredTokenSummary: async (provider, bucket) => {
      const token = await manager().getTokenStore().getToken(provider, bucket);
      return token === null
        ? null
        : {
            expiry: token.expiry,
            hasRefreshToken: Boolean(token.refresh_token),
          };
    },
  } as OAuthControl;
}

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
}

export function setupDiagnosticsTest(): DiagnosticsTestSetup {
  const mockTokenStore = new Map<string, MCPOAuthCredentials>();

  vi.spyOn(
    KeychainTokenStorage.prototype,
    'getAllCredentials',
  ).mockImplementation(async () => new Map(mockTokenStore));

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
      },
      // Partial mock: only `tools.list` is exercised by diagnosticsCommand's
      // appendToolsAndTelemetry. Cast via `unknown as Agent` (rather than the
      // broader `as never`) to convey that this is a deliberate partial
      // stand-in for the full Agent surface.
      agent: {
        tools: {
          list: vi.fn(() => []),
        },
      } as unknown as Agent,
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

  return { mockContext, mockTokenStore };
}

export function teardownDiagnosticsTest(setup: DiagnosticsTestSetup): void {
  setup.mockTokenStore.clear();
  vi.restoreAllMocks();
}
