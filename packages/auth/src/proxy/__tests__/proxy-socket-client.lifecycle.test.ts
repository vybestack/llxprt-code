/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250214-CREDPROXY.P04
 */

import { assertDefined, errorMessage } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

import {
  ProxySocketClient,
  IDLE_TIMEOUT_MS,
  PROTOCOL_VERSION,
} from '../proxy-socket-client.js';
import { encodeFrame, FrameDecoder } from '../framing.js';

/**
 * Module-level socket tracker. Each test that creates a net.Server registers
 * it here so the afterEach hook can forcibly destroy lingering connections
 * before calling server.close(). Under Bun, server.close() waits for all
 * connections to end, which can hang indefinitely when client sockets linger.
 */
const trackedServers = new Map<net.Server, Set<net.Socket>>();

function trackServerSockets(srv: net.Server): void {
  // Idempotent: only register the connection listener once per server.
  if (trackedServers.has(srv)) return;
  const sockets = new Set<net.Socket>();
  srv.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  trackedServers.set(srv, sockets);
}

function destroyServerSockets(srv: net.Server): void {
  const sockets = trackedServers.get(srv);
  if (sockets) {
    for (const sock of sockets) {
      sock.destroy();
    }
    sockets.clear();
    trackedServers.delete(srv);
  }
}

function initialized<T>(value: T | undefined, resourceName: string): T {
  assertDefined(value, `${resourceName} was not initialized`);
  return value;
}

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
 * Absolute path to the ProxySocketClient source, so a spawned subprocess can
 * import the REAL implementation (no mocks) via a dynamic import. Uses a
 * file:// URL (not URL.pathname) for Windows portability.
 */
/**
 * Budget for deadline races in tests. Comfortably below Bun's 5s per-test cap
 * and the 30s request timeout, so a regression fails fast instead of hanging.
 */
const TEST_DEADLINE_MS = 2_000;

/**
 * Races a promise against a deadline and returns the textual outcome plus the
 * losing timer handle so the caller can clear it in every path. A settled
 * promise yields its error message (or 'resolved' on success). A pending
 * promise yields a sentinel string that fails strict assertions.
 */
async function deadlineRace<T>(
  promise: Promise<T>,
  budgetMs: number,
): Promise<{ result: string; timer: ReturnType<typeof setTimeout> }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    promise.then(
      () => 'resolved',
      (err: unknown) => errorMessage(err),
    ),
    new Promise<string>((resolve) => {
      timer = setTimeout(
        () => resolve('STILL PENDING — transport loss not detected'),
        budgetMs,
      );
    }),
  ]);
  return { result, timer: timer! };
}

/**
 * Inline script run by a real subprocess to prove an idle proxy client exits
 * on its own. It imports the real ProxySocketClient via a file:// URL,
 * connects, completes one request to reach the idle state, then resolves. If
 * the idle socket is unreferenced the event loop drains and the process exits
 * 0; if it is referenced the process hangs and the watchdog SIGKILLs it.
 *
 * Bun `--eval` strips the `--` separator, so the script reads the socket path
 * from process.argv[2]. The module URL is passed as process.argv[1].
 */
