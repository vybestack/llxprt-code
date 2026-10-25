/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { collectedWithin } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { JournalStore } from './journalStore.js';
import type { CommittedGroup } from './journal-store-state.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function appendTracked(store: JournalStore): Promise<{
  group: CommittedGroup;
  bytes: WeakRef<Uint8Array>;
}> {
  const draft = draftRow({ text: 'closed group payload'.repeat(1024) });
  return {
    group: await store.commitDetailed([{ kind: 'append', rows: [draft] }]),
    bytes: new WeakRef(draft.blocks[0].bytes),
  };
}

describe('committed group payload ownership', () => {
  const directory = useTempDir('journal-commit-payload-');

  it('keeps fanout payload until close and releases it while the closed group remains reachable', async () => {
    const store = await JournalStore.create(
      join(directory(), 'history.llxj'),
      storeDeps(),
    );
    try {
      const { group, bytes } = await appendTracked(store);
      expect(await collectedWithin(bytes)).toBe(false);
      expect(group.resolvedEdits).toHaveLength(1);
      await group.close();
      expect(await collectedWithin(bytes)).toBe(true);
      expect(group.after.rows).toBe(1);
      const entries = [];
      for await (const entry of store.rows()) entries.push(entry);
      const stored = await store.readRow(entries[0]);
      expect(new TextDecoder().decode(stored.blocks[0])).toBe(
        'closed group payload'.repeat(1024),
      );
    } finally {
      await store.close();
    }
  });
});
