/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRow,
} from './detached-rollback-test-helpers.js';
import type { HistoryService } from './HistoryService.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import {
  envelopeGate,
  envelopeGC,
  envelopeSurvivors,
} from './publication-envelope-test-helpers.js';

class CompletedEnvelopeInput implements AsyncIterable<IContent> {
  private rows: IContent[] | undefined;
  private index = 0;
  constructor(
    rows: IContent[],
    private readonly ownership: RowOwnership,
  ) {
    this.rows = rows;
    for (const row of rows) ownership.retain(row);
  }
  next(): Promise<IteratorResult<IContent, void>> {
    if (this.rows === undefined)
      return Promise.resolve({ done: true, value: undefined });
    if (this.index === this.rows.length) return this.return();
    return Promise.resolve({ done: false, value: this.rows[this.index++] });
  }
  return(): Promise<IteratorResult<IContent, void>> {
    for (const row of this.rows ?? []) this.ownership.release(row);
    this.rows = undefined;
    return Promise.resolve({ done: true, value: undefined });
  }
  [Symbol.asyncIterator](): CompletedEnvelopeInput {
    return this;
  }
}
function submit(
  history: HistoryService,
  ownership: RowOwnership,
  size: number,
  bytes: number,
): {
  input: CompletedEnvelopeInput;
  weak: Array<WeakRef<IContent>>;
  completed: Promise<void>;
} {
  const rows = Array.from({ length: size }, (_, index) =>
    detachedRow(index, bytes),
  );
  const weak = rows.map((row) => new WeakRef(row));
  const input = new CompletedEnvelopeInput(rows, ownership);
  return { input, weak, completed: history.detachedValues.replace(input) };
}

for (const [size, bytes] of [
  [512, 2048],
  [8192, 2048],
  [1, 9437184],
]) {
  describe(`held real detached finalizer ${size}/${bytes}`, () => {
    it('releases input values at ack while finalization, producer and storage remain held', async () => {
      await withNativeDetachedFixture(async (fixture) => {
        const history = fixture.history;
        fixture.pauseWriter(size);
        history.setTokenizerFactory(exactTokenizer());
        const entered = envelopeGate();
        const finish = envelopeGate();
        const storage: Array<
          AsyncIterable<MediaReferenceBlock> | Iterable<MediaReferenceBlock>
        > = [];
        await history.registerMediaOwner({
          prepareReplacement() {
            throw new Error('Unexpected row replacement');
          },
          async prepareReferenceReplacement(references) {
            storage.push(references);
            for await (const reference of references) void reference;
            return {
              publish(): void {},
              async finalize(): Promise<void> {
                entered.resolve();
                await finish.promise;
              },
              rollback(): void {},
            };
          },
          async reconcile(): Promise<void> {},
          async releaseAll(): Promise<void> {},
          adopt(): void {},
        });
        const held = submit(history, fixture.owners, size, bytes);
        try {
          await fixture.writerPaused;
          fixture.releaseWriter();
          await entered.promise;
          await envelopeGC();
          expect({
            source: envelopeSurvivors(held.weak),
            live: fixture.owners.snapshot().liveRows,
          }).toStrictEqual({
            source: 0,
            live: 0,
          });
          expect(await held.input.next()).toStrictEqual({
            done: true,
            value: undefined,
          });
          let index = 0;
          for await (const row of history.streamRawHistory())
            expect(JSON.stringify(row.blocks)).toBe(
              JSON.stringify(detachedRow(index++, bytes).blocks),
            );
          expect(index).toBe(size);
          const acknowledged = await detachedDigest(history.streamRawHistory());
          expect(acknowledged).toStrictEqual(
            await detachedDigest(fixture.primaryRows()),
          );
          finish.resolve();
          await held.completed;
          await envelopeGC();
          expect(await Array.fromAsync(storage[0])).toStrictEqual([]);
          expect(await detachedDurableDigest(fixture.recording)).toStrictEqual(
            acknowledged,
          );
          await held.completed;
        } finally {
          finish.resolve();
          await held.completed;
          await history.dispose();
        }
      });
    }, 180_000);
  });
}
