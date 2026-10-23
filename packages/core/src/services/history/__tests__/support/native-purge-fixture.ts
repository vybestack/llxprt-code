/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectJournalFileRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { createRecorderForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { expect, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RowOwnership } from '../../../../recording/rowOwnership.js';
import { HistoryMediaOwnership } from '../../../../storage/history-media-ownership.js';
import { LocalMediaStore } from '../../../../storage/local-media-store.js';
import { HistoryService } from '../../HistoryService.js';
import { JournalSession } from '../../journalSession.js';

import { exactTokenizer } from '../../chronology-rollback-test-helpers.js';
import type { HistoryMediaOwner } from '../../historyBatchContracts.js';
import { historyMutationFailure } from '../../historyMutationEffects.js';
import type { IContent } from '../../IContent.js';

type ReferenceSource = Parameters<
  NonNullable<HistoryMediaOwner['prepareReferenceReplacement']>
>[0];

export class PurgeReleaseStore extends LocalMediaStore {
  rejectedId: string | undefined;
  readonly releaseFailure = new Error('purge rollback release failed');

  override async release(contentId: string, ownerId: string): Promise<void> {
    if (contentId === this.rejectedId) {
      this.rejectedId = undefined;
      throw this.releaseFailure;
    }
    await super.release(contentId, ownerId);
  }
}

export class PurgePublicationOwner extends HistoryMediaOwnership {
  rejectPublication = false;
  readonly failure = new Error('purge media publication failed');

  override prepareReferenceReplacement(
    references: ReferenceSource,
    ownership?: RowOwnership,
  ): ReturnType<HistoryMediaOwnership['prepareReferenceReplacement']> {
    const effect = super.prepareReferenceReplacement(references, ownership);
    if (!this.rejectPublication) return effect;
    this.rejectPublication = false;
    return {
      ...effect,
      publish: async (): Promise<void> => {
        await effect.publish();
        throw this.failure;
      },
    };
  }
}

interface NativePurgeFixture {
  readonly session: JournalSession;
  readonly history: HistoryService;
  readonly store: PurgeReleaseStore;
  readonly owner: PurgePublicationOwner;
  readonly owners: RowOwnership;
  assertDurable(expected: readonly IContent[]): Promise<void>;
}

export async function withNativePurgeFixture(
  action: (fixture: NativePurgeFixture) => Promise<void>,
  origin?: object,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'native-purge-'));
  const primary = join(root, 'primary.llxj');
  const session = await JournalSession.create(primary);
  const opener = spyOn(JournalSession, 'createUnlinked').mockResolvedValue(
    session,
  );
  const owners = new RowOwnership();
  const history = new HistoryService({
    mutationOwnership: owners,
  });
  opener.mockRestore();
  const recording = createRecorderForTest({
    sessionId: 'purge-owner',
    projectHash: 'purge',
    chatsDir: root,
  });
  const store = new PurgeReleaseStore({
    rootDirectory: join(root, 'media'),
    quotaBytes: 1024,
  });
  const owner = new PurgePublicationOwner(store);
  const failures: unknown[] = [];
  try {
    history.setTokenizerFactory(exactTokenizer());
    await history.attachJournal(recording, true, undefined, origin);
    await history.registerMediaOwner(owner);
    await action({
      session,
      history,
      store,
      owner,
      owners,
      assertDurable: async (expected): Promise<void> => {
        await history.waitForCommit();
        for (const path of [primary, recording.getFilePath()]) {
          if (path === null) throw new Error('Missing persisted journal');
          await collectJournalFileRowsForAssertions(path, (rows) => {
            expect(rows).toStrictEqual(expected);
            expect(JSON.stringify(rows)).toBe(JSON.stringify(expected));
          });
        }
      },
    });
  } catch (error) {
    failures.push(error);
  }
  for (const close of [
    () => owner.releaseAll(),
    () => history.dispose(),
    () => history.waitForOwnershipSettlement(),
    () => recording.dispose(),
    () => store.close(),
    () => rmSync(root, { recursive: true, force: true }),
  ]) {
    try {
      await Promise.resolve(close());
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw historyMutationFailure(failures[0], failures.slice(1));
}
