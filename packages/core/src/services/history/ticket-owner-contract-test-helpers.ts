/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryStorePort } from './historyStorePort.js';
import { expect } from 'bun:test';
import type { IContent } from './IContent.js';
import {
  transformProbes,
  probeTransformRow,
  sweepTransformRows,
  type TransformProbes,
} from './transform-value-test-helpers.js';

export function submitTicketRows(
  journal: HistoryStorePort,
  size: number,
  makeRow: (index: number) => IContent,
  register?: (row: IContent) => void,
  afterAdmit?: (index: number) => void,
): TransformProbes {
  const probes = transformProbes();
  for (let index = 0; index < size; index++) {
    const row = makeRow(index);
    probeTransformRow(row, probes);
    register?.(row);
    journal.apply({ kind: 'content', content: row });
    afterAdmit?.(index);
  }
  return probes;
}

export async function expectTicketCallersReleased(
  probes: TransformProbes,
): Promise<void> {
  // The collector can keep one row alive through a stale conservative stack
  // slot; retention by the journal never frees, so repeated sweeps still fail it.
  const live = (): number =>
    probes.rows.filter((row) => row.deref() !== undefined).length +
    probes.markers.filter((marker) => marker.deref() !== undefined).length;
  for (let sweep = 0; sweep < 5; sweep++) {
    await sweepTransformRows();
    if (live() === 0) break;
  }
  expect(probes.rows.filter((row) => row.deref() !== undefined)).toHaveLength(
    0,
  );
  expect(
    probes.markers.filter((marker) => marker.deref() !== undefined),
  ).toHaveLength(0);
}
