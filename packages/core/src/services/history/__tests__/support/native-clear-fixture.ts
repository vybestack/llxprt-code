/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectJournalFileRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { HistoryService } from '../../HistoryService.js';
import { JournalSession } from '../../journalSession.js';
import { batchGate } from './addbatch-stream-test-helpers.js';
import { exactTokenizer } from '../../chronology-rollback-test-helpers.js';
import type { IContent } from '../../IContent.js';
import type { JournalOpenDependencies } from '../../../../journal/journalWriterOpen.js';
import { LocalMediaStore } from '../../../../storage/local-media-store.js';
import { HistoryMediaOwnership } from '../../../../storage/history-media-ownership.js';

export interface NativeClearFixture {
  readonly history: HistoryService;
  readonly waitForPausedWrite: Promise<void>;
  pauseWriter(): void;
  releaseWriter(): void;
  assertDurable(rows: readonly IContent[]): Promise<void>;
}

export async function withNativeClearFixture(
  action: (fixture: NativeClearFixture) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'native-compression-clear-'));
  const path = join(directory, 'primary.journal');
  const gate = batchGate();
  const entered = batchGate();
  let paused = false;
  const wait = async (): Promise<void> => {
    if (!paused) return;
    entered.resolve();
    await gate.promise;
  };
  const openHeld: JournalOpenDependencies['open'] = async (file, flags) => {
    const handle = await open(file, flags);
    return {
      fd: handle.fd,
      read: handle.read.bind(handle),
      stat: handle.stat.bind(handle),
      truncate: handle.truncate.bind(handle),
      close: handle.close.bind(handle),
      write: async (...args) => {
        await wait();
        return handle.write(...args);
      },
      writev: async (...args) => {
        await wait();
        return handle.writev(...args);
      },
    };
  };
  const opener = spyOn(JournalSession, 'createUnlinked').mockImplementation(
    () => JournalSession.create(path, { journal: { open: openHeld } }),
  );
  const history = new HistoryService({ backend: 'journal' });
  opener.mockRestore();
  history.setTokenizerFactory(exactTokenizer());
  try {
    await history.waitForCommit();
    await action({
      history,
      waitForPausedWrite: entered.promise,
      pauseWriter: () => {
        paused = true;
      },
      releaseWriter: () => gate.resolve(),
      assertDurable: (expected) =>
        collectJournalFileRowsForAssertions(path, (rows) => {
          expect(rows).toStrictEqual(expected);
        }),
    });
  } finally {
    gate.resolve();
    await history.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function withNativeClearMediaFixture(
  action: (
    fixture: NativeClearFixture,
    store: LocalMediaStore,
  ) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'native-clear-media-'));
  const store = new LocalMediaStore({
    rootDirectory: directory,
    quotaBytes: 1024,
  });
  try {
    await withNativeClearFixture(async (fixture) => {
      await fixture.history.registerMediaOwner(
        new HistoryMediaOwnership(store),
      );
      try {
        await action(fixture, store);
      } finally {
        await fixture.history.dispose();
        await fixture.history.waitForOwnershipSettlement();
      }
    });
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
