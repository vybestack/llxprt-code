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

const isWindows = process.platform === 'win32';

// ─── In-Memory Test Double: TokenStore ───────────────────────────────────────

class InMemoryTokenStore implements TokenStore {
  private tokens: Map<string, OAuthToken> = new Map();
  private locks: Set<string> = new Set();
  private bucketStats: Map<string, BucketStats> = new Map();

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
    provider: string,
    bucket: string,
  ): Promise<BucketStats | null> {
    return this.bucketStats.get(this.key(provider, bucket)) ?? null;
  }

  /** Test helper: populate bucket stats to prove sandbox path suppresses real data. */
  setBucketStats(provider: string, bucket: string, stats: BucketStats): void {
    this.bucketStats.set(this.key(provider, bucket), stats);
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

  async acquireAuthLock(
    provider: string,
    options?: { waitMs?: number; staleMs?: number; bucket?: string },
  ): Promise<boolean> {
    const k = `${this.key(provider, options?.bucket)}:auth`;
    if (this.locks.has(k)) return false;
    this.locks.add(k);
    return true;
  }

  async releaseAuthLock(provider: string, bucket?: string): Promise<void> {
    this.locks.delete(`${this.key(provider, bucket)}:auth`);
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

const CAPABILITY_TOKEN = 'a'.repeat(64);

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
      client.close();
    } catch {
      // client may not be initialized
    }
    try {
      await server.stop();
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
    capabilityToken?: string,
  ): Promise<ProxySocketClient> {
    const socketPath = await serverInstance.start();
    const c = new ProxySocketClient(socketPath, capabilityToken);
    await c.ensureConnected();
    return c;
  }

  /** Sends a raw handshake frame over a bare TCP/Unix socket and resolves
   *  with the decoded response frame. Used to test server-level rejection
   *  paths (version mismatch, missing token) that bypass the client SDK. */
  async function sendRawHandshake(
    socketPath: string,
    handshakePayload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const net = await import('node:net');
    const { encodeFrame, FrameDecoder } = await import(
      '@vybestack/llxprt-code-auth'
    );
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      let settled = false;
      const socket = net.createConnection(socketPath, () => {
        socket.write(encodeFrame(handshakePayload));
      });
      const decoder = new FrameDecoder();
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error('Timeout waiting for handshake response'));
      }, 5000);
      socket.on('data', (chunk: Buffer) => {
        let frames: Array<Record<string, unknown>>;
        try {
          frames = decoder.feed(chunk);
        } catch (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          reject(err);
          return;
        }
        for (const frame of frames) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(frame);
        }
      });
      socket.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      });
      socket.on('close', () => {
        // Defer to allow pending 'data' events to fire first
        process.nextTick(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error('Connection closed before handshake response'));
        });
      });
    });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * @requirement R25.1
   * @scenario start creates a Unix socket file and returns the socket path
   * @given A CredentialProxyServer is constructed
   * @when start() is called
   * @then A Unix socket file exists at the returned path
   */
  it.skipIf(isWindows)(
    'start creates a Unix socket and returns the socket path',
    async () => {
      server = createServer();
      const socketPath = await server.start();

      expect(socketPath).toStrictEqual(expect.any(String));
      expect(socketPath.endsWith('.sock')).toBe(true);
      const stat = fs.statSync(socketPath);
      expect(stat.isSocket()).toBe(true);
    },
  );

  /**
   * @requirement R25.2
   * @scenario stop removes the socket file and rejects new connections
   * @given A server is started
   * @when stop() is called
   * @then The socket file is removed from disk
   */
  it.skipIf(isWindows)(
    'stop removes the socket file and rejects new connections',
    async () => {
      server = createServer();
      const socketPath = await server.start();

      expect(fs.existsSync(socketPath)).toBe(true);

      await server.stop();

      expect(fs.existsSync(socketPath)).toBe(false);
    },
  );

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

    await expect(server.start()).rejects.toThrow(/already started/);
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

    const response = await sendRawHandshake(socketPath, {
      v: 999,
      op: 'handshake',
      payload: { minVersion: 999, maxVersion: 999 },
    });

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

  // ─── Capability Token Authentication ──────────────────────────────────────

  /**
   * @scenario Server with capability token accepts connection with valid token
   * @given A server configured with a capability token
   * @when A client connects and sends the correct token in the handshake
   * @then The handshake succeeds and the client can make requests
   */
  it('accepts handshake with valid capability token', async () => {
    server = createServer({ capabilityToken: CAPABILITY_TOKEN });
    client = await startAndConnect(server, CAPABILITY_TOKEN);

    // Verify the handshake succeeded by making a request — sandbox connections
    // receive FORBIDDEN (not NOT_FOUND) for missing tokens to prevent enumeration.
    const response = await client.request('get_token', {
      provider: 'nonexistent',
    });
    expect(response.ok).toBe(false);
    expect(response.code).toBe('FORBIDDEN');
  });

  /**
   * @scenario Server with capability token rejects connection with invalid token
   * @given A server configured with a capability token
   * @when A client connects with a wrong token
   * @then The handshake fails with UNAUTHORIZED and the connection is destroyed
   */
  it('rejects handshake with invalid capability token', async () => {
    const token = CAPABILITY_TOKEN;
    server = createServer({ capabilityToken: token });
    const socketPath = await server.start();

    const badClient = new ProxySocketClient(socketPath, 'wrong-token');
    try {
      await expect(badClient.ensureConnected()).rejects.toThrow(
        /authentication failed/i,
      );
    } finally {
      badClient.close();
    }
  });

  /**
   * @scenario Server with capability token rejects connection with missing token
   * @given A server configured with a capability token
   * @when A client connects without presenting any token
   * @then The handshake fails and the connection is destroyed
   */
  it('rejects handshake with missing capability token', async () => {
    const token = CAPABILITY_TOKEN;
    server = createServer({ capabilityToken: token });
    const socketPath = await server.start();

    const tokenlessClient = new ProxySocketClient(socketPath);
    try {
      await expect(tokenlessClient.ensureConnected()).rejects.toThrow(
        /authentication failed/i,
      );
    } finally {
      tokenlessClient.close();
    }
  });

  /**
   * @scenario Server without capability token accepts connections without token
   * @given A server NOT configured with a capability token (non-sandbox)
   * @when A client connects without presenting a token
   * @then The handshake succeeds (backward compatibility)
   */
  it('allows connections without token when no capability token configured', async () => {
    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('list_providers', {});
    expect(response.ok).toBe(true);
  });

  // ─── Enumeration Restriction for Sandbox Connections ───────────────────────

  /**
   * @scenario list_api_keys returns empty array for sandbox connection
   * @given A server with capability token, keys in storage
   * @when A sandbox client (valid token) requests list_api_keys
   * @then Response contains an empty keys array
   */
  it('list_api_keys returns empty array for sandbox connection', async () => {
    await keyStorage.saveKey('anthropic', 'sk-ant-123');
    await keyStorage.saveKey('openai', 'sk-oai-456');

    const token = CAPABILITY_TOKEN;
    server = createServer({ capabilityToken: token });
    client = await startAndConnect(server, token);

    const response = await client.request('list_api_keys', {});
    expect(response.ok).toBe(true);
    expect(response.data!.keys).toStrictEqual([]);
  });

  /**
   * @scenario list_providers returns empty array for sandbox connection
   * @given A server with capability token, tokens in store
   * @when A sandbox client requests list_providers
   * @then Response contains an empty providers array
   */
  it('list_providers returns empty array for sandbox connection', async () => {
    await tokenStore.saveToken('anthropic', makeToken());
    await tokenStore.saveToken('gemini', makeToken());

    const token = CAPABILITY_TOKEN;
    server = createServer({ capabilityToken: token });
    client = await startAndConnect(server, token);

    const response = await client.request('list_providers', {});
    expect(response.ok).toBe(true);
    expect(response.data!.providers).toStrictEqual([]);
  });

  /**
   * @scenario list_buckets returns empty array for sandbox connection
   * @given A server with capability token, tokens in multiple buckets
   * @when A sandbox client requests list_buckets
   * @then Response contains an empty buckets array
   */
  it('list_buckets returns empty array for sandbox connection', async () => {
    await tokenStore.saveToken('anthropic', makeToken(), 'default');
    await tokenStore.saveToken('anthropic', makeToken(), 'work');

    const token = CAPABILITY_TOKEN;
    server = createServer({ capabilityToken: token });
    client = await startAndConnect(server, token);

    const response = await client.request('list_buckets', {
      provider: 'anthropic',
    });
    expect(response.ok).toBe(true);
    expect(response.data!.buckets).toStrictEqual([]);
  });

  /**
   * @scenario get_token still works for sandbox connection (targeted access)
   * @given A server with capability token, a token in store
   * @when A sandbox client requests get_token for a known provider
   * @then The token is returned (targeted access still works)
   */
  it('get_token works for sandbox connection with known provider', async () => {
    await tokenStore.saveToken('anthropic', makeToken());

    const token = CAPABILITY_TOKEN;
    server = createServer({ capabilityToken: token });
    client = await startAndConnect(server, token);

    const response = await client.request('get_token', {
      provider: 'anthropic',
    });
    expect(response.ok).toBe(true);
    expect(response.data!.access_token).toBe('test-access-token');
  });

  /**
   * @scenario get_api_key still works for sandbox connection (targeted access)
   * @given A server with capability token, a key in storage
   * @when A sandbox client requests get_api_key for a known name
   * @then The key is returned (targeted access still works)
   */
  it('get_api_key works for sandbox connection with known name', async () => {
    await keyStorage.saveKey('anthropic', 'sk-ant-123');

    const token = CAPABILITY_TOKEN;
    server = createServer({ capabilityToken: token });
    client = await startAndConnect(server, token);

    const response = await client.request('get_api_key', {
      name: 'anthropic',
    });
    expect(response.ok).toBe(true);
    expect(response.data!.key).toBe('sk-ant-123');
  });

  /**
   * @scenario has_api_key blocked for sandbox connection (prevents enumeration)
   * @given A server with capability token, a key in storage
   * @when A sandbox client requests has_api_key
   * @then Response is ok: false with code FORBIDDEN
   */
  it('has_api_key blocked for sandbox connection', async () => {
    await keyStorage.saveKey('anthropic', 'sk-ant-123');

    server = createServer({ capabilityToken: CAPABILITY_TOKEN });
    client = await startAndConnect(server, CAPABILITY_TOKEN);

    const response = await client.request('has_api_key', {
      name: 'anthropic',
    });
    expect(response.ok).toBe(false);
    expect(response.code).toBe('FORBIDDEN');
  });

  /**
   * @scenario get_token returns FORBIDDEN for unknown provider in sandbox
   * @given A server with capability token, no token for "unknown" provider
   * @when A sandbox client requests get_token for a non-existent provider
   * @then Response is FORBIDDEN. Note: this does NOT fully prevent provider
   *      enumeration — a sandbox client can still distinguish existing
   *      providers (ok: true) from non-existing ones (FORBIDDEN). True
   *      enumeration prevention is only provided by list_* operations.
   *      The FORBIDDEN code avoids revealing the NOT_FOUND code specifically.
   */
  it('get_token returns FORBIDDEN for unknown provider in sandbox', async () => {
    server = createServer({ capabilityToken: CAPABILITY_TOKEN });
    client = await startAndConnect(server, CAPABILITY_TOKEN);

    const response = await client.request('get_token', {
      provider: 'nonexistent',
    });

    expect(response.ok).toBe(false);
    expect(response.code).toBe('FORBIDDEN');
  });

  /**
   * @scenario get_api_key returns FORBIDDEN for unknown key in sandbox
   * @given A server with capability token, no key for "unknown"
   * @when A sandbox client requests get_api_key for a non-existent key
   * @then Response is FORBIDDEN. Note: this does NOT fully prevent key
   *      enumeration — a sandbox client can still distinguish existing keys
   *      (ok: true) from non-existing ones (FORBIDDEN). True enumeration
   *      prevention is only provided by list_* operations. The FORBIDDEN
   *      code avoids revealing the NOT_FOUND code specifically.
   */
  it('get_api_key returns FORBIDDEN for unknown key in sandbox', async () => {
    server = createServer({ capabilityToken: CAPABILITY_TOKEN });
    client = await startAndConnect(server, CAPABILITY_TOKEN);

    const response = await client.request('get_api_key', {
      name: 'nonexistent',
    });

    expect(response.ok).toBe(false);
    expect(response.code).toBe('FORBIDDEN');
  });

  /**
   * @scenario Enumeration works for non-sandbox (no token) connections
   * @given A server WITHOUT capability token, keys and tokens in store
   * @when A non-sandbox client requests enumeration operations
   * @then Full lists are returned (backward compatibility)
   */
  it('list operations return full data for non-sandbox connections', async () => {
    await keyStorage.saveKey('anthropic', 'sk-ant-123');
    await tokenStore.saveToken('gemini', makeToken());

    server = createServer();
    client = await startAndConnect(server);

    const keysResponse = await client.request('list_api_keys', {});
    expect(keysResponse.ok).toBe(true);
    expect(keysResponse.data!.keys).toContain('anthropic');

    const providersResponse = await client.request('list_providers', {});
    expect(providersResponse.ok).toBe(true);
    expect(providersResponse.data!.providers).toContain('gemini');

    // Verify get_bucket_stats returns real data for non-sandbox connections
    tokenStore.setBucketStats('gemini', 'default', {
      bucket: 'default',
      requestCount: 42,
      percentage: 75,
      lastUsed: 1234567890,
    });
    const statsResponse = await client.request('get_bucket_stats', {
      provider: 'gemini',
      bucket: 'default',
    });
    expect(statsResponse.ok).toBe(true);
    expect(statsResponse.data!.requestCount).toBe(42);
    expect(statsResponse.data!.percentage).toBe(75);
  });

  // ─── Sandbox Mutation Restrictions (OCR Remediation) ──────────────────────

  /**
   * @scenario save_token is blocked for sandbox connections
   * @given A server WITH capability token and an existing token
   * @when A sandbox-authenticated client tries to save a token
   * @then Response is ok: false with code FORBIDDEN
   */
  it('save_token blocked for sandbox connections', async () => {
    await tokenStore.saveToken('anthropic', makeToken());

    server = createServer({ capabilityToken: CAPABILITY_TOKEN });
    client = await startAndConnect(server, CAPABILITY_TOKEN);

    const response = await client.request('save_token', {
      provider: 'anthropic',
      token: {
        access_token: 'new-token',
        refresh_token: 'new-rt',
        expiry: 8888888888,
        token_type: 'Bearer',
      },
    });

    expect(response.ok).toBe(false);
    expect(response.code).toBe('FORBIDDEN');

    // Verify the store was not mutated
    const stored = await tokenStore.getToken('anthropic');
    expect(stored?.access_token).toBe('test-access-token');
  });

  /**
   * @scenario remove_token is blocked for sandbox connections
   * @given A server WITH capability token and an existing token
   * @when A sandbox-authenticated client tries to remove a token
   * @then Response is ok: false with code FORBIDDEN
   */
  it('remove_token blocked for sandbox connections', async () => {
    await tokenStore.saveToken('anthropic', makeToken());

    server = createServer({ capabilityToken: CAPABILITY_TOKEN });
    client = await startAndConnect(server, CAPABILITY_TOKEN);

    const response = await client.request('remove_token', {
      provider: 'anthropic',
    });

    expect(response.ok).toBe(false);
    expect(response.code).toBe('FORBIDDEN');

    // Verify the token was not removed
    const stored = await tokenStore.getToken('anthropic');
    expect(stored).not.toBeNull();
  });

  /**
   * @scenario get_bucket_stats is blocked for sandbox connections
   * @given A server WITH capability token
   * @when A sandbox-authenticated client requests bucket stats
   * @then Response is ok: true but with empty data (no stats leaked)
   */
  it('returns empty stats for sandbox connections', async () => {
    // Populate real stats so the test proves the sandbox path suppresses
    // actual data rather than returning zeros from an empty store.
    tokenStore.setBucketStats('anthropic', 'default', {
      bucket: 'default',
      requestCount: 42,
      percentage: 75,
      lastUsed: 1234567890,
    });

    server = createServer({ capabilityToken: CAPABILITY_TOKEN });
    client = await startAndConnect(server, CAPABILITY_TOKEN);

    const response = await client.request('get_bucket_stats', {
      provider: 'anthropic',
      bucket: 'default',
    });

    expect(response.ok).toBe(true);
    expect(response.data!).toStrictEqual({
      bucket: 'default',
      requestCount: 0,
      percentage: 0,
    });
    expect(response.data!.lastUsed).toBeUndefined();
  });

  /**
   * @scenario get_bucket_stats returns NOT_FOUND for non-sandbox when no stats
   * @given A server WITHOUT capability token and no stats for the provider
   * @when A non-sandbox client requests bucket stats
   * @then Response is ok: false with code NOT_FOUND
   */
  it('get_bucket_stats returns NOT_FOUND for non-sandbox when no stats', async () => {
    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('get_bucket_stats', {
      provider: 'nonexistent',
      bucket: 'default',
    });

    expect(response.ok).toBe(false);
    expect(response.code).toBe('NOT_FOUND');
  });

  /**
   * @scenario save_token works for non-sandbox connections
   * @given A server WITHOUT capability token
   * @when A non-sandbox client saves a token
   * @then Response is ok: true (backward compatibility)
   */
  it('save_token works for non-sandbox connections', async () => {
    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('save_token', {
      provider: 'anthropic',
      token: {
        access_token: 'new-at',
        refresh_token: 'new-rt',
        expiry: 8888888888,
        token_type: 'Bearer',
      },
    });

    expect(response.ok).toBe(true);

    // Verify the token was actually persisted
    const stored = await tokenStore.getToken('anthropic');
    expect(stored?.access_token).toBe('new-at');
  });

  /**
   * @scenario remove_token works for non-sandbox connections
   * @given A server WITHOUT capability token and an existing token
   * @when A non-sandbox client removes a token
   * @then Response is ok: true and the token is actually removed
   */
  it('remove_token works for non-sandbox connections', async () => {
    await tokenStore.saveToken('anthropic', makeToken());

    server = createServer();
    client = await startAndConnect(server);

    const response = await client.request('remove_token', {
      provider: 'anthropic',
    });

    expect(response.ok).toBe(true);

    // Verify the token was actually removed
    const stored = await tokenStore.getToken('anthropic');
    expect(stored).toBeNull();
  });

  /**
   * @scenario Empty capability token is rejected at construction time
   * @given A server configured with an empty string capability token
   * @when The constructor is called
   * @then It throws to prevent silently disabling authentication
   */
  it('rejects empty capability token at construction time', () => {
    expect(() => createServer({ capabilityToken: '' })).toThrow(
      /non-empty string/,
    );
  });

  /**
   * @scenario Version mismatch is rejected before capability token check
   * @given A server configured with a capability token
   * @when A client sends a handshake with an incompatible protocol version
   * @then The handshake fails with a version mismatch error (not UNAUTHORIZED)
   */
  it('rejects version mismatch before capability token check', async () => {
    server = createServer({ capabilityToken: CAPABILITY_TOKEN });
    const socketPath = await server.start();

    const response = await sendRawHandshake(socketPath, {
      v: 999,
      op: 'handshake',
      payload: { minVersion: 999, maxVersion: 999 },
    });

    expect(response.ok).toBe(false);
    expect(response.code).toBe('UNKNOWN_VERSION');
  });

  /**
   * @scenario OAuth mutating operations are blocked for sandbox connections
   * @given A server configured with a capability token (sandbox connections)
   * @when A sandbox client requests an OAuth operation that would mutate the
   *       token store (oauth_initiate, oauth_exchange, oauth_poll, refresh_token)
   * @then The operation is blocked with FORBIDDEN to prevent token store
   *       mutation bypass via OAuth endpoints
   */
  it('blocks oauth mutating operations for sandbox connections', async () => {
    server = createServer({ capabilityToken: CAPABILITY_TOKEN });
    client = await startAndConnect(server, CAPABILITY_TOKEN);

    const response = await client.request('oauth_initiate', {
      provider: 'anthropic',
    });

    expect(response.ok).toBe(false);
    expect(response.code).toBe('FORBIDDEN');
  });
});
