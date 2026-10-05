/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { batchRow } from './addbatch-stream-test-helpers.js';
import { withSynchronousFixture } from './synchronous-ticket-test-helpers.js';
import {
  transformProbes,
  probeTransformRow,
  sweepTransformRows,
  recordTransformPhase,
} from './transform-value-test-helpers.js';
import type { IContent } from './IContent.js';

const cap = { rows: 440, serializedBytes: 8 * 1024 * 1024 };
type Fixture = Parameters<Parameters<typeof withSynchronousFixture>[0]>[0];

function submitCold(
  fixture: Fixture,
  size: number,
  probes: ReturnType<typeof transformProbes>,
  retained?: IContent[],
): void {
  for (let ordinal = 0; ordinal < size; ordinal++) {
    const row = batchRow(ordinal);
    fixture.owners.registerInput([row]);
    fixture.owners.retain(row);
    try {
      probeTransformRow(row, probes);
      fixture.history.add(row);
      if (retained !== undefined) {
        retained.push(row);
        fixture.owners.retain(row);
      }
    } finally {
      fixture.owners.release(row);
    }
  }
}

async function checkRows(fixture: Fixture, size: number): Promise<void> {
  let ordinal = 0;
  for await (const row of fixture.history.streamRawHistory()) {
    const expected = batchRow(ordinal);
    expect(row.blocks).toStrictEqual(expected.blocks);
    expect(row.metadata?.chronology).toStrictEqual(
      expected.metadata?.chronology,
    );
    ordinal++;
  }
  expect(ordinal).toBe(size);
}

function record(phase: string, fixture: Fixture, size: number): void {
  const output = process.env.SYNC_TICKET_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      JSON.stringify({
        phase,
        size,
        owners: fixture.owners.snapshot(),
        pendingBytes: fixture.recorder.getPendingByteCount(),
        pendingRecords: fixture.recorder.getPendingRecordCount(),
        writerPeakBytes: fixture.writerPeakBytes(),
        memory: process.memoryUsage(),
      }) + '\n',
    );
}

describe('synchronous value tickets', () => {
  for (const size of [512, 8192]) {
    it(`releases a cold no-await ${size}-row producer before durable acknowledgement`, async () => {
      await withSynchronousFixture(async (fixture) => {
        await fixture.recorder.flush();
        const probes = transformProbes();
        fixture.pauseWriter();
        submitCold(fixture, size, probes);
        record('admission', fixture, size);
        try {
          expect(fixture.history.length()).toBe(size);
          const admitted = fixture.owners.snapshot();
          expect(admitted.peakRows).toBeLessThanOrEqual(cap.rows);
          expect(admitted.peakSerializedBytes).toBeLessThanOrEqual(
            cap.serializedBytes,
          );
          await fixture.waitForPausedWrite;
          await sweepTransformRows();
          record('paused', fixture, size);
          const weak = recordTransformPhase(
            'synchronous-ticket',
            'paused',
            size,
            fixture.owners,
            probes,
          );
          expect(weak.callerRows).toBe(0);
          expect(weak.callerMarkers).toBe(0);
          await checkRows(fixture, size);
          expect(fixture.owners.within(cap)).toBe(true);
        } finally {
          fixture.releaseWriter();
          await fixture.history.waitForCommit();
          await fixture.history.waitForTokenUpdates();
        }
        await sweepTransformRows();
        record('acknowledged', fixture, size);
        expect(
          fixture.writerPeakBytes() +
            fixture.owners.snapshot().peakSerializedBytes,
        ).toBeLessThanOrEqual(cap.serializedBytes);
        const acknowledged = fixture.owners.snapshot();
        expect(acknowledged.liveRows).toBe(0);
        expect(acknowledged.peakRows).toBeLessThanOrEqual(cap.rows);
        await checkRows(fixture, size);
      });
    }, 180_000);

    it(`detects an external retaining ${size}-row producer`, async () => {
      await withSynchronousFixture(async (fixture) => {
        const retained: IContent[] = [];
        const probes = transformProbes();
        fixture.pauseWriter();
        try {
          submitCold(fixture, size, probes, retained);
          await fixture.waitForPausedWrite;
          await sweepTransformRows();
          record('retaining-control', fixture, size);
          expect(fixture.owners.within(cap)).toBe(false);
          expect(
            probes.rows.filter((probe) => probe.deref() !== undefined).length,
          ).toBe(size);
        } finally {
          for (const row of retained) fixture.owners.release(row);
          retained.length = 0;
          fixture.releaseWriter();
          await fixture.history.waitForCommit();
          await fixture.history.waitForTokenUpdates();
        }
      });
    }, 180_000);
  }
});

describe('synchronous value semantics', () => {
  it('captures pending metadata and blocks at synchronous submission', async () => {
    await withSynchronousFixture(async (fixture) => {
      fixture.pauseWriter();
      const row = batchRow(0);
      fixture.history.add(row);
      expect(fixture.history.length()).toBe(1);
      row.blocks = [{ type: 'text', text: 'mutated after return' }];
      if (row.metadata?.chronology === undefined)
        throw new Error('Missing marker');
      row.metadata.chronology = { ...row.metadata.chronology, seq: 999 };
      try {
        await fixture.waitForPausedWrite;
        await checkRows(fixture, 1);
      } finally {
        fixture.releaseWriter();
        await fixture.history.waitForCommit();
        await fixture.history.waitForTokenUpdates();
      }
    });
  });

  it('preserves synchronous observer error identity, compensation and retry', async () => {
    await withSynchronousFixture(async (fixture) => {
      fixture.pauseWriter();
      const failure = new Error('synchronous observer failed');
      fixture.history.once('contentAdded', () => {
        throw failure;
      });
      try {
        expect(() => fixture.history.add(batchRow(0))).toThrow(failure);
        expect(fixture.history.length()).toBe(0);
        fixture.history.add(batchRow(1));
        expect(fixture.history.length()).toBe(1);
        await fixture.waitForPausedWrite;
        record('rollback', fixture, 1);
        expect(fixture.owners.within(cap)).toBe(true);
      } finally {
        fixture.releaseWriter();
        await fixture.history.waitForCommit();
        await fixture.history.waitForTokenUpdates();
      }
      const result: IContent[] = [];
      for await (const row of fixture.history.streamRawHistory())
        result.push(row);
      expect(result.map((row) => row.blocks)).toStrictEqual([
        batchRow(1).blocks,
      ]);
    });
  });

  it('preserves a complete row larger than nine MiB without imposing the small-row cap', async () => {
    await withSynchronousFixture(async (fixture) => {
      fixture.pauseWriter();
      const row = batchRow(0, 9 * 1024 * 1024 + 17);
      fixture.history.add(row);
      try {
        await fixture.waitForPausedWrite;
        for await (const stored of fixture.history.streamRawHistory())
          expect(stored.blocks).toStrictEqual(row.blocks);
      } finally {
        fixture.releaseWriter();
        await fixture.history.waitForCommit();
        await fixture.history.waitForTokenUpdates();
      }
      for await (const durable of fixture.history.streamRawHistory())
        expect(durable).toStrictEqual(row);
    });
  }, 180_000);
});
