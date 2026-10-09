/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalResolver } from '../../recording/journalResolver.js';
import { detachedRow } from './detached-rollback-test-helpers.js';
import type { EnvelopeFixture } from './publication-envelope-test-helpers.js';
import {
  envelopeGC,
  envelopeSurvivors,
  envelopeCensus,
  withEnvelopeFixture,
  seedEnvelopeStore,
  seedEnvelopePublication,
} from './publication-envelope-test-helpers.js';

async function expectFullBytes(
  fixture: EnvelopeFixture,
  size: number,
  bytes: number,
): Promise<void> {
  let ordinal = 0;
  for await (const row of fixture.store.streamRows()) {
    expect(JSON.stringify(row)).toBe(
      JSON.stringify(detachedRow(ordinal++, bytes)),
    );
  }
  expect(ordinal).toBe(size);
  const path = fixture.recorder.getFilePath();
  if (path === null) throw new Error('Missing acknowledged journal');
  const fresh = await JournalResolver.open(path);
  try {
    ordinal = 0;
    for await (const entry of fresh.resolve()) {
      expect(JSON.stringify(entry.content)).toBe(
        JSON.stringify(detachedRow(ordinal++, bytes)),
      );
    }
    expect(ordinal).toBe(size);
  } finally {
    await fresh.close();
  }
}

async function expectReleased(fixture: EnvelopeFixture): Promise<void> {
  await envelopeGC();
  expect(envelopeCensus(fixture)).toStrictEqual({
    lines: 0,
    payloads: 0,
    rows: 0,
  });
  expect(fixture.owners.snapshot().liveRows).toBe(0);
}

for (const [size, bytes] of [
  [512, 2048],
  [8192, 2048],
  [1, 9 * 1024 * 1024],
]) {
  describe(`acknowledged publication envelope ${size}/${bytes}`, () => {
    it('collects original rows, payloads and lines with the journal and completed durability promise held', async () => {
      await withEnvelopeFixture(async (fixture) => {
        const weak = seedEnvelopeStore(fixture.store, size, bytes);
        const completed = fixture.store.waitForDurable();
        await fixture.writerStarted.promise;
        await envelopeGC();
        const pendingLength = fixture.store.getLength();
        fixture.writer.resolve();
        await completed;
        await expectReleased(fixture);
        expect(envelopeSurvivors(weak)).toBe(0);
        await expectFullBytes(fixture, size, bytes);
        await completed;
        expect([pendingLength, fixture.store.getLength()]).toStrictEqual([
          size,
          size,
        ]);
      });
    }, 180_000);

    it('collects the envelope before close while a completed publication promise and disk journals stay held', async () => {
      await withEnvelopeFixture(async (fixture) => {
        const held = seedEnvelopePublication(fixture, size, bytes);
        try {
          await fixture.writerStarted.promise;
          await envelopeGC();
          fixture.writer.resolve();
          await held.completed;
          await expectReleased(fixture);
          expect(envelopeSurvivors(held.weak)).toBe(0);
          expect(held.publication.admittedCount).toBe(size);
          await expectFullBytes(fixture, size, bytes);
          held.publication.close();
          await expectReleased(fixture);
          await expectFullBytes(fixture, size, bytes);
          await held.completed;
          expect(held.next.length).toBe(size);
        } finally {
          held.publication.close();
          held.next.close();
          held.previous.close();
        }
      });
    }, 180_000);
  });
}
