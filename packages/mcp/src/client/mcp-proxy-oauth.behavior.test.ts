/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createServer, get } from 'node:http';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { startLocalForwardProxy } from '@vybestack/llxprt-code-test-utils/network/local-forward-proxy.js';
import { MCPOAuthProvider } from '../auth/oauth-provider.js';
import { createTestOAuthBinding } from './test-support/oauth.js';
import { fetchWwwAuthenticateHeader } from './mcp-oauth-helpers.js';

async function authorize(authorization: string): Promise<void> {
  const url = new URL(authorization);
  const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
  callback.searchParams.set('state', url.searchParams.get('state') ?? '');
  callback.searchParams.set('code', 'local-code');
  await new Promise<void>((resolve, reject) => {
    const request = get(callback, (response) => {
      response.resume();
      response.on('end', resolve);
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

describe('MCP OAuth proxy ownership', () => {
  it('routes HEAD, metadata, registration, code exchange and refresh through the owner proxy', async () => {
    let base = '';
    let grants = 0;
    const server = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        if (request.method === 'HEAD') {
          response
            .writeHead(401, {
              'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
            })
            .end();
          return;
        }
        let value: unknown;
        switch (request.url) {
          case '/.well-known/oauth-protected-resource':
            value = { resource: `${base}/mcp`, authorization_servers: [base] };
            break;
          case '/.well-known/oauth-authorization-server':
            value = {
              issuer: base,
              authorization_endpoint: `${base}/authorize`,
              token_endpoint: `${base}/token`,
              registration_endpoint: `${base}/register`,
            };
            break;
          case '/register':
            value = { client_id: 'registered-client' };
            break;
          default:
            value = {
              access_token: `grant-${++grants}`,
              refresh_token: 'refresh-local',
              token_type: 'Bearer',
              expires_in: 3600,
            };
        }
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(value));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected TCP');
    base = `http://127.0.0.1:${address.port}`;
    const proxy = await startLocalForwardProxy({
      '127.0.0.1': (request) =>
        fetch(new URL(request.path, base), {
          method: request.method,
          headers: request.headers,
          ...(request.body ? { body: request.body } : {}),
        }),
    });
    const network = new OwnedFetch(proxy.url);
    const binding = { ...createTestOAuthBinding(), openBrowser: authorize };
    try {
      expect(
        await fetchWwwAuthenticateHeader(network.fetch, {
          httpUrl: `${base}/mcp`,
        }),
      ).toContain('resource_metadata');
      const token = await MCPOAuthProvider.authenticate(
        network.fetch,
        binding,
        'local',
        { enabled: true },
        `${base}/mcp`,
      );
      await binding.tokenStorage.saveToken(
        'local',
        { ...token, expiresAt: Date.now() - 1000 },
        'registered-client',
        `${base}/token`,
        `${base}/mcp`,
      );
      expect(
        await MCPOAuthProvider.getValidToken(
          network.fetch,
          binding.tokenStorage,
          'local',
          { clientId: 'registered-client' },
        ),
      ).toBe('grant-2');
      expect(
        proxy.requests.filter((request) => request.method === 'HEAD').length,
      ).toBeGreaterThan(0);
      expect(proxy.requests.map((request) => request.path)).toContain(
        '/.well-known/oauth-protected-resource',
      );
      expect(proxy.requests.map((request) => request.path)).toContain(
        '/.well-known/oauth-authorization-server',
      );
      expect(
        proxy.requests.filter((request) => request.path === '/register'),
      ).toHaveLength(1);
      expect(
        proxy.requests.filter((request) => request.path === '/token'),
      ).toHaveLength(2);
    } finally {
      await network.dispose();
      await proxy.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
