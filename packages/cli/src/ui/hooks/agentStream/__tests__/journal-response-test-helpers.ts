/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionRecorder } from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  ContentMetadata,
  EmojiFilterMode,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../../types.js';
import { NativeJournalCursor } from '../../../stores/turn/native-journal-cursor.js';

type History = HistoryService;
export type Arrival = Awaited<ReturnType<History['openResponseArrival']>>;

export interface JournalResponseFixture {
  readonly history: History;
  open(id: string): Promise<Arrival>;
  items(mode?: EmojiFilterMode): Promise<HistoryItem[]>;
}

export async function withJournalResponse(
  run: (fixture: JournalResponseFixture) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'journal-response-test-'));
  const recording = createSessionRecorder({
    chatsDir: directory,
    projectHash: 'journal-response-test',
    sessionId: crypto.randomUUID(),
    workspaceDirs: [directory],
    provider: 'test',
    model: 'test',
  });
  const history = new HistoryService();
  const origin = {};
  await history.attachJournal(recording, true, undefined, origin);
  try {
    await run({
      history,
      open: (id) =>
        history.openResponseArrival({ id, submissionId: 'prompt' }, {}, origin),
      items: async (mode = 'allowed') => {
        await history.waitForCommit();
        const path = history.journalPath();
        if (path === null) throw new Error('Missing response journal path');
        const cursor = await NativeJournalCursor.open(
          path,
          { emojiFilterMode: mode },
          64,
        );
        try {
          return (await cursor.pageBack(64)).entries
            .flatMap((entry) =>
              entry.kind === 'projected' ? [entry.item] : [],
            )
            .reverse();
        } finally {
          await cursor.close();
        }
      },
    });
  } finally {
    await history.dispose();
    await recording.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

export async function sealText(
  fixture: JournalResponseFixture,
  id: string,
  deltas: readonly string[],
  metadata: ContentMetadata = {},
): Promise<void> {
  const arrival = await fixture.open(id);
  for (const text of deltas) await arrival.append({ type: 'text', text });
  await arrival.seal(metadata);
}

export function renderedOrder(items: readonly HistoryItem[]): string[] {
  return items.flatMap((item) =>
    item.type === 'gemini'
      ? [
          ...(item.thinkingBlocks ?? []).map(
            (block) => `thinking:${block.thought}`,
          ),
          ...(item.text === '' ? [] : [`text:${item.text}`]),
        ]
      : [],
  );
}
