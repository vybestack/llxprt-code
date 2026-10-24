/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '../../debug/index.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';
import { storedTokenUsageFacts } from './token-usage-facts.js';

describe('request-scoped token usage preparation', () => {
  const directory = useTempDir('deferred-token-facts-');

  it('does not measure shell-only history before a provider request needs usage', async () => {
    let calls = 0;
    const session = await JournalSession.createUnlinked({
      tokenUsageCountTokens: (text) => {
        calls++;
        return text.length;
      },
    });
    try {
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'shell output' }] },
      ]);
      expect(calls).toBe(0);
      expect(session.store.enableNeutralRowFacts()).toBe(true);
      await session.store.commit([{ kind: 'append', rows: [] }]);
      expect(calls).toBe(1);
      const snapshot = await session.store.snapshot();
      try {
        const entry = await snapshot.entryAt(0);
        const facts = await storedTokenUsageFacts(snapshot, entry.label);
        expect(facts[0].measurement.tokens).toBe('shell output'.length);
      } finally {
        await snapshot.close();
      }
      expect(session.store.enableNeutralRowFacts()).toBe(false);
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'next turn' }] },
      ]);
      expect(calls).toBe(2);
    } finally {
      await session.close();
    }
  });

  it('rebuilds facts after an unmeasured append to a resumed journal', async () => {
    const path = directory() + '/session.llxj';
    const countTokens = (text: string): number => text.length;
    const original = await JournalSession.create(path, {
      tokenUsageCountTokens: countTokens,
      eagerTokenUsageFacts: true,
    });
    try {
      await original.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] },
      ]);
    } finally {
      await original.close();
    }
    const session = await JournalSession.open(path, {
      tokenUsageCountTokens: countTokens,
    });
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text: 'second' }] },
    ]);
    const store = new JournalHistoryStore(session);
    try {
      const request = await store.prepareCurated({
        tail: [],
        options: {},
        logger: new DebugLogger('deferred-facts-test'),
        isCompressing: false,
      });
      try {
        const indexed = request.native?.indexed;
        if (indexed === undefined) throw new Error('Expected native request');
        const tokens: number[] = [];
        for await (const fact of indexed.openTokenUsageReader(() => {
          throw new Error('Prepared facts must already be persisted');
        }))
          tokens.push(fact.measurement.tokens);
        expect(tokens).toStrictEqual([5, 6]);
      } finally {
        await request.close();
      }
    } finally {
      await store.dispose();
    }
  });
});
