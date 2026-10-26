/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  realisticSessionRows,
  realisticSessionSummary,
  sessionRowPayload,
} from './realistic-session.js';
import {
  assertWholeHistoryControl,
  createWholeHistoryBufferingControl,
  measureRealisticSession,
  sessionMemoryAccepted,
  type SessionRouteAdapter,
} from './session-memory-protocol.js';

function recordRoute(): SessionRouteAdapter {
  const summary = realisticSessionSummary();
  return {
    routeId: 'record-fake',
    operation: 'record',
    warmup: async () => {},
    prepare: async () => ({
      corpus: {
        ...summary,
        selectedRowCount: summary.rowCount,
        journalBytes: summary.neutralPayloadBytes + 25_000 * 128,
        selectedPayloadBytes: summary.neutralPayloadBytes * 2,
      },
      reference: { bytes: summary.neutralPayloadBytes, sha256: summary.sha256 },
      run: async (probe, owner) => {
        const hash = createHash('sha256');
        let count = 0;
        for (const row of realisticSessionRows()) {
          const payload = sessionRowPayload(row);
          hash.update(payload);
          owner.retain(Buffer.from(payload));
          count++;
          if (count === 6250) await probe.checkpoint('quarter');
          if (count === 12_500) await probe.checkpoint('half');
          if (count === 18_750) await probe.checkpoint('three-quarter');
        }
        await probe.checkpoint('record-append');
        await probe.checkpoint('record-ack');
        await probe.checkpoint('terminal-publication');
        return {
          bytes: summary.neutralPayloadBytes,
          sha256: hash.digest('hex'),
        };
      },
      close: async () => {},
    }),
  };
}

describe('record measurement contract', () => {
  it('uses neutral bytes for recording even when route payload bytes differ', async () => {
    const result = await measureRealisticSession(recordRoute());
    expect(sessionMemoryAccepted(result)).toBe(true);
    expect(result.boundBytes).toBe(Math.floor(result.neutralPayloadBytes / 4));
    expect(result.boundBytes).toBeLessThan(result.selectedPayloadBytes / 4);
    expect(sessionMemoryAccepted({ ...result, wireSha256: 'corrupt' })).toBe(
      false,
    );
    expect(
      sessionMemoryAccepted({
        ...result,
        peakBufferGrowthBytes: result.boundBytes,
      }),
    ).toBe(false);
    expect(
      sessionMemoryAccepted({
        ...result,
        baseline: { ...result.baseline, heapBytes: Number.NaN },
      }),
    ).toBe(false);
    expect(
      sessionMemoryAccepted({ ...result, peakRssGrowthBytes: 1024 ** 4 }),
    ).toBe(true);
  });

  it('rejects retaining fresh byte copies of all existing history while recording', async () => {
    const control = createWholeHistoryBufferingControl();
    const result = await measureRealisticSession(recordRoute(), control);
    expect(control.payloadBytes).toBe(result.neutralPayloadBytes);
    expect(sessionMemoryAccepted(result)).toBe(false);
    expect(() => assertWholeHistoryControl(result, control)).not.toThrow();
    control.release();
  });
});
