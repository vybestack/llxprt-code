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
import { OpenAIProvider } from '../openai/OpenAIProvider.js';

const MODEL_A = 'model-a.invalid';
const MODEL_B = 'model-b.invalid';

function completion(content: string): Response {
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

describe('wrapper-created invocations carry the owner transport', () => {
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

  async function managerThrough(
    host: string,
    content: string,
  ): Promise<{ manager: ProviderManager; proxy: LocalForwardProxy }> {
    const proxy = await startLocalForwardProxy({
      [host]: () => completion(content),
    });
    proxies.push(proxy);
    const network = new OwnedFetch(proxy.url);
    networks.push(network);
    const settings = new SettingsService();
    settings.set('streaming', 'disabled');
    settings.set('retries', 1);
    settings.setProviderSetting('openai', 'model', 'gpt-4o');
    settings.setProviderSetting('openai', 'base-url', `http://${host}/v1`);
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

  it('sends a call with no invocation through the manager transport', async () => {
    const { manager, proxy } = await managerThrough(MODEL_A, 'from-a');

    expect(await complete(manager)).toBe('from-a');

    expect(proxy.requestsTo(MODEL_A)).toHaveLength(1);
    expect(proxy.requestsTo(MODEL_A)[0]).toMatchObject({
      method: 'POST',
      path: '/v1/chat/completions',
    });
  });

  it('keeps two managers on their own transports', async () => {
    const left = await managerThrough(MODEL_A, 'from-a');
    const right = await managerThrough(MODEL_B, 'from-b');

    expect(await complete(left.manager)).toBe('from-a');
    expect(await complete(right.manager)).toBe('from-b');

    expect(left.proxy.requests.map((request) => request.host)).toStrictEqual([
      MODEL_A,
    ]);
    expect(right.proxy.requests.map((request) => request.host)).toStrictEqual([
      MODEL_B,
    ]);
  });
});
