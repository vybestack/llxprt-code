/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import type { IContent } from './IContent.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { HistoryJournalStore } from './historyJournalStore.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import {
  transformProbes,
  probeTransformRow,
  sweepTransformRows,
  type TransformProbes,
} from './transform-value-test-helpers.js';
import {
  expectScalarCharge,
  scalarRowCharge,
} from './scalar-owner-contract-test-helpers.js';

export async function seedTicketRows(
  recorder: SessionRecordingService,
  size: number,
  makeRow: (index: number) => IContent,
): Promise<TransformProbes> {
  const probes = transformProbes();
  for (let index = 0; index < size; index++) {
    const content = makeRow(index);
    probeTransformRow(content, probes);
    await recorder.commit('content', { content });
  }
  return probes;
}

export function submitTicketRows(
  journal: HistoryJournalStore,
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
  await sweepTransformRows();
  expect(probes.rows.filter((row) => row.deref() !== undefined)).toHaveLength(
    0,
  );
  expect(
    probes.markers.filter((marker) => marker.deref() !== undefined),
  ).toHaveLength(0);
}

export function expectTicketCursorRows(
  journal: HistoryJournalStore,
  owners: RowOwnership,
  size: number,
  expected: (index: number) => IContent,
): void {
  expectScalarCharge(owners, 0, 0);
  journal.withReadRows((cursor) => {
    expect(cursor.length).toBe(size);
    let index = 0;
    for (const row of cursor.rows()) {
      expect(row).toStrictEqual(expected(index));
      expect(cursor.chronologySeqAt(index)).toBe(
        expected(index).metadata?.chronology?.seq,
      );
      expectScalarCharge(owners, 1, scalarRowCharge(expected(index)));
      index++;
    }
    expect(index).toBe(size);
    expectScalarCharge(owners, 0, 0);
  });
  expectScalarCharge(owners, 0, 0);
}
