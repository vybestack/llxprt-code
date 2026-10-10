/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { drain } from './helpers/agentHarness.js';
import { describe, expect, it, spyOn } from 'bun:test';
import * as compressionFactory from '../../compression/compressionStrategyFactory.js';
import type { CompressionStrategy } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

function pathOf(state: { enabled: boolean; path?: string }): string {
  if (!state.enabled || state.path === undefined) {
    throw new Error('Expected a materialized recording');
  }
  return state.path;
}

describe('facade recording chat execution on a borrowed client', () => {
  it('routes manual compression through the executing facade across stop and resume', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      const sibling = await borrow();
      const seenPaths: Array<string | undefined> = [];
      const strategy: CompressionStrategy = {
        name: 'one-shot',
        requiresLLM: true,
        trigger: { mode: 'threshold', defaultThreshold: 0.8 },
        compress: async (context) => {
          seenPaths.push(context.transcriptPath);
          return {
            kind: 'applied',
            newHistory: [
              {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'text',
                    text: `summary-path:${context.transcriptPath ?? 'absent'}`,
                  },
                ],
              },
            ],
            metadata: {
              originalMessageCount: context.history.length,
              compressedMessageCount: 1,
              strategyUsed: 'one-shot',
              llmCallMade: false,
            },
          };
        },
      };
      const strategySpy = spyOn(
        compressionFactory,
        'getCompressionStrategy',
      ).mockReturnValue(strategy);
      try {
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'seed for A' }] },
          { speaker: 'ai', blocks: [{ type: 'text', text: 'answer for A' }] },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'another question' }],
          },
          { speaker: 'ai', blocks: [{ type: 'text', text: 'another answer' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        const pathA = pathOf(agent.session.getRecording());
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await sibling.session.setRecording({ enabled: true });
        const pathB = pathOf(sibling.session.getRecording());
        expect(pathB).not.toBe(pathA);
        await agent.compress({ promptId: 'compress-A' });
        expect(seenPaths).toContain(pathA);
        await agent.session.setRecording({ enabled: false });
        await agent.compress({ promptId: 'compress-A-stopped' });
        expect(seenPaths[seenPaths.length - 1]).toBeUndefined();
        await sibling.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'seed for B' }] },
          { speaker: 'ai', blocks: [{ type: 'text', text: 'answer for B' }] },
          { speaker: 'human', blocks: [{ type: 'text', text: 'next for B' }] },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'next answer for B' }],
          },
        ]);
        await sibling.compress({ promptId: 'compress-B' });
        expect(seenPaths[seenPaths.length - 1]).toBe(pathB);
        await agent.session.resume('latest');
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'resumed seed' }],
          },
          { speaker: 'ai', blocks: [{ type: 'text', text: 'resumed answer' }] },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'resumed follow-up' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'resumed completion' }],
          },
        ]);
        await agent.compress({ promptId: 'compress-A-resumed' });
        expect(seenPaths[seenPaths.length - 1]).toBe(
          pathOf(agent.session.getRecording()),
        );
      } finally {
        strategySpy.mockRestore();
      }
    });
  }, 30000);

  it('records a purge only for the executing facade on the same client and history', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      const sibling = await borrow();
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'base64',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
            },
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'url',
              data: 'https://example.test/image.png',
            },
          ],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const pathB = pathOf(sibling.session.getRecording());
      expect(pathA).not.toBe(pathB);
      await drain(agent.stream('purge A'));
      const a = await readFile(pathA, 'utf8');
      const b = await readFile(pathB, 'utf8');
      expect(a).toContain('"type":"semantic_media_purge"');
      expect(b).not.toContain('"type":"semantic_media_purge"');
      await sibling.setHistory([
        {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'base64',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
            },
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'url',
              data: 'https://example.test/image.png',
            },
          ],
        },
      ]);
      await drain(sibling.stream('purge B'));
      expect(await readFile(pathB, 'utf8')).toContain(
        '"type":"semantic_media_purge"',
      );
      expect(
        (await readFile(pathA, 'utf8')).match(/"type":"semantic_media_purge"/g),
      ).toHaveLength(1);
    });
  }, 30000);

  it('does not persist a non-recording facade purge into the sibling recorder', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      const sibling = await borrow();
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'base64',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
            },
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'url',
              data: 'https://example.test/image.png',
            },
          ],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      await drain(sibling.stream('non-recording B'));
      expect(await readFile(pathA, 'utf8')).not.toContain(
        '"type":"semantic_media_purge"',
      );
      expect(sibling.session.getRecording().enabled).toBe(false);
    });
  }, 30000);

  it('uses the executing facade recorder after a profile candidate adopts live history', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow, config }) => {
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      const sibling = await borrow();
      const replacement = new FakeProvider(
        fileURLToPath(
          new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
        ),
        config.getTargetDir(),
      );
      replacement.name = 'replacement';
      agent.providerManager.registerProvider(replacement);
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'base64',
              data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
            },
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'url',
              data: 'https://example.test/image.png',
            },
          ],
        },
      ]);
      await agent.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await sibling.session.setRecording({ enabled: true });
      const pathB = pathOf(sibling.session.getRecording());
      const profile: Profile = {
        version: 1,
        provider: 'replacement',
        model: 'candidate',
        modelParams: {},
        ephemeralSettings: { 'media.semantic-purge': 'remove' },
      };
      await agent.profiles.applySnapshot(profile);
      expect(agent.getProvider()).toBe('replacement');
      await drain(agent.stream('purge A after rebind'));
      expect(await readFile(pathA, 'utf8')).toContain(
        '"type":"semantic_media_purge"',
      );
      expect(await readFile(pathB, 'utf8')).not.toContain(
        '"type":"semantic_media_purge"',
      );
    });
  }, 30000);
});
