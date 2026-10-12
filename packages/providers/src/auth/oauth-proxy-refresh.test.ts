/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OAuthManager } from './oauth-manager.js';
import { registerStandardOAuthProviders } from '../composition/oauth-provider-registration.js';
import type { TokenStore } from '@vybestack/llxprt-code-auth';

async function tokenProxy(): Promise<{
  url: string;
  grants: string[];
  close: () => Promise<void>;
}> {
  const grants: string[] = [];
  const server = createServer();
  server.on('connect', (_request, socket) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', (data) => {
      const body = data.toString().split('\r\n\r\n')[1];
      grants.push(new URLSearchParams(body).get('refresh_token') ?? '');
      const result = JSON.stringify({
        access_token: 'renewed',
        token_type: 'Bearer',
        id_token: `header.${Buffer.from(JSON.stringify({ account_id: 'proxy-account' })).toString('base64url')}.signature`,
        expires_in: 1800,
      });
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(result)}\r\nConnection: close\r\n\r\n${result}`,
      );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    grants,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function store(): TokenStore {
  return {
    saveToken: async () => undefined,
    getToken: async () => null,
    removeToken: async () => undefined,
    listProviders: async () => [],
    listBuckets: async () => [],
    getBucketStats: async () => null,
    acquireRefreshLock: async () => true,
    releaseRefreshLock: async () => undefined,
    acquireAuthLock: async () => true,
    releaseAuthLock: async () => undefined,
  };
}

describe('OAuth owner fetch', () => {
  it.each(['claudecode', 'codex'])(
    'refreshes %s each root through its proxy and preserves B after A closes',
    async (providerName) => {
      const aProxy = await tokenProxy();
      const bProxy = await tokenProxy();
      const a = new OwnedFetch(aProxy.url);
      const b = new OwnedFetch(bProxy.url);
      const aManager = new OAuthManager(store());
      const bManager = new OAuthManager(store());
      const aProviders = new ProviderManager({
        settingsService: new SettingsService(),
      });
      const bProviders = new ProviderManager({
        settingsService: new SettingsService(),
      });
      const transport =
        (network: OwnedFetch) =>
        (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const url = new URL(String(input));
          url.protocol = 'http:';
          return network.fetch(url, init);
        };
      try {
        registerStandardOAuthProviders(aManager, aProviders.fetchNetwork);
        registerStandardOAuthProviders(bManager, bProviders.fetchNetwork);
        aProviders.bindNetworkFetch(transport(a));
        bProviders.bindNetworkFetch(transport(b));
        const refresh = async (
          manager: OAuthManager,
          refreshToken: string,
        ): Promise<number> => {
          const provider = manager.getProvider(providerName);
          if (provider === undefined) throw new Error('Missing provider');
          const token = await provider.refreshToken({
            access_token: 'old',
            refresh_token: refreshToken,
            expiry: 1,
            token_type: 'Bearer',
          });
          if (token === null) throw new Error('Refresh failed');
          return token.expiry;
        };
        expect(await refresh(aManager, 'a-grant')).toBeGreaterThan(
          Date.now() / 1000,
        );
        expect(await refresh(bManager, 'b-grant')).toBeGreaterThan(
          Date.now() / 1000,
        );
        await a.dispose();
        expect(await refresh(bManager, 'b-next')).toBeGreaterThan(
          Date.now() / 1000,
        );
        expect(aProxy.grants).toStrictEqual(['a-grant']);
        expect(bProxy.grants).toStrictEqual(['b-grant', 'b-next']);
      } finally {
        await Promise.all([aManager.dispose(), bManager.dispose()]);
        await Promise.all([a.dispose(), b.dispose()]);
        await Promise.all([aProxy.close(), bProxy.close()]);
      }
    },
  );
});
