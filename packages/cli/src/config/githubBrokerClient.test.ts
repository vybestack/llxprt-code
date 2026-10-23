/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  CredentialProxyServer,
  type RequestHandler,
} from '../../../providers/src/auth/proxy/credential-proxy-server.js';
import {
  InMemoryProviderKeyStorage,
  InMemoryTokenStore,
} from '../../../providers/src/auth/proxy/__tests__/credential-proxy-server-helpers.js';
import { createGitHubBrokerClient } from './githubBrokerClient.js';

async function brokerHost(
  capability: string,
  multiplier: number,
): Promise<{
  authority: CredentialAuthority;
  stop(): Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'broker-owner-'));
  const handler: RequestHandler = (_socket, id, payload, state) => {
    if (typeof payload.limit !== 'number') throw new Error('Missing limit');
    state.writer.sendOk(id, { totalCount: payload.limit * multiplier });
  };
  const server = new CredentialProxyServer({
    tokenStore: new InMemoryTokenStore(),
    providerKeyStorage: new InMemoryProviderKeyStorage(),
    capabilityToken: capability,
    socketDir: directory,
    extraHandlers: { github: handler },
  });
  const socket = await server.start();
  return {
    authority: new CredentialAuthority(socket, capability),
    stop: async () => {
      await server.stop();
      await rm(directory, { recursive: true });
    },
  };
}

describe('CLI GitHub broker credential ownership', () => {
  it('keeps two capability roots independently authenticated through disposal', async () => {
    const hostA = await brokerHost('a'.repeat(64), 2);
    const hostB = await brokerHost('b'.repeat(64), 3);
    const a = createGitHubBrokerClient(hostA.authority);
    const b = createGitHubBrokerClient(hostB.authority);
    const signal = new AbortController().signal;
    try {
      const resultA = await a.runOperation('issue.list', { limit: 4 }, signal);
      const resultB = await b.runOperation('issue.list', { limit: 4 }, signal);
      expect(resultA.totalCount).toBe(8);
      expect(resultB.totalCount).toBe(12);
      a.dispose();
      expect(
        await b.runOperation('issue.list', { limit: 5 }, signal),
      ).toStrictEqual({
        totalCount: 15,
      });
      expect(JSON.stringify(hostA.authority)).not.toContain('a'.repeat(64));
    } finally {
      a.dispose();
      b.dispose();
      await hostA.stop();
      await hostB.stop();
    }
  });
});
