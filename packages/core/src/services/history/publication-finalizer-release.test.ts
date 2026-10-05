/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import {
  mediaParticipant,
  exactTokenizer,
} from './chronology-rollback-test-helpers.js';
import {
  detachedRow,
  detachedDigest,
  detachedDurableDigest,
} from './detached-rollback-test-helpers.js';
import type { IContent } from './IContent.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import {
  envelopeGate,
  envelopeGC,
  envelopeCensus,
  envelopeSurvivors,
  withEnvelopeFixture,
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
    it('releases original and envelope values at ack while finalization, producer and storage remain held', async () => {
      await withEnvelopeFixture(async (fixture) => {
        const history = new HistoryService({
          recording: fixture.recorder,
          mutationOwnership: fixture.owners,
        });
        history.setTokenizerFactory(exactTokenizer());
        const entered = envelopeGate();
        const finish = envelopeGate();
        const storage: Array<Iterable<IContent>> = [];
        history.registerMediaOwner(
          mediaParticipant((rows) => {
            storage.push(rows.previous, rows.next);
            return {
              publish: (): void => {},
              finalize: async (): Promise<void> => {
                entered.resolve();
                await finish.promise;
              },
              rollback: (): void => {},
            };
          }),
        );
        const held = submit(history, fixture.owners, size, bytes);
        try {
          await fixture.writerStarted.promise;
          fixture.writer.resolve();
          await entered.promise;
          await envelopeGC();
          expect({
            source: envelopeSurvivors(held.weak),
            envelope: envelopeCensus(fixture),
            live: fixture.owners.snapshot().liveRows,
          }).toStrictEqual({
            source: 0,
            envelope: { lines: 0, payloads: 0, rows: 0 },
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
            await detachedDurableDigest(fixture.recorder),
          );
          finish.resolve();
          await held.completed;
          await envelopeGC();
          expect(envelopeCensus(fixture)).toStrictEqual({
            lines: 0,
            payloads: 0,
            rows: 0,
          });
          expect(() => [...storage[1]]).toThrow('Detached journal is closed');
          expect(await detachedDurableDigest(fixture.recorder)).toStrictEqual(
            acknowledged,
          );
          await held.completed;
        } finally {
          finish.resolve();
          await held.completed;
          history.dispose();
        }
      });
    }, 180_000);
  });
}
