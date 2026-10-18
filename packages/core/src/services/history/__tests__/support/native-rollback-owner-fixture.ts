/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectJournalFileRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { HistoryMediaOwnership } from '../../../../storage/history-media-ownership.js';
import { LocalMediaStore } from '../../../../storage/local-media-store.js';
import { RowOwnership } from '../../../../recording/rowOwnership.js';
import type { HistoryMediaOwner } from '../../historyBatchContracts.js';
import type { IContent, MediaReferenceBlock } from '../../IContent.js';
import {
  exactTokenizer,
  rejectedValue,
} from '../../chronology-rollback-test-helpers.js';
import { ownerFixtureRow } from '../../chronology-rollback-owner-test-helpers.js';
import { batchGate } from './addbatch-stream-test-helpers.js';
import { createCoreSuffixFixtureGraph } from './core-suffix-fixture-test-helpers.js';

type ReferenceInput = Parameters<
  NonNullable<HistoryMediaOwner['prepareReferenceReplacement']>
>[0];

class PausedMediaOwner extends HistoryMediaOwnership {
  readonly ready = batchGate();
  readonly release = batchGate();
  readonly failure = new Error('native rollback publication failure');
  paused = false;

  override prepareReferenceReplacement(
    references: ReferenceInput,
    ownership?: RowOwnership,
  ): ReturnType<HistoryMediaOwnership['prepareReferenceReplacement']> {
    const effect = super.prepareReferenceReplacement(references, ownership);
    if (!this.paused) return effect;
    this.paused = false;
    return {
      ...effect,
      publish: async (): Promise<void> => {
        await effect.publish();
        this.ready.resolve();
        await this.release.promise;
        throw this.failure;
      },
    };
  }
}

interface NativeOwnerResult {
  readonly previous: ReturnType<RowOwnership['snapshot']>;
  readonly transaction: ReturnType<RowOwnership['snapshot']>;
  readonly traversed: number;
  readonly bytes: number;
}

