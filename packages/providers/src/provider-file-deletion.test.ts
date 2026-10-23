/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { deleteRetainedProviderFile } from './provider-file-deletion.js';

describe('provider file maintenance transport release', () => {
  const repeated = new Error('physical transport release fault');
  it.each([undefined, repeated])(
    'joins the real HTTP deletion and transport before retaining ordered primary/release failures %#',
    async (primary) => {
      const id = randomUUID();
      const retained = new Set<string>([id]);
      let disconnected!: () => void;
      const closed = new Promise<void>((resolve) => {
        disconnected = resolve;
      });
      const server = createServer((socket) => {
        socket.once('close', disconnected);
        let incoming = '';
        socket.on('data', (chunk) => {
          incoming += chunk.toString();
          if (!incoming.endsWith('\r\n\r\n')) return;
          const [method, path] = incoming.split(' ', 2);
          if (method !== 'DELETE') {
            socket.end(
              'HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n',
            );
            return;
          }
          retained.delete(path.slice(1));
          socket.write('HTTP/1.1 204 No Content\r\n\r\n');
        });
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Missing deletion server address');
      const original = OwnedFetch.prototype.dispose;
      const disposal = vi
        .spyOn(OwnedFetch.prototype, 'dispose')
        .mockImplementation(async function (this: OwnedFetch): Promise<void> {
          await original.call(this);
          throw repeated;
        });
      try {
        const outcome = await deleteRetainedProviderFile(
          async (file, requestFetch) => {
            const response = await requestFetch(
              `http://127.0.0.1:${address.port}/${file}`,
              { method: 'DELETE' },
            );
            await response.text();
            throw primary;
          },
          id,
          undefined,
        ).then(
          () => ({ succeeded: true }),
          (error: unknown) => ({ error }),
        );
        await closed;
        expect(retained.size).toBe(0);
        if (!('error' in outcome) || !(outcome.error instanceof AggregateError))
          throw new Error('Missing maintenance failure aggregation');
        expect(outcome.error.errors.length).toBe(2);
        expect(outcome.error.errors[0]).toBe(primary);
        expect(outcome.error.errors[1]).toBe(repeated);
      } finally {
        disposal.mockRestore();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
});
