/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250214-CREDPROXY.P10
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as net from 'node:net';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProxyTokenStore } from '../proxy-token-store.js';
import { encodeFrame, FrameDecoder } from '../framing.js';
import { PROTOCOL_VERSION } from '../proxy-socket-client.js';
import type { OAuthToken, BucketStats } from '../../types.js';

function createTempSocketPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\llxprt-proxy-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-ts-test-'));
  return path.join(tmpDir, 'test.sock');
}

function makeToken(overrides?: Partial<OAuthToken>): OAuthToken {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expiry: Date.now() + 3600000,
    token_type: 'Bearer',
    ...overrides,
  };
}

type RequestHandler = (
  op: string,
  payload: Record<string, unknown>,
) => Record<string, unknown>;

/**
 * Creates a test server that speaks the proxy framing protocol.
 * Performs handshake automatically, then delegates request handling to the provided handler.
 */
function createTestServer(
  socketPath: string,
  handler: RequestHandler,
): net.Server {
  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      const frames = decoder.feed(chunk);
      for (const frame of frames) {
        const msg = frame;
        if (msg.op === 'handshake') {
          socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
        } else {
          const response = handler(
            msg.op as string,
            msg.payload as Record<string, unknown>,
          );
          socket.write(encodeFrame({ ...response, id: msg.id }));
        }
      }
    });
  });
  return server;
}

function serveToken(socket: net.Socket): void {
  const decoder = new FrameDecoder();
  socket.on('data', (chunk) => {
    const frames = decoder.feed(chunk);
    for (const msg of frames) {
      if (msg.op === 'handshake') {
        socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
      } else {
        socket.write(
          encodeFrame({
            ok: true,
            id: msg.id,
            data: makeToken(),
          }),
        );
      }
    }
  });
}

function listenAsync(server: net.Server, socketPath: string): Promise<void> {
  return new Promise<void>((resolve) => server.listen(socketPath, resolve));
}

