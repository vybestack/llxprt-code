/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import {
  startLocalForwardProxy,
  type ForwardProxyRequest,
  type LocalForwardProxy,
} from '@vybestack/llxprt-code-test-utils/network/local-forward-proxy.js';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import {
  InMemoryProviderKeyStorage,
  OwnedCredentialFixture,
  useOwnedCredentials,
} from './helpers/owned-credential-fixture.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';

const MODEL_HOST_A = 'model-a.invalid';
const MODEL_HOST_B = 'model-b.invalid';
const COMPRESS_HOST_A = 'compress-a.invalid';
const COMPRESS_HOST_B = 'compress-b.invalid';
const KEY_NAME = 'compression-shared-name';
const KEY_A = 'secret-held-by-root-a';
const KEY_B = 'secret-held-by-root-b';

function respond(host: string, request: ForwardProxyRequest): Response {
  if (request.path !== '/v1/chat/completions') return new Response('ok');
  const text = `from-${host}`;
  const streaming = (JSON.parse(request.body) as { stream?: boolean }).stream;
  if (streaming !== true) {
    return Response.json({
      id: 'proxied',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop',
        },
      ],
    });
  }
  const chunk = (delta: object, finish: string | null): string =>
    `data: ${JSON.stringify({
      id: 'proxied',
      object: 'chat.completion.chunk',
      model: 'gpt-4o',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return new Response(
    chunk({ role: 'assistant', content: text }, null) +
      chunk({}, 'stop') +
      'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('compression profile key storage per root', () => {
  useOwnedCredentials();
  usePromptFixture();
  const proxies: LocalForwardProxy[] = [];
  const cleanups: Array<() => Promise<void>> = [];
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'compression-key-roots-'));
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    for (const proxy of proxies.splice(0)) await proxy.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function startProxy(
    modelHost: string,
    compressHost: string,
  ): Promise<LocalForwardProxy> {
    const proxy = await startLocalForwardProxy({
      [modelHost]: (request) => respond(modelHost, request),
      [compressHost]: (request) => respond(compressHost, request),
    });
    proxies.push(proxy);
    return proxy;
  }

  async function createCredentials(
    key: string,
  ): Promise<OwnedCredentialFixture> {
    const storage = new InMemoryProviderKeyStorage();
    await storage.saveKey(KEY_NAME, key);
    const credentials = await OwnedCredentialFixture.create(undefined, storage);
    cleanups.push(() => credentials.dispose());
    return credentials;
  }

  async function createRoot(
    credentials: OwnedCredentialFixture,
    modelHost: string,
    compressHost: string,
  ): Promise<{ agent: Agent; proxy: LocalForwardProxy }> {
    const proxy = await startProxy(modelHost, compressHost);
    const agent = await createAgent({
      provider: 'openai',
      model: 'gpt-4o',
      auth: { apiKey: 'test-key', baseUrl: `http://${modelHost}/v1` },
      proxy: proxy.url,
      workingDir: directory,
      credentialAuthority: credentials.authority,
      harness: { includeProcessCwd: false },
    });
    cleanups.push(() => agent.dispose());
    return { agent, proxy };
  }

  async function saveCompressionProfile(
    name: string,
    host: string,
  ): Promise<void> {
    await new ProfileManager().saveProfile(name, {
      version: 1,
      provider: 'openai',
      model: `${name}-model`,
      modelParams: {},
      ephemeralSettings: {
        'base-url': `http://${host}/v1`,
        'auth-key-name': KEY_NAME,
      },
    });
  }

  async function compressThroughProfile(
    agent: Agent,
    profile: string,
  ): Promise<void> {
    for (let turn = 0; turn < 6; turn++) {
      for await (const _event of agent.stream(
        `Earlier turn ${turn}: ${'context '.repeat(200)}`,
      )) {
        // Draining the stream records the turn in history.
      }
    }
    agent.setEphemeralSetting('compression.strategy', 'one-shot');
    agent.setEphemeralSetting('compression.profile', profile);
    await agent.compress();
  }

  function authorizations(
    proxy: LocalForwardProxy,
    host: string,
  ): readonly string[] {
    return proxy
      .requestsTo(host)
      .filter(({ path }) => path === '/v1/chat/completions')
      .map(({ headers }) => headers.authorization);
  }

  it('sends each root its own stored key for an auth-key-name compression profile', async () => {
    const firstCredentials = await createCredentials(KEY_A);
    const secondCredentials = await createCredentials(KEY_B);
    await saveCompressionProfile('compress-keys-a', COMPRESS_HOST_A);
    await saveCompressionProfile('compress-keys-b', COMPRESS_HOST_B);
    const left = await createRoot(
      firstCredentials,
      MODEL_HOST_A,
      COMPRESS_HOST_A,
    );
    const right = await createRoot(
      secondCredentials,
      MODEL_HOST_B,
      COMPRESS_HOST_B,
    );

    await compressThroughProfile(left.agent, 'compress-keys-a');
    await compressThroughProfile(right.agent, 'compress-keys-b');

    const leftAuthorizations = authorizations(left.proxy, COMPRESS_HOST_A);
    const rightAuthorizations = authorizations(right.proxy, COMPRESS_HOST_B);
    expect(leftAuthorizations.length).toBeGreaterThan(0);
    expect(new Set(leftAuthorizations)).toStrictEqual(
      new Set([`Bearer ${KEY_A}`]),
    );
    expect(rightAuthorizations.length).toBeGreaterThan(0);
    expect(new Set(rightAuthorizations)).toStrictEqual(
      new Set([`Bearer ${KEY_B}`]),
    );
  }, 60_000);
});
