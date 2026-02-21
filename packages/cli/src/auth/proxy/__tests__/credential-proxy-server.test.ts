/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for CredentialProxyServer.
 *
 * Uses REAL Unix domain sockets with in-memory test doubles for
 * TokenStore and ProviderKeyStorage. ProxySocketClient from core
 * connects to the server to exercise real protocol behavior.
 *
 * @plan PLAN-20250214-CREDPROXY.P16
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';

import {
  CredentialProxyServer,
  type CredentialProxyServerOptions,
} from '../credential-proxy-server.js';
import type {
  TokenStore,
  OAuthToken,
  BucketStats,
} from '@vybestack/llxprt-code-core';
import { ProxySocketClient } from '@vybestack/llxprt-code-core';

// ─── In-Memory Test Double: TokenStore ───────────────────────────────────────

class InMemoryTokenStore implements TokenStore {
  private tokens: Map<string, OAuthToken> = new Map();
  private locks: Set<string> = new Set();

  private key(provider: string, bucket?: string): string {
    return bucket ? `${provider}:${bucket}` : provider;
  }

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    this.tokens.set(this.key(provider, bucket), token);
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokens.get(this.key(provider, bucket)) ?? null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    this.tokens.delete(this.key(provider, bucket));
  }

  async listProviders(): Promise<string[]> {
    const providers = new Set<string>();
    for (const k of this.tokens.keys()) {
      providers.add(k.split(':')[0]);
    }
    return [...providers];
  }

  async listBuckets(provider: string): Promise<string[]> {
    const buckets: string[] = [];
    for (const k of this.tokens.keys()) {
      const parts = k.split(':');
      if (parts[0] === provider && parts.length > 1) {
        buckets.push(parts[1]);
      }
    }
    return buckets;
  }

  async getBucketStats(
    _provider: string,
    _bucket: string,
  ): Promise<BucketStats | null> {
    return null;
  }

  async acquireRefreshLock(
    provider: string,
    options?: { waitMs?: number; staleMs?: number; bucket?: string },
  ): Promise<boolean> {
    const k = this.key(provider, options?.bucket);
    if (this.locks.has(k)) return false;
    this.locks.add(k);
    return true;
  }

  async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
    this.locks.delete(this.key(provider, bucket));
  }
}

// ─── In-Memory Test Double: ProviderKeyStorage ───────────────────────────────

class InMemoryProviderKeyStorage {
  private keys: Map<string, string> = new Map();

  async saveKey(name: string, apiKey: string): Promise<void> {
    this.keys.set(name, apiKey.trim());
  }

  async getKey(name: string): Promise<string | null> {
    return this.keys.get(name) ?? null;
  }

  async deleteKey(name: string): Promise<boolean> {
    return this.keys.delete(name);
  }

  async listKeys(): Promise<string[]> {
    return [...this.keys.keys()];
  }