describe('ProxyTokenStore', () => {
  let socketPath: string;
  let server: net.Server;
  let store: ProxyTokenStore;

  beforeEach(() => {
    socketPath = createTempSocketPath();
  });

  afterEach(async () => {
    try {
      store.getClient().close();
    } catch {
      // client may not be initialized or already closed
    }
    await new Promise<void>((resolve) => {
      if (server.listening) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // may already be gone
    }
  });

  // ─── getToken ────────────────────────────────────────────────────────────

  /**
   * @requirement R8.1
   * @scenario getToken sends correct operation/provider/bucket and returns token
   */
  it('getToken sends correct operation and returns token from response', async () => {
    const token = makeToken();
    let receivedOp: string | undefined;
    let receivedPayload: Record<string, unknown> | undefined;

    server = createTestServer(socketPath, (op, payload) => {
      receivedOp = op;
      receivedPayload = payload;
      return { ok: true, data: token };
    });
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    const result = await store.getToken('anthropic', 'my-bucket');

    expect(receivedOp).toBe('get_token');
    expect(receivedPayload).toStrictEqual({
      provider: 'anthropic',
      bucket: 'my-bucket',
    });
    expect(result).toStrictEqual(token);
  });

  /**
   * @requirement R23.3
   * @scenario getToken returns null when server responds with NOT_FOUND
   */
  it('getToken returns null when server responds NOT_FOUND', async () => {
    server = createTestServer(socketPath, () => ({
      ok: false,
      code: 'NOT_FOUND',
      error: 'Token not found',
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    const result = await store.getToken('anthropic', 'missing-bucket');

    expect(result).toBeNull();
  });

  /** @requirement R-2197 @scenario valid OAuth token payload accepted */
  it('returns token (with provider extensions) when server data is a valid OAuth token', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: {
        access_token: 'test-access-token',
        expiry: 123456,
        token_type: 'Bearer',
        scope: null,
        resource_url: 'https://api.example.com',
        account_id: 'acct-1',
        id_token: 'jwt',
      },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    const result = await store.getToken('anthropic');

    expect(result).toMatchObject({
      access_token: 'test-access-token',
      expiry: 123456,
      token_type: 'Bearer',
      scope: null,
      resource_url: 'https://api.example.com',
    });
    expect(Reflect.get(result ?? {}, 'account_id')).toBe('acct-1');
    expect(Reflect.get(result ?? {}, 'id_token')).toBe('jwt');
  });

  /** @requirement R-2197 @scenario malformed token data rejected */
  it('rejects malformed token data with the stable proxy payload error', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: { access_token: 42 },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(store.getToken('anthropic')).rejects.toThrow(
      /PROXY_PAYLOAD_ERROR/,
    );
  });

  it('rejects token data with a wrong-typed expiry', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: {
        access_token: 'at',
        expiry: 'later',
        token_type: 'Bearer',
      },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(store.getToken('anthropic')).rejects.toThrow(
      /PROXY_PAYLOAD_ERROR/,
    );
  });

  it('rejects token data with a wrong-typed token_type', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: {
        access_token: 'at',
        expiry: 123456,
        token_type: 'invalid',
      },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(store.getToken('anthropic')).rejects.toThrow(
      /PROXY_PAYLOAD_ERROR/,
    );
  });

  it('rejects bucket stats data when the requestCount member is missing', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: { bucket: 'default' },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(store.getBucketStats('anthropic', 'default')).rejects.toThrow(
      /PROXY_PAYLOAD_ERROR/,
    );
  });

  it('rejects bucket stats data when only a scalar is present', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: 'default',
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(store.getBucketStats('anthropic', 'default')).rejects.toThrow(
      /Malformed response for request/,
    );
  });

  it('rejects a provider list wrapper that is scalar', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: { providers: 'anthropic' },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(store.listProviders()).rejects.toThrow(/PROXY_PAYLOAD_ERROR/);
  });

  it('rejects a bucket list wrapper that is scalar', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: { buckets: 'default' },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(store.listBuckets('anthropic')).rejects.toThrow(
      /PROXY_PAYLOAD_ERROR/,
    );
  });

  /** @requirement R-2197 @scenario missing token data rejected */
  it('rejects missing token data with the stable proxy payload error', async () => {
    server = createTestServer(socketPath, () => ({ ok: true }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(store.getToken('anthropic')).rejects.toThrow(
      /PROXY_PAYLOAD_ERROR/,
    );
  });

  /**
   * @requirement R8.1
   * @scenario getToken passes undefined bucket when none specified
   */
  it('getToken passes undefined bucket when none specified', async () => {
    const token = makeToken();
    let receivedPayload: Record<string, unknown> | undefined;

    server = createTestServer(socketPath, (_op, payload) => {
      receivedPayload = payload;
      return { ok: true, data: token };
    });
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await store.getToken('gemini');

    // When bucket is undefined, the payload omits the key entirely (strict equality behavior)
    expect(receivedPayload).toStrictEqual({
      provider: 'gemini',
    });
  });

  // ─── saveToken ───────────────────────────────────────────────────────────

  /**
   * @requirement R8.2
   * @scenario saveToken sends token data with correct operation/provider/bucket
   */
  it('saveToken sends correct operation with token payload', async () => {
    const token = makeToken({ access_token: 'save-me' });
    let receivedOp: string | undefined;
    let receivedPayload: Record<string, unknown> | undefined;

    server = createTestServer(socketPath, (op, payload) => {
      receivedOp = op;
      receivedPayload = payload;
      return { ok: true };
    });
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await store.saveToken('anthropic', token, 'work');

    expect(receivedOp).toBe('save_token');
    expect(receivedPayload).toStrictEqual({
      provider: 'anthropic',
      bucket: 'work',
      token,
    });
  });

  /**
   * @requirement R8.2
   * @scenario saveToken resolves on success response
   */
  it('saveToken resolves without error on success', async () => {
    server = createTestServer(socketPath, () => ({ ok: true }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(
      store.saveToken('anthropic', makeToken()),
    ).resolves.toBeUndefined();
  });

  // ─── removeToken ─────────────────────────────────────────────────────────

  /**
   * @requirement R8.3
   * @scenario removeToken sends remove request with provider/bucket
   */
  it('removeToken sends correct operation with provider and bucket', async () => {
    let receivedOp: string | undefined;
    let receivedPayload: Record<string, unknown> | undefined;

    server = createTestServer(socketPath, (op, payload) => {
      receivedOp = op;
      receivedPayload = payload;
      return { ok: true };
    });
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await store.removeToken('gemini', 'personal');

    expect(receivedOp).toBe('remove_token');
    expect(receivedPayload).toStrictEqual({
      provider: 'gemini',
      bucket: 'personal',
    });
  });

  /**
   * @requirement R8.3
   * @scenario removeToken resolves on success
   */
  it('removeToken resolves without error on success', async () => {
    server = createTestServer(socketPath, () => ({ ok: true }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(
      store.removeToken('anthropic', 'default'),
    ).resolves.toBeUndefined();
  });

  // ─── listProviders ───────────────────────────────────────────────────────

  /**
   * @requirement R8.4
   * @scenario listProviders returns array of provider names from server
   */
  it('listProviders returns provider names from server response', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: { providers: ['anthropic', 'gemini', 'device-code-test'] },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    const providers = await store.listProviders();

    expect(providers).toStrictEqual([
      'anthropic',
      'gemini',
      'device-code-test',
    ]);
  });

  /**
   * @requirement R8.4
   * @scenario listProviders returns empty array when no providers
   */
  it('listProviders returns empty array when no providers exist', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: { providers: [] },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    const providers = await store.listProviders();

    expect(providers).toStrictEqual([]);
  });

  it('rejects a provider list containing non-string entries', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: { providers: ['anthropic', 42] },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);

    await expect(store.listProviders()).rejects.toThrow(/PROXY_PAYLOAD_ERROR/);
  });

  // ─── listBuckets ─────────────────────────────────────────────────────────

  /**
   * @requirement R8.5
   * @scenario listBuckets returns array of bucket names for a provider
   */
  it('listBuckets returns bucket names for a provider', async () => {
    let receivedPayload: Record<string, unknown> | undefined;

    server = createTestServer(socketPath, (_op, payload) => {
      receivedPayload = payload;
      return {
        ok: true,
        data: { buckets: ['default', 'work', 'personal'] },
      };
    });
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    const buckets = await store.listBuckets('anthropic');

    expect(receivedPayload).toStrictEqual({ provider: 'anthropic' });
    expect(buckets).toStrictEqual(['default', 'work', 'personal']);
  });

  /**
   * @requirement R8.5
   * @scenario listBuckets returns empty array when no buckets
   */
  it('listBuckets returns empty array when no buckets exist', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: { buckets: [] },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    const buckets = await store.listBuckets('anthropic');

    expect(buckets).toStrictEqual([]);
  });

  it('rejects a bucket list containing non-string entries', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: { buckets: ['default', false] },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);

    await expect(store.listBuckets('anthropic')).rejects.toThrow(
      /PROXY_PAYLOAD_ERROR/,
    );
  });

  // ─── getBucketStats ──────────────────────────────────────────────────────

  /**
   * @requirement R8.7
   * @scenario getBucketStats returns BucketStats object from server response
   */
  it('returns stats from a valid bucket-stats response', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: {
        bucket: 'default',
        requestCount: 42,
        percentage: 75,
        lastUsed: 1234567890,
      },
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    const stats = await store.getBucketStats('anthropic', 'default');

    expect(stats).toStrictEqual({
      bucket: 'default',
      requestCount: 42,
      percentage: 75,
      lastUsed: 1234567890,
    } satisfies BucketStats);
  });

  /**
   * @requirement R8.7, R-2197
   * @scenario getBucketStats rejects token-shaped data (no fabricated zeros)
   */
  it('rejects malformed bucket-stats data instead of fabricating zeros', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: makeToken(),
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(store.getBucketStats('anthropic', 'default')).rejects.toThrow(
      /PROXY_PAYLOAD_ERROR/,
    );
  });

  /**
   * @requirement R8.7, R23.3
   * @scenario getBucketStats returns null when server responds NOT_FOUND
   */
  it('getBucketStats returns null when server responds NOT_FOUND', async () => {
    server = createTestServer(socketPath, () => ({
      ok: false,
      code: 'NOT_FOUND',
      error: 'No such token',
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    const stats = await store.getBucketStats('anthropic', 'nonexistent');

    expect(stats).toBeNull();
  });

  // ─── Lock no-ops ─────────────────────────────────────────────────────────

  /**
   * @requirement R8.8
   * @scenario acquireRefreshLock returns truthy without contacting server
   */
  it('acquireRefreshLock returns true without contacting server', async () => {
    let serverContacted = false;

    server = createTestServer(socketPath, () => {
      serverContacted = true;
      return { ok: true };
    });
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    const acquired = await store.acquireRefreshLock('anthropic');

    expect(acquired).toBe(true);
    expect(serverContacted).toBe(false);
  });

  /**
   * @requirement R8.9
   * @scenario releaseRefreshLock resolves without contacting server
   */
  it('releaseRefreshLock resolves without contacting server', async () => {
    let serverContacted = false;

    server = createTestServer(socketPath, () => {
      serverContacted = true;
      return { ok: true };
    });
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(
      store.releaseRefreshLock('anthropic'),
    ).resolves.toBeUndefined();
    expect(serverContacted).toBe(false);
  });

  // ─── Error handling ──────────────────────────────────────────────────────

  /**
   * @requirement R23.3
   * @scenario Rejects when server returns generic error status
   */
  it('rejects when server returns error status', async () => {
    server = createTestServer(socketPath, () => ({
      ok: false,
      code: 'INTERNAL_ERROR',
      error: 'Something went wrong on host',
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(store.getToken('anthropic')).rejects.toThrow(
      /something went wrong/i,
    );
  });

  /**
   * @requirement R23.3
   * @scenario Rejects when server sends UNAUTHORIZED status
   */
  it('rejects when server sends UNAUTHORIZED status', async () => {
    server = createTestServer(socketPath, () => ({
      ok: false,
      code: 'UNAUTHORIZED',
      error: 'Provider not allowed',
    }));
    await listenAsync(server, socketPath);

    store = new ProxyTokenStore(socketPath);
    await expect(store.saveToken('anthropic', makeToken())).rejects.toThrow(
      /not available|unauthorized|not allowed/i,
    );
  });

  // ─── Connection lifecycle ────────────────────────────────────────────────

  /**
   * @requirement R29.1
   * @scenario Connection is lazy — no connect happens in constructor
   */
  it('creates a lazy connection on first call, not in constructor', async () => {
    let connectionCount = 0;

    server = net.createServer((socket) => {
      connectionCount++;
      serveToken(socket);
    });
    await listenAsync(server, socketPath);

    // Constructor should NOT trigger a connection
    store = new ProxyTokenStore(socketPath);
    expect(connectionCount).toBe(0);

    // First operation should trigger the connection
    await store.getToken('anthropic');
    expect(connectionCount).toBe(1);
  });
});
