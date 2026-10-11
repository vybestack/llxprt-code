/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { buildAgent } from './helpers/agentHarness.js';

async function proxy(): Promise<{
  url: string;
  requests: () => number;
  close: () => Promise<void>;
}> {
  let requests = 0;
  const server = createServer();
  server.on('connect', (_request, socket) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => {
      requests += 1;
      socket.end(
        'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello',
      );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected proxy address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests: () => requests,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

describe('two live agent proxy roots', () => {
  it('routes each shipped web tool through its own proxy and leaves B usable after A closes', async () => {
    const aProxy = await proxy();
    const bProxy = await proxy();
    const a = await buildAgent('plain-text.jsonl', {
      sessionId: 'same-label',
      proxy: aProxy.url,
    });
    const b = await buildAgent('plain-text.jsonl', {
      sessionId: 'same-label',
      proxy: bProxy.url,
    });
    const params = { url: 'http://example.invalid/page', format: 'text' };
    try {
      const aTool = a.agent.tools.get('direct_web_fetch');
      const bTool = b.agent.tools.get('direct_web_fetch');
      if (aTool === undefined || bTool === undefined)
        throw new Error('Expected shipped web tools');
      await aTool.buildAndExecute(params, new AbortController().signal);
      expect([aProxy.requests(), bProxy.requests()]).toStrictEqual([1, 0]);
      await bTool.buildAndExecute(params, new AbortController().signal);
      expect([aProxy.requests(), bProxy.requests()]).toStrictEqual([1, 1]);
      await a.agent.dispose();
      await bTool.buildAndExecute(params, new AbortController().signal);
      expect([aProxy.requests(), bProxy.requests()]).toStrictEqual([1, 2]);
    } finally {
      await b.cleanup();
      await a.cleanup();
      await Promise.all([aProxy.close(), bProxy.close()]);
    }
  });
});
