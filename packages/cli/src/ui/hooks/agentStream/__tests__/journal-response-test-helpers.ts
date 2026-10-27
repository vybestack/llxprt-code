/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type {
  ContentMetadata,
  EmojiFilterMode,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../../types.js';
import { NativeJournalCursor } from '../../../stores/turn/native-journal-cursor.js';
import { withJournalTurn } from '../../../stores/turn/journal-turn-test-helpers.js';

type History = NonNullable<
  ReturnType<Agent['agentClient']['getHistoryService']>
>;
export type Arrival = Awaited<ReturnType<History['openResponseArrival']>>;

export interface JournalResponseFixture {
  readonly history: History;
  open(id: string): Promise<Arrival>;
  items(mode?: EmojiFilterMode): Promise<HistoryItem[]>;
}

export async function withJournalResponse(
  run: (fixture: JournalResponseFixture) => Promise<void>,
): Promise<void> {
  await withJournalTurn(async (_turn, agent) => {
    const history = agent.agentClient.getHistoryService();
    if (history === null) throw new Error('Missing response journal');
    await run({
      history,
      open: (id) => history.openResponseArrival({ id, submissionId: 'prompt' }),
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
  });
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