  async hasKey(name: string): Promise<boolean> {
    return this.keys.has(name);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeToken(overrides: Partial<OAuthToken> = {}): OAuthToken {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token-secret',
    expiry: 9999999999,
    token_type: 'Bearer' as const,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CredentialProxyServer', () => {
  let tokenStore: InMemoryTokenStore;
  let keyStorage: InMemoryProviderKeyStorage;
  let server: CredentialProxyServer;
  let client: ProxySocketClient;

  beforeEach(() => {
    tokenStore = new InMemoryTokenStore();
    keyStorage = new InMemoryProviderKeyStorage();
  });

  afterEach(async () => {
    try {
      client?.close();
    } catch {
      // client may not be initialized
    }
    try {
      await server?.stop();
    } catch {
      // server may not be started
    }
  });

  function createServer(
    overrides: Partial<CredentialProxyServerOptions> = {},
  ): CredentialProxyServer {
    return new CredentialProxyServer({
      tokenStore,
      providerKeyStorage:
        keyStorage as unknown as CredentialProxyServerOptions['providerKeyStorage'],
      ...overrides,
    });
  }

  async function startAndConnect(
    serverInstance: CredentialProxyServer,
  ): Promise<ProxySocketClient> {
    const socketPath = await serverInstance.start();
    const c = new ProxySocketClient(socketPath);
    await c.ensureConnected();
    return c;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * @requirement R25.1
   * @scenario start creates a Unix socket file and returns the socket path
   * @given A CredentialProxyServer is constructed
   * @when start() is called
   * @then A Unix socket file exists at the returned path
   */
  it('start creates a Unix socket and returns the socket path', async () => {
    server = createServer();
    const socketPath = await server.start();

    expect(socketPath).toEqual(expect.any(String));
    expect(socketPath.endsWith('.sock')).toBe(true);
    const stat = fs.statSync(socketPath);
    expect(stat.isSocket()).toBe(true);
  });

  /**
   * @requirement R25.2
   * @scenario stop removes the socket file and rejects new connections
   * @given A server is started
   * @when stop() is called
   * @then The socket file is removed from disk
   */
  it('stop removes the socket file and rejects new connections', async () => {
    server = createServer();
    const socketPath = await server.start();

    expect(fs.existsSync(socketPath)).toBe(true);

    await server.stop();

    expect(fs.existsSync(socketPath)).toBe(false);
  });

  /**
   * @requirement R25.3
   * @scenario getSocketPath returns null before start, path after start
   * @given A CredentialProxyServer is constructed but not started
   * @when getSocketPath is called before and after start
   * @then It returns null before start and a string path after start
   */
  it('getSocketPath returns null before start, path after start', async () => {
    server = createServer();

    expect(server.getSocketPath()).toBeNull();

    const socketPath = await server.start();

    expect(server.getSocketPath()).toBe(socketPath);
  });

  /**
   * @requirement R25.4
   * @scenario start can only be called once
   * @given A server that has already been started
   * @when start() is called a second time
   * @then It throws or rejects
   */
  it('start can only be called once (second call throws)', async () => {
    server = createServer();
    await server.start();

    await expect(server.start()).rejects.toThrow();
  });

  // ─── Handshake ─────────────────────────────────────────────────────────────

  /**
   * @requirement R6.1
   * @scenario Accepts handshake with correct version
   * @given A running server
   * @when A client connects and sends a v1 handshake
   * @then The server responds with handshake_ack (ok: true)
   */
  it('accepts handshake with correct version and returns handshake_ack', async () => {
    server = createServer();
    client = await startAndConnect(server);

    // If we reach here without throwing, the handshake succeeded.
    // Verify the client is usable by making a request.
    const response = await client.request('list_providers', {});
    expect(response.ok).toBe(true);
  });

  /**
   * @requirement R6.2
   * @scenario Rejects handshake with wrong version
   * @given A running server
   * @when A client connects and sends a handshake with unsupported version
   * @then The server rejects the handshake
   */
  it('rejects handshake with wrong version', async () => {
    server = createServer();
    const socketPath = await server.start();

    // Manually construct a client-like connection with wrong version
    // by using the raw socket to send a bad handshake
    const net = await import('node:net');
    const { encodeFrame, FrameDecoder } = await import(
      '@vybestack/llxprt-code-core'
    );

    const response = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const socket = net.createConnection(socketPath, () => {
          const handshake = {
            v: 999,
            op: 'handshake',
            payload: { minVersion: 999, maxVersion: 999 },
          };
          socket.write(encodeFrame(handshake));
        });
        const decoder = new FrameDecoder();
        socket.on('data', (chunk: Buffer) => {
          const frames = decoder.feed(chunk);
          for (const frame of frames) {
            socket.destroy();
            resolve(frame);
          }
        });
        socket.on('error', reject);
        setTimeout(() => {
          socket.destroy();
          reject(new Error('Timeout waiting for handshake response'));
        }, 5000);
      },
    );

    expect(response.ok).toBe(false);
  });

  // ─── Token Operations ─────────────────────────────────────────────────────

  /**
   * @requirement R8.1
   * @scenario get_token returns token from store with refresh_token stripped
   * @given A token { access_token: "at", refresh_token: "rt", expiry: 9999999999 } in the store
   * @when get_token is requested for that provider
   * @then Response contains access_token and expiry but NOT refresh_token
   */
  it('get_token returns token from store with refresh_token stripped', async () => {
    const token = makeToken();
    await tokenStore.saveToken('anthropic', token);

    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('get_token', {
      provider: 'anthropic',
    });

    expect(response.ok).toBe(true);
    expect(response.data!.access_token).toBe('test-access-token');
    expect(response.data!.expiry).toBe(9999999999);
    expect(response.data!.refresh_token).toBeUndefined();
  });

  /**
   * @requirement R8.2
   * @scenario get_token returns NOT_FOUND for missing token
   * @given No token stored for the requested provider
   * @when get_token is requested
   * @then Response is ok: false with code NOT_FOUND
   */
  it('get_token returns NOT_FOUND for missing token', async () => {
    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('get_token', {
      provider: 'nonexistent',
    });

    expect(response.ok).toBe(false);
    expect(response.code).toBe('NOT_FOUND');
  });

  /**
   * @requirement R8.3
   * @scenario save_token saves to underlying store
   * @given A running server
   * @when save_token is called with a token
   * @then The token is saved in the underlying store
   */
  it('save_token saves to underlying store', async () => {
    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('save_token', {
      provider: 'anthropic',
      token: {
        access_token: 'new-access-token',
        expiry: 8888888888,
        token_type: 'Bearer',
      },
    });

    expect(response.ok).toBe(true);

    const stored = await tokenStore.getToken('anthropic');
    expect(stored).not.toBeNull();
    expect(stored!.access_token).toBe('new-access-token');
  });

  /**
   * @requirement R8.4
   * @scenario remove_token removes from underlying store
   * @given A token exists in the store
   * @when remove_token is requested
   * @then The token is removed from the store
   */
  it('remove_token removes from underlying store', async () => {
    await tokenStore.saveToken('anthropic', makeToken());

    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('remove_token', {
      provider: 'anthropic',
    });

    expect(response.ok).toBe(true);

    const stored = await tokenStore.getToken('anthropic');
    expect(stored).toBeNull();
  });

  /**
   * @requirement R8.5
   * @scenario list_providers returns provider list
   * @given Tokens for anthropic and gemini in the store
   * @when list_providers is requested
   * @then Response data includes both providers
   */
  it('list_providers returns provider list', async () => {
    await tokenStore.saveToken('anthropic', makeToken());
    await tokenStore.saveToken('gemini', makeToken());

    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('list_providers', {});

    expect(response.ok).toBe(true);
    const providers = response.data!.providers as string[];
    expect(providers).toContain('anthropic');
    expect(providers).toContain('gemini');
  });

  /**
   * @requirement R8.6
   * @scenario list_buckets returns bucket list for provider
   * @given Tokens for anthropic with buckets "default" and "work"
   * @when list_buckets is requested for anthropic
   * @then Response data includes both buckets
   */
  it('list_buckets returns bucket list for provider', async () => {
    await tokenStore.saveToken('anthropic', makeToken(), 'default');
    await tokenStore.saveToken('anthropic', makeToken(), 'work');

    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('list_buckets', {
      provider: 'anthropic',
    });

    expect(response.ok).toBe(true);
    const buckets = response.data!.buckets as string[];
    expect(buckets).toContain('default');
    expect(buckets).toContain('work');
  });

  // ─── Key Operations ───────────────────────────────────────────────────────

  /**
   * @requirement R9.1
   * @scenario get_api_key returns key from storage
   * @given A key "anthropic" with value "sk-ant-123" in storage
   * @when get_api_key is requested for "anthropic"
   * @then Response data contains the key value
   */
  it('get_api_key returns key from storage', async () => {
    await keyStorage.saveKey('anthropic', 'sk-ant-123');

    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('get_api_key', {
      name: 'anthropic',
    });

    expect(response.ok).toBe(true);
    expect(response.data!.key).toBe('sk-ant-123');
  });

  /**
   * @requirement R9.2
   * @scenario get_api_key returns NOT_FOUND for missing key
   * @given No key stored with the requested name
   * @when get_api_key is requested
   * @then Response is ok: false with code NOT_FOUND
   */
  it('get_api_key returns NOT_FOUND for missing key', async () => {
    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('get_api_key', {
      name: 'nonexistent',
    });

    expect(response.ok).toBe(false);
    expect(response.code).toBe('NOT_FOUND');
  });

  /**
   * @requirement R9.3
   * @scenario list_api_keys returns key names
   * @given Keys "anthropic" and "openai" in storage
   * @when list_api_keys is requested
   * @then Response data includes both key names
   */
  it('list_api_keys returns key names', async () => {
    await keyStorage.saveKey('anthropic', 'sk-ant-123');
    await keyStorage.saveKey('openai', 'sk-oai-456');

    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('list_api_keys', {});

    expect(response.ok).toBe(true);
    const keys = response.data!.keys as string[];
    expect(keys).toContain('anthropic');
    expect(keys).toContain('openai');
  });

  /**
   * @requirement R9.4
   * @scenario has_api_key returns exists true/false
   * @given A key "anthropic" exists, "missing" does not
   * @when has_api_key is requested for each
   * @then Returns exists: true for anthropic, exists: false for missing
   */
  it('has_api_key returns exists true/false', async () => {
    await keyStorage.saveKey('anthropic', 'sk-ant-123');

    server = createServer();
    client = await startAndConnect(server);

    const existsResponse = await client.request('has_api_key', {
      name: 'anthropic',
    });
    expect(existsResponse.ok).toBe(true);
    expect(existsResponse.data!.exists).toBe(true);

    const missingResponse = await client.request('has_api_key', {
      name: 'missing',
    });
    expect(missingResponse.ok).toBe(true);
    expect(missingResponse.data!.exists).toBe(false);
  });

  /**
   * @requirement R9.5
   * @scenario All providers are accessible when no allowlist is configured
   * @given A server with tokens and keys for multiple providers
   * @when Various provider operations are requested
   * @then All providers can be accessed without restriction
   */
  it('allows access to all providers without allowlist restrictions', async () => {
    await tokenStore.saveToken('anthropic', makeToken(), 'default');
    await tokenStore.saveToken('openai', makeToken(), 'default');
    await keyStorage.saveKey('anthropic', 'sk-ant-123');
    await keyStorage.saveKey('openai', 'sk-oai-456');

    server = createServer({});
    client = await startAndConnect(server);

    const anthropicBuckets = await client.request('list_buckets', {
      provider: 'anthropic',
    });
    expect(anthropicBuckets.ok).toBe(true);

    const openAiBuckets = await client.request('list_buckets', {
      provider: 'openai',
    });
    expect(openAiBuckets.ok).toBe(true);

    const anthropicKey = await client.request('get_api_key', {
      name: 'anthropic',
    });
    expect(anthropicKey.ok).toBe(true);
    expect(anthropicKey.data!.key).toBe('sk-ant-123');

    const openaiKey = await client.request('get_api_key', {
      name: 'openai',
    });
    expect(openaiKey.ok).toBe(true);
    expect(openaiKey.data!.key).toBe('sk-oai-456');

    const listedKeys = await client.request('list_api_keys', {});
    expect(listedKeys.ok).toBe(true);
    expect(listedKeys.data!.keys).toContain('anthropic');
    expect(listedKeys.data!.keys).toContain('openai');

    const hasAnthropicKey = await client.request('has_api_key', {
      name: 'anthropic',
    });
    expect(hasAnthropicKey.ok).toBe(true);
    expect(hasAnthropicKey.data!.exists).toBe(true);

    const hasOpenaiKey = await client.request('has_api_key', {
      name: 'openai',
    });
    expect(hasOpenaiKey.ok).toBe(true);
    expect(hasOpenaiKey.data!.exists).toBe(true);
  });

  it('returns all buckets without bucket allowlist filtering', async () => {
    await tokenStore.saveToken('anthropic', makeToken(), 'default');
    await tokenStore.saveToken('anthropic', makeToken(), 'work');

    server = createServer({});
    client = await startAndConnect(server);

    const response = await client.request('list_buckets', {
      provider: 'anthropic',
    });

    expect(response.ok).toBe(true);
    expect(response.data!.buckets).toContain('default');
    expect(response.data!.buckets).toContain('work');
  });

  // ─── Security ──────────────────────────────────────────────────────────────

  /**
   * @requirement R10.1
   * @scenario get_token response does NOT include refresh_token (CRITICAL)
   * @given A token with refresh_token in the store
   * @when get_token is requested
   * @then The response payload has no refresh_token property at all
   */
  it('get_token response does NOT include refresh_token', async () => {
    const token = makeToken({ refresh_token: 'super-secret-refresh' });
    await tokenStore.saveToken('gemini', token);

    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('get_token', {
      provider: 'gemini',
    });

    expect(response.ok).toBe(true);
    expect(response.data!.access_token).toBe('test-access-token');
    expect('refresh_token' in response.data!).toBe(false);
  });

  /**
   * @requirement R10.2
   * @scenario save_token from inner process strips refresh_token before storing
   * @given An existing token with refresh_token "original-rt" in the store
   * @when save_token is sent with a new access_token and a refresh_token from the inner process
   * @then The stored token's refresh_token is NOT overwritten by the inner process value
   */
  it('save_token from inner process strips refresh_token before storing', async () => {
    const existing = makeToken({
      access_token: 'old-at',
      refresh_token: 'original-rt',
    });
    await tokenStore.saveToken('anthropic', existing);

    server = createServer();
    client = await startAndConnect(server);

    await client.request('save_token', {
      provider: 'anthropic',
      token: {
        access_token: 'new-at',
        refresh_token: 'malicious-rt',
        expiry: 8888888888,
        token_type: 'Bearer',
      },
    });

    const stored = await tokenStore.getToken('anthropic');
    expect(stored).not.toBeNull();
    expect(stored!.access_token).toBe('new-at');
    // The original refresh_token must be preserved, not overwritten
    expect(stored!.refresh_token).toBe('original-rt');
    expect(stored!.refresh_token).not.toBe('malicious-rt');
  });

  // ─── Error Handling ────────────────────────────────────────────────────────

  /**
   * @requirement R7.1
   * @scenario Unknown operation returns INVALID_REQUEST error
   * @given A running server with an active client connection
   * @when An unknown operation is sent
   * @then Response is ok: false with code INVALID_REQUEST
   */
  it('unknown operation returns INVALID_REQUEST error', async () => {
    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('totally_bogus_op', {});

    expect(response.ok).toBe(false);
    expect(response.code).toBe('INVALID_REQUEST');
  });

  /**
   * @requirement R7.2
   * @scenario Malformed request returns error and does not crash server
   * @given A running server
   * @when A malformed request is sent followed by a valid request
   * @then The valid request still receives a correct response
   */
  it('malformed request returns error and does not crash server', async () => {
    server = createServer();
    client = await startAndConnect(server);

    // Send a request with missing required fields
    const badResponse = await client.request('get_token', {});

    expect(badResponse.ok).toBe(false);

    // Server should still be alive — send a valid request
    await tokenStore.saveToken('anthropic', makeToken());
    const goodResponse = await client.request('get_token', {
      provider: 'anthropic',
    });

    expect(goodResponse.ok).toBe(true);
    expect(goodResponse.data!.access_token).toBe('test-access-token');
  });

  // ─── Multiple Clients ─────────────────────────────────────────────────────

  /**
   * @requirement R25.5
   * @scenario Handles multiple sequential client connections
   * @given A running server
   * @when Two clients connect sequentially and make requests
   * @then Both clients receive correct responses
   */
  it('handles multiple sequential client connections', async () => {
    await tokenStore.saveToken('anthropic', makeToken());
    await keyStorage.saveKey('openai', 'sk-oai-789');

    server = createServer();
    const socketPath = await server.start();

    // First client
    const client1 = new ProxySocketClient(socketPath);
    await client1.ensureConnected();
    const r1 = await client1.request('get_token', { provider: 'anthropic' });
    expect(r1.ok).toBe(true);
    expect(r1.data!.access_token).toBe('test-access-token');
    client1.close();

    // Second client after first disconnects
    const client2 = new ProxySocketClient(socketPath);
    await client2.ensureConnected();
    const r2 = await client2.request('get_api_key', { name: 'openai' });
    expect(r2.ok).toBe(true);
    expect(r2.data!.key).toBe('sk-oai-789');
    client2.close();
  });
});
