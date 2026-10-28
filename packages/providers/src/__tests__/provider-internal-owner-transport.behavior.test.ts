/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import {
  startLocalForwardProxy,
  type LocalForwardProxy,
} from '@vybestack/llxprt-code-test-utils/network/local-forward-proxy.js';
import { ProviderManager } from '../ProviderManager.js';
import { LoadBalancingProvider } from '../LoadBalancingProvider.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import type { IProvider } from '../IProvider.js';
import type { ResolvedSubProfile } from '../loadBalancing/loadBalancerTypes.js';

const MODEL_A = 'model-a.invalid';
const MODEL_B = 'model-b.invalid';

function completion(content: string, streamed: boolean): Response {
  if (streamed) {
    const chunk = (delta: object, finish: string | null): string =>
      `data: ${JSON.stringify({
        id: 'proxied',
        object: 'chat.completion.chunk',
        model: 'gpt-4o',
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    return new Response(
      [
        chunk({ role: 'assistant', content }, null),
        chunk({}, 'stop'),
        'data: [DONE]\n\n',
      ].join(''),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  }
  return new Response(
    JSON.stringify({
      id: 'proxied',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function subProfileFor(name: string, host: string): ResolvedSubProfile {
  return {
    name,
    providerName: 'openai',
    model: 'model-a',
    baseURL: `http://${host}/v1`,
    authToken: 'test-key',
    ephemeralSettings: {},
    modelParams: {},
  };
}

describe('provider-internal invocations keep the owner transport', () => {
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
  });

  async function networkFor(
    host: string,
    content: string,
  ): Promise<{ network: OwnedFetch; proxy: LocalForwardProxy }> {
    const proxy = await startLocalForwardProxy({
      [host]: (request) =>
        completion(content, request.body.includes('"stream":true')),
    });
    proxies.push(proxy);
    const network = new OwnedFetch(proxy.url);
    networks.push(network);
    return { network, proxy };
  }

  function settingsFor(host: string): SettingsService {
    const settings = new SettingsService();
    settings.set('streaming', 'disabled');
    settings.set('retries', 1);
    settings.setProviderSetting('openai', 'model', 'gpt-4o');
    settings.setProviderSetting('openai', 'base-url', `http://${host}/v1`);
    return settings;
  }

  async function loadBalancerManager(
    host: string,
    content: string,
  ): Promise<{ manager: ProviderManager; proxy: LocalForwardProxy }> {
    const { network, proxy } = await networkFor(host, content);
    const settings = settingsFor(host);
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
    manager.registerProvider(
      new LoadBalancingProvider(
        {
          profileName: `lb-${host}`,
          strategy: 'round-robin',
          subProfiles: [subProfileFor('sub-a', host)],
        },
        manager,
      ),
    );
    manager.setActiveProvider('load-balancer');
    return { manager, proxy };
  }

  async function complete(provider: IProvider | undefined): Promise<string> {
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

  it('sends a load-balancer sub-profile request through the manager transport', async () => {
    const left = await loadBalancerManager(MODEL_A, 'from-a');
    const right = await loadBalancerManager(MODEL_B, 'from-b');

    expect(await complete(left.manager.getActiveProvider())).toBe('from-a');

    expect(left.proxy.requestsTo(MODEL_A)).toHaveLength(1);
    expect(left.proxy.requestsTo(MODEL_A)[0]).toMatchObject({
      method: 'POST',
      path: '/v1/chat/completions',
    });
    expect(right.proxy.requests).toHaveLength(0);

    expect(await complete(right.manager.getActiveProvider())).toBe('from-b');
    expect(right.proxy.requests.map((request) => request.host)).toStrictEqual([
      MODEL_B,
    ]);
    expect(left.proxy.requests).toHaveLength(1);
  });

  it('sends a provider call with no invocation through its bound transport', async () => {
    const left = await networkFor(MODEL_A, 'from-a');
    const right = await networkFor(MODEL_B, 'from-b');
    const bind = (host: string, network: OwnedFetch): IProvider =>
      new OpenAIProvider('test-key').bindOwnerAuthentication(
        settingsFor(host),
        () => network.fetch,
      );

    expect(await complete(bind(MODEL_A, left.network))).toBe('from-a');

    expect(left.proxy.requestsTo(MODEL_A)).toHaveLength(1);
    expect(left.proxy.requestsTo(MODEL_A)[0]).toMatchObject({
      method: 'POST',
      path: '/v1/chat/completions',
    });
    expect(right.proxy.requests).toHaveLength(0);

    expect(await complete(bind(MODEL_B, right.network))).toBe('from-b');
    expect(right.proxy.requests.map((request) => request.host)).toStrictEqual([
      MODEL_B,
    ]);
  });
});
