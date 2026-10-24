/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import {
  startLocalForwardProxy,
  type LocalForwardProxy,
} from '@vybestack/llxprt-code-test-utils/network/local-forward-proxy.js';
import { ProviderManager } from '../ProviderManager.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';

const PROXIED_HOST = 'model-a.invalid';

function jsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function proxiedResponse(path: string): Response {
  if (path.endsWith('/models')) {
    return jsonResponse({
      object: 'list',
      data: [{ id: 'proxied-model', object: 'model' }],
    });
  }
  return jsonResponse({
    id: 'proxied',
    object: 'chat.completion',
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'from-proxy' },
        finish_reason: 'stop',
      },
    ],
  });
}

interface LoopbackListener {
  readonly baseUrl: string;
  readonly requests: IncomingMessage[];
  readonly server: Server;
}

async function startLoopbackListener(): Promise<LoopbackListener> {
  const requests: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.push(request);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'loopback-model', object: 'model' }],
      }),
    );
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, requests, server };
}

describe('providers get their transport only from their manager', () => {
  const listeners: LoopbackListener[] = [];
  const proxies: LocalForwardProxy[] = [];
  const networks: OwnedFetch[] = [];
  const settingsOwners: SessionSettingsOwner[] = [];

  afterEach(async () => {
    for (const owner of settingsOwners.splice(0)) {
      await owner.dispose();
    }
    for (const network of networks.splice(0)) {
      network.closeAdmissionAndAbort();
      await network.dispose();
    }
    for (const proxy of proxies.splice(0)) {
      await proxy.close();
    }
    for (const listener of listeners.splice(0)) {
      listener.server.close();
    }
  });

  async function boundManager(
    extraSettings: Readonly<Record<string, number>> = {},
  ): Promise<{ manager: ProviderManager; proxy: LocalForwardProxy }> {
    const proxy = await startLocalForwardProxy({
      [PROXIED_HOST]: (request) => proxiedResponse(request.path),
    });
    proxies.push(proxy);
    const network = new OwnedFetch(proxy.url);
    networks.push(network);
    const settings = new SettingsService();
    settings.set('streaming', 'disabled');
    settings.set('retries', 1);
    for (const [key, value] of Object.entries(extraSettings)) {
      settings.set(key, value);
    }
    settings.setProviderSetting('openai', 'model', 'gpt-4o');
    settings.setProviderSetting(
      'openai',
      'base-url',
      `http://${PROXIED_HOST}/v1`,
    );
    const config = createRuntimeConfigStub(settings);
    const settingsOwner = new SessionSettingsOwner(settings);
    settingsOwner.bindTelemetry(config);
    settingsOwners.push(settingsOwner);
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      config,
      undefined,
      undefined,
      settingsOwner,
    );
    manager.bindNetworkFetch(network.fetch);
    manager.registerProvider(new OpenAIProvider('test-key'));
    manager.setActiveProvider('openai');
    return { manager, proxy };
  }

  it('lists the fallback models on a provider no manager registered, and records nothing at the listener', async () => {
    const listener = await startLoopbackListener();
    listeners.push(listener);
    const provider = new OpenAIProvider('test-key', listener.baseUrl);

    const models = await provider.getModels();

    expect(models.length).toBeGreaterThan(0);
    expect(models.map(({ id }) => id)).not.toContain('loopback-model');
    expect(listener.requests).toHaveLength(0);
  });

  it('lists models through the owner transport of the manager that registered the provider', async () => {
    const { manager, proxy } = await boundManager();
    const provider = manager.getActiveProvider();
    if (provider === undefined) throw new Error('No active provider');

    const models = await provider.getModels();

    expect(models.map(({ id }) => id)).toStrictEqual(['proxied-model']);
    expect(proxy.requestsTo(PROXIED_HOST)).toHaveLength(1);
    expect(proxy.requestsTo(PROXIED_HOST)[0]).toMatchObject({
      method: 'GET',
      path: '/v1/models',
    });
  });

  it('sends a chat request that sets a headers timeout through the invocation fetch', async () => {
    const { manager, proxy } = await boundManager({
      'openai-headers-timeout-ms': 30000,
    });
    const provider = manager.getActiveProvider();
    if (provider === undefined) throw new Error('No active provider');
    const texts: string[] = [];

    for await (const content of provider.generateChatCompletion({
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
      systemInstruction: 'Answer briefly.',
    })) {
      for (const block of content.blocks) {
        if (block.type === 'text') texts.push(block.text);
      }
    }

    expect(texts.join('')).toBe('from-proxy');
    expect(proxy.requestsTo(PROXIED_HOST)).toHaveLength(1);
    expect(proxy.requestsTo(PROXIED_HOST)[0]).toMatchObject({
      method: 'POST',
      path: '/v1/chat/completions',
    });
  });
});
