/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { OwnerDictionary } from '../../journal/ownerDictionary.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { DetachedHistoryHost } from './detachedHistoryMutation.js';
import { ChronologyStamper } from './historyChronology.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

/** A row of the seed and the origin that owns it; undefined is unowned. */
export interface SeedRow {
  readonly content: IContent;
  readonly origin?: string;
}

export interface OwnedJournal {
  readonly store: JournalHistoryStore;
  readonly session: JournalSession;
  readonly host: DetachedHistoryHost;
  /** The origin that owns each row, in order; undefined for an unowned row. */
  originsOfRows(): Promise<Array<string | undefined>>;
  dispose(): Promise<void>;
}

/** A detached host over a journal store seeded with `seed`, with an optional media owner. */
export async function openOwnedJournal(
  file: string,
  seed: readonly SeedRow[],
  extras: {
    readonly mediaOwner?: HistoryMediaOwner;
    readonly ownership?: RowOwnership;
  } = {},
): Promise<OwnedJournal> {
  const session = await JournalSession.create(file);
  const store = new JournalHistoryStore(session);
  const stamper = new ChronologyStamper(() => 0);
  for (const { content, origin } of seed) {
    stamper.stamp(content);
    store.apply({ kind: 'content', content, origin });
  }
  await store.waitForDurable();
  let tokens = 0;
  const host: DetachedHistoryHost = {
    // The journal path never reads it; the old store's port is a placeholder.
    journal: new HistoryJournalStore(),
    chronology: stamper,
    ...extras,
    snapshot: () => ({ tokens, spans: [], chronology: stamper.snapshot() }),
    apply: (applied) => {
      tokens = applied;
    },
    waitForTokenUpdates: () => Promise.resolve(),
    estimate: (rows) => Promise.resolve([...rows].length),
    notify: () => {},
    notifyBatch: () => {},
    notifyRows: () => {},
    notifyTokens: () => {},
    notifyRange: () => {},
  };
  return {
    store,
    session,
    host,
    originsOfRows: async () => {
      const snapshot = await session.store.snapshot();
      try {
        const dictionary = await OwnerDictionary.load(session.store);
        const origins: Array<string | undefined> = [];
        for await (const entry of snapshot.entries()) {
          origins.push(
            entry.owner === 0 ? undefined : dictionary.originOf(entry.owner),
          );
        }
        return origins;
      } finally {
        snapshot.close();
      }
    },
    dispose: () => store.dispose(),
  };
}
