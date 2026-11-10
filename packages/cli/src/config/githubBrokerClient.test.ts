/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
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
import {
  makeCwdShim,
  withGhOnPath,
} from '../../../providers/src/auth/proxy/__tests__/github-broker-cwd-recorder.js';
import { createGitHubBrokerClient } from './githubBrokerClient.js';

interface BrokerHost {
  authority: CredentialAuthority;
  stop(): Promise<void>;
}

async function brokerHost(
  capability: string,
  multiplier: number,
): Promise<BrokerHost> {
  return brokerHostWith(capability, (_socket, id, payload, state) => {
    if (typeof payload.limit !== 'number') throw new Error('Missing limit');
    state.writer.sendOk(id, { totalCount: payload.limit * multiplier });
  });
}

async function brokerHostWith(
  capability: string,
  handler: RequestHandler,
): Promise<BrokerHost> {
  const directory = await mkdtemp(join(tmpdir(), 'broker-owner-'));
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

describe('CLI GitHub broker working directory (issue #4001)', () => {
  describe.skipIf(process.platform === 'win32')(
    'host and sandbox transports',
    () => {
      const prParams = {
        title: 'T',
        body: 'B',
        base: 'main',
        head: 'feature',
      };

      it('runs gh on the host in the session workspace directory the caller supplies', async () => {
        const shim = await makeCwdShim();
        const workspace = await mkdtemp(join(tmpdir(), 'broker-workspace-'));
        const client = createGitHubBrokerClient(new CredentialAuthority());
        try {
          const result = await withGhOnPath(shim.binDir, () =>
            client.runOperation(
              'pr.create',
              prParams,
              new AbortController().signal,
              { workingDirectory: workspace },
            ),
          );
          expect(result.url).toContain('/pull/');
          expect(await shim.readCwds()).toStrictEqual([
            await realpath(workspace),
          ]);
        } finally {
          client.dispose();
          await shim.cleanup();
          await rm(workspace, { recursive: true, force: true });
        }
      });

      it('keeps the workspace directory off the sandbox socket', async () => {
        const host = await brokerHostWith(
          'c'.repeat(64),
          (_socket, id, payload, state) => {
            state.writer.sendOk(id, { received: JSON.stringify(payload) });
          },
        );
        const client = createGitHubBrokerClient(host.authority);
        try {
          const result = await client.runOperation(
            'pr.create',
            prParams,
            new AbortController().signal,
            { workingDirectory: '/home/someone/secret-workspace' },
          );
          const received = String(result.received);
          expect(received).not.toContain('workingDirectory');
          expect(received).not.toContain('/home/someone/secret-workspace');
          expect(received).toContain('"op":"pr.create"');
        } finally {
          client.dispose();
          await host.stop();
        }
      });
    },
  );
});
