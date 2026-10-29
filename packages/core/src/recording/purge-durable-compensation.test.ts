/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { SemanticMediaPurgeStreamCoordinator } from '../services/history/semantic-purge-stream.js';
import { withCoreSuffixFixture } from '../services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { ownerFixtureRow } from '../services/history/chronology-rollback-owner-test-helpers.js';
import { RowOwnership } from './rowOwnership.js';
import type { IContent } from '../services/history/IContent.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import type { JournalSession } from '../services/history/journalSession.js';
import { readOnlyJournalRows } from './__tests__/support/read-only-journal-rows.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { recordingConfig } from './__tests__/support/journalRecordingFixture.js';

class StreamOnlyHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'materialize trap');
  }
}

describe('journal materialization guard', () => {
  it('StreamOnlyHistory rejects native eager materialization', async () => {
    const history = new StreamOnlyHistory();
    try {
      const journal: unknown = Reflect.get(history, 'journal');
      if (typeof journal !== 'object' || journal === null)
        throw new Error('Missing journal');
      const materialize: unknown = Reflect.get(journal, 'materialize');
      if (typeof materialize !== 'function')
        throw new Error('Missing materializer');
      await expect(materialize.call(journal)).rejects.toThrow(
        'materialize trap',
      );
    } finally {
      await history.dispose();
    }
  });
});
function imageRow(index: number, bytes: number): IContent {
  const row = ownerFixtureRow(index, bytes);
  return {
    ...row,
    blocks: row.blocks.map((block) =>
      block.type === 'media'
        ? { ...block, mimeType: 'image/png', caption: `caption-${index}` }
        : block,
    ),
  };
}

async function assertReopened(file: string, size: number): Promise<void> {
  let count = 0;
  for await (const row of readOnlyJournalRows(file))
    expect(row.content).toStrictEqual(imageRow(count++, 2048));
  expect(count).toBe(size);
}
async function verifyCancellation(
  history: HistoryService,
  durable: JournalSession,
  recording: JournalRecordingService,
  owners: RowOwnership,
  size: number,
): Promise<void> {
  const controller = new AbortController();
  const failure = new Error('cancel after durable append');
  let writes = 0;
  const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
    enabled: true,
    explicitCacheWriteRequired: false,
    ownership: owners,
    persist: async (source) => {
      async function* rows(): AsyncGenerator<
        ReturnType<typeof encodeContentRow>
      > {
        for await (const content of source.streamRows())
          yield encodeContentRow(content, { owner: 0 });
      }
      await durable.store.commit([{ kind: 'replace', rows: rows() }]);
      if (++writes === 1) controller.abort(failure);
    },
  });
  const transaction = await coordinator.begin({ mode: 'remove' });
  if (transaction === undefined) throw new Error('Missing transaction');
  try {
    await expect(
      coordinator.commit(
        transaction,
        { status: 'success', cachePrefixWritten: true },
        controller.signal,
      ),
    ).rejects.toBe(failure);
    expect(writes).toBe(2);
    let index = 0;
    for await (const content of history.streamRawHistory())
      expect(content).toStrictEqual(imageRow(index++, 2048));
    expect(index).toBe(size);
    const file = recording.getFilePath();
    if (file === null) throw new Error('Missing journal');
    await assertReopened(file, size);
  } finally {
    await transaction.close();
  }
}

describe('journal purge durable compensation after acknowledged persistence', () => {
  const directory = useTempDir('purge-compensation-');
  for (const size of [512, 8192]) {
    it(`restores all ${size} rows in live and reopened membership after cancellation without eager access`, async () => {
      const owners = new RowOwnership();
      const recording = JournalRecordingService.create(
        recordingConfig(directory()),
      );
      try {
        const durable = await recording.session();
        await withCoreSuffixFixture(
          size,
          (history) =>
            verifyCancellation(history, durable, recording, owners, size),
          2048,
          imageRow,
          owners,
          (options) => new StreamOnlyHistory(options),
        );
        expect(owners.snapshot().liveRows).toBe(0);
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
      } finally {
        await recording.dispose();
      }
    }, 300_000);
  }
});
