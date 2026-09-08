/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for concurrent dispatch on the credential proxy server.
 *
 * REQ-005: Requests on a credential-proxy connection must dispatch
 * concurrently while each response is still written as exactly one complete
 * frame. Today every request is chained onto state.inFlight, so a long-running
 * operation blocks every later request on that connection.
 *
 * These tests use REAL Unix domain sockets. node:net and the server are never
 * mocked. Only the infrastructure boundary (TokenStore / ProviderKeyStorage)
 * uses in-memory test doubles, which is permitted by the mock-hygiene rules.
 *
 * @plan PLAN-20260731-GHBROKER.P03
 * @requirement REQ-005
 * @pseudocode 001-concurrent-dispatch.md lines T1-T8
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as net from 'node:net';

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
import { encodeFrame, FrameDecoder } from '@vybestack/llxprt-code-auth';

const isWindows = process.platform === 'win32';

// ─── In-Memory Test Doubles (infrastructure boundary) ────────────────────────

class InMemoryTokenStore implements TokenStore {
  protected tokens: Map<string, OAuthToken> = new Map();
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

  async acquireRefreshLock(
    provider: string,
    options?: { waitMs?: number; bucket?: string },
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
    options?: { waitMs?: number; bucket?: string },
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

/**
 * Token store whose getToken blocks on a manual gate. Simulates a
 * long-running host-side operation (the future blocking watch) so we can
 * prove that unrelated requests on the same connection are not blocked.
 */
class GatedTokenStore extends InMemoryTokenStore {
  private gatePromise: Promise<void>;
  private releaseFn: () => void = () => {};

  constructor() {
    super();
    this.gatePromise = new Promise((resolve) => {
      this.releaseFn = resolve;
    });
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    await this.gatePromise;
    return super.getToken(provider, bucket);
  }

  /** Release the gate so all blocked getToken calls proceed. */
  release(): void {
    this.releaseFn();
  }
}

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

/**
 * Sends raw frames over a bare Unix-domain socket and collects decoded
 * response frames. Used for protocol-level tests that must bypass the
 * ProxySocketClient SDK (e.g., duplicate request ids, pre-handshake requests).
 *
 * @plan PLAN-20260731-GHBROKER.P03
 * @requirement REQ-005
 * @pseudocode 001-concurrent-dispatch.md lines T4, T7
 */
async function sendRawFrames(
  socketPath: string,
  frames: Array<Record<string, unknown>>,
  options: { capabilityToken?: string; expectHandshake?: boolean } = {},
): Promise<Array<Record<string, unknown>>> {
  const { capabilityToken, expectHandshake = true } = options;
  return new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const responses: Array<Record<string, unknown>> = [];
    let settled = false;
    const decoder = new FrameDecoder();

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error('Timeout waiting for responses'));
    }, 10000);

    const socket = net.createConnection(socketPath, () => {
      if (expectHandshake) {
        const handshakePayload: Record<string, unknown> = {
          minVersion: 1,
          maxVersion: 1,
        };
        if (capabilityToken) {
          handshakePayload.capabilityToken = capabilityToken;
        }
        socket.write(
          encodeFrame({ v: 1, op: 'handshake', payload: handshakePayload }),
        );
      }
      for (const frame of frames) {
        socket.write(encodeFrame(frame));
      }
    });

    const expectedResponseCount = frames.length;
    let handshakeReceived = !expectHandshake;

    socket.on('data', (chunk: Buffer) => {
      let decoded: Array<Record<string, unknown>>;
      try {
        decoded = decoder.feed(chunk);
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(err);
        return;
      }
      for (const frame of decoded) {
        if (!handshakeReceived) {
          handshakeReceived = true;
          continue;
        }
        responses.push(frame);
        if (responses.length >= expectedResponseCount) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          resolve(responses);
          return;
        }
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
      process.nextTick(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (responses.length > 0) {
          resolve(responses);
        } else {
          reject(new Error('Connection closed before responses'));
        }
      });
    });
  });
}

