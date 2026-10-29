/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { batchGate } from '../../../../../core/src/services/history/__tests__/support/addbatch-stream-test-helpers.js';
import { createCoreSuffixFixtureGraph } from '../../../../../core/src/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import {
  HighdensityDiskHistory,
  highdensityOracle,
  highdensityRow,
  highdensitySetup,
} from '../highdensity-disk-helpers.js';
import { nativeFileRows } from './native-file-rows.js';

class CountedMediaOwner extends HistoryMediaOwnership {
  constructor(
    store: LocalMediaStore,
    private readonly census: RowOwnership,
  ) {
    super(store);
  }

  override prepareReferenceReplacement(
    references: Parameters<
      HistoryMediaOwnership['prepareReferenceReplacement']
    >[0],
  ): ReturnType<HistoryMediaOwnership['prepareReferenceReplacement']> {
    return super.prepareReferenceReplacement(references, this.census);
  }
}

class PublicationMediaStore extends LocalMediaStore {
  readonly ready = batchGate();
  readonly resume = batchGate();
  readonly failure = new Error('paused native high-density publication');
  rejecting = false;
  releasing = false;
  readonly releaseReady = batchGate();
  readonly releaseResume = batchGate();

  override async release(
    ...args: Parameters<LocalMediaStore['release']>
  ): Promise<void> {
    if (this.releasing) {
      this.releasing = false;
      this.releaseReady.resolve();
      await this.releaseResume.promise;
    }
    await super.release(...args);
  }

  override async reserve(
    ...args: Parameters<LocalMediaStore['reserve']>
  ): Promise<void> {
    await super.reserve(...args);
    if (!this.rejecting) return;
    this.rejecting = false;
    this.ready.resolve();
    await this.resume.promise;
    throw this.failure;
  }
}

async function persisted(
  path: string,
  expected: readonly IContent[],
): Promise<void> {
  let count = 0;
  for await (const content of nativeFileRows(path))
    expect(content).toStrictEqual(expected[count++]);
  expect(count).toBe(expected.length);
}

interface PublicationFixture {
  readonly size: number;
  readonly graph: ReturnType<typeof createCoreSuffixFixtureGraph>;
  readonly transaction: RowOwnership;
  readonly media: PublicationMediaStore;
  readonly rowAt: (index: number) => IContent;
  readonly contentId: string;
}

async function inspectPrior(
  input: PublicationFixture,
  prior: AsyncGenerator<IContent, void, unknown>,
  first: IteratorResult<IContent, void>,
  retained: IContent[],
  trap: boolean,
): Promise<void> {
  const source = input.graph.ownership;
  let next = first;
  let count = 0;
  while (next.done !== true) {
    source.retain(next.value);
    expect(next.value).toStrictEqual(input.rowAt(count++));
    if (trap) retained.push(next.value);
    else source.release(next.value);
    next = await prior.next();
  }
  expect(count).toBe(input.size);
  expect(source.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
    !trap,
  );
  expect(source.snapshot().peakRows).toBeGreaterThan(0);
  expect(source.snapshot().peakRows > 440).toBe(trap);
  expect(source.snapshot().peakSerializedBytes > 8 * 1024 * 1024).toBe(trap);
  expect(input.transaction.snapshot().liveRows).toBeGreaterThan(0);
  expect(
    input.transaction.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
  ).toBe(true);
}

async function verifyRetry(
  input: PublicationFixture,
  setup: ReturnType<typeof highdensitySetup>,
  expected: readonly IContent[],
): Promise<void> {
  const {
    graph: { service: history, recording },
    size,
    rowAt,
    media,
    contentId,
  } = input;
  let restored = 0;
  for await (const row of history.streamRawHistory())
    expect(row).toStrictEqual(rowAt(restored++));
  expect(restored).toBe(size);
  expect(history.getCacheAnchorSeq()).toBe(1);
  expect(await media.hasReservations(contentId)).toBe(true);
  await history.waitForCommit();
  const path = recording.getFilePath();
  if (path === null) throw new Error('Missing native publication mirror');
  await persisted(
    path,
    Array.from({ length: size }, (_, index) => rowAt(index)),
  );
  expect(await setup.handler.performCompression('native-owner-retry')).toBe(
    PerformCompressionResult.COMPRESSED,
  );
  expect(setup.transport.requests).toHaveLength(0);
  let published = 0;
  for await (const row of history.streamRawHistory())
    expect(row).toStrictEqual(expected[published++]);
  expect(published).toBe(expected.length);
  await history.waitForCommit();
  await persisted(path, expected);
  expect(await media.hasReservations(contentId)).toBe(true);
}

