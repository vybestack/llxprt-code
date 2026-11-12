/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { startLocalForwardProxy } from '@vybestack/llxprt-code-test-utils/network/local-forward-proxy.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';

interface McpRequest {
  id?: string | number;
  method: string;
}

function isMcpRequest(value: unknown): value is McpRequest {
  return typeof value === 'object' && value !== null && 'method' in value;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected TCP');
  return `http://127.0.0.1:${address.port}`;
}

describe('MCP root proxy ownership', () => {
  usePromptFixture();
  const close: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of close.splice(0).reverse()) await cleanup();
  });

  it('sends the MCP initialize request through its configured root proxy and keeps an unproxied root direct', async () => {
    await mkdir(join(process.cwd(), '../../tmp/lane'), { recursive: true });
    const directory = await mkdtemp(
      join(process.cwd(), '../../tmp/lane/mcp-proxy-'),
    );
    close.push(() => rm(directory, { recursive: true, force: true }));
    const received: string[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        if (request.method !== 'POST') {
          response.writeHead(405).end();
          return;
        }
        let body = '';
        for await (const chunk of request) body += chunk.toString();
        const message: unknown = JSON.parse(body);
        if (!isMcpRequest(message)) throw new Error('Expected MCP request');
        if (message.method === 'initialize') received.push(request.url ?? '');
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result:
              message.method === 'initialize'
                ? {
                    protocolVersion: '2025-06-18',
                    capabilities: { tools: {} },
                    serverInfo: { name: 'proxy-fixture', version: '1' },
                  }
                : {
                    tools: [
                      {
                        name: 'ping',
                        description: 'Ping the fixture',
                        inputSchema: { type: 'object', properties: {} },
                      },
                    ],
                  },
          }),
        );
      })();
    });
    const url = await listen(server);
    close.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    const proxy = await startLocalForwardProxy({
      '127.0.0.1': (request) =>
        fetch(new URL(request.path, url), {
          method: request.method,
          headers: request.headers,
          ...(request.body ? { body: request.body } : {}),
        }),
    });
    close.push(() => proxy.close());
    const build = async (name: string, proxyUrl?: string) => {
      const config = new Config({
        sessionId: name,
        model: 'test',
        targetDir: directory,
        cwd: directory,
        proxy: proxyUrl,
        trustedFolder: true,
        skillsSupport: false,
        debugMode: false,
        coreTools: [],
        telemetry: { enabled: false },
        mcpServers: { [name]: { httpUrl: `${url}/${name}`, timeout: 5000 } },
      });
      close.push(() => config.dispose());
      const network = new OwnedFetch(config.getProxy());
      close.push(() => network.dispose());
      const owner = await createTestMcpRuntime(
        {
          config,
          oauth: createTestOAuthBinding(),
          requestFetch: network.fetch,
        },
        {},
      );
      close.push(() => owner.dispose());
      await owner.initialize();
      expect([...(await owner.awaitDiscovery())]).toStrictEqual([]);
      return owner;
    };
    const proxied = await build('proxied', proxy.url);
    const direct = await build('direct');
    await proxied.refresh();
    await direct.refresh();
    expect([...(await proxied.awaitDiscovery())]).toStrictEqual([]);
    expect([...(await direct.awaitDiscovery())]).toStrictEqual([]);
    const initializePaths = proxy.requests
      .filter(
        (request) =>
          request.method === 'POST' &&
          JSON.parse(request.body).method === 'initialize',
      )
      .map((request) => request.path);
    expect(initializePaths.length).toBeGreaterThan(0);
    expect(new Set(initializePaths)).toStrictEqual(new Set(['/proxied']));
    expect(received).toContain('/direct');
    await proxied.dispose();
    const count = proxy.requests.length;
    await direct.refresh();
    expect(proxy.requests).toHaveLength(count);
    expect([...(await direct.awaitDiscovery())]).toStrictEqual([]);
  }, 30000);
});
