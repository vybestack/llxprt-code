/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { buildAgent } from './helpers/agentHarness.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import {
  listenCutoverFixtureServer,
  startCutoverFixtureServer,
} from './helpers/mcp-cutover-server-fixture.js';

describe('retained MCP credential owners', () => {
  it.each(['http', 'sse'] as const)(
    'keeps identical %s server credentials and browsers through 401, manual callback, reconnect and refresh',
    async (transportType) => {
      let session = 0;
      const browsers: string[] = [];
      const fixture = startCutoverFixtureServer(transportType, () => ++session);
      await listenCutoverFixtureServer(fixture);
      const base = fixture.base;
      const entered = gate();
      const release = gate();
      const a = createTestOAuthBinding();
      const persist = a.tokenStorage.setCredentials.bind(a.tokenStorage);
      const storageGate = spyOn(
        a.tokenStorage,
        'setCredentials',
      ).mockImplementation(async (value) => {
        entered.resolve();
        await release.promise;
        await persist(value);
      });
      const b = createTestOAuthBinding();
      const host = (owner: string) => browserForOwner(owner, browsers);
      const hostA = host('A');
      const options = {
        folderTrust: true,
        mcpServers: {
          same: {
            url: `${base}/mcp`,
            type: transportType,
            oauth: {
              enabled: false,
              authorizationUrl: `${base}/authorize`,
              tokenUrl: `${base}/token`,
              registrationUrl: `${base}/register`,
            },
          },
        },
        telemetry: { enabled: false },
        recording: { enabled: false },
      };
      const builtA = await buildAgent('multi-turn-text.jsonl', {
        ...options,
        mcpTokenStorage: a.tokenStorage,
        mcpHost: hostA,
      });
      const builtB = await buildAgent('multi-turn-text.jsonl', {
        ...options,
        mcpTokenStorage: b.tokenStorage,
        mcpHost: host('B'),
      });
      let authA: Promise<unknown> | undefined;
      try {
        await Promise.all(
          [builtA, builtB].map(
            ({ agent }) =>
              new Promise<void>((resolve) => {
                const check = (): void => {
                  if (agent.mcp.discoveryState() !== 'pending') {
                    unsubscribe();
                    resolve();
                  }
                };
                const unsubscribe = agent.mcp.subscribeStatus(check);
                check();
              }),
          ),
        );
        expect(browsers).toStrictEqual([]);
        expect((await builtA.agent.mcp.auth('same')).authenticated).toBe(false);
        hostA.openBrowser = host('wrong').openBrowser;
        authA = builtA.agent.mcp.authenticate('same');
        await entered.promise;
        await builtB.agent.mcp.authenticate('same');
        expect(await a.tokenStorage.getCredentials('same')).toBeNull();
        release.resolve();
        await authA;
        expect(browsers).toStrictEqual(['A', 'B']);
        expect(
          (await a.tokenStorage.getCredentials('same'))?.token.accessToken,
        ).toBe('A');
        expect(
          (await b.tokenStorage.getCredentials('same'))?.token.accessToken,
        ).toBe('B');
        expect(fixture.traffic).toContain('Bearer A');
        expect(fixture.traffic).toContain('Bearer B');
        expect(
          await builtB.agent.mcp.readResource('same', 'test://same'),
        ).toStrictEqual({
          contents: [{ uri: 'test://same', text: 'Bearer B' }],
        });
        const saved = await a.tokenStorage.getCredentials('same');
        if (!saved) throw new Error('Missing A credentials');
        await a.tokenStorage.setCredentials({
          ...saved,
          token: { ...saved.token, expiresAt: 1 },
        });
        await builtA.agent.mcp.refresh('same');
        expect(
          (await a.tokenStorage.getCredentials('same'))?.token.accessToken,
        ).toBe('A-rotated');
        expect(
          (await b.tokenStorage.getCredentials('same'))?.token.accessToken,
        ).toBe('B');
        expect(fixture.traffic).toContain('Bearer A-rotated');
      } finally {
        release.resolve();
        await authA;
        storageGate.mockRestore();
        await builtB.cleanup();
        await builtA.cleanup();
        fixture.server.closeAllConnections();
        await new Promise<void>((resolve) =>
          fixture.server.close(() => resolve()),
        );
      }
    },
  );
});

function browserForOwner(
  owner: string,
  browsers: string[],
): { openBrowser: (url: string) => Promise<void> } {
  return {
    openBrowser: async (value) => {
      browsers.push(owner);
      const url = new URL(value);
      url.searchParams.set('owner', owner);
      const response = await fetch(url);
      await response.text();
    },
  };
}

function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