export async function pausedNativeRollback(
  size: number,
  trap: boolean,
  kind: 'density' | 'transform',
): Promise<NativeOwnerResult> {
  const directory = mkdtempSync(join(tmpdir(), 'native-rollback-owner-'));
  const store = new LocalMediaStore({
    rootDirectory: join(directory, 'media'),
    quotaBytes: 1024,
  });
  try {
    const references = await Promise.all(
      [1, 2, 3].map((byte) =>
        store.admit({
          bytes: new Uint8Array([byte]),
          mimeType: 'application/octet-stream',
          semanticMetadata: {},
        }),
      ),
    );
    return await runRollback(directory, store, references, size, trap, kind);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function runRollback(
  directory: string,
  store: LocalMediaStore,
  references: readonly MediaReferenceBlock[],
  size: number,
  trap: boolean,
  kind: 'density' | 'transform',
): Promise<NativeOwnerResult> {
  const transaction = new RowOwnership();
  const graph = createCoreSuffixFixtureGraph(
    directory,
    transaction,
    undefined,
    'journal',
  );
  const { service: history, recording, ownership: previous } = graph;
  const rowAt = (index: number): IContent => {
    const row = ownerFixtureRow(index, 2048);
    if (index !== 0 && index !== size - 1) return row;
    return {
      ...row,
      blocks: [...row.blocks, references[index === 0 ? 0 : 1]],
    };
  };
  const owner = new PausedMediaOwner(store);
  try {
    await graph.seed(
      (function* (): Generator<IContent> {
        for (let index = 0; index < size; index++) yield rowAt(index);
      })(),
    );
    history.setTokenizerFactory(exactTokenizer());
    await history.registerMediaOwner(owner);
    await history.settleMediaOwnership();
    return await observeRollback({
      history,
      recording,
      previous,
      transaction,
      owner,
      store,
      references,
      rowAt,
      size,
      trap,
      kind,
    });
  } finally {
    owner.release.resolve();
    await history.dispose();
    await history.waitForOwnershipSettlement();
    await recording.dispose();
  }
}

interface ObservationInput {
  readonly history: ReturnType<typeof createCoreSuffixFixtureGraph>['service'];
  readonly recording: ReturnType<
    typeof createCoreSuffixFixtureGraph
  >['recording'];
  readonly previous: RowOwnership;
  readonly transaction: RowOwnership;
  readonly owner: PausedMediaOwner;
  readonly store: LocalMediaStore;
  readonly references: readonly MediaReferenceBlock[];
  readonly rowAt: (index: number) => IContent;
  readonly size: number;
  readonly trap: boolean;
  readonly kind: 'density' | 'transform';
}

function startReplacement(
  { history, kind, size }: ObservationInput,
  replacement: IContent,
): Promise<void> {
  if (kind === 'density')
    return history.applyDensityResult({
      replacements: new Map([[Math.floor(size / 2), replacement]]),
      removals: [size - 1],
      metadata: {
        readWritePairsPruned: 0,
        fileDeduplicationsPruned: 0,
        recencyPruned: 1,
      },
    });
  return history.detachedValues.transform(async (source, sink) => {
    let index = 0;
    for await (const row of source.streamRows()) {
      if (index === Math.floor(size / 2))
        await sink.appendReplacement(index, replacement);
      else if (index === size - 1) await sink.removeValue(index);
      else await sink.appendDerived(index, row);
      index++;
    }
    expect(index).toBe(size);
  });
}

async function observeRollback(
  input: ObservationInput,
): Promise<NativeOwnerResult> {
  const { history, transaction, owner, size, references } = input;
  const beforeTokens = history.getTotalTokens();
  const beforeRange = history.getContextRange();
  const replacement = {
    ...ownerFixtureRow(size, 2048),
    blocks: [...ownerFixtureRow(size, 2048).blocks, references[2]],
  };
  const prior = history.streamRawHistory();
  const first = await prior.next();
  transaction.retain(replacement);
  owner.paused = true;
  const operation = rejectedValue(startReplacement(input, replacement));
  const retained: IContent[] = [];
  try {
    await Promise.race([
      owner.ready.promise,
      operation.then((error) => {
        throw error ?? new Error('Native publication ended before pause');
      }),
    ]);
    const result = await inspectPrior(input, prior, first, retained);
    for (const reference of references)
      expect(await input.store.hasReservations(reference.contentId)).toBe(true);
    owner.release.resolve();
    expect(await operation).toBe(owner.failure);
    transaction.release(replacement);
    for (const row of retained) {
      input.previous.release(row);
      transaction.release(row);
    }
    retained.length = 0;
    expect(input.previous.snapshot().liveRows).toBe(0);
    expect(transaction.snapshot().liveRows).toBe(0);
    expect(history.getTotalTokens()).toBe(beforeTokens);
    expect(history.getContextRange()).toStrictEqual(beforeRange);
    expect(replacement.metadata?.chronology?.seq).toBe(size + 1);
    await verifyRestored(input);
    expect(await input.store.hasReservations(references[0].contentId)).toBe(
      true,
    );
    expect(await input.store.hasReservations(references[1].contentId)).toBe(
      true,
    );
    expect(await input.store.hasReservations(references[2].contentId)).toBe(
      false,
    );
    return result;
  } finally {
    owner.release.resolve();
    await prior.return();
    await operation;
  }
}

async function inspectPrior(
  input: ObservationInput,
  prior: AsyncGenerator<IContent, void, unknown>,
  first: IteratorResult<IContent, void>,
  retained: IContent[],
): Promise<NativeOwnerResult> {
  let next = first;
  let traversed = 0;
  let bytes = 0;
  while (next.done !== true) {
    expect(next.value).toStrictEqual(input.rowAt(traversed));
    traversed++;
    bytes += Buffer.byteLength(JSON.stringify(next.value));
    if (input.trap) {
      retained.push(next.value);
      input.previous.retain(next.value);
      input.transaction.retain(next.value);
    }
    next = await prior.next();
  }
  return {
    traversed,
    bytes,
    previous: input.previous.snapshot(),
    transaction: input.transaction.snapshot(),
  };
}

async function verifyRestored(input: ObservationInput): Promise<void> {
  const { history, recording, rowAt, size } = input;
  let restored = 0;
  for await (const row of history.streamRawHistory())
    expect(row).toStrictEqual(rowAt(restored++));
  expect(restored).toBe(size);
  await history.waitForCommit();
  const path = recording.getFilePath();
  if (path === null) throw new Error('Missing native mirror path');
  await collectJournalFileRowsForAssertions(path, (rows) => {
    expect(rows).toHaveLength(size);
    for (const [index, row] of rows.entries())
      expect(row).toStrictEqual(rowAt(index));
  });
}
