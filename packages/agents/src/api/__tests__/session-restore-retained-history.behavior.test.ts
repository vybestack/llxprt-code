/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

function row(text: string, speaker: IContent['speaker']): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

async function texts(source: AsyncIterable<IContent>): Promise<string[]> {
  const result: string[] = [];
  for await (const content of source)
    for (const block of content.blocks)
      if (block.type === 'text') result.push(block.text);
  return result;
}

describe('owner restore retained history', () => {
  for (const recordingBeforeSeed of [false, true]) {
    it(`keeps the first turn when recording starts before seed ${recordingBeforeSeed}`, async () => {
      await withRecordingLifetimeFixture(async ({ agent }) => {
        if (recordingBeforeSeed)
          await agent.session.setRecording({ enabled: true });
        await agent.setHistory([
          row('first', 'human'),
          row('one', 'ai'),
          row('second', 'human'),
          row('two', 'ai'),
        ]);
        if (!recordingBeforeSeed)
          await agent.session.setRecording({ enabled: true });
        const restored = await agent.session.restoreTurns(1);
        expect(restored.itemsRemoved).toBe(2);
        expect(await texts(restored.remainingHistory)).toStrictEqual([
          'first',
          'one',
        ]);
        expect(await texts(agent.streamHistory())).toStrictEqual([
          'first',
          'one',
        ]);
      });
    });
  }
});
