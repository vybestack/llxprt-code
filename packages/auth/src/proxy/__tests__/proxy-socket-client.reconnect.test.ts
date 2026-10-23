/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import * as net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProxySocketClient } from '../proxy-socket-client.js';
import { encodeFrame, FrameDecoder } from '../framing.js';

describe('ProxySocketClient connection ownership', () => {
  it('serves immediate beta when the retired alpha socket closes during the replacement handshake', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'proxy-reconnect-'));
    const endpoint =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\llxprt-reconnect-${process.pid}-${randomUUID()}`
        : join(directory, 'proxy.sock');
    const events: string[] = [];
    const peers: net.Socket[] = [];
    const transports: net.Socket[] = [];
    const peerClosures: Array<Promise<void>> = [];
    const transportClosures: Array<Promise<void>> = [];
    let releaseOldClose: (() => void) | undefined;
    let observeOldClose: () => void = () => {
      throw new Error('Native close observer is not initialized');
    };
    const oldClose = new Promise<void>((resolve) => {
      observeOldClose = resolve;
    });
    const connect = net.createConnection;
    const connectionSpy = vi.spyOn(net, 'createConnection');
    connectionSpy.mockImplementation(
      (address: net.NetConnectOpts | number | string): net.Socket => {
        if (typeof address !== 'string')
          throw new Error('Expected a native IPC endpoint');
        const socket = connect(address);
        transports.push(socket);
        const identity = transports.length;
        transportClosures.push(
          new Promise<void>((resolve) => socket.once('close', () => resolve())),
        );
        if (identity === 1) {
          const emit = socket.emit.bind(socket);
          vi.spyOn(socket, 'emit').mockImplementation(
            (event: string | symbol, ...values: unknown[]): boolean => {
              if (event !== 'close') return emit(event, ...values);
              events.push('alpha-native-close');
              releaseOldClose = () => {
                events.push('alpha-close-delivered');
                emit(event, ...values);
              };
              observeOldClose();
              return true;
            },
          );
        }
        return socket;
      },
    );
    const acknowledgeReplacement = (socket: net.Socket): void => {
      void oldClose.then(() => {
        const deliver = releaseOldClose;
        if (deliver === undefined) throw new Error('Missing native close');
        releaseOldClose = undefined;
        deliver();
        socket.write(encodeFrame({ ok: true, data: { version: 2 } }));
      });
    };
    const server = net.createServer((socket) => {
      peers.push(socket);
      const identity = peers.length;
      events.push(`connect-${identity}`);
      peerClosures.push(
        new Promise<void>((resolve) => socket.once('close', () => resolve())),
      );
      const decoder = new FrameDecoder();
      socket.on('data', (chunk) => {
        for (const frame of decoder.feed(chunk)) {
          if (frame.op === 'handshake') {
            events.push(`handshake-${identity}`);
            if (identity === 1) {
              socket.write(encodeFrame({ ok: true, data: { version: 2 } }));
            } else {
              acknowledgeReplacement(socket);
            }
          } else {
            events.push(String(frame.op));
            socket.write(
              encodeFrame({
                ok: true,
                id: frame.id,
                data: identity === 1 ? [1, 2] : { recovered: true },
              }),
            );
          }
        }
      });
    });
    const client = new ProxySocketClient(
      endpoint,
      'reconnect-capability-secret',
    );
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(endpoint, resolve);
      });
      await expect(client.request('alpha', {})).rejects.toThrow(
        /Malformed response for request/i,
      );
      events.push('alpha-rejected');
      const recovered = await client.request('beta', {});
      expect(recovered.data).toStrictEqual({ recovered: true });
      expect(peers).toHaveLength(2);
      expect(events.indexOf('handshake-2')).toBeLessThan(
        events.indexOf('alpha-close-delivered'),
      );
      expect(events.indexOf('alpha-rejected')).toBeLessThan(
        events.indexOf('connect-2'),
      );
      expect(events.at(-1)).toBe('beta');
    } finally {
      releaseOldClose?.();
      vi.restoreAllMocks();
      client.close();
      for (const socket of [...transports, ...peers]) socket.destroy();
      await Promise.all([...peerClosures, ...transportClosures]);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    }
  });
});
