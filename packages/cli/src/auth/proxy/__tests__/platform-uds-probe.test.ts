/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Probe tests for Unix domain socket behavior across platforms,
 * specifically targeting Docker Desktop macOS UDS behavior.
 *
 * These tests verify that Unix domain sockets work correctly in tmpdir,
 * can be accessed via both symlink and realpath, and support the
 * framing protocol for credential proxy communication.
 *
 * @plan:PLAN-20250214-CREDPROXY.P38
 * @requirement R27.2
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

import { encodeFrame, FrameDecoder } from '@vybestack/llxprt-code-core';

// ─── Test Helpers ────────────────────────────────────────────────────────────

const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';

// ─── Platform UDS Probe Tests ────────────────────────────────────────────────

describe('Platform UDS Probe Tests (Phase 38)', () => {
  let tmpDir: string;
  let server: net.Server | null = null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-'));
  });

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // UDS Round-Trip Through Tmpdir
  // ─────────────────────────────────────────────────────────────────────────

  describe('UDS round-trip through tmpdir', () => {
    /**
     * @requirement R27.2
     * @scenario Create socket in tmpdir, connect, send/receive frame
     * @given A Unix socket created in the system tmpdir
     * @when A client connects and sends a frame
     * @then The server receives the frame and sends a response
     */
    it.skipIf(isWindows)(
      'creates socket in tmpdir, client connects, frame round-trips',
      async () => {
        const socketPath = path.join(tmpDir, 'probe-roundtrip.sock');

        // Create a simple echo server using the framing protocol
        server = net.createServer((socket) => {
          const decoder = new FrameDecoder();

          socket.on('data', (chunk: Buffer) => {
            const frames = decoder.feed(chunk);
            for (const frame of frames) {
              // Echo back with response
              const response = {
                id: (frame as Record<string, unknown>).id,
                ok: true,
                data: { echo: (frame as Record<string, unknown>).op },
              };
              socket.write(encodeFrame(response));
            }
          });
        });

        await new Promise<void>((resolve) =>
          server!.listen(socketPath, resolve),
        );

        // Verify socket exists
        expect(fs.existsSync(socketPath)).toBe(true);
        const stat = fs.statSync(socketPath);
        expect(stat.isSocket()).toBe(true);

        // Connect and send a frame
        const clientSocket = net.createConnection(socketPath);
        const decoder = new FrameDecoder();

        const response = await new Promise<Record<string, unknown>>(
          (resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Timeout waiting for response')),
              5000,
            );

            clientSocket.on('connect', () => {
              const request = { id: 'test-1', op: 'probe', payload: {} };
              clientSocket.write(encodeFrame(request));
            });

            clientSocket.on('data', (chunk: Buffer) => {
              const frames = decoder.feed(chunk);
              if (frames.length > 0) {
                clearTimeout(timeout);
                resolve(frames[0]);
              }
            });

            clientSocket.on('error', (err) => {
              clearTimeout(timeout);
              reject(err);
            });
          },
        );

        expect(response.ok).toBe(true);
        expect((response.data as Record<string, unknown>)?.echo).toBe('probe');

        clientSocket.destroy();
      },
    );

    /**
     * @requirement R27.2
     * @scenario Multiple frames in single connection
     * @given A Unix socket with a client connected
     * @when Multiple frames are sent in sequence
     * @then All frames are received and processed correctly
     */
    it.skipIf(isWindows)(
      'handles multiple frames in single connection',
      async () => {
        const socketPath = path.join(tmpDir, 'probe-multiframe.sock');
        const receivedFrames: Array<Record<string, unknown>> = [];

        server = net.createServer((socket) => {
          const decoder = new FrameDecoder();

          socket.on('data', (chunk: Buffer) => {
            const frames = decoder.feed(chunk);
            for (const frame of frames) {
              receivedFrames.push(frame);
              const response = {
                id: (frame as Record<string, unknown>).id,
                ok: true,
                seq: receivedFrames.length,
              };
              socket.write(encodeFrame(response));
            }
          });
        });

        await new Promise<void>((resolve) =>
          server!.listen(socketPath, resolve),
        );

        const clientSocket = net.createConnection(socketPath);
        const decoder = new FrameDecoder();
        const responses: Array<Record<string, unknown>> = [];

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Timeout waiting for responses')),
            5000,
          );

          clientSocket.on('connect', () => {
            // Send multiple frames
            clientSocket.write(
              encodeFrame({ id: 'a', op: 'first', payload: {} }),
            );
            clientSocket.write(
              encodeFrame({ id: 'b', op: 'second', payload: {} }),
            );
            clientSocket.write(
              encodeFrame({ id: 'c', op: 'third', payload: {} }),
            );
          });

          clientSocket.on('data', (chunk: Buffer) => {
            const frames = decoder.feed(chunk);
            responses.push(...frames);
            if (responses.length >= 3) {
              clearTimeout(timeout);
              resolve();
            }
          });

          clientSocket.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        expect(responses.length).toBe(3);
        expect(responses[0].seq).toBe(1);
        expect(responses[1].seq).toBe(2);
        expect(responses[2].seq).toBe(3);

        clientSocket.destroy();
      },
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // UDS Cross-Container Simulation
  // ─────────────────────────────────────────────────────────────────────────

  describe('UDS cross-container simulation', () => {
    /**
     * @requirement R27.3
     * @scenario Socket accessible from subprocess (simulates container)
     * @given A Unix socket created by the parent process
     * @when A subprocess attempts to connect
     * @then The subprocess can communicate via the socket
     */
    it.skipIf(isWindows)(
      'subprocess can connect to socket created by parent',
      async () => {
        const socketPath = path.join(tmpDir, 'probe-subprocess.sock');
        const messages: string[] = [];

        server = net.createServer((socket) => {
          socket.on('data', (data) => {
            messages.push(data.toString().trim());
            socket.write('ACK\n');
          });
        });

        await new Promise<void>((resolve) =>
          server!.listen(socketPath, resolve),
        );

        // Spawn a subprocess that connects to the socket
        const result = await new Promise<{ stdout: string; stderr: string }>(
          (resolve, reject) => {
            const child = spawn(
              process.execPath,
              [
                '-e',
                `
              const net = require('net');
              const socket = net.createConnection(${JSON.stringify(socketPath)}, () => {
                socket.write('HELLO_FROM_CHILD\\n');
                socket.on('data', (data) => {
                  console.log('RECEIVED:', data.toString().trim());
                  socket.destroy();
                });
              });
              socket.on('error', (err) => {
                console.error('ERROR:', err.message);
                process.exit(1);
              });
            `,
              ],
              {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env },
              },
            );

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => (stdout += data.toString()));
            child.stderr.on('data', (data) => (stderr += data.toString()));

            const timeout = setTimeout(() => {
              child.kill();
              reject(new Error('Subprocess timeout'));
            }, 5000);

            child.on('close', () => {
              clearTimeout(timeout);
              resolve({ stdout, stderr });
            });
          },
        );

        expect(result.stderr).toBe('');
        expect(result.stdout).toContain('RECEIVED: ACK');
        expect(messages).toContain('HELLO_FROM_CHILD');
      },
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Socket Accessible After Realpath
  // ─────────────────────────────────────────────────────────────────────────

  describe('Socket accessible after realpath', () => {
    /**
     * @requirement R27.2
     * @scenario Socket created at realpath, accessible at both paths
     * @given macOS where /var is symlink to /private/var
     * @when Socket is created using realpath
     * @then Socket is accessible via the realpath
     */
    it.skipIf(!isMacOS)('macOS: socket at realpath is accessible', async () => {
      // Use realpath for socket location
      const resolvedTmpDir = fs.realpathSync(tmpDir);
      const socketPath = path.join(resolvedTmpDir, 'probe-realpath.sock');

      server = net.createServer((socket) => {
        socket.on('data', () => {
          socket.write('REALPATH_OK\n');
        });
      });

      await new Promise<void>((resolve) => server!.listen(socketPath, resolve));

      // Connect using the realpath
      const response = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

        const clientSocket = net.createConnection(socketPath, () => {
          clientSocket.write('PING\n');
        });

        clientSocket.on('data', (data) => {
          clearTimeout(timeout);
          resolve(data.toString().trim());
          clientSocket.destroy();
        });

        clientSocket.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(response).toBe('REALPATH_OK');
    });

    /**
     * @requirement R27.2
     * @scenario Verify tmpdir realpath resolution
     * @given System tmpdir
     * @when realpath is applied
     * @then Path is resolved and accessible
     */
    it.skipIf(isWindows)('tmpdir realpath is resolved and accessible', () => {
      const rawTmpdir = os.tmpdir();
      const resolvedTmpdir = fs.realpathSync(rawTmpdir);

      // Both paths should be accessible
      expect(fs.existsSync(rawTmpdir)).toBe(true);
      expect(fs.existsSync(resolvedTmpdir)).toBe(true);

      // On macOS, if rawTmpdir starts with /var, resolved should start with /private/var
      if (isMacOS && rawTmpdir.startsWith('/var')) {
        expect(resolvedTmpdir.startsWith('/private/var')).toBe(true);
      }
    });

    /**
     * @requirement R27.2
     * @scenario Symlink and realpath both work for socket access
     * @given A socket created in a resolved path
     * @when Creating a symlink to the socket directory
     * @then Socket is accessible via both paths
     */
    it.skipIf(isWindows)(
      'socket accessible via both symlink and realpath',
      async () => {
        const realDir = path.join(tmpDir, 'real');
        const linkDir = path.join(tmpDir, 'link');

        fs.mkdirSync(realDir);
        fs.symlinkSync(realDir, linkDir);

        const socketPath = path.join(realDir, 'probe-symlink.sock');

        server = net.createServer((socket) => {
          socket.on('data', () => {
            socket.write('SYMLINK_OK\n');
          });
        });

        await new Promise<void>((resolve) =>
          server!.listen(socketPath, resolve),
        );

        // Access via realpath
        const realResponse = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
          const s = net.createConnection(socketPath, () => s.write('PING\n'));
          s.on('data', (data) => {
            clearTimeout(timeout);
            resolve(data.toString().trim());
            s.destroy();
          });
          s.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        expect(realResponse).toBe('SYMLINK_OK');

        // Access via symlink
        const linkSocketPath = path.join(linkDir, 'probe-symlink.sock');
        const linkResponse = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
          const s = net.createConnection(linkSocketPath, () =>
            s.write('PING\n'),
          );
          s.on('data', (data) => {
            clearTimeout(timeout);
            resolve(data.toString().trim());
            s.destroy();
          });
          s.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        expect(linkResponse).toBe('SYMLINK_OK');
      },
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Framing Protocol Over UDS
  // ─────────────────────────────────────────────────────────────────────────

  describe('Framing protocol over UDS', () => {
    /**
     * @requirement R27.3
     * @scenario Length-prefixed framing works over UDS
     * @given A UDS server using the framing protocol
     * @when Client sends properly framed requests
     * @then Server receives and decodes frames correctly
     */
    it.skipIf(isWindows)(
      'length-prefixed framing works correctly over UDS',
      async () => {
        const socketPath = path.join(tmpDir, 'probe-framing.sock');
        const receivedPayloads: Array<Record<string, unknown>> = [];

        server = net.createServer((socket) => {
          const decoder = new FrameDecoder();

          socket.on('data', (chunk: Buffer) => {
            const frames = decoder.feed(chunk);
            for (const frame of frames) {
              receivedPayloads.push(frame);
              socket.write(
                encodeFrame({
                  id: (frame as Record<string, unknown>).id,
                  ok: true,
                  received: true,
                }),
              );
            }
          });
        });

        await new Promise<void>((resolve) =>
          server!.listen(socketPath, resolve),
        );

        const clientSocket = net.createConnection(socketPath);
        const clientDecoder = new FrameDecoder();
        const responses: Array<Record<string, unknown>> = [];

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

          clientSocket.on('connect', () => {
            // Send a complex payload
            const payload = {
              id: 'complex-1',
              op: 'test',
              payload: {
                nested: { data: [1, 2, 3] },
                unicode: '日本語テスト',
                special: '<script>alert("xss")</script>',
              },
            };
            clientSocket.write(encodeFrame(payload));
          });

          clientSocket.on('data', (chunk: Buffer) => {
            const frames = clientDecoder.feed(chunk);
            responses.push(...frames);
            if (responses.length >= 1) {
              clearTimeout(timeout);
              resolve();
            }
          });

          clientSocket.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        expect(responses.length).toBe(1);
        expect(responses[0].ok).toBe(true);
        expect(responses[0].received).toBe(true);

        // Verify server received the payload correctly
        expect(receivedPayloads.length).toBe(1);
        const receivedPayload = receivedPayloads[0].payload as Record<
          string,
          unknown
        >;
        expect(
          (receivedPayload.nested as Record<string, unknown>).data,
        ).toEqual([1, 2, 3]);
        expect(receivedPayload.unicode).toBe('日本語テスト');

        clientSocket.destroy();
      },
    );

    /**
     * @requirement R27.3
     * @scenario Large frames work over UDS
     * @given A UDS connection
     * @when A large (but valid) frame is sent
     * @then Frame is transmitted correctly
     */
    it.skipIf(isWindows)('handles larger frames over UDS', async () => {
      const socketPath = path.join(tmpDir, 'probe-large.sock');
      let receivedSize = 0;

      server = net.createServer((socket) => {
        const decoder = new FrameDecoder();

        socket.on('data', (chunk: Buffer) => {
          const frames = decoder.feed(chunk);
          for (const frame of frames) {
            const payload = (frame as Record<string, unknown>)
              .payload as Record<string, unknown>;
            receivedSize = (payload.largeData as string).length;
            socket.write(
              encodeFrame({
                id: (frame as Record<string, unknown>).id,
                ok: true,
                size: receivedSize,
              }),
            );
          }
        });
      });

      await new Promise<void>((resolve) => server!.listen(socketPath, resolve));

      const clientSocket = net.createConnection(socketPath);
      const clientDecoder = new FrameDecoder();

      // Create a moderately large payload (~32KB)
      const largeData = 'x'.repeat(32 * 1024);

      const response = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);

          clientSocket.on('connect', () => {
            clientSocket.write(
              encodeFrame({
                id: 'large-1',
                op: 'large',
                payload: { largeData },
              }),
            );
          });

          clientSocket.on('data', (chunk: Buffer) => {
            const frames = clientDecoder.feed(chunk);
            if (frames.length > 0) {
              clearTimeout(timeout);
              resolve(frames[0]);
            }
          });

          clientSocket.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        },
      );

      expect(response.ok).toBe(true);
      expect(response.size).toBe(32 * 1024);

      clientSocket.destroy();
    });
  });
});
