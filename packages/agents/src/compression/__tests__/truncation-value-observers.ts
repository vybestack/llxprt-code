/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { appendFileSync } from 'node:fs';
import type { AdmissionFailureRecorder } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  isRecord,
  isSpeakerContent,
} from '@vybestack/llxprt-code-core/services/history/historyJournalGuards.js';
import {
  transformProbes,
  probeTransformRow,
  sweepTransformRows,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';

export function publishedTruncationProbes(
  recorder: AdmissionFailureRecorder,
  size: number,
): (phase: string) => Promise<void> {
  const probes = transformProbes();
  const enqueue = recorder.enqueue.bind(recorder);
  recorder.enqueue = (type, payload) => {
    const line = enqueue(type, payload);
    if (
      line !== null &&
      type === 'content' &&
      isRecord(payload) &&
      isSpeakerContent(payload.content)
    )
      probeTransformRow(payload.content, probes);
    return line;
  };
  return async (phase): Promise<void> => {
    await sweepTransformRows();
    const liveRows = probes.rows.filter(
      (row) => row.deref() !== undefined,
    ).length;
    const liveMarkers = probes.markers.filter(
      (row) => row.deref() !== undefined,
    ).length;
    const output = process.env.TRANSFORM_VALUE_OUTPUT;
    if (output !== undefined)
      appendFileSync(
        output,
        JSON.stringify({
          route: 'truncation-published',
          size,
          phase,
          probedRows: probes.rows.length,
          liveRows,
          liveMarkers,
        }) + '\n',
      );
    expect(probes.rows.length).toBeGreaterThan(0);
    if (phase === 'writer-paused') {
      expect(liveRows).toBeGreaterThan(0);
      expect(liveRows).toBeLessThanOrEqual(440);
      expect(liveMarkers).toBeGreaterThan(0);
    } else {
      expect(liveRows).toBe(0);
      expect(liveMarkers).toBe(0);
    }
  };
}
