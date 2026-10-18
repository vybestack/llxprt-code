/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { historyOriginId } from '../services/history/historyOriginId.js';
import { JournalHistoryStore } from '../services/history/journalHistoryStore.js';
import { JournalSession } from '../services/history/journalSession.js';
import { useBackendEnv } from './__tests__/support/backendEnv.js';
import { chatsDirIn, userRow } from './__tests__/support/recordedJournals.js';
import {
  forkCheckpoint,
  ownedRows,
  primaryRows,
  useForkProof,
} from './__tests__/support/forkProof.js';

describe('late recorder and checkpoint fork use current row ownership', () => {
  const directory = useTempDir('fork-late-ownership-');
  const setBackend = useBackendEnv();
  const proof = useForkProof();

  it('persists the accepted primary subset after rows move into and out of its origin', async () => {
    setBackend('journal');
    const chats = chatsDirIn(directory());
    const history = proof.history();
    const a = {};
    const b = {};
    const first = proof.recorder(chats, 'a');
    const late = proof.recorder(chats, 'b');
    await history.attachJournal(first, false, undefined, a);
    const seeds = [
      ['into-b', a],
      ['out-of-b', b],
      ['becomes-shared', a],
      ['shared-into-b', undefined],
      ['shared', undefined],
      ['stays-b', b],
      ['stays-a', a],
    ] as const;
    for (const [text, origin] of seeds)
      history.add(userRow(text), undefined, origin);
    await history.waitForCommit();
    const before = await primaryRows(history);
    const store = history.detachedValues.host().journal;
    if (!(store instanceof JournalHistoryStore))
      throw new Error('Expected journal store');
    store.changeOwnersOf([
      { position: 0, origin: historyOriginId(b) },
      { position: 1, origin: historyOriginId(a) },
      { position: 2, origin: undefined },
      { position: 3, origin: historyOriginId(b) },
    ]);
    await history.waitForCommit();
    const primary = await primaryRows(history);
    expect(primary.map(({ content }) => content)).toStrictEqual(
      before.map(({ content }) => content),
    );
    expect(primary.map(({ origin }) => origin)).toStrictEqual([
      historyOriginId(b),
      historyOriginId(a),
      undefined,
      historyOriginId(b),
      undefined,
      historyOriginId(b),
      historyOriginId(a),
    ]);
    const expected = primary.filter(
      ({ origin }) => origin === undefined || origin === historyOriginId(b),
    );

    await history.attachJournal(late, false, undefined, b);
    await history.waitForCommit();
    expect(await ownedRows(await late.session())).toStrictEqual(expected);
    await late.createCheckpoint('late-owners');
    history.add(userRow('after-checkpoint'), undefined, b);
    await history.waitForCommit();
    await history.detachJournal(late);
    const sourcePath = late.getFilePath();
    if (sourcePath === null) throw new Error('Missing late recorder file');
    await late.dispose();
    const persisted = await JournalSession.open(sourcePath, {
      journal: undefined,
    });
    try {
      expect(
        (await ownedRows(persisted)).slice(0, expected.length),
      ).toStrictEqual(expected);
      expect(persisted.store.published?.rows).toBe(expected.length + 1);
    } finally {
      await persisted.close();
    }

    const result = await forkCheckpoint(chats, 'late-owners');
    proof.keep(result.recording);
    expect(await Array.fromAsync(result.boot.streamRows())).toStrictEqual(
      expected.map(({ content }) => content),
    );
    const childPath = result.recording.getFilePath();
    if (childPath === null) throw new Error('Missing child file');
    await result.recording.dispose();
    const child = await JournalSession.open(childPath);
    try {
      expect(await ownedRows(child)).toStrictEqual(expected);
    } finally {
      await child.close();
    }
  });
});
