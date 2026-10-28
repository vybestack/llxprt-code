/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { IdeContextNotificationSchema } from '@vybestack/llxprt-code-ide-integration';
import {
  setup,
  cleanup,
  deferred,
  installIdeCleanup,
} from './helpers/ide-companion.js';

describe('IDE companion fixture handshake', () => {
  installIdeCleanup();

  it('does not replay bootstrap context when the standalone stream opens after the synchronization ping', async (): Promise<void> => {
    const host = await setup();
    const getEntered = deferred();
    const releaseGet = deferred();
    const getOpened = deferred();
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${host.port}/mcp`),
      {
        fetch: async (url, init): Promise<Response> => {
          if (init?.method === 'GET') {
            getEntered.resolve();
            await releaseGet.promise;
          }
          const response = await fetch(url, init);
          if (init?.method === 'GET') getOpened.resolve();
          return response;
        },
      },
    );
    const peer = new Client({ name: 'handshake-regression', version: '1.0.0' });
    cleanup.push(async () => {
      releaseGet.resolve();
      await peer.close();
    });
    const contexts: Array<boolean | undefined> = [];
    const changed = deferred();
    peer.setNotificationHandler(
      IdeContextNotificationSchema,
      (notification) => {
        const trusted = notification.params.workspaceState?.isTrusted;
        contexts.push(trusted);
        if (trusted === false) changed.resolve();
      },
    );

    await peer.connect(transport);
    await getEntered.promise;
    await peer.ping();
    expect(contexts).toStrictEqual([true]);

    releaseGet.resolve();
    await getOpened.promise;
    // The reply acknowledges consumption of preceding standalone messages.
    await host.sessions[0].server.ping();
    await host.updateTrust(0, false);
    await changed.promise;
    expect(contexts).toStrictEqual([true, false]);

    await peer.ping();
    expect(contexts).toStrictEqual([true, false]);
  });
});