async function observePublication(
  input: PublicationFixture,
  trap: boolean,
): Promise<void> {
  const {
    graph: { service: history, ownership: source },
    media,
    size,
    rowAt,
  } = input;
  const expected = await highdensityOracle(history, size, 2048, rowAt);
  const setup = highdensitySetup(history);
  history.setCacheAnchorSeq(1);
  const prior = history.streamRawHistory();
  const first = await prior.next();
  media.rejecting = true;
  const operation = setup.handler.performCompression('native-owner-pause').then(
    () => undefined,
    (error: unknown) => error,
  );
  const retained: IContent[] = [];
  try {
    await Promise.race([
      media.ready.promise,
      operation.then((error) => {
        throw error ?? new Error('Publication ended before reservation gate');
      }),
    ]);
    expect(await media.hasReservations(input.contentId)).toBe(true);
    await inspectPrior(input, prior, first, retained, trap);
    media.resume.resolve();
    expect(await operation).toBe(media.failure);
    for (const row of retained) source.release(row);
    retained.length = 0;
    expect(
      input.transaction.snapshot().liveRows + source.snapshot().liveRows,
    ).toBe(0);
    await verifyRetry(input, setup, expected);
  } finally {
    media.resume.resolve();
    await prior.return();
    await operation;
    for (const row of retained) source.release(row);
  }
}

async function releasePublication(input: PublicationFixture): Promise<void> {
  const {
    graph: { service: history },
    media,
    transaction,
    contentId,
  } = input;
  media.releasing = true;
  const disposal = history
    .dispose()
    .then(() => history.waitForOwnershipSettlement());
  try {
    await Promise.race([
      media.releaseReady.promise,
      disposal.then(() => {
        throw new Error('Disposal ended before media release');
      }),
    ]);
    expect(await media.hasReservations(contentId)).toBe(true);
    expect(transaction.snapshot().liveRows).toBeGreaterThan(0);
  } finally {
    media.releaseResume.resolve();
    await disposal;
  }
  await history.waitForOwnershipSettlement();
  expect(await media.hasReservations(contentId)).toBe(false);
}

export async function nativePublication(
  size: number,
  trap = false,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'native-publication-'));
  const media = new PublicationMediaStore({
    rootDirectory: join(root, 'media'),
    quotaBytes: 1024,
  });
  const transaction = new RowOwnership();
  const graph = createCoreSuffixFixtureGraph(root, transaction, (options) => {
    const counters = options.attachmentCounters;
    if (counters === undefined)
      throw new Error('Native publication fixture requires read counters');
    return new HighdensityDiskHistory({
      ...options,
      attachmentCounters: { ...counters, ownership: transaction },
    });
  });
  const { service: history, recording } = graph;
  try {
    const reference = await media.admit({
      bytes: new Uint8Array([1]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const rowAt = (index: number): IContent => {
      const row = highdensityRow(index, trap ? 64 * 1024 : 2048);
      return index === 0 || index === size - 1
        ? { ...row, blocks: [...row.blocks, reference] }
        : row;
    };
    await graph.seed(
      (function* (): Generator<IContent> {
        for (let index = 0; index < size; index++) yield rowAt(index);
      })(),
    );
    await history.registerMediaOwner(new CountedMediaOwner(media, transaction));
    await history.settleMediaOwnership();
    expect(await media.hasReservations(reference.contentId)).toBe(true);
    await observePublication(
      {
        size,
        graph,
        transaction,
        media,
        rowAt,
        contentId: reference.contentId,
      },
      trap,
    );
    await releasePublication({
      size,
      graph,
      transaction,
      media,
      rowAt,
      contentId: reference.contentId,
    });
  } finally {
    media.resume.resolve();
    media.releaseResume.resolve();
    await history.dispose();
    await recording.dispose();
    await media.close();
    rmSync(root, { recursive: true, force: true });
  }
}
