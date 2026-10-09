/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import {
  borrowCaller,
  callerRow,
  witness,
  withCallerFixture,
} from './pending-caller-lifecycle-test-helpers.js';

describe('pending caller admission lifecycle', () => {
  it('retains original pending identity and admission until durable ack', async () => {
    await withCallerFixture(async (fixture) => {
      const marker = { seq: 1, userTurn: 1, step: 1, recordedAt: 42 };
      const row = { ...callerRow(), metadata: { chronology: marker } };
      fixture.store.apply({ kind: 'content', content: row });
      witness('applied-before-ack', fixture, row);
      const admission = {
        ...fixture.owners.snapshot(),
        references: fixture.owners.references,
      };
      const primary = new Error('caller callback failure');
      const observation = await borrowCaller(fixture, row, primary);
      const beforeAck = fixture.owners.references;
      fixture.releaseWriter();
      await fixture.store.waitForDurable();
      witness('durable-ack', fixture, row);
      expect(observation.error).toBe(primary);
      expect(observation.readerClosed).toBe(true);
      expect(fixture.owners.references).toBe(0);
      expect(fixture.transaction.references).toBe(0);
      expect(row.metadata.chronology).toBe(marker);
      expect({
        admission,
        beforeAck,
        rowIdentity: observation.borrowed === row,
        markerIdentity: observation.borrowed.metadata?.chronology === marker,
      }).toMatchObject({
        admission: { liveRows: 1, references: 1 },
        beforeAck: 1,
        rowIdentity: true,
        markerIdentity: true,
      });
    });
  });
});

describe('pending caller write failure lifecycle', () => {
  it('preserves write failure while retaining admission until retirement', async () => {
    await withCallerFixture(async (fixture) => {
      const row = callerRow();
      fixture.store.apply({ kind: 'content', content: row });
      const primary = new Error('callback before failed write');
      const observation = await borrowCaller(fixture, row, primary);
      const failure = new Error('actual append boundary failed');
      const pendingAck = fixture.store.waitForDurable();
      fixture.failWriter(failure);
      const ackError = await rejectedValue(pendingAck);
      const beforeRetirement = fixture.owners.references;
      witness('append-failed-before-retirement', fixture, row);
      fixture.store.dispose();
      witness('failed-admission-retired', fixture, row);
      expect(observation.error).toBe(primary);
      expect(ackError).toBe(failure);
      expect(observation.readerClosed).toBe(true);
      expect(fixture.owners.references).toBe(0);
      expect(fixture.transaction.references).toBe(0);
      expect({
        beforeRetirement,
        rowIdentity: observation.borrowed === row,
      }).toStrictEqual({
        beforeRetirement: 1,
        rowIdentity: true,
      });
    });
  });
});

describe('pending caller cancellation lifecycle', () => {
  it('retires cancelled admission after closing the borrowed reader', async () => {
    await withCallerFixture(async (fixture) => {
      const row = callerRow();
      fixture.store.apply({ kind: 'content', content: row });
      const controller = new AbortController();
      const primary = new Error('cancel caller snapshot');
      const observation = await borrowCaller(
        fixture,
        row,
        primary,
        false,
        controller.signal,
        () => controller.abort(primary),
      );
      const beforeRetirement = fixture.owners.references;
      witness('cancelled-before-retirement', fixture, row);
      fixture.store.dispose();
      fixture.releaseWriter();
      await fixture.recorder.flush();
      witness('cancelled-admission-retired-and-drained', fixture, row);
      expect(observation.error).toBe(primary);
      expect(observation.readerClosed).toBe(true);
      expect(fixture.owners.references).toBe(0);
      expect(fixture.transaction.references).toBe(0);
      expect({
        beforeRetirement,
        rowIdentity: observation.borrowed === row,
      }).toStrictEqual({
        beforeRetirement: 1,
        rowIdentity: true,
      });
    });
  });
});

describe('pending caller retained consumer lifecycle', () => {
  it('keeps a retained consumer distinct from the admission across ack', async () => {
    await withCallerFixture(async (fixture) => {
      const row = callerRow();
      fixture.store.apply({ kind: 'content', content: row });
      const primary = new Error('retained caller callback');
      const observation = await borrowCaller(fixture, row, primary, true);
      try {
        const beforeAck = fixture.owners.references;
        fixture.releaseWriter();
        await fixture.store.waitForDurable();
        witness('consumer-retained-after-ack', fixture, row);
        expect(observation.error).toBe(primary);
        expect(observation.readerClosed).toBe(true);
        expect(fixture.owners.references).toBe(1);
        expect(fixture.owners.snapshot().liveRows).toBe(1);
        expect(fixture.transaction.references).toBe(0);
        expect({
          beforeAck,
          rowIdentity: observation.borrowed === row,
        }).toStrictEqual({
          beforeAck: 2,
          rowIdentity: true,
        });
      } finally {
        fixture.owners.release(observation.borrowed);
        witness('consumer-released', fixture, row);
      }
      expect(fixture.owners.references).toBe(0);
    });
  });
});

describe('pending caller retaining trap lifecycle', () => {
  it.skipIf(process.env['CALLER_RETAINED_TRAP'] !== '1')(
    'fails the empty-owner predicate while a consumer remains retained',
    async () => {
      await withCallerFixture(async (fixture) => {
        const row = callerRow();
        fixture.store.apply({ kind: 'content', content: row });
        const primary = new Error('deliberate retained consumer');
        const observation = await borrowCaller(fixture, row, primary, true);
        try {
          fixture.releaseWriter();
          await fixture.store.waitForDurable();
          witness('adverse-consumer-retained-after-ack', fixture, row);
          expect(observation.error).toBe(primary);
          expect(fixture.owners.snapshot().liveRows).toBe(0);
        } finally {
          fixture.owners.release(observation.borrowed);
          witness('adverse-consumer-released', fixture, row);
        }
      });
    },
  );
});
