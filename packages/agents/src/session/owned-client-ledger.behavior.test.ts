/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  ProviderFileLifecycle,
  resolveProviderFilePolicy,
  type ProviderFileIdentity,
} from '@vybestack/llxprt-code-providers';
import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { releaseAdoptedFileScope } from '../api/adoption-release.js';
import { OwnedClientLedger } from './session-client-cleanup.js';

const IDENTITY = {
  provider: 'kimi-style',
  baseURL: 'http://responder.invalid/v1',
  credentialHash: 'credential-a',
} satisfies ProviderFileIdentity;

function sessionPolicy() {
  const policy = resolveProviderFilePolicy({
    configuredMode: 'session',
    configuredRetentionMs: 60_000,
    configuredDeletion: 'delete',
    providerFileReferences: true,
    zeroDataRetention: 'incompatible-while-retained',
    zeroDataRetentionRequired: false,
  });
  if (policy.mode !== 'enabled')
    throw new Error('Expected session provider Files policy to be enabled');
  return policy;
}

function liveClient(): AgentClientContract {
  return { dispose: () => Promise.resolve() } as unknown as AgentClientContract;
}

function failureCount(
  results: ReadonlyArray<PromiseSettledResult<unknown>>,
  fileId: string,
): number {
  return results.filter(
    (result) =>
      result.status === 'rejected' &&
      String(result.reason).includes(`files=${fileId}`),
  ).length;
}

describe('owned client ledger release failures', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          }),
      ),
    );
  });

  async function responder(deletionStatus: number) {
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      response.statusCode = deletionStatus;
      response.end();
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    return { requests, url: `http://127.0.0.1:${port}/` };
  }

  async function ledgerWithFiles(deletionStatus: number) {
    const remote = await responder(deletionStatus);
    const lifecycle = new ProviderFileLifecycle({
      maxFiles: 8,
      maxBytes: 1024,
    });
    const ledger = new OwnedClientLedger((scope) =>
      releaseAdoptedFileScope(lifecycle, scope),
    );
    const upload = async (scopeId: string, fileId: string) => {
      const retained = await lifecycle.retain({
        cacheKey: `content-${fileId}`,
        fileId,
        bytes: 10,
        identity: IDENTITY,
        policy: sessionPolicy(),
        scopeId,
        deleteRemote: async (id) => {
          const response = await fetch(`${remote.url}files/${id}`, {
            method: 'DELETE',
          });
          if (!response.ok)
            throw new Error(`delete ${id} answered ${response.status}`);
        },
      });
      await retained.lease.release();
    };
    return { ledger, upload, remote };
  }

  it('reports a temporary client release failure to its caller and to settlement once', async () => {
    const { ledger, upload } = await ledgerWithFiles(500);
    const temporary = liveClient();
    ledger.register(temporary, 'runtime#generation#1');
    await upload('runtime#generation#1', 'file-temporary');

    await expect(ledger.dispose(temporary)).rejects.toThrow(
      /Provider file cleanup incomplete for runtime runtime#generation#1; files=file-temporary/,
    );

    const settled = await ledger.settleOwnedClients();
    expect(settled.map((result) => result.status)).toStrictEqual(['rejected']);
    expect(failureCount(settled, 'file-temporary')).toBe(1);
    expect(await ledger.settleOwnedClients()).toStrictEqual([]);
  });

  it('reports a failure of a client released by settlement itself once', async () => {
    const { ledger, upload } = await ledgerWithFiles(500);
    const main = liveClient();
    ledger.register(main, 'runtime');
    await upload('runtime', 'file-main');

    const settled = await ledger.settleOwnedClients();

    expect(settled.map((result) => result.status)).toStrictEqual(['rejected']);
    expect(failureCount(settled, 'file-main')).toBe(1);
    expect(await ledger.settleOwnedClients()).toStrictEqual([]);
  });

  it('reports one temporary failure and one settlement failure once each', async () => {
    const { ledger, upload } = await ledgerWithFiles(500);
    const main = liveClient();
    const temporary = liveClient();
    ledger.register(main, 'runtime');
    ledger.register(temporary, 'runtime#generation#2');
    await upload('runtime', 'file-main');
    await upload('runtime#generation#2', 'file-temporary');
    await expect(ledger.dispose(temporary)).rejects.toThrow(/file-temporary/);

    const settled = await ledger.settleOwnedClients();

    expect(settled).toHaveLength(2);
    expect(failureCount(settled, 'file-temporary')).toBe(1);
    expect(failureCount(settled, 'file-main')).toBe(1);
  });

  it('keeps a peer ledger with a healthy responder clean while another failure is outstanding', async () => {
    const failing = await ledgerWithFiles(500);
    const healthy = await ledgerWithFiles(200);
    const failingTemporary = liveClient();
    const healthyTemporary = liveClient();
    failing.ledger.register(failingTemporary, 'runtime#generation#3');
    healthy.ledger.register(healthyTemporary, 'peer#generation#1');
    await failing.upload('runtime#generation#3', 'file-failing');
    await healthy.upload('peer#generation#1', 'file-healthy');
    await expect(failing.ledger.dispose(failingTemporary)).rejects.toThrow(
      /file-failing/,
    );

    await healthy.ledger.dispose(healthyTemporary);

    expect(await healthy.ledger.settleOwnedClients()).toStrictEqual([]);
    expect(healthy.remote.requests).toStrictEqual([
      'DELETE /files/file-healthy',
    ]);
    expect(
      failureCount(await failing.ledger.settleOwnedClients(), 'file-failing'),
    ).toBe(1);
  });
});
