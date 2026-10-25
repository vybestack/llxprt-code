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
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchApiKeyQuota } from '@vybestack/llxprt-code-providers';
import { Storage } from '@vybestack/llxprt-code-settings';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';

const MODEL_CACHE_FILE = 'models.json';
const MODELS_WAIT_LIMIT_MS = 10_000;
const MODELS_WAIT_STEP_MS = 10;

async function firstContextWindow(agent: Agent): Promise<number | undefined> {
  return (await agent.listAvailableModels())[0]?.contextWindow;
}

/**
 * The Agent has no model-change subscription: `listAvailableModels()` starts
 * the registry's background refresh and returns. The refreshed list is
 * observed through the same public read.
 */
async function awaitContextWindow(
  agent: Agent,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + MODELS_WAIT_LIMIT_MS;
  while ((await firstContextWindow(agent)) !== expected) {
    if (Date.now() > deadline)
      throw new Error(`Models did not reach context window ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, MODELS_WAIT_STEP_MS));
  }
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
  a: Agent;
  b: Agent;
  aProxy: Awaited<ReturnType<typeof proxy>>;
  bProxy: Awaited<ReturnType<typeof proxy>>;
  cacheFile: string;
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
  const workingDir = realpathSync(mkdtempSync(join(tmpdir(), 'quota-root-')));
  const open = (proxyUrl: string): Promise<Agent> =>
    createAgent({
      provider: 'fake',
      model: 'fake-model',
      sessionId: 'same-label',
      workingDir,
      proxy: proxyUrl,
    });
  const a = await open(aProxy.url);
  const b = await open(bProxy.url);
  return {
    a,
    b,
    aProxy,
    bProxy,
    cacheFile: join(dir, MODEL_CACHE_FILE),
    cleanup: async () => {
      await Promise.all([a.dispose(), b.dispose()]);
      await Promise.all([aProxy.close(), bProxy.close()]);
      cache.mockRestore();
      rmSync(workingDir, { recursive: true, force: true });
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
  useFakeResponsesReplay('plain-text.jsonl');

  it('routes interleaved quota and registry requests through each live root proxy', () =>
    withProxyCertificate(
      'routes interleaved quota and registry requests through each live root proxy',
      async () => {
        const fixture = await roots();
        try {
          const { a, b, aProxy, bProxy, cacheFile } = fixture;
          const aQuota = await fetchApiKeyQuota(
            a.sessionClient.fetch,
            'zai',
            'test-key',
            'http://quota.invalid',
          );
          await b.listAvailableModels();
          await awaitContextWindow(b, 16000);
          const bQuota = await fetchApiKeyQuota(
            b.sessionClient.fetch,
            'zai',
            'test-key',
            'http://quota.invalid',
          );
          // The on-disk model cache is shared by design: B's refresh wrote it,
          // and A would load it instead of fetching through its own root.
          rmSync(cacheFile, { force: true });
          await a.listAvailableModels();
          await awaitContextWindow(a, 8000);
          expect(aQuota?.lines).not.toStrictEqual(bQuota?.lines);
          const aModels = await a.listAvailableModels();
          const bModels = await b.listAvailableModels();
          expect([
            aModels[0]?.contextWindow,
            bModels[0]?.contextWindow,
          ]).toStrictEqual([8000, 16000]);
          expect([aProxy.requests(), bProxy.requests()]).toStrictEqual([
            ['quota.invalid:80', 'models.dev:443'],
            ['models.dev:443', 'quota.invalid:80'],
          ]);
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
          await b.listAvailableModels();
          await awaitContextWindow(b, 16000);
          await a.dispose();
          const models = await b.listAvailableModels();
          expect(models[0]?.contextWindow).toBe(16000);
          expect([
            aProxy.requests().length,
            bProxy.requests().length,
          ]).toStrictEqual([0, 1]);
        } finally {
          await fixture.cleanup();
        }
      },
    ));
});
