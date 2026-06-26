/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260622-MCPOAUTHTRUTH.P03
 * @requirement REQ-001,REQ-INT-001
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import type { OAuthCredentials, TokenStorage } from './token-storage/types.js';
import type { MCPOAuthToken } from './token-store.js';
import { MCPOAuthTokenStorage } from './oauth-token-storage.js';
import { mcpServerRequiresOAuth } from '../client/mcp-status.js';
import * as mcpAuth from './index.js';

class MockTokenStorage implements TokenStorage {
  private readonly tokens = new Map<string, OAuthCredentials>();
  private shouldThrow = false;

  setShouldThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  async getCredentials(serverName: string): Promise<OAuthCredentials | null> {
    if (this.shouldThrow) {
      throw new Error('store get');
    }
    return this.tokens.get(serverName) ?? null;
  }

  async setCredentials(credentials: OAuthCredentials): Promise<void> {
    this.tokens.set(credentials.serverName, {
      ...credentials,
      updatedAt: credentials.updatedAt,
    });
  }

  async deleteCredentials(serverName: string): Promise<void> {
    this.tokens.delete(serverName);
  }

  async listServers(): Promise<string[]> {
    return Array.from(this.tokens.keys());
  }

  async getAllCredentials(): Promise<Map<string, OAuthCredentials>> {
    return new Map(this.tokens);
  }

  async clearAll(): Promise<void> {
    this.tokens.clear();
  }
}

async function seedToken(
  store: MockTokenStorage,
  serverName: string,
  expiresAt: number,
): Promise<void> {
  const token: MCPOAuthToken = {
    accessToken: 'a',
    tokenType: 'Bearer',
    expiresAt,
  };
  await store.setCredentials({
    serverName,
    token,
    updatedAt: Date.now(),
  });
}

describe('getMcpServerOAuthStatus — REQ-001 canonical helper', () => {
  let store: MockTokenStorage;
  let priorStore: TokenStorage;

  beforeEach(() => {
    priorStore = MCPOAuthTokenStorage.getTokenStore();
    store = new MockTokenStorage();
    MCPOAuthTokenStorage.setTokenStore(store);
  });

  afterEach(() => {
    MCPOAuthTokenStorage.setTokenStore(priorStore);
    mcpServerRequiresOAuth.clear();
  });

  // T1: NOT-required, storage never read (throwing store proves short-circuit).
  it('returns not-required when not required, without reading storage', async () => {
    store.setShouldThrow(true);
    const result = await mcpAuth.getMcpServerOAuthStatus('srv');
    expect(result).toBe('not-required');
  });

  // T2: required via opts, empty store → none.
  it('returns none when required via opts and no credentials exist', async () => {
    const result = await mcpAuth.getMcpServerOAuthStatus('srv', {
      requiresOAuth: true,
    });
    expect(result).toBe('none');
  });

  // T3: required via map, empty store → none.
  it('returns none when required via map and no credentials exist', async () => {
    mcpServerRequiresOAuth.set('srv', true);
    const result = await mcpAuth.getMcpServerOAuthStatus('srv');
    expect(result).toBe('none');
  });

  // T4: required + non-expired creds → authenticated.
  it('returns authenticated when required and non-expired credentials exist', async () => {
    await seedToken(store, 'srv', Date.now() + 10 * 60 * 1000);
    const result = await mcpAuth.getMcpServerOAuthStatus('srv', {
      requiresOAuth: true,
    });
    expect(result).toBe('authenticated');
  });

  // T5: required + expired creds → expired (within buffer + past value).
  it('returns expired when required and credentials are within the expiry buffer', async () => {
    await seedToken(store, 'srv', Date.now() + 60_000);
    const result = await mcpAuth.getMcpServerOAuthStatus('srv', {
      requiresOAuth: true,
    });
    expect(result).toBe('expired');
  });

  it('returns expired when required and credentials are in the past', async () => {
    await seedToken(store, 'srv', Date.now() - 1000);
    const result = await mcpAuth.getMcpServerOAuthStatus('srv', {
      requiresOAuth: true,
    });
    expect(result).toBe('expired');
  });

  // T6: required + storage throws → none (never throws).
  it('returns none when required and the storage read throws', async () => {
    store.setShouldThrow(true);
    const result = await mcpAuth.getMcpServerOAuthStatus('srv', {
      requiresOAuth: true,
    });
    expect(result).toBe('none');
  });

  // PROP1: authenticated for generated future expiry offsets beyond the buffer.
  it('returns authenticated for any expiry strictly beyond the buffer (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 6 * 60 * 1000, max: 60 * 60 * 1000 }),
        async (offsetMs) => {
          const serverName = 'srv-prop1';
          await seedToken(store, serverName, Date.now() + offsetMs);
          const result = await mcpAuth.getMcpServerOAuthStatus(serverName, {
            requiresOAuth: true,
          });
          expect(result).toBe('authenticated');
        },
      ),
    );
  });

  // PROP2: OR-combine requiredness (hint || runtime).
  it('OR-combines requiresOAuth hint with the runtime map (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        fc.string({ minLength: 1 }),
        async (hint, runtime, name) => {
          mcpServerRequiresOAuth.set(name, runtime);
          const result = await mcpAuth.getMcpServerOAuthStatus(name, {
            requiresOAuth: hint,
          });
          const expected = hint || runtime ? 'none' : 'not-required';
          expect(result).toBe(expected);
        },
      ),
    );
  });

  // PROP3: fault-tolerance for generated server names with throwing storage.
  it('returns none (never throws) for any server when storage throws (property)', async () => {
    store.setShouldThrow(true);
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (name) => {
        const result = await mcpAuth.getMcpServerOAuthStatus(name, {
          requiresOAuth: true,
        });
        expect(result).toBe('none');
      }),
    );
  });
});
