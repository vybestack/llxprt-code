import { capturedAgentClient } from './helpers/agent-client-observation.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { requireMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { buildAgent } from './helpers/agentHarness.js';
import {
  CarryProbeClient,
  historyDigest,
} from './helpers/agent-carry-fixture.js';

const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
async function* mediaSource(): AsyncIterable<IContent> {
  yield {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'signed reasoning',
        signature: 'signature-854',
      },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: image,
        caption: 'carried image',
      },
    ],
    metadata: {
      model: 'historical-model',
      cacheAnchor: true,
      providerMetadata: { opaque: 'provider-bytes' },
    },
  };
}

describe('AgentImpl carried media ownership', () => {
  it('preserves signatures, cache and provider metadata, and media reservations through failed startup and retry', async () => {
    let armed = false;
    const defaults = buildAgentClientFactory();
    const { agent, cleanup } = await buildAgent(
      'plain-text.jsonl',
      {},
      (config, runtime, readMcp, media, paths, instr) => {
        if (!armed)
          return defaults(config, runtime, readMcp, media, paths, instr);
        if (media === undefined || paths === undefined)
          throw new Error('Carry probe requires the session media store');
        const probe = new CarryProbeClient(
          config,
          runtime,
          readMcp ?? (() => undefined),
          media,
          paths,
          undefined,
          undefined,
          instr,
        );
        vi.spyOn(probe, 'startChat').mockRejectedValueOnce(
          new Error('Media startup fault'),
        );
        return probe;
      },
    );
    const previous = capturedAgentClient(agent);
    const store = requireMediaStore(previous);
    await previous.storeHistoryForLaterUse(mediaSource());
    const digest = await historyDigest(previous.streamHistory());
    const cursor = previous.streamHistory();
    const first = await cursor.next();
    await cursor.return();
    if (first.done === true) throw new Error('Missing admitted media row');
    const reference = first.value.blocks.find(
      (block) => block.type === 'media',
    );
    if (reference?.type !== 'media' || reference.encoding !== 'reference')
      throw new Error('Missing admitted reference');
    armed = true;
    try {
      await expect(agent.setModel('media-carried-model')).rejects.toThrow(
        'Media startup fault',
      );
      const next = capturedAgentClient(agent);
      expect(next.hasChatInitialized()).toBe(false);
      const failedStartup = {
        digest: await historyDigest(agent.streamHistory()),
        reserved: await store.hasReservations(reference.contentId),
      };
      expect(
        Buffer.from(await store.readVerified(reference)).toString('base64'),
      ).toBe(image);
      await next.startChat([]);
      const retriedStartup = {
        digest: await historyDigest(agent.streamHistory()),
        reserved: await store.hasReservations(reference.contentId),
      };
      expect({ failedStartup, retriedStartup }).toStrictEqual({
        failedStartup: { digest, reserved: true },
        retriedStartup: { digest, reserved: true },
      });
      await next.dispose();
      expect(await store.hasReservations(reference.contentId)).toBe(false);
    } finally {
      await cleanup();
    }
  }, 180000);
});
