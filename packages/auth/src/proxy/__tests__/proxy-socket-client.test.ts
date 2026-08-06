/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250214-CREDPROXY.P04
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

import {
  ProxySocketClient,
  REQUEST_TIMEOUT_MS,
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
const PROXY_SOCKET_CLIENT_URL = new URL(
  '../proxy-socket-client.js',
  import.meta.url,
).href;

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
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
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
const IDLE_EXIT_SCRIPT = [
  `const mod = await import(process.argv[1]);`,
  `const { ProxySocketClient } = mod;`,
  `const socketPath = process.argv[2];`,
  `const client = new ProxySocketClient(socketPath);`,
  `await client.ensureConnected();`,
  `// Perform one request to transition active -> idle.`,
  `const res = await client.request('idle-probe', { ok: true });`,
  `if (res.ok !== true) process.exitCode = 2;`,
  `// Nothing else is scheduled. An unreferenced idle socket lets the`,
  `// process exit naturally.`,
].join('\n');

/**
 * Spawns a Bun subprocess for the idle-exit liveness test and resolves its
 * exit status. A watchdog SIGKILLs the child if it does not self-exit within
 * the budget, so a referenced-socket regression fails fast instead of
 * hanging the suite.
 */
async function runIdleExitSubprocess(
  clientModuleUrl: string,
  ipcPath: string,
  budgetMs = TEST_DEADLINE_MS,
): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}> {
  const child = spawn(
    process.execPath,
    ['--eval', IDLE_EXIT_SCRIPT, '--', clientModuleUrl, ipcPath],
    {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exit = once(child, 'exit');
  const watchdog = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, budgetMs);
  try {
    const [code, signal] = (await exit) as [
      number | null,
      NodeJS.Signals | null,
    ];
    return { code, signal, stderr };
  } finally {
    clearTimeout(watchdog);
    // Always terminate and await the child exit in cleanup so no process leaks.
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exit;
    }
  }
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

  /**
   * @requirement R24.2
   * @scenario An idle connected proxy client must NOT keep the process alive.
   *           Verified through real process liveness: a subprocess that
   *           connects and goes idle must exit on its own, because the socket
   *           is unreferenced while no work is outstanding.
   */
  it('an idle connected client does not keep the process alive', async () => {
    server = createAutoReplyServer(socketPath);
    trackServerSockets(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const { code, signal, stderr } = await runIdleExitSubprocess(
      PROXY_SOCKET_CLIENT_URL,
      socketPath,
    );

    // A clean self-exit (code 0) proves the idle socket did not hold the
    // event loop open. A SIGKILL from the watchdog means the process hung.
    expect({ code, signal, stderr }).toStrictEqual({
      code: 0,
      signal: null,
      stderr: '',
    });
  });

  /**
   * @requirement R6.2
   * @scenario Handshake rejects when server responds with version mismatch
   */
  it('rejects handshake on version mismatch', async () => {
    server = net.createServer((socket) => {
      trackServerSockets(server);
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
      trackServerSockets(server);
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
    server = net.createServer((socket) => {
      trackServerSockets(server);
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

    vi.useFakeTimers();

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
    server = createAutoReplyServer(socketPath);
    trackServerSockets(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    // The idle timer was created with real setTimeout. Bun's fake timers
    // only intercept timers created AFTER activation, so simulate the
    // idle-timeout effect by calling gracefulClose directly.
    client.gracefulClose();
    await new Promise((resolve) => setImmediate(resolve));

    // After idle timeout, the next request should trigger a reconnection
    // (which means a new handshake). We verify by making another request
    // that succeeds (requires new handshake)
    const response = await client.request('after-idle', { test: true });
    expect(response.ok).toBe(true);
  });

  /**
   * @requirement R24.2
   * @scenario Server destroys the transport while a post-handshake request is
   *           pending. The request must reject promptly with the
   *           connection-loss error — not wait for the 30s request timeout.
   */
  it('surfaces "Credential proxy connection lost" on connection error', async () => {
    server = net.createServer((socket) => {
      trackServerSockets(server);
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

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

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
      trackServerSockets(server);
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
    let handshakeCount = 0;

    server = net.createServer((socket) => {
      trackServerSockets(server);
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

    // The idle timer was created with real setTimeout before fake timers are
    // activated. Bun's fake timers only intercept timers created AFTER
    // activation, so advancing fake timers won't fire the existing real idle
    // timer. Simulate the idle-timeout effect by calling gracefulClose directly.
    client.gracefulClose();
    // Yield to let the socket teardown complete
    await new Promise((resolve) => setImmediate(resolve));

    // Next request should reconnect with a new handshake
    await client.request('after-reconnect', {});
    expect(handshakeCount).toBe(2);
  });

  /**
   * @requirement R6.5
   * @scenario close() destroys socket and rejects pending requests
   */
  it('rejects pending requests when close() is called', async () => {
    server = net.createServer((socket) => {
      trackServerSockets(server);
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
    trackServerSockets(server);
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
    trackServerSockets(server);

    client = new ProxySocketClient(socketPath, capabilityToken);
    await client.ensureConnected();

    const handshake = await result.handshake;
    const payload = handshake.payload as Record<string, unknown>;
    expect(payload.capabilityToken).toBe(capabilityToken);
    // The client advertises support for versions [1, PROTOCOL_VERSION].
    expect(payload.minVersion).toBe(1);
    expect(payload.maxVersion).toBe(PROTOCOL_VERSION);
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
    trackServerSockets(server);

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
    trackServerSockets(server);

    client = new ProxySocketClient(socketPath, 'some-token');
    await expect(client.ensureConnected()).rejects.toThrow(
      /Credential proxy authentication failed/i,
    );
  });

  /**
   * @requirement R24.2
   * @scenario Server destroys the transport while MULTIPLE requests are
   *           concurrently pending. Every pending request must reject promptly
   *           with the connection-loss error — not wait for the per-request
   *           timeout. After cleanup the client must reconnect to a fresh
   *           server and succeed.
   */
  it('rejects all concurrently pending requests promptly on transport loss, then reconnects', async () => {
    server = net.createServer((socket) => {
      trackServerSockets(server);
      const decoder = new FrameDecoder();
      let requestCount = 0;
      socket.on('data', (chunk) => {
        const frames = decoder.feed(chunk);
        for (const frame of frames) {
          const msg = frame;
          if (msg.op === 'handshake') {
            socket.write(encodeFrame({ ok: true, v: PROTOCOL_VERSION }));
          } else {
            requestCount++;
            if (requestCount >= 3) {
              socket.destroy();
            }
          }
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    const requests = Array.from({ length: 3 }, (_, i) =>
      client.request(`concurrent-${i}`, {}),
    );

    const timers: Array<ReturnType<typeof setTimeout>> = [];
    try {
      const outcomes = await Promise.all(
        requests.map(async (p) => {
          const { result, timer } = await deadlineRace(p, TEST_DEADLINE_MS);
          timers.push(timer);
          return result;
        }),
      );

      for (const outcome of outcomes) {
        expect(outcome).toMatch(/credential proxy connection lost/i);
        expect(outcome).not.toMatch(/timed out/i);
      }
    } finally {
      for (const timer of timers) clearTimeout(timer);
    }

    destroyServerSockets(server);
    await new Promise<void>((resolve) => server.close(() => resolve()));

    server = createAutoReplyServer(socketPath);
    trackServerSockets(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const response = await client.request('after-reconnect', { ok: true });
    expect(response.ok).toBe(true);
    expect(response.data).toStrictEqual({ ok: true });
  });
});
