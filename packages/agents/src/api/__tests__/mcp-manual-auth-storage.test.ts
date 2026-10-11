/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { get } from 'node:http';
import { buildAgent } from './helpers/agentHarness.js';
import {
  MCPOAuthTokenStorage,
  type OAuthCredentials,
  type TokenStorage,
} from '@vybestack/llxprt-code-mcp';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('manual MCP authentication storage', () => {
  it('public manual authentication retains its browser and joins started persistence without publishing success', async () => {
    const entered = gate();
    const released = gate();
    const credentials = new Map<string, OAuthCredentials>();
    const storage: TokenStorage = {
      getCredentials: async (name) => credentials.get(name) ?? null,
      setCredentials: async (value) => {
        entered.release();
        await released.promise;
        credentials.set(value.serverName, value);
      },
      deleteCredentials: async (name) => {
        credentials.delete(name);
      },
      listServers: async () => [...credentials.keys()],
      getAllCredentials: async () => new Map(credentials),
      clearAll: async () => {
        credentials.clear();
      },
    };
    let browserA = 0;
    let browserB = 0;
    const host = {
      openBrowser: async (authorization: string): Promise<void> => {
        browserA++;
        const url = new URL(authorization);
        const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
        callback.searchParams.set('state', url.searchParams.get('state') ?? '');
        callback.searchParams.set('code', 'owner-code');
        await new Promise<void>((resolve, reject) => {
          const request = get(callback, (response) => {
            response.resume();
            response.on('end', resolve);
            response.on('error', reject);
          });
          request.on('error', reject);
        });
      },
    };
    const network = spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({
        access_token: 'persisted-after-cancel',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    );
    const built = await buildAgent('multi-turn-text.jsonl', {
      folderTrust: false,
      mcpHost: host,
      mcpTokenStorage: storage,
      mcpServers: {
        shared: {
          httpUrl: 'https://mcp-owner.test/mcp',
          oauth: {
            enabled: true,
            clientId: 'owner-client',
            authorizationUrl: 'https://oauth-owner.test/authorize',
            tokenUrl: 'https://oauth-owner.test/token',
          },
        },
      },
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    host.openBrowser = async (): Promise<void> => {
      browserB++;
    };
    const messages: string[] = [];
    let auth: Promise<unknown> | undefined;
    let disposal: Promise<void> | undefined;
    try {
      auth = built.agent.mcp
        .authenticate('shared', (message) => {
          messages.push(message);
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await Promise.race([
        entered.promise,
        auth.then((result) => {
          throw new Error(
            `Authentication ended before persistence: ${JSON.stringify(result)}`,
          );
        }),
      ]);
      let settled = false;
      disposal = built.agent.dispose();
      void disposal.then(() => {
        settled = true;
      });
      expect(built.agent.dispose()).toBe(disposal);
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(messages.join('\n')).toContain(
        'https://oauth-owner.test/authorize',
      );
      expect(browserA).toBe(1);
      expect(browserB).toBe(0);
      released.release();
      expect(await auth).toHaveProperty('error.name', 'AbortError');
      await disposal;
      const observer = new MCPOAuthTokenStorage(storage);
      expect((await observer.getCredentials('shared'))?.token.accessToken).toBe(
        'persisted-after-cancel',
      );
      expect(await built.agent.mcp.auth('shared')).toMatchObject({
        authenticated: true,
        sessionAuthenticated: false,
      });
    } finally {
      released.release();
      await auth;
      await disposal;
      await built.cleanup();
      network.mockRestore();
    }
  }, 30000);
});
