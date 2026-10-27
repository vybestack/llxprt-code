/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalSession, type IContent } from '@vybestack/llxprt-code-core';
import {
  createScrollbackPagerStore,
  type ScrollbackPagerStore,
} from './scrollbackPager.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { withRecordingLifetimeFixture } from '../../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import type { HistoryItemWithoutId } from '../../types.js';
export { readJournalItems } from './read-journal-items.js';
import { createTurnStore, type TurnStore } from './turnStore.js';
import { JournalDisplayWriter } from '@vybestack/llxprt-code-core/journal/display-recording.js';
import { encodeJournalUiItem } from './journal-ui-item.js';

export async function withJournalTurn(
  action: (turn: TurnStore, agent: Agent) => Promise<void>,
): Promise<void> {
  await withRecordingLifetimeFixture(async ({ agent }) => {
    await agent.session.setRecording({ enabled: true });
    const turn = createTurnStore();
    turn.commands.bindJournal(() => agent.agentClient.getHistoryService());
    await action(turn, agent);
  });
}

type JournalPagerFixture = ScrollbackPagerStore & {
  appendItem(item: HistoryItemWithoutId): Promise<void>;
};

export function registerJournalPagerFixture(): (
  rows: IContent[],
) => Promise<JournalPagerFixture> {
  const resources: Array<{ pager: ScrollbackPagerStore; directory: string }> =
    [];
  afterEach(async () => {
    for (const { pager, directory } of resources.splice(0)) {
      await pager.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  return async (rows) => {
    const directory = await mkdtemp(join(tmpdir(), 'journal-ui-test-'));
    const filePath = join(directory, 'session.llxj');
    const session = await JournalSession.create(filePath);
    try {
      await session.append(rows);
    } finally {
      await session.close();
    }
    const pager = createScrollbackPagerStore({
      filePath,
      pageRows: 8,
      viewport: { visibleKeys: [], viewportLines: 8, rowHeightLines: () => 1 },
      settings: { marginViewports: 0, byteFloorBytes: 256, purgeDebounceMs: 0 },
    });
    resources.push({ pager, directory });
    await pager.resumeFromJournal();
    return Object.assign(pager, {
      appendItem: async (item: HistoryItemWithoutId): Promise<void> => {
        const writer = await JournalSession.open(filePath);
        try {
          await new JournalDisplayWriter(writer.store).append(
            { type: 'ui-item' },
            encodeJournalUiItem(item),
          );
        } finally {
          await writer.close();
        }
        await pager.invalidate();
        await pager.resumeFromJournal();
      },
    });
  };
}
