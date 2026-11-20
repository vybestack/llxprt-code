/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  transformProbes,
  probeTransformRow,
  sweepTransformRows,
} from '@vybestack/llxprt-code-core/services/history/transform-value-test-helpers.js';

export function observeNativeTruncation(
  history: HistoryService,
  beforePublication: () => void = () => {},
  signal?: AbortSignal,
): (phase: string) => Promise<void> {
  const probes = transformProbes();
  const transform = history.detachedValues.transform.bind(
    history.detachedValues,
  );
  history.detachedValues.transform = (task, model, options) => {
    beforePublication();
    return transform(
      (source, sink) =>
        task(source, {
          ...sink,
          appendDerived: async (ordinal, row) => {
            probeTransformRow(row, probes);
            await sink.appendDerived(ordinal, row);
          },
          appendValue: async (row) => {
            probeTransformRow(row, probes);
            await sink.appendValue(row);
          },
        }),
      model,
      { ...options, signal: signal ?? options?.signal },
    );
  };
  return async (phase): Promise<void> => {
    await sweepTransformRows();
    expect(probes.rows.length).toBeGreaterThan(0);
    const limit = phase === 'writer-paused' ? 440 : 0;
    expect(
      probes.rows.filter((row) => row.deref() !== undefined).length,
    ).toBeLessThanOrEqual(limit);
    expect(
      probes.markers.filter((row) => row.deref() !== undefined).length,
    ).toBeLessThanOrEqual(limit);
  };
}