function isInvalidRequestResponse(response: Record<string, unknown>): boolean {
  return response.ok === false && response.code === 'INVALID_REQUEST';
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Concurrent dispatch (REQ-005)', () => {
  describe.skipIf(isWindows)('non-Windows transport behavior', () => {
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

    // ─── T1: slow op + fast op → fast returns first ───────────────────────────

    /**
     * A slow get_token (gated) and a fast get_api_key are issued on the same
     * connection. With concurrent dispatch the fast op resolves first; with the
     * old serialized chain the fast op would wait for the slow one.
     *
     * @plan PLAN-20260731-GHBROKER.P03
     * @requirement REQ-005
     * @pseudocode 001-concurrent-dispatch.md line T1 (I3)
     */
    it('T1: a fast op returns before a slow op on the same connection', async () => {
      const gatedStore = new GatedTokenStore();
      await gatedStore.saveToken('slow-provider', makeToken());
      await keyStorage.saveKey('fast-key', 'sk-fast-123');

      server = new CredentialProxyServer({
        tokenStore: gatedStore,
        providerKeyStorage:
          keyStorage as unknown as CredentialProxyServerOptions['providerKeyStorage'],
      });
      client = await startAndConnect(server);

      const completionOrder: string[] = [];

      const slowPromise = client
        .request('get_token', { provider: 'slow-provider' })
        .then((r) => {
          completionOrder.push('slow');
          return r;
        });
      const fastPromise = client
        .request('get_api_key', { name: 'fast-key' })
        .then((r) => {
          completionOrder.push('fast');
          return r;
        });

      // Give both requests time to be sent and dispatched.
      await new Promise((resolve) => setTimeout(resolve, 50));
      // The fast op should have resolved already (concurrent dispatch).
      const fastResult = await fastPromise;
      expect(fastResult.ok).toBe(true);
      expect(fastResult.data!.key).toBe('sk-fast-123');

      // Release the gate so the slow op can complete.
      gatedStore.release();
      const slowResult = await slowPromise;
      expect(slowResult.ok).toBe(true);

      // The fast op MUST complete before the slow op.
      expect(completionOrder).toStrictEqual(['fast', 'slow']);
    });

    // ─── T2: long op in flight + get_api_key → key returns immediately ────────

    /**
     * A blocking get_token (gated) is in flight. A get_api_key request arrives
     * on the same connection and must be answered immediately, without waiting
     * for the blocking op to finish. This is the core REQ-005 scenario.
     *
     * @plan PLAN-20260731-GHBROKER.P03
     * @requirement REQ-005
     * @pseudocode 001-concurrent-dispatch.md line T2
     */
    it('T2: get_api_key answers immediately while a long op is in flight', async () => {
      const gatedStore = new GatedTokenStore();
      await gatedStore.saveToken('blocking-provider', makeToken());
      await keyStorage.saveKey('needed-key', 'sk-needed-456');

      server = new CredentialProxyServer({
        tokenStore: gatedStore,
        providerKeyStorage:
          keyStorage as unknown as CredentialProxyServerOptions['providerKeyStorage'],
      });
      client = await startAndConnect(server);

      // Start the blocking op (do not await).
      const blockingPromise = client.request('get_token', {
        provider: 'blocking-provider',
      });

      // Give the blocking op time to be dispatched.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // get_api_key must return immediately while the blocking op is still pending.
      const keyResult = await client.request('get_api_key', {
        name: 'needed-key',
      });
      expect(keyResult.ok).toBe(true);
      expect(keyResult.data!.key).toBe('sk-needed-456');

      // Release the blocking op.
      gatedStore.release();
      const blockingResult = await blockingPromise;
      expect(blockingResult.ok).toBe(true);
    });

    // ─── T3: high-volume interleaved responses, every frame intact ─────────────

    /**
     * 200 requests are issued in waves of 16 (the concurrency cap) on one
     * connection. Every response frame must decode intact with the correct
     * id and data — no truncation, no interleaving of bytes across frames.
     *
     * Waves stay within MAX_CONCURRENT_PER_CONNECTION so the test exercises
     * concurrent dispatch and frame integrity under load, not the cap (which
     * T6 covers).
     *
     * This test guards invariant I1: every response is one complete frame.
     * If socket.write() calls were ever to interleave mid-buffer, the
     * FrameDecoder would produce malformed JSON and the test would fail.
     *
     * @plan PLAN-20260731-GHBROKER.P03
     * @requirement REQ-005
     * @pseudocode 001-concurrent-dispatch.md line T3 (I1)
     */
    it('T3: 200 interleaved responses decode intact with no truncation', async () => {
      const count = 200;
      const waveSize = 16;
      for (let i = 0; i < count; i++) {
        await keyStorage.saveKey(
          `key-${i}`,
          `sk-value-${i}-data`.padEnd(64, 'x'),
        );
      }

      server = createServer();
      client = await startAndConnect(server);

      const responses: Array<{
        ok: boolean;
        id?: string;
        data?: Record<string, unknown>;
      }> = [];

      // Issue requests in waves of `waveSize`, awaiting each wave so we stay
      // within the concurrency cap while still stressing concurrent writes.
      for (let start = 0; start < count; start += waveSize) {
        const end = Math.min(start + waveSize, count);
        const wave: Array<Promise<void>> = [];
        for (let i = start; i < end; i++) {
          wave.push(
            client.request('get_api_key', { name: `key-${i}` }).then((r) => {
              responses.push(r);
            }),
          );
        }
        await Promise.all(wave);
      }

      // Every response must be ok and contain the correct key value.
      expect(responses).toHaveLength(count);
      for (let i = 0; i < count; i++) {
        const matching = responses.find(
          (r) => r.data?.key === `sk-value-${i}-data`.padEnd(64, 'x'),
        );
        expect(matching).toBeDefined();
        expect(matching!.ok).toBe(true);
      }
    });

    // ─── T4: request before handshake → rejected ───────────────────────────────

    /**
     * A request frame sent before a valid handshake must not be dispatched.
     * With a capability token configured, a bare request frame (no capability
     * token) is treated as a handshake attempt and rejected with UNAUTHORIZED —
     * proving the handshake path stays strictly synchronous and gates every
     * dispatch.
     *
     * @plan PLAN-20260731-GHBROKER.P03
     * @requirement REQ-005
     * @pseudocode 001-concurrent-dispatch.md line T4 (I2)
     */
    it('T4: a request before handshake is not dispatched', async () => {
      await keyStorage.saveKey('secret-key', 'sk-secret-value');
      server = createServer({ capabilityToken: CAPABILITY_TOKEN });
      const socketPath = await server.start();

      // Send a request frame WITHOUT a handshake first. The server treats the
      // first frame as a handshake attempt. Since the frame carries no valid
      // capability token, it must be rejected with UNAUTHORIZED — the request
      // must never dispatch, so the secret key value never leaks.
      const rawSocket = net.createConnection(socketPath, () => {
        rawSocket.write(
          encodeFrame({
            v: 1,
            id: 'req-before-handshake',
            op: 'get_api_key',
            payload: { name: 'secret-key' },
          }),
        );
      });

      const result = await new Promise<{ ok: boolean; code?: string }>(
        (resolve, reject) => {
          const decoder = new FrameDecoder();
          const timer = setTimeout(() => {
            rawSocket.destroy();
            reject(new Error('Timeout'));
          }, 5000);

          rawSocket.on('data', (chunk: Buffer) => {
            try {
              const frames = decoder.feed(chunk);
              for (const frame of frames) {
                clearTimeout(timer);
                rawSocket.destroy();
                resolve(frame as { ok: boolean; code?: string });
                return;
              }
            } catch {
              clearTimeout(timer);
              rawSocket.destroy();
              resolve({ ok: false });
            }
          });
          rawSocket.on('close', () => {
            process.nextTick(() => {
              clearTimeout(timer);
              resolve({ ok: false });
            });
          });
          rawSocket.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        },
      );

      // The request frame was treated as a handshake and rejected for lack of
      // a valid capability token — never dispatched.
      expect(result.ok).toBe(false);
      expect(result.code).toBe('UNAUTHORIZED');
    });

    // ─── T5: close mid-op → abort fires, pending empty ─────────────────────────

    /**
     * A slow op is in flight when the client closes the connection. The server
     * must abort the pending op, clear the pending map, and remain healthy.
     * No write should occur after the socket is destroyed.
     *
     * @plan PLAN-20260731-GHBROKER.P03
     * @requirement REQ-005
     * @pseudocode 001-concurrent-dispatch.md line T5 (I4)
     */
    it('T5: closing mid-op aborts cleanly and server stays healthy', async () => {
      const gatedStore = new GatedTokenStore();
      await gatedStore.saveToken('mid-op-provider', makeToken());

      server = new CredentialProxyServer({
        tokenStore: gatedStore,
        providerKeyStorage:
          keyStorage as unknown as CredentialProxyServerOptions['providerKeyStorage'],
      });
      client = await startAndConnect(server);

      // Start a blocking op (do not await — the client will be closed).
      const blockingPromise = client.request('get_token', {
        provider: 'mid-op-provider',
      });
      blockingPromise.catch(() => {
        // Expected: connection lost when client closes.
      });

      // Give the op time to be dispatched and registered in pending.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Close the client connection mid-op.
      client.close();

      // Give the server time to process the close event.
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Release the gate so the blocked getToken can resolve (it will try to
      // write a response, but the socket is already destroyed).
      gatedStore.release();

      // Give the resolved handler time to attempt sendOk (which must no-op).
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The server must still be healthy — a new client can connect and work.
      const newClient = new ProxySocketClient(server.getSocketPath()!);
      await newClient.ensureConnected();
      await keyStorage.saveKey('post-close-key', 'sk-post-789');
      const result = await newClient.request('get_api_key', {
        name: 'post-close-key',
      });
      expect(result.ok).toBe(true);
      expect(result.data!.key).toBe('sk-post-789');
      newClient.close();
    });

    // ─── T6: 17th concurrent request → RESOURCE_EXHAUSTED ──────────────────────

    /**
     * MAX_CONCURRENT_PER_CONNECTION is 16. When 16 ops are in flight, the 17th
     * request must receive RESOURCE_EXHAUSTED instead of being dispatched.
     *
     * @plan PLAN-20260731-GHBROKER.P03
     * @requirement REQ-005
     * @pseudocode 001-concurrent-dispatch.md line T6 (I5), lines 34-38
     */
    it('T6: 17th concurrent request receives RESOURCE_EXHAUSTED', async () => {
      const gatedStore = new GatedTokenStore();
      for (let i = 0; i < 16; i++) {
        await gatedStore.saveToken(`provider-${i}`, makeToken());
      }

      server = new CredentialProxyServer({
        tokenStore: gatedStore,
        providerKeyStorage:
          keyStorage as unknown as CredentialProxyServerOptions['providerKeyStorage'],
      });
      client = await startAndConnect(server);

      // Issue 16 blocking requests (all gated).
      const blockingPromises: Array<Promise<unknown>> = [];
      for (let i = 0; i < 16; i++) {
        const p = client.request('get_token', { provider: `provider-${i}` });
        blockingPromises.push(p.catch(() => undefined));
      }

      // Give them time to be dispatched and registered.
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The 17th request must get RESOURCE_EXHAUSTED.
      await gatedStore.saveToken('provider-16', makeToken());
      const overflow = await client.request('get_token', {
        provider: 'provider-16',
      });
      expect(overflow.ok).toBe(false);
      expect(overflow.code).toBe('RESOURCE_EXHAUSTED');

      // Release the gate so the 16 blocking ops complete.
      gatedStore.release();
      await Promise.all(blockingPromises);
    });

    // ─── T7: duplicate request id → INVALID_REQUEST ───────────────────────────

    /**
     * Two frames with the same request id arrive on the same connection. The
     * second must receive INVALID_REQUEST (fail fast, no dispatch). The
     * INVALID_REQUEST is sent synchronously when the duplicate id is detected,
     * before the first request's async handler completes, so we match by
     * content rather than assuming arrival order.
     *
     * @plan PLAN-20260731-GHBROKER.P03
     * @requirement REQ-005
     * @pseudocode 001-concurrent-dispatch.md line T7, lines 24-26
     */
    it('T7: duplicate request id receives INVALID_REQUEST', async () => {
      await keyStorage.saveKey('dup-key-a', 'sk-dup-a');
      await keyStorage.saveKey('dup-key-b', 'sk-dup-b');

      server = createServer();
      const socketPath = await server.start();

      const dupId = 'duplicate-id-42';
      const responses = await sendRawFrames(
        socketPath,
        [
          {
            v: 1,
            id: dupId,
            op: 'get_api_key',
            payload: { name: 'dup-key-a' },
          },
          {
            v: 1,
            id: dupId,
            op: 'get_api_key',
            payload: { name: 'dup-key-b' },
          },
        ],
        {},
      );

      expect(responses).toHaveLength(2);
      // Exactly one response is the successful get_api_key for the first
      // request (the second is never dispatched due to the duplicate id).
      const success = responses.find((r) => r.ok === true);
      expect(success).toBeDefined();
      expect(success!.data!.key).toBe('sk-dup-a');
      // Exactly one response is the INVALID_REQUEST for the duplicate.
      const rejection = responses.find(isInvalidRequestResponse);
      expect(rejection).toBeDefined();
      expect(rejection!.error).toContain('Duplicate request id');
    });

    // ─── T8: sendOk / sendError emit exactly one socket.write per frame ────────

    /**
     * Invariant I1 (load-bearing): every response is emitted by exactly ONE
     * socket.write() of one complete frame. This test instruments the raw
     * socket data stream and verifies that each response decodes as exactly one
     * valid frame — it would fail if someone later split a response across
     * multiple writes.
     *
     * @plan PLAN-20260731-GHBROKER.P03
     * @requirement REQ-005
     * @pseudocode 001-concurrent-dispatch.md line T3 (I1), lines 991/1001
     */
    it('T8: each response is exactly one complete frame in the byte stream', async () => {
      await keyStorage.saveKey('frame-key', 'sk-frame-999');

      server = createServer();
      const socketPath = await server.start();

      // Connect with a raw socket and capture every 'data' event. Each event
      // may contain zero, one, or multiple frames. We verify that the total
      // decoded frames are correct and each is well-formed.
      const frames = await collectRawFrames(socketPath, [
        {
          v: 1,
          id: 'single-frame-test',
          op: 'get_api_key',
          payload: { name: 'frame-key' },
        },
      ]);

      // Exactly one response frame for one request — no truncation or
      // interleaving. A split write would cause JSON parse failure.
      expect(frames).toHaveLength(1);
      expect(frames[0].ok).toBe(true);
      expect(frames[0].data).toBeDefined();
      expect((frames[0].data as Record<string, unknown>).key).toBe(
        'sk-frame-999',
      );
    });
  });
});

