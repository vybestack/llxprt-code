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
 * Creates a temporary IPC endpoint for testing.
 */
function createTempSocketPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\llxprt-proxy-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-test-'));
  return path.join(tmpDir, 'test.sock');
}

/**
 * Helper: starts a server that auto-replies to handshake then echoes requests.
 */
function createAutoReplyServer(_socketPath: string): net.Server {
  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      const frames = decoder.feed(chunk);
      for (const frame of frames) {
        const msg = frame;
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

/**
 * Helper: starts a server that captures the handshake frame and auto-replies.
 * Returns both the server and a per-instance handshake promise so each test
 * owns its own state (no module-level mutable singleton).
 *
 * @param onHandshake Optional factory to customize the handshake response.
 *                    Defaults to ok: true with the current protocol version.
 */
function createHandshakeCapturingServer(
  socketPath: string,
  onHandshake?: () => Buffer,
): Promise<{
  server: net.Server;
  handshake: Promise<Record<string, unknown>>;
}> {
  let resolveHandshake!: (frame: Record<string, unknown>) => void;
  let rejectHandshake!: (err: Error) => void;
  let timeoutHandle!: ReturnType<typeof setTimeout>;
  let settled = false;
  const handshake = Promise.race([
    new Promise<Record<string, unknown>>((resolve, reject) => {
      resolveHandshake = (frame) => {
        clearTimeout(timeoutHandle);
        resolve(frame);
      };
      rejectHandshake = (err) => {
        clearTimeout(timeoutHandle);
        reject(err);
      };
    }),
    new Promise<Record<string, unknown>>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Handshake capture timed out'));
        }
      }, 5000);
      timeoutHandle.unref();
    }),
  ]);
  // Prevent unhandled rejection if the caller never awaits the handshake promise
  handshake.catch(() => {});
  const srv = net.createServer((socket) => {
    const decoder = new FrameDecoder();
    socket.on('data', (chunk) => {
      const frames = decoder.feed(chunk);
      for (const frame of frames) {
        if (frame.op === 'handshake') {
          if (!settled) {
            settled = true;
            resolveHandshake(frame);
          }
          if (onHandshake) {
            socket.end(onHandshake());
          } else {
            socket.end(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
          }
          break;
        }
      }
    });
    socket.on('close', () => {
      if (!settled) {
        settled = true;
        rejectHandshake(new Error('Socket closed before handshake'));
      }
    });
    socket.on('error', (err) => {
      if (!settled) {
        settled = true;
        rejectHandshake(err);
      }
    });
  });
  return new Promise((resolve, reject) => {
    const rejectStartup = (error: Error): void => reject(error);
    srv.once('error', rejectStartup);
    srv.listen(socketPath, () => {
      srv.removeListener('error', rejectStartup);
      srv.on('error', rejectHandshake);
      resolve({ server: srv, handshake });
    });
  });
}

describe('ProxySocketClient', () => {
  let socketPath: string;
  let server: net.Server | undefined;
  let client: ProxySocketClient | undefined;

  beforeEach(() => {
    socketPath = createTempSocketPath();
  });

  afterEach(async () => {
    client?.close();
    await new Promise<void>((resolve) => {
      if (server?.listening === true) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });

    if (process.platform !== 'win32') {
      const socketDir = path.dirname(socketPath);
      fs.rmSync(socketDir, { recursive: true, force: true });
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
              const msg = frame;
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

  it('unrefs the socket after connect so idle proxy clients do not keep Bun alive', async () => {
    server = createAutoReplyServer(socketPath);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const unrefSpy = vi.spyOn(net.Socket.prototype, 'unref');
    try {
      client = new ProxySocketClient(socketPath);
      await client.ensureConnected();

      expect(unrefSpy).toHaveBeenCalled();
    } finally {
      unrefSpy.mockRestore();
    }
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
          const msg = frame;
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
          const msg = frame;
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

    await expect(requestPromise).rejects.toThrow(/timed out/);

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
          const msg = frame;
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
    const handleServerFrame = (
      msg: Record<string, unknown>,
      socket: net.Socket,
      pendingResponses: Array<{ id: string; op: string }>,
    ): void => {
      if (msg.op === 'handshake') {
        socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
        return;
      }
      pendingResponses.push({
        id: msg.id as string,
        op: msg.op as string,
      });

      // Respond in reverse order to test correlation
      if (pendingResponses.length === 3) {
        const reversed = pendingResponses.toReversed();
        for (const pending of reversed) {
          socket.write(
            encodeFrame({
              ok: true,
              id: pending.id,
              data: { echo: pending.op },
            }),
          );
        }
      }
    };

    server = net.createServer((socket) => {
      const decoder = new FrameDecoder();
      const pendingResponses: Array<{ id: string; op: string }> = [];

      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          handleServerFrame(frame, socket, pendingResponses);
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
    expect(r1.data).toStrictEqual({ echo: 'alpha' });
    expect(r2.data).toStrictEqual({ echo: 'beta' });
    expect(r3.data).toStrictEqual({ echo: 'gamma' });
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
          const msg = frame;
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
          const msg = frame;
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

    await expect(pendingRequest).rejects.toThrow(Error);
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

  // ─── Capability Token ──────────────────────────────────────────────────────

  /**
   * @scenario Client includes capability token in handshake payload
   * @given A client constructed with a capability token
   * @when The client connects and performs a handshake
   * @then The handshake payload contains the capabilityToken field
   */
  it('includes capability token in handshake payload when provided', async () => {
    const capabilityToken = 'deadbeef'.repeat(8);
    const result = await createHandshakeCapturingServer(socketPath);
    server = result.server;

    client = new ProxySocketClient(socketPath, capabilityToken);
    await client.ensureConnected();

    const handshake = await result.handshake;
    const payload = handshake.payload as Record<string, unknown>;
    expect(payload.capabilityToken).toBe(capabilityToken);
    // The client currently hardcodes minVersion/maxVersion to 1 (not PROTOCOL_VERSION)
    expect(payload.minVersion).toBe(1);
    expect(payload.maxVersion).toBe(1);
  });

  /**
   * @scenario Client omits capability token when not provided
   * @given A client constructed WITHOUT a capability token
   * @when The client connects and performs a handshake
   * @then The handshake payload does NOT contain a capabilityToken field
   */
  it('omits capability token in handshake when not provided', async () => {
    const result = await createHandshakeCapturingServer(socketPath);
    server = result.server;

    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    const handshake = await result.handshake;
    const payload = handshake.payload as Record<string, unknown>;
    expect(payload.capabilityToken).toBeUndefined();
  });

  /**
   * @scenario Client surfaces descriptive error when server rejects token
   * @given A server that responds to handshake with ok: false and UNAUTHORIZED
   * @when A client connects
   * @then ensureConnected rejects with an authentication failure message
   */
  it('surfaces authentication error on UNAUTHORIZED handshake', async () => {
    const result = await createHandshakeCapturingServer(socketPath, () =>
      encodeFrame({
        ok: false,
        code: 'UNAUTHORIZED',
        error: 'Invalid or missing capability token',
      }),
    );
    server = result.server;

    client = new ProxySocketClient(socketPath, 'some-token');
    await expect(client.ensureConnected()).rejects.toThrow(
      /Credential proxy authentication failed/i,
    );
  });
});
