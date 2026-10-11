/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { MCPOAuthProvider } from './oauth-provider.js';
import { MCPOAuthTokenStorage } from './oauth-token-storage.js';
import type { OAuthCredentials, TokenStorage } from './token-storage/index.js';

class MemoryStore implements TokenStorage {
  private readonly credentials = new Map<string, OAuthCredentials>();
  async getCredentials(name: string): Promise<OAuthCredentials | null> {
    return this.credentials.get(name) ?? null;
  }
  async setCredentials(value: OAuthCredentials): Promise<void> {
    this.credentials.set(value.serverName, value);
  }
  async deleteCredentials(name: string): Promise<void> {
    this.credentials.delete(name);
  }
  async listServers(): Promise<string[]> {
    return [...this.credentials.keys()];
  }
  async getAllCredentials(): Promise<Map<string, OAuthCredentials>> {
    return new Map(this.credentials);
  }
  async clearAll(): Promise<void> {
    this.credentials.clear();
  }
}

describe('explicit MCP credential selection', () => {
  it('refreshes the same account and URL into only the supplied backend', async () => {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        const refresh = new URLSearchParams(body).get('refresh_token');
        if (!refresh) {
          response.writeHead(400);
          response.end('missing refresh token');
          return;
        }
        requests.push(refresh);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            access_token: `${refresh}-rotated`,
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected TCP address');
    const url = `http://127.0.0.1:${address.port}/`;
    const a = new MCPOAuthTokenStorage(new MemoryStore());
    const b = new MCPOAuthTokenStorage(new MemoryStore());
    try {
      for (const [storage, refresh] of [
        [a, 'A'],
        [b, 'B'],
      ] as const) {
        await storage.saveToken(
          'same',
          {
            accessToken: 'expired',
            refreshToken: refresh,
            tokenType: 'Bearer',
            expiresAt: 1,
          },
          'client',
          `${url}token`,
          `${url}mcp`,
        );
      }
      const tokens = await Promise.all([
        MCPOAuthProvider.getValidToken(a, 'same', { clientId: 'client' }),
        MCPOAuthProvider.getValidToken(b, 'same', { clientId: 'client' }),
      ]);
      expect(tokens).toStrictEqual(['A-rotated', 'B-rotated']);
      expect([...requests].sort()).toStrictEqual(['A', 'B']);
      expect((await a.getCredentials('same'))?.token.refreshToken).toBe('A');
      expect((await b.getCredentials('same'))?.token.refreshToken).toBe('B');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
