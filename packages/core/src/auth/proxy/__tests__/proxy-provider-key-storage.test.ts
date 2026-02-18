/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250214-CREDPROXY.P13
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'node:net';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProxyProviderKeyStorage } from '../proxy-provider-key-storage.js';
import { encodeFrame, FrameDecoder } from '../framing.js';
import { ProxySocketClient, PROTOCOL_VERSION } from '../proxy-socket-client.js';

function createTempSocketPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-pks-test-'));
  return path.join(tmpDir, 'test.sock');
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
        const msg = frame as Record<string, unknown>;
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

function listenAsync(server: net.Server, socketPath: string): Promise<void> {
  return new Promise<void>((resolve) => server.listen(socketPath, resolve));
}

describe('ProxyProviderKeyStorage', () => {
  let socketPath: string;
  let server: net.Server;
  let client: ProxySocketClient;
  let storage: ProxyProviderKeyStorage;

  beforeEach(() => {
    socketPath = createTempSocketPath();
  });

  afterEach(async () => {
    try {
      client?.close();
    } catch {
      // client may not be initialized or already closed
    }
    await new Promise<void>((resolve) => {
      if (server?.listening) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
    try {
      // Remove the entire temp directory (includes socket file)
      const tmpDir = path.dirname(socketPath);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // may already be gone
    }
  });

  // ─── getKey ─────────────────────────────────────────────────────────────

  /**
   * @requirement R9.1
   * @scenario getKey sends get_api_key operation with name, returns key string
   */
  it('getKey sends get_api_key operation with name and returns key string', async () => {
    let receivedOp: string | undefined;
    let receivedPayload: Record<string, unknown> | undefined;

    server = createTestServer(socketPath, (op, payload) => {
      receivedOp = op;
      receivedPayload = payload;
      return { ok: true, data: { key: 'sk-ant-abc123' } };
    });
    await listenAsync(server, socketPath);

    client = new ProxySocketClient(socketPath);
    storage = new ProxyProviderKeyStorage(client);
    const result = await storage.getKey('anthropic');

    expect(receivedOp).toBe('get_api_key');
    expect(receivedPayload).toEqual({ name: 'anthropic' });
    expect(result).toBe('sk-ant-abc123');
  });

  /**
   * @requirement R9.1, R23.3
   * @scenario getKey returns null when server responds NOT_FOUND
   */
  it('getKey returns null when server responds NOT_FOUND', async () => {
    server = createTestServer(socketPath, () => ({
      ok: false,
      code: 'NOT_FOUND',
      error: 'Key not found',
    }));
    await listenAsync(server, socketPath);

    client = new ProxySocketClient(socketPath);
    storage = new ProxyProviderKeyStorage(client);
    const result = await storage.getKey('nonexistent-provider');

    expect(result).toBeNull();
  });

  // ─── listKeys ───────────────────────────────────────────────────────────

  /**
   * @requirement R9.2
   * @scenario listKeys sends list_api_keys operation and returns array of key names
   */
  it('listKeys sends list_api_keys operation and returns array of key names', async () => {
    let receivedOp: string | undefined;

    server = createTestServer(socketPath, (op) => {
      receivedOp = op;
      return { ok: true, data: { keys: ['anthropic', 'gemini', 'openai'] } };
    });
    await listenAsync(server, socketPath);

    client = new ProxySocketClient(socketPath);
    storage = new ProxyProviderKeyStorage(client);
    const keys = await storage.listKeys();

    expect(receivedOp).toBe('list_api_keys');
    expect(keys).toEqual(['anthropic', 'gemini', 'openai']);
  });

  /**
   * @requirement R9.2
   * @scenario listKeys returns empty array when no keys exist
   */
  it('listKeys returns empty array when no keys exist', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: { keys: [] },
    }));
    await listenAsync(server, socketPath);

    client = new ProxySocketClient(socketPath);
    storage = new ProxyProviderKeyStorage(client);
    const keys = await storage.listKeys();

    expect(keys).toEqual([]);
  });

  // ─── hasKey ─────────────────────────────────────────────────────────────

  /**
   * @requirement R9.3
   * @scenario hasKey sends has_api_key operation and returns true when key exists
   */
  it('hasKey sends has_api_key operation and returns true when found', async () => {
    let receivedOp: string | undefined;
    let receivedPayload: Record<string, unknown> | undefined;

    server = createTestServer(socketPath, (op, payload) => {
      receivedOp = op;
      receivedPayload = payload;
      return { ok: true, data: { exists: true } };
    });
    await listenAsync(server, socketPath);

    client = new ProxySocketClient(socketPath);
    storage = new ProxyProviderKeyStorage(client);
    const result = await storage.hasKey('anthropic');

    expect(receivedOp).toBe('has_api_key');
    expect(receivedPayload).toEqual({ name: 'anthropic' });
    expect(result).toBe(true);
  });

  /**
   * @requirement R9.3
   * @scenario hasKey returns false when key not found
   */
  it('hasKey returns false when key not found', async () => {
    server = createTestServer(socketPath, () => ({
      ok: true,
      data: { exists: false },
    }));
    await listenAsync(server, socketPath);

    client = new ProxySocketClient(socketPath);
    storage = new ProxyProviderKeyStorage(client);
    const result = await storage.hasKey('nonexistent');

    expect(result).toBe(false);
  });

  // ─── Write operations (blocked) ────────────────────────────────────────

  /**
   * @requirement R9.4
   * @scenario saveKey throws sandbox error immediately without contacting server
   */
  it('saveKey throws sandbox error without contacting server', async () => {
    let serverContacted = false;

    server = createTestServer(socketPath, () => {
      serverContacted = true;
      return { ok: true };
    });
    await listenAsync(server, socketPath);

    client = new ProxySocketClient(socketPath);
    storage = new ProxyProviderKeyStorage(client);

    await expect(storage.saveKey('anthropic', 'sk-test-key')).rejects.toThrow(
      /not available in sandbox/i,
    );
    expect(serverContacted).toBe(false);
  });

  /**
   * @requirement R9.5
   * @scenario deleteKey throws sandbox error immediately without contacting server
   */
  it('deleteKey throws sandbox error without contacting server', async () => {
    let serverContacted = false;

    server = createTestServer(socketPath, () => {
      serverContacted = true;
      return { ok: true };
    });
    await listenAsync(server, socketPath);

    client = new ProxySocketClient(socketPath);
    storage = new ProxyProviderKeyStorage(client);

    await expect(storage.deleteKey('anthropic')).rejects.toThrow(
      /not available in sandbox/i,
    );
    expect(serverContacted).toBe(false);
  });

  // ─── Error handling ────────────────────────────────────────────────────

  /**
   * @requirement R23.3
   * @scenario getKey rejects when server returns INTERNAL_ERROR
   */
  it('getKey rejects when server returns INTERNAL_ERROR', async () => {
    server = createTestServer(socketPath, () => ({
      ok: false,
      code: 'INTERNAL_ERROR',
      error: 'Something went wrong on host',
    }));
    await listenAsync(server, socketPath);

    client = new ProxySocketClient(socketPath);
    storage = new ProxyProviderKeyStorage(client);

    await expect(storage.getKey('anthropic')).rejects.toThrow(
      /something went wrong/i,
    );
  });

  /**
   * @requirement R23.3
   * @scenario listKeys rejects when server returns UNAUTHORIZED
   */
  it('listKeys rejects when server returns UNAUTHORIZED', async () => {
    server = createTestServer(socketPath, () => ({
      ok: false,
      code: 'UNAUTHORIZED',
      error: 'Provider not allowed',
    }));
    await listenAsync(server, socketPath);

    client = new ProxySocketClient(socketPath);
    storage = new ProxyProviderKeyStorage(client);

    await expect(storage.listKeys()).rejects.toThrow(
      /not available|unauthorized|not allowed/i,
    );
  });

  // ─── Shared client ────────────────────────────────────────────────────

  /**
   * @requirement R29.1
   * @scenario Uses existing ProxySocketClient passed to constructor (doesn't create its own)
   */
  it('uses the provided ProxySocketClient without creating a new connection', async () => {
    let connectionCount = 0;

    server = net.createServer((socket) => {
      connectionCount++;
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          const msg = frame as Record<string, unknown>;
          if (msg.op === 'handshake') {
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
          } else {
            socket.write(
              encodeFrame({
                ok: true,
                id: msg.id,
                data: { key: 'test-key' },
              }),
            );
          }
        }
      });
    });
    await listenAsync(server, socketPath);

    client = new ProxySocketClient(socketPath);
    storage = new ProxyProviderKeyStorage(client);

    // First call triggers the single connection
    await storage.getKey('provider1');
    expect(connectionCount).toBe(1);

    // Second call reuses the same connection — no new connection
    await storage.getKey('provider2');
    expect(connectionCount).toBe(1);
  });
});
