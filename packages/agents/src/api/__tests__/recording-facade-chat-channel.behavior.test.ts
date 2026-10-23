/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { drain } from './helpers/agentHarness.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { OneShotStrategy } from '../../compression/OneShotStrategy.js';
import { summaryOutput } from '../../compression/summaryOutput.js';
import {
  withNativeRecordingFixture,
  nativeRows,
  rowTexts,
} from './helpers/native-session-fixture.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function pathOf(state: { enabled: boolean; path?: string }): string {
  if (!state.enabled || state.path === undefined) {
    throw new Error('Expected a materialized recording');
  }
  return state.path;
}

function mediaSeed(): IContent {
  return {
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
  };
}

function compressionSeed(label: string): IContent[] {
  return ['human', 'ai', 'human', 'ai'].map((speaker, index) => ({
    speaker: speaker === 'human' ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `${label}-${index}` }],
  }));
}

async function expectNativePurge(
  path: string,
  ownTurn: string,
  foreignTurn: string,
): Promise<void> {
  const rows = await nativeRows(path);
  expect(rows[0].blocks).toStrictEqual([mediaSeed().blocks[1]]);
  expect(rowTexts(rows)).toContain(ownTurn);
  expect(rowTexts(rows)).not.toContain(foreignTurn);
}

