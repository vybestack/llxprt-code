/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { NativeJournalCursor } from './native-journal-cursor.js';
import type { HistoryItem } from '../../types.js';

async function readAiItems(
  history: HistoryService,
  attempts: ReadonlySet<string>,
): Promise<HistoryItem[]> {
  const path = history.journalPath();
  if (path === null) throw new Error('Missing journal path');
  const cursor = await NativeJournalCursor.open(
    path,
    { emojiFilterMode: 'allowed' },
    8,
  );
  try {
    return (await cursor.pageBack(8)).entries
      .flatMap((entry) =>
        entry.kind === 'projected' && attempts.has(entry.transcriptId)
          ? [entry.item]
          : [],
      )
      .reverse();
  } finally {
    await cursor.close();
  }
}

describe('native journal attempt visibility', () => {
  const directory = useTempDir('native-attempt-visibility-');
  it('hides superseded thinking and text while retaining earlier and replacement replies', async () => {
    const recording = createSessionRecorder({
      sessionId: 'attempt-visibility',
      projectHash: 'attempt-visibility',
      chatsDir: directory(),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    const history = new HistoryService();
    try {
      history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'question' }],
      });
      await history.attachJournal(recording, true);
      const first = await history.openResponseArrival({
        id: 'first',
        submissionId: 'one',
      });
      await first.append({ type: 'text', text: 'Earlier reply' });
      await first.seal({});
      const abandoned = await history.openResponseArrival({
        id: 'abandoned',
        submissionId: 'two',
      });
      await abandoned.append({
        type: 'thinking',
        thought: 'abandoned reasoning',
      });
      await abandoned.append({
        type: 'text',
        text: 'abandoned paragraph\n\ntail',
      });
      await abandoned.interrupt('superseded');
      const replacement = await history.openResponseArrival({
        id: 'replacement',
        submissionId: 'two',
      });
      await replacement.append({
        type: 'thinking',
        thought: 'Plan',
        streamId: 'replacement-thinking',
      });
      await replacement.seal({});
      await history.waitForCommit();
      const items = await readAiItems(
        history,
        new Set([
          first.identity.transcriptId,
          abandoned.identity.transcriptId,
          replacement.identity.transcriptId,
        ]),
      );
      {
        expect(items.map((item) => item.text)).toStrictEqual([
          'Earlier reply',
          '',
        ]);
        expect(
          items
            .flatMap((item) =>
              item.type === 'gemini' ? (item.thinkingBlocks ?? []) : [],
            )
            .map((block) => [block.thought, block.streamId]),
        ).toStrictEqual([['Plan', 'replacement-thinking']]);
        expect(
          new Set(items.map((item) => JSON.stringify(item.rowIdentity))).size,
        ).toBe(2);
      }
    } finally {
      await history.dispose();
      await recording.dispose();
    }
  });
});
