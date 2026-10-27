/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProxySocketClient } from '@vybestack/llxprt-code-auth/proxy/proxy-socket-client.js';
import {
  MemoryTokenStore,
  makeExpiredToken,
} from '../__tests__/behavioral/test-utils.js';
import {
  createAndStartProxy,
  type SandboxProxyHandle,
} from './sandbox-proxy-lifecycle.js';

describe('sandbox credential proxy ownership', () => {
  it.each([false, true])(
    'routes two owners independently and keeps the second usable after the first retires (concurrent=%s)',
    async (concurrent) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'proxy-owners-'));
      const handshakes = [0, 0];
      const requests = [0, 0];
      const clients: ProxySocketClient[] = [];
      const handles: SandboxProxyHandle[] = [];
      const start = async (index: number): Promise<SandboxProxyHandle> => {
        const tokenStore = new MemoryTokenStore();
        await tokenStore.saveToken('codex', makeExpiredToken(`owner-${index}`));
        await tokenStore.saveToken(
          'codex',
          makeExpiredToken(`other-${index}`),
          'other',
        );
        return createAndStartProxy(
          {
            tokenStore,
            socketPath: directory,
            onSandboxHandshake: () => {
              handshakes[index]++;
            },
          },
          async () => {
            requests[index]++;
            return Response.json({
              access_token: `owner-${index}-rotation-${requests[index]}`,
              refresh_token: `next-${index}`,
              expires_in: 3600,
              token_type: 'Bearer',
            });
          },
        );
      };
      try {
        if (concurrent)
          handles.push(...(await Promise.all([start(0), start(1)])));
        else {
          handles.push(await start(0));
          handles.push(await start(1));
        }
        clients.push(
          ...handles.map(
            (handle) =>
              new ProxySocketClient(handle.socketPath, handle.capabilityToken),
          ),
        );
        expect(handles[0].socketPath).not.toBe(handles[1].socketPath);
        expect(handles[0].capabilityToken).not.toBe(handles[1].capabilityToken);
        await Promise.all(clients.map((client) => client.ensureConnected()));
        expect(handshakes).toStrictEqual([1, 1]);
        const responses = await Promise.all(
          clients.map((client) =>
            client.request('get_token', { provider: 'codex' }),
          ),
        );
        expect(
          responses.map((response) => response.data?.access_token),
        ).toStrictEqual(['owner-0', 'owner-1']);
        await handles[0].stop();
        const result = await clients[1].request('get_token', {
          provider: 'codex',
          bucket: 'other',
        });
        expect(result.ok).toBe(true);
        expect(result.data?.access_token).toBe('other-1');
        expect(requests).toStrictEqual([0, 0]);
      } finally {
        for (const client of clients) client.close();
        await Promise.all(handles.map((handle) => handle.stop()));
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'leaves another owner usable when its POSIX socket directory prevents startup',
    async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'proxy-startup-'));
      const invalid = path.join(directory, 'file');
      await writeFile(invalid, 'not a socket directory');
      const owner = await createAndStartProxy(
        { socketPath: directory, tokenStore: new MemoryTokenStore() },
        fetch,
      );
      const client = new ProxySocketClient(
        owner.socketPath,
        owner.capabilityToken,
      );
      try {
        await expect(
          createAndStartProxy(
            { socketPath: invalid, tokenStore: new MemoryTokenStore() },
            fetch,
          ),
        ).rejects.toThrow(/EEXIST|ENOTDIR/);
        const response = await client.request('list_providers', {});
        expect(response.ok).toBe(true);
        expect((await readdir(directory)).sort()).toStrictEqual(
          ['file', path.basename(owner.socketPath)].sort(),
        );
      } finally {
        client.close();
        await owner.stop();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