describe('ProxySocketClient', () => {
  let socketPath: string;
  let server: net.Server | undefined;
  let client: ProxySocketClient | undefined;

  beforeEach(() => {
    socketPath = createTempSocketPath();
  });

  afterEach(async () => {
    client?.close();
    vi.useRealTimers();
    await new Promise<void>((resolve) => {
      if (server?.listening === true) {
        destroyServerSockets(server);
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
   * @requirement R24.1
   * @scenario The idle timeout closes the first socket after 5 minutes and the
   *           next request completes over a new connection. Fake timers are
   *           activated BEFORE the client is constructed so the idle timer is
   *           created on the faked clock and advancing it past the deadline
   *           fires the real timer path.
   */
  it('closes the first socket at the idle deadline and serves the next request over a new connection', async () => {
    let handshakeCount = 0;
    let firstSocket: net.Socket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const firstSocketClosed = new Promise<void>((resolve) => {
      server = net.createServer((socket) => {
        trackServerSockets(initialized(server, 'server'));
        firstSocket ??= socket;
        socket.on('close', () => {
          if (socket === firstSocket) {
            resolve();
          }
        });
        const decoder = new FrameDecoder();
        socket.on('data', (chunk) => {
          const frames = decoder.feed(chunk);
          for (const frame of frames) {
            const msg = frame;
            if (msg.op === 'handshake') {
              handshakeCount++;
              socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
            } else {
              socket.write(
                encodeFrame({
                  ok: true,
                  id: msg.id,
                  data: { handshake: handshakeCount },
                }),
              );
            }
          }
        });
      });
    });

    await new Promise<void>((resolve) =>
      initialized(server, 'server').listen(socketPath, resolve),
    );

    vi.useFakeTimers();
    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();
    const initialResponse = await client.request('idle-probe', { test: true });
    expect(initialResponse.data).toStrictEqual({ handshake: 1 });

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 1);
    // Restore real timers before waiting on socket teardown: Bun's fake
    // timers freeze Date.now() and stall any wall-clock deadline.
    vi.useRealTimers();

    try {
      await Promise.race([
        firstSocketClosed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Idle timer did not close the socket')),
            TEST_DEADLINE_MS,
          );
        }),
      ]);

      // After the idle close, the next request reconnects over a new socket
      // and a new handshake.
      const response = await client.request('after-idle', { test: true });
      expect(response.data).toStrictEqual({ handshake: 2 });
    } finally {
      clearTimeout(timer);
    }
  });

  /**
   * @requirement R24.1
   * @scenario One millisecond short of the idle deadline the socket stays open,
   *           distinguishing the deadline from any earlier teardown.
   */
  it('keeps the connection open one millisecond short of the idle deadline', async () => {
    let handshakeCount = 0;
    server = net.createServer((socket) => {
      trackServerSockets(initialized(server, 'server'));
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          const msg = frame;
          if (msg.op === 'handshake') {
            handshakeCount++;
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
          } else {
            socket.write(
              encodeFrame({
                ok: true,
                id: msg.id,
                data: { handshake: handshakeCount },
              }),
            );
          }
        }
      });
    });

    await new Promise<void>((resolve) =>
      initialized(server, 'server').listen(socketPath, resolve),
    );

    vi.useFakeTimers();
    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();
    const initialResponse = await client.request('idle-probe', { test: true });
    expect(initialResponse.data).toStrictEqual({ handshake: 1 });

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    // Restore real timers before the next request performs real socket I/O.
    vi.useRealTimers();

    const response = await client.request('before-idle-deadline', {
      test: true,
    });
    expect(response.data).toStrictEqual({ handshake: 1 });
    expect(handshakeCount).toBe(1);
  });

  /**
   * @requirement R24.2
   * @scenario Server destroys the transport while a post-handshake request is
   *           pending. The request must reject promptly with the
   *           connection-loss error — not wait for the 30s request timeout.
   */
  it('surfaces "Credential proxy connection lost" on connection error', async () => {
    server = net.createServer((socket) => {
      trackServerSockets(initialized(server, 'server'));
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          const msg = frame;
          if (msg.op === 'handshake') {
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
          } else {
            socket.destroy();
          }
        }
      });
    });

    await new Promise<void>((resolve) =>
      initialized(server, 'server').listen(socketPath, resolve),
    );

    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    const { result, timer } = await deadlineRace(
      client.request('will-fail', {}),
      TEST_DEADLINE_MS,
    );
    try {
      expect(result).toMatch(/credential proxy connection lost/i);
      expect(result).not.toMatch(/timed out/i);
    } finally {
      clearTimeout(timer);
    }
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
      trackServerSockets(initialized(server, 'server'));
      const decoder = new FrameDecoder();
      const pendingResponses: Array<{ id: string; op: string }> = [];

      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          handleServerFrame(frame, socket, pendingResponses);
        }
      });
    });

    await new Promise<void>((resolve) =>
      initialized(server, 'server').listen(socketPath, resolve),
    );

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

  /** @requirement R-2197 @scenario malformed data envelope rejects a correlated request */
  it('rejects a malformed envelope for a correlated request', async () => {
    let connectionCount = 0;
    server = net.createServer((socket) => {
      connectionCount++;
      trackServerSockets(initialized(server, 'server'));
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          if (frame.op === 'handshake') {
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
            continue;
          }
          socket.write(
            connectionCount === 1
              ? encodeFrame({ ok: true, id: frame.id, data: [1, 2] })
              : encodeFrame({
                  ok: true,
                  id: frame.id,
                  data: { recovered: true },
                }),
          );
        }
      });
    });

    await new Promise<void>((resolve) =>
      initialized(server, 'server').listen(socketPath, resolve),
    );

    client = new ProxySocketClient(socketPath);

    const { result, timer } = await deadlineRace(
      client.request('alpha', {}),
      TEST_DEADLINE_MS,
    );
    try {
      expect(result).toMatch(/Malformed response for request/i);
    } finally {
      clearTimeout(timer);
    }

    const recovered = await client.request('beta', {});
    expect(recovered.data).toStrictEqual({ recovered: true });
    expect(connectionCount).toBe(2);
  });

  it('ignores a malformed response without a usable correlation ID', async () => {
    server = net.createServer((socket) => {
      trackServerSockets(initialized(server, 'server'));
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          if (frame.op === 'handshake') {
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
            continue;
          }
          socket.write(encodeFrame({ ok: 'invalid' }));
          socket.write(
            encodeFrame({
              ok: true,
              id: frame.id,
              data: { correlated: true },
            }),
          );
        }
      });
    });

    await new Promise<void>((resolve) =>
      initialized(server, 'server').listen(socketPath, resolve),
    );

    client = new ProxySocketClient(socketPath);

    const response = await client.request('alpha', {});
    expect(response.data).toStrictEqual({ correlated: true });
  });

  /**
   * @requirement R6.4
   * @scenario Reconnection after the idle deadline completes a new handshake.
   *           Fake timers are activated before the client is constructed so the
   *           idle timer is on the faked clock; advancing the timer fires the
   *           real timer path and the server observes the second handshake.
   */
  it('reconnects with a second handshake after the idle deadline', async () => {
    let handshakeCount = 0;
    let firstSocket: net.Socket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    server = net.createServer((socket) => {
      trackServerSockets(initialized(server, 'server'));
      firstSocket ??= socket;
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

    await new Promise<void>((resolve) =>
      initialized(server, 'server').listen(socketPath, resolve),
    );

    vi.useFakeTimers();
    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();
    expect(handshakeCount).toBe(1);
    const initialResponse = await client.request('idle-probe', { test: true });
    expect(initialResponse.ok).toBe(true);

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 1);
    // Restore real timers before waiting on socket teardown: Bun's fake
    // timers freeze Date.now() and stall any wall-clock deadline.
    vi.useRealTimers();

    try {
      // The first socket must close before the new connection is created, so the
      // next handshake is a genuine reconnect and not an observed duplicate.
      await Promise.race([
        new Promise<void>((resolve) => {
          if (firstSocket !== undefined) {
            firstSocket.once('close', () => resolve());
          } else {
            resolve();
          }
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Idle timer did not close the socket')),
            TEST_DEADLINE_MS,
          );
        }),
      ]);

      // Next request should reconnect with a new handshake
      await client.request('after-reconnect', {});
      expect(handshakeCount).toBe(2);
    } finally {
      clearTimeout(timer);
    }
  });
});
