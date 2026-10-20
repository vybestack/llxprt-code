import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchApiKeyQuota } from '@vybestack/llxprt-code-providers';
import { Storage } from '@vybestack/llxprt-code-settings';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { buildAgent, type Agent } from './helpers/agentHarness.js';

function clientOwner(agent: Agent): SessionClientOwner {
  const owner = fixtureAgentResources(agent)
    .sessionOwners.values()
    .next().value;
  if (owner === undefined) throw new Error('Expected root client owner');
  return owner;
}

async function proxy(
  credentials: { key: Buffer; cert: Buffer },
  limit: number,
): Promise<{
  url: string;
  requests: () => readonly string[];
  close: () => Promise<void>;
}> {
  let requests: readonly string[] = [];
  const tlsServer = createHttpsServer(credentials, (_request, response) => {
    requests = [...requests, 'models.dev:443'];
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        fake: {
          id: 'fake',
          name: 'Fixture provider',
          env: [],
          models: {
            'fake-model': {
              id: 'fake-model',
              name: 'fake-model',
              limit: { context: limit, output: 4000 },
              release_date: '2026-01-01',
              open_weights: false,
              tool_call: true,
            },
          },
        },
      }),
    );
  });
  tlsServer.listen(0, '127.0.0.1');
  await once(tlsServer, 'listening');
  const tlsAddress = tlsServer.address();
  if (tlsAddress === null || typeof tlsAddress === 'string')
    throw new Error('Expected TLS address');
  const server = createServer();
  server.on('connect', (request, socket) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (request.url === 'models.dev:443') {
      const upstream = connect(tlsAddress.port, '127.0.0.1', () =>
        socket.pipe(upstream).pipe(socket),
      );
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
      return;
    }
    const stream = socket;
    stream.on('error', () => socket.destroy());
    stream.once('data', () => {
      requests = [...requests, request.url ?? ''];
      const body = JSON.stringify({
        code: 200,
        msg: 'ok',
        success: true,
        data: {
          level: 'pro',
          limits: [
            {
              type: 'TOKENS_LIMIT',
              unit: 1,
              number: 5,
              percentage: limit / 1000,
            },
          ],
        },
      });
      stream.end(
        `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
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
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await new Promise<void>((resolve, reject) =>
        tlsServer.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

async function roots(): Promise<{
  a: Awaited<ReturnType<typeof buildAgent>>;
  b: Awaited<ReturnType<typeof buildAgent>>;
  aProxy: Awaited<ReturnType<typeof proxy>>;
  bProxy: Awaited<ReturnType<typeof proxy>>;
  cleanup: () => Promise<void>;
}> {
  const dir = process.env.LLXPRT_QUOTA_PROXY_CERT_DIR;
  if (dir === undefined)
    throw new Error('Proxy certificate fixture is missing');
  const cache = vi.spyOn(Storage, 'getGlobalCacheDir').mockReturnValue(dir);
  const context = {
    key: readFileSync(join(dir, 'key.pem')),
    cert: readFileSync(join(dir, 'cert.pem')),
  };
  const aProxy = await proxy(context, 8000);
  const bProxy = await proxy(context, 16000);
  const a = await buildAgent('plain-text.jsonl', {
    sessionId: 'same-label',
    proxy: aProxy.url,
  });
  const b = await buildAgent('plain-text.jsonl', {
    sessionId: 'same-label',
    proxy: bProxy.url,
  });
  return {
    a,
    b,
    aProxy,
    bProxy,
    cleanup: async () => {
      await Promise.all([a.cleanup(), b.cleanup()]);
      await Promise.all([aProxy.close(), bProxy.close()]);
      cache.mockRestore();
    },
  };
}

async function withProxyCertificate(
  name: string,
  run: () => Promise<void>,
): Promise<void> {
  if (process.env.LLXPRT_QUOTA_PROXY_CERT_DIR !== undefined) {
    await run();
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'quota-registry-proxy-'));
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-subj',
        '/CN=models.dev',
        '-addext',
        'subjectAltName=DNS:models.dev',
        '-days',
        '1',
      ],
      { stdio: 'ignore' },
    );
    const result = spawnSync(
      process.execPath,
      ['test', fileURLToPath(import.meta.url), '--test-name-pattern', name],
      {
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: cert,
          LLXPRT_QUOTA_PROXY_CERT_DIR: dir,
        },
        stdio: 'pipe',
      },
    );
    expect({
      exitCode: result.status,
      output: result.status === 0 ? '' : result.stderr.toString(),
    }).toStrictEqual({ exitCode: 0, output: '' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('root-owned quota and registry transport', () => {
  it('routes interleaved quota and registry requests through each live root proxy', () =>
    withProxyCertificate(
      'routes interleaved quota and registry requests through each live root proxy',
      async () => {
        const fixture = await roots();
        try {
          const { a, b, aProxy, bProxy } = fixture;
          const aQuota = await fetchApiKeyQuota(
            a.agent.sessionClient.fetch,
            'zai',
            'test-key',
            'http://quota.invalid',
          );
          const bUpdated = new Promise<void>((resolve) => {
            clientOwner(b.agent).modelRegistry.on('models:updated', resolve);
          });
          await fixtureAgentResources(b.agent).manager.getAvailableModels();
          await bUpdated;
          const bQuota = await fetchApiKeyQuota(
            b.agent.sessionClient.fetch,
            'zai',
            'test-key',
            'http://quota.invalid',
          );
          await clientOwner(a.agent).modelRegistry.refresh();
          expect(aQuota?.lines).not.toStrictEqual(bQuota?.lines);
          const aModels = await fixtureAgentResources(
            a.agent,
          ).manager.getAvailableModels();
          const bModels = await fixtureAgentResources(
            b.agent,
          ).manager.getAvailableModels();
          expect([
            aModels[0]?.contextWindow,
            bModels[0]?.contextWindow,
          ]).toStrictEqual([8000, 16000]);
          expect([aProxy.requests(), bProxy.requests()]).toStrictEqual([
            ['quota.invalid:80', 'models.dev:443'],
            ['models.dev:443', 'quota.invalid:80'],
          ]);
          expect(
            clientOwner(a.agent).modelRegistry.getById('fake/fake-model')
              ?.contextWindow,
          ).toBe(8000);
          expect(
            clientOwner(b.agent).modelRegistry.getById('fake/fake-model')
              ?.contextWindow,
          ).toBe(16000);
        } finally {
          await fixture.cleanup();
        }
      },
    ));

  it('keeps B registry refresh and publication usable after disposing A', () =>
    withProxyCertificate(
      'keeps B registry refresh and publication usable after disposing A',
      async () => {
        const fixture = await roots();
        try {
          const { a, b, aProxy, bProxy } = fixture;
          const registry = clientOwner(b.agent).modelRegistry;
          let publications = 0;
          registry.on('models:updated', () => {
            publications += 1;
          });
          await registry.refresh();
          await fixtureAgentResources(b.agent).manager.getAvailableModels();
          await a.agent.dispose();
          expect(await registry.refresh()).toBe(true);
          expect(publications).toBe(2);
          const models = await fixtureAgentResources(
            b.agent,
          ).manager.getAvailableModels();
          expect(models[0]?.contextWindow).toBe(16000);
          expect([
            aProxy.requests().length,
            bProxy.requests().length,
          ]).toStrictEqual([0, 2]);
          expect(registry.getById('fake/fake-model')?.contextWindow).toBe(
            16000,
          );
        } finally {
          await fixture.cleanup();
        }
      },
    ));
});