describe('native facade recording chat execution on a borrowed client', () => {
  it('commits compression to its executing recorder across stop and resume', async () => {
    await withNativeRecordingFixture(async ({ agent, borrow }) => {
      const sibling = await borrow();
      const seenPaths: Array<string | undefined> = [];
      const strategy = spyOn(
        OneShotStrategy.prototype,
        'prepareDisk',
      ).mockImplementation(async (context) => {
        seenPaths.push(context.transcriptPath);
        return summaryOutput(context.history, 0, context.history.length, [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: `summary-path:${context.transcriptPath ?? 'absent'}`,
              },
            ],
          },
        ]);
      });
      try {
        await agent.setHistory(compressionSeed('A'));
        await agent.session.setRecording({ enabled: true });
        const pathA = pathOf(agent.session.getRecording());
        const sessionA = agent.session.getSessionId();
        await sibling.session.setRecording({ enabled: true });
        const pathB = pathOf(sibling.session.getRecording());
        expect(pathB).not.toBe(pathA);
        await agent.compress({ promptId: 'native-compress-A' });
        await agent.session.flushRecording();
        expect(rowTexts(await nativeRows(pathA))).toContain(
          `summary-path:${pathA}`,
        );
        expect(rowTexts(await nativeRows(pathB))).not.toContain(
          `summary-path:${pathA}`,
        );
        await agent.session.setRecording({ enabled: false });
        const closedA = await readFile(pathA);
        await agent.setHistory(compressionSeed('stopped-A'));
        await agent.compress({ promptId: 'native-compress-stopped' });
        expect(seenPaths[seenPaths.length - 1]).toBeUndefined();
        await sibling.setHistory(compressionSeed('B'));
        await sibling.compress({ promptId: 'native-compress-B' });
        await sibling.session.flushRecording();
        expect(seenPaths[seenPaths.length - 1]).toBe(pathB);
        expect(rowTexts(await nativeRows(pathB))).toContain(
          `summary-path:${pathB}`,
        );
        expect(Buffer.compare(await readFile(pathA), closedA)).toBe(0);
        await agent.session.resume(sessionA);
        await agent.setHistory(compressionSeed('resumed-A'));
        await agent.compress({ promptId: 'native-compress-resumed' });
        expect(seenPaths[seenPaths.length - 1]).toBe(pathA);
        await agent.session.setRecording({ enabled: false });
        expect(rowTexts(await nativeRows(pathA))).toContain(
          `summary-path:${pathA}`,
        );
        expect(rowTexts(await nativeRows(pathB))).not.toContain(
          `summary-path:${pathA}`,
        );
      } finally {
        strategy.mockRestore();
      }
    });
  }, 30000);

  it('commits shared unowned media changes while keeping each facade turn in its own file', async () => {
    await withNativeRecordingFixture(async ({ agent, borrow }) => {
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      const sibling = await borrow();
      await agent.setHistory([mediaSeed()]);
      await agent.session.setRecording({ enabled: true });
      await sibling.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      const pathB = pathOf(sibling.session.getRecording());
      expect(pathA).not.toBe(pathB);
      expect((await nativeRows(pathA))[0].blocks).toHaveLength(2);
      expect(await nativeRows(pathB)).toStrictEqual(await nativeRows(pathA));
      const eventsA = await drain(agent.stream('native-purge-A'));
      expect(eventsA.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      await agent.session.flushRecording();
      await sibling.session.flushRecording();
      await expectNativePurge(pathA, 'native-purge-A', 'native-purge-B');
      expect(rowTexts(await nativeRows(pathB))).toStrictEqual(['']);
      expect((await nativeRows(pathB))[0].blocks).toStrictEqual([
        mediaSeed().blocks[1],
      ]);
      await sibling.setHistory([mediaSeed()]);
      const eventsB = await drain(sibling.stream('native-purge-B'));
      expect(eventsB.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      await agent.session.setRecording({ enabled: false });
      await sibling.session.setRecording({ enabled: false });
      await expectNativePurge(pathB, 'native-purge-B', 'native-purge-A');
      expect(rowTexts(await nativeRows(pathA))).toStrictEqual(['']);
      expect((await nativeRows(pathA))[0].blocks).toStrictEqual([
        mediaSeed().blocks[1],
      ]);
    });
  }, 30000);

  it('rejects an unrecorded facade purge without changing live media or its sibling file', async () => {
    await withNativeRecordingFixture(async ({ agent, borrow }) => {
      agent.setEphemeralSetting('media.semantic-purge', 'remove');
      const sibling = await borrow();
      await agent.setHistory([mediaSeed()]);
      await agent.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      const before = await nativeRows(pathA);
      const liveBefore = await Array.fromAsync(sibling.streamHistory());
      const events = await drain(sibling.stream('native-unrecorded-B'));
      expect(events.filter((event) => event.type === 'error')).toMatchObject([
        { type: 'error', error: { message: 'No active recording' } },
      ]);
      expect(sibling.session.getRecording().enabled).toBe(false);
      expect((await Array.fromAsync(sibling.streamHistory()))[0]).toStrictEqual(
        liveBefore[0],
      );
      await agent.session.setRecording({ enabled: false });
      expect(isDeepStrictEqual(await nativeRows(pathA), before)).toBe(true);
      expect(rowTexts(await nativeRows(pathA))).not.toContain(
        'native-unrecorded-B',
      );
    });
  }, 30000);

  it('moves the executing recorder to its profile client without purging or appending to its borrowed sibling', async () => {
    await withNativeRecordingFixture(async ({ agent, borrow, config }) => {
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
      await agent.setHistory([mediaSeed()]);
      await agent.session.setRecording({ enabled: true });
      await sibling.session.setRecording({ enabled: true });
      const pathA = pathOf(agent.session.getRecording());
      const pathB = pathOf(sibling.session.getRecording());
      const siblingBefore = await nativeRows(pathB);
      await agent.profiles.applySnapshot({
        version: 1,
        provider: 'replacement',
        model: 'candidate',
        modelParams: {},
        ephemeralSettings: { 'media.semantic-purge': 'remove' },
      });
      expect(agent.getProvider()).toBe('replacement');
      const events = await drain(agent.stream('native-purge-after-profile-A'));
      expect(events.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      expect(agent.session.getRecording().path).toBe(pathA);
      expect(sibling.session.getRecording().path).toBe(pathB);
      await agent.session.setRecording({ enabled: false });
      await sibling.session.setRecording({ enabled: false });
      await expectNativePurge(
        pathA,
        'native-purge-after-profile-A',
        'native-profile-sibling-B',
      );
      expect(isDeepStrictEqual(await nativeRows(pathB), siblingBefore)).toBe(
        true,
      );
      expect(
        (await Array.fromAsync(agent.streamHistory()))[0].blocks,
      ).toStrictEqual([mediaSeed().blocks[1]]);
    });
  }, 30000);
});
