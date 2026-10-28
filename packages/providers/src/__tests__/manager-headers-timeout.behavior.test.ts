/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
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

const SERVER_HEADERS_DELAY_MS = 1_500;
const SHORT_DEADLINE_MS = 100;
const LONG_DEADLINE_MS = 4_000;
const PROXIED_HOST = 'slow-headers.invalid';

const COMPLETION_BODY = JSON.stringify({
  id: 'delayed',
  object: 'chat.completion',
  model: 'gpt-4o',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'ready' },
      finish_reason: 'stop',
    },
  ],
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Route {
  readonly network: OwnedFetch;
  readonly baseUrl: string;
}

describe('the manager forwards the per-request headers deadline to the owner root', () => {
  const servers: Server[] = [];
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
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      server.close();
    }
  });

  async function directRoute(): Promise<Route> {
    const server = createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(COMPLETION_BODY);
      }, SERVER_HEADERS_DELAY_MS);
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    const { port } = server.address() as AddressInfo;
    const network = new OwnedFetch();
    networks.push(network);
    return { network, baseUrl: `http://127.0.0.1:${port}/v1` };
  }

  async function proxyRoute(): Promise<Route> {
    const proxy = await startLocalForwardProxy({
      [PROXIED_HOST]: async () => {
        await delay(SERVER_HEADERS_DELAY_MS);
        return new Response(COMPLETION_BODY, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    proxies.push(proxy);
    const network = new OwnedFetch(proxy.url);
    networks.push(network);
    return { network, baseUrl: `http://${PROXIED_HOST}/v1` };
  }

  function managerFor(route: Route, headersTimeoutMs: number): ProviderManager {
    const settings = new SettingsService();
    settings.set('streaming', 'disabled');
    settings.set('retries', 1);
    settings.set('openai-headers-timeout-ms', headersTimeoutMs);
    settings.setProviderSetting('openai', 'model', 'gpt-4o');
    settings.setProviderSetting('openai', 'base-url', route.baseUrl);
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
    manager.bindNetworkFetch(route.network.fetch);
    manager.registerProvider(new OpenAIProvider('test-key'));
    manager.setActiveProvider('openai');
    return manager;
  }

  async function complete(manager: ProviderManager): Promise<string> {
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
    return texts.join('');
  }

  const routes: ReadonlyArray<readonly [string, () => Promise<Route>]> = [
    ['directly', directRoute],
    ['through the proxy', proxyRoute],
  ];

  for (const [label, startRoute] of routes) {
    it(`rejects a slow-header response past a short deadline and accepts it within a long one ${label}`, async () => {
      const route = await startRoute();

      await expect(
        complete(managerFor(route, SHORT_DEADLINE_MS)),
      ).rejects.toThrow('Request timed out.');

      expect(await complete(managerFor(route, LONG_DEADLINE_MS))).toBe('ready');
    });
  }
});
