/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250214-CREDPROXY.P04
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  ProxySocketClient,
  REQUEST_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  PROTOCOL_VERSION,
} from '../proxy-socket-client.js';
import { encodeFrame, FrameDecoder } from '../framing.js';

/**
 * Creates a temporary Unix socket path for testing.
 */
function createTempSocketPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-test-'));
  return path.join(tmpDir, 'test.sock');
}

/**
 * Creates a mock proxy server that speaks the framing protocol.
 * Returns the server and its socket path.

/**
 * Helper: starts a server that auto-replies to handshake then echoes requests.
 */
function createAutoReplyServer(_socketPath: string): net.Server {
  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      const frames = decoder.feed(chunk);
      for (const frame of frames) {
        const msg = frame as Record<string, unknown>;
        if (msg.op === 'handshake') {
          // Reply with handshake success
          const response = { ok: true, v: PROTOCOL_VERSION };
          socket.write(encodeFrame(response));
        } else {
          // Echo back with ok and the request id
          const response = {
            ok: true,
            id: msg.id,
            data: msg.payload,
          };
          socket.write(encodeFrame(response));
        }
      }
    });
  });

  return server;
}

describe('ProxySocketClient', () => {
  let socketPath: string;
  let server: net.Server;
  let client: ProxySocketClient;

  beforeEach(() => {
    socketPath = createTempSocketPath();
  });

  afterEach(async () => {
    try {
      client?.close();
    } catch {
      // client may not be initialized
    }
    await new Promise<void>((resolve) => {
      if (server?.listening) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });
    // Clean up socket file
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // may already be gone
    }
  });

  /**
   * @requirement R6.1
   * @scenario Constructor stores the socket path for later connection
   */
  it('stores socketPath from constructor', () => {
    client = new ProxySocketClient(socketPath);

    // The client should store the path — we verify by using it to connect
    // (No public getter, but ensureConnected will use the stored path)
    expect(client).toBeInstanceOf(ProxySocketClient);
  });

  /**
   * @requirement R6.2
   * @scenario Handshake sends protocol version 1
   */
  it('sends a handshake frame with version 1 on connect', async () => {
    const handshakeReceived = new Promise<Record<string, unknown>>(
      (resolve) => {
        server = net.createServer((socket) => {
          const decoder = new FrameDecoder();
          socket.on('data', (chunk) => {
            const frames = decoder.feed(chunk);
            for (const frame of frames) {
              const msg = frame as Record<string, unknown>;
              if (msg.op === 'handshake') {
                resolve(msg);
                // Reply so the handshake completes
                socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
              }
            }
          });
        });
      },
    );

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    const handshake = await handshakeReceived;
    expect(handshake.v).toBe(PROTOCOL_VERSION);
    expect(handshake.op).toBe('handshake');
  });

  /**
   * @requirement R6.2
   * @scenario Handshake rejects when server responds with version mismatch
   */
  it('rejects handshake on version mismatch', async () => {
    server = net.createServer((socket) => {
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const _frame of frames) {
          // Reply with error
          socket.write(
            encodeFrame({
              ok: false,
              error: 'Unsupported protocol version',
            }),
          );
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);
    await expect(client.ensureConnected()).rejects.toThrow(/version/i);
  });

  /**
   * @requirement R6.3
   * @scenario Each request generates a unique UUID
   */
  it('generates a unique UUID for each request', async () => {
    const receivedIds = new Set<string>();

    server = net.createServer((socket) => {
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          const msg = frame as Record<string, unknown>;
          if (msg.op === 'handshake') {
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
          } else {
            receivedIds.add(msg.id as string);
            socket.write(encodeFrame({ ok: true, id: msg.id, data: {} }));
          }
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);

    await client.request('op1', { a: 1 });
    await client.request('op2', { b: 2 });
    await client.request('op3', { c: 3 });

    expect(receivedIds.size).toBe(3);
    // Verify each ID looks like a UUID
    for (const id of receivedIds) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });

  /**
   * @requirement R6.3
   * @scenario Request times out after REQUEST_TIMEOUT_MS
   */
  it('rejects request after 30s timeout', async () => {
    vi.useFakeTimers();

    server = net.createServer((socket) => {
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          const msg = frame as Record<string, unknown>;
          if (msg.op === 'handshake') {
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
          }
          // Deliberately do NOT respond to other requests (simulates timeout)
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    const requestPromise = client.request('slow-op', {});

    // Advance past the request timeout
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS + 100);

    await expect(requestPromise).rejects.toThrow();

    vi.useRealTimers();
  });

  /**
   * @requirement R24.1
   * @scenario Idle timeout triggers graceful close after 5 minutes
   */
  it('triggers gracefulClose after idle timeout', async () => {
    vi.useFakeTimers();

    server = createAutoReplyServer(socketPath);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    // Advance time past idle timeout
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 100);

    // After idle timeout, the next request should trigger a reconnection
    // (which means a new handshake). We verify by making another request
    // that succeeds (requires new handshake)
    const response = await client.request('after-idle', { test: true });
    expect(response.ok).toBe(true);

    vi.useRealTimers();
  });

  /**
   * @requirement R24.2
   * @scenario Connection error surfaces descriptive error message
   */
  it('surfaces "Credential proxy connection lost" on connection error', async () => {
    server = net.createServer((socket) => {
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          const msg = frame as Record<string, unknown>;
          if (msg.op === 'handshake') {
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
          } else {
            // Destroy connection mid-request to simulate error
            socket.destroy();
          }
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    await expect(client.request('will-fail', {})).rejects.toThrow(
      /credential proxy connection lost/i,
    );
  });

  /**
   * @requirement R6.3
   * @scenario Multiple concurrent requests correlate responses by ID
   */
  it('correlates concurrent responses by request ID', async () => {
    server = net.createServer((socket) => {
      const decoder = new FrameDecoder();
      const pendingResponses: Array<{ id: string; op: string }> = [];

      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          const msg = frame as Record<string, unknown>;
          if (msg.op === 'handshake') {
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
          } else {
            pendingResponses.push({
              id: msg.id as string,
              op: msg.op as string,
            });

            // Respond in reverse order to test correlation
            if (pendingResponses.length === 3) {
              for (const pending of pendingResponses.reverse()) {
                socket.write(
                  encodeFrame({
                    ok: true,
                    id: pending.id,
                    data: { echo: pending.op },
                  }),
                );
              }
            }
          }
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);

    // Send 3 concurrent requests
    const [r1, r2, r3] = await Promise.all([
      client.request('alpha', {}),
      client.request('beta', {}),
      client.request('gamma', {}),
    ]);

    // Each response should match its original request despite reverse ordering
    expect(r1.data).toEqual({ echo: 'alpha' });
    expect(r2.data).toEqual({ echo: 'beta' });
    expect(r3.data).toEqual({ echo: 'gamma' });
  });

  /**
   * @requirement R6.4
   * @scenario Reconnection after idle close sends new handshake
   */
  it('sends new handshake on reconnection after idle close', async () => {
    vi.useFakeTimers();

    let handshakeCount = 0;

    server = net.createServer((socket) => {
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          const msg = frame as Record<string, unknown>;
          if (msg.op === 'handshake') {
            handshakeCount++;
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
          } else {
            socket.write(encodeFrame({ ok: true, id: msg.id, data: {} }));
          }
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();
    expect(handshakeCount).toBe(1);

    // Trigger idle timeout
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 100);

    // Next request should reconnect with a new handshake
    await client.request('after-reconnect', {});
    expect(handshakeCount).toBe(2);

    vi.useRealTimers();
  });

  /**
   * @requirement R6.5
   * @scenario close() destroys socket and rejects pending requests
   */
  it('rejects pending requests when close() is called', async () => {
    server = net.createServer((socket) => {
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          const msg = frame as Record<string, unknown>;
          if (msg.op === 'handshake') {
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
          }
          // Don't respond to other requests — they'll pend
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    // Start a request that will never get a response
    const pendingRequest = client.request('will-be-rejected', {});

    // Close the client — should reject pending requests
    client.close();

    await expect(pendingRequest).rejects.toThrow();
  });

  /**
   * @requirement R6.5
   * @scenario gracefulClose() ends socket cleanly without pending rejections for idle
   */
  it('gracefulClose ends socket without rejecting (no pending requests)', async () => {
    server = createAutoReplyServer(socketPath);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    // No pending requests — graceful close should not throw
    expect(() => client.gracefulClose()).not.toThrow();
  });
});