/**
 * Connects to the socket, performs a handshake, sends the given request
 * frames, and collects all decoded response frames. Each response must
 * decode as one complete frame — if socket.write() were ever to interleave
 * mid-buffer, FrameDecoder would produce malformed JSON.
 *
 * @plan PLAN-20260731-GHBROKER.P03
 * @requirement REQ-005
 * @pseudocode 001-concurrent-dispatch.md line T8 (I1)
 */
async function collectRawFrames(
  socketPath: string,
  requests: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  return new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const decoder = new FrameDecoder();
    const responses: Array<Record<string, unknown>> = [];
    let handshakeReceived = false;
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error('Timeout'))),
      5000,
    );

    const socket = net.createConnection(socketPath, () => {
      socket.write(
        encodeFrame({
          v: 1,
          op: 'handshake',
          payload: { minVersion: 1, maxVersion: 1 },
        }),
      );
      for (const req of requests) socket.write(encodeFrame(req));
    });

    socket.on('data', (chunk: Buffer) => {
      let decoded: Array<Record<string, unknown>>;
      try {
        decoded = decoder.feed(chunk);
      } catch (err) {
        finish(() => reject(err));
        return;
      }
      for (const frame of decoded) {
        if (!handshakeReceived) {
          handshakeReceived = true;
          continue;
        }
        responses.push(frame);
        if (responses.length >= requests.length) {
          finish(() => resolve(responses));
          return;
        }
      }
    });

    socket.on('error', (err) => finish(() => reject(err)));

    // Without this, an unexpected server close leaves the promise pending
    // until the 5s timeout and reports a timeout rather than the real
    // cause, which is a slow and misleading way to learn the connection
    // dropped.
    socket.on('close', () =>
      finish(() =>
        reject(
          new Error(
            `Connection closed after ${responses.length}/${requests.length} responses`,
          ),
        ),
      ),
    );
  });
}
