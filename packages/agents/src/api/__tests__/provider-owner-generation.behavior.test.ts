/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { buildAgent, internalConfig } from './helpers/agentHarness.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { successful, withOwners } from './turn-revision-capture.fixture.js';

async function textFrom(
  stream: AsyncIterable<{ type: string; text?: string }>,
): Promise<string> {
  let text = '';
  for await (const event of stream) {
    if (event.type === 'error') throw new Error(JSON.stringify(event));
    if (event.type === 'text') text += event.text ?? '';
  }
  return text;
}

function denyManagerDiscovery(config: object): () => void {
  Object.defineProperty(config, 'getProviderManager', {
    configurable: true,
    value: () => {
      throw new Error('Forbidden Config manager discovery');
    },
  });
  return () => {
    Reflect.deleteProperty(config, 'getProviderManager');
  };
}

describe('provider owner generation boundary', () => {
  it('drives public generation and parameter changes without consulting Config for a manager', async () => {
    const built = await buildAgent('multi-turn-text.jsonl');
    const config = internalConfig(built.agent);
    const blocked = denyManagerDiscovery(config);
    try {
      built.agent.setModelParam('temperature', 0.4);
      expect(
        await textFrom(built.agent.stream('Use the explicit owner')),
      ).not.toBe('');
      built.agent.clearModelParam('temperature');
      expect(built.agent.getModelParams()).not.toHaveProperty('temperature');
    } finally {
      blocked();
      await built.cleanup();
    }
  });

  it('keeps an initialized borrowed client usable after facade shutdown', async () => {
    const built = await buildCliStyleConfig('multi-turn-text.jsonl');
    const client = built.agentClient;
    await client.startChat();
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
    });
    try {
      const blocked = denyManagerDiscovery(built.config);
      try {
        expect(
          await textFrom(agent.stream('Borrow the initialized client')),
        ).not.toBe('');
        await agent.dispose();
        expect(
          (await client.getHistory()).flatMap((turn) =>
            turn.blocks
              .filter((block) => block.type === 'text')
              .map((block) => block.text),
          ),
        ).toContain('Borrow the initialized client');
        expect(client.isInitialized()).toBe(true);
        await client.startChat();
        expect(client.hasChatInitialized()).toBe(true);
      } finally {
        blocked();
      }
    } finally {
      await agent.dispose();
      await built.cleanup();
    }
  });
  it('retains admitted parameters through HTTP steering while a fresh admission observes the owner change', async () => {
    await withOwners(async (a, b, left, right, start) => {
      const denied = [a, b].map((agent) =>
        denyManagerDiscovery(internalConfig(agent)),
      );
      try {
        const pending = start(a, 'First owner');
        await Promise.race([
          left.entered,
          pending.then(() => {
            throw new Error('Generation stopped before transport');
          }),
        ]);
        a.setModelParam('temperature', 0.9);
        a.injectSteer('Same admitted route');
        successful(await start(b, 'Sibling owner'));
        left.release();
        successful(await pending);
        successful(await start(a, 'Fresh owner admission'));
        expect(
          left.requests().map((request) => request.temperature),
        ).toStrictEqual([0.2, 0.2, 0.9]);
        expect(
          right.requests().map((request) => request.temperature),
        ).toStrictEqual([0.7]);
      } finally {
        left.release();
        for (const spy of denied) spy();
      }
    });
  });
});
