/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  realisticSessionRows,
  realisticSessionSummary,
  sessionRowPayload,
} from './realistic-session.js';
import {
  assertSessionMemory,
  assertWholeHistoryControl,
  createWholeHistoryBufferingControl,
  measureRealisticSession,
  sessionMemoryAccepted,
  type SessionRouteAdapter,
  type SessionProbe,
} from './session-memory-protocol.js';

function fakeRoute(): SessionRouteAdapter {
  const summary = realisticSessionSummary();
  return {
    routeId: 'streaming-fake',
    operation: 'send',
    warmup: async () => {
      for (const row of realisticSessionRows({
        rowCount: 64,
        payloadBytes: 64 * 2048,
      })) {
        createHash('sha256').update(sessionRowPayload(row)).digest();
      }
    },
    prepare: async () => ({
      corpus: {
        ...summary,
        selectedRowCount: summary.rowCount,
        journalBytes: summary.neutralPayloadBytes + summary.rowCount * 128,
        selectedPayloadBytes: summary.neutralPayloadBytes,
      },
      reference: { bytes: summary.neutralPayloadBytes, sha256: summary.sha256 },
      run: async (probe, owner) => {
        const hash = createHash('sha256');
        let bytes = 0;
        let consumed = 0;
        await probe.checkpoint('conversion');
        for (const row of realisticSessionRows()) {
          const payload = sessionRowPayload(row);
          owner.retain(payload);
          hash.update(payload);
          bytes += Buffer.byteLength(payload);
          consumed++;
          await consumptionCheckpoint(probe, consumed);
        }
        probe.sample('transport-entry');
        await probe.checkpoint('transport-entry');
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        await probe.checkpoint('paused-upload');
        await probe.checkpoint('body-admission');
        return { bytes, sha256: hash.digest('hex') };
      },
      close: async () => {},
    }),
  };
}

async function consumptionCheckpoint(
  probe: SessionProbe,
  count: number,
): Promise<void> {
  if (count === 6250) await probe.checkpoint('quarter');
  if (count === 12_500) await probe.checkpoint('half');
  if (count === 18_750) await probe.checkpoint('three-quarter');
}

describe('realistic session memory protocol', () => {
  it('accepts a streaming fake and rejects fresh whole-history byte copies with the same predicate', async () => {
    const streaming = await measureRealisticSession(fakeRoute());
    expect(sessionMemoryAccepted(streaming)).toBe(true);
    expect(() => assertSessionMemory(streaming)).not.toThrow();
    expect(
      streaming.samples.some((sample) => sample.mode === 'uncollected'),
    ).toBe(true);
    expect(streaming.samples.some((sample) => sample.mode === 'settled')).toBe(
      true,
    );
    expect(
      streaming.samples.some((sample) => sample.checkpoint === 'interval'),
    ).toBe(true);
    expect(streaming.baseline.rssBytes).toBeGreaterThan(0);
    const control = createWholeHistoryBufferingControl();
    const buffered = await measureRealisticSession(fakeRoute(), control);
    expect(control.rowCount).toBe(25_000);
    expect(control.payloadBytes).toBe(streaming.neutralPayloadBytes);
    expect(sessionMemoryAccepted(buffered)).toBe(false);
    expect(buffered.peakBufferGrowthBytes).toBeGreaterThanOrEqual(
      buffered.boundBytes,
    );
    expect(() => assertSessionMemory(buffered)).toThrow('streaming-fake');
    expect(() => assertWholeHistoryControl(buffered, control)).not.toThrow();
    expect(() =>
      assertWholeHistoryControl({ ...buffered, samples: [] }, control),
    ).toThrow('invalid proof');
    expect(() =>
      assertWholeHistoryControl(
        { ...buffered, wireSha256: 'corrupt' },
        control,
      ),
    ).toThrow('invalid proof');
    control.release();
    expect(control.rowCount).toBe(0);
  });

  it('rejects tiny suffixes, missing checkpoints, and invalid memory samples', async () => {
    const measurement = await measureRealisticSession(fakeRoute());
    expect(
      sessionMemoryAccepted({ ...measurement, selectedRowCount: 64 }),
    ).toBe(false);
    expect(
      sessionMemoryAccepted({ ...measurement, selectedPayloadBytes: 1024 }),
    ).toBe(false);
    expect(sessionMemoryAccepted({ ...measurement, samples: [] })).toBe(false);
    expect(
      sessionMemoryAccepted({
        ...measurement,
        peakHeapGrowthBytes: Number.NaN,
      }),
    ).toBe(false);
    expect(
      sessionMemoryAccepted({
        ...measurement,
        peakHeapGrowthBytes: measurement.boundBytes,
      }),
    ).toBe(false);
    const incomplete = createWholeHistoryBufferingControl();
    incomplete.retain('one row');
    expect(() => assertWholeHistoryControl(measurement, incomplete)).toThrow(
      'complete selected history',
    );
  });
});
