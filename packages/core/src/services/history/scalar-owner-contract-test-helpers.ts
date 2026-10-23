/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import type { SessionRecordingPort } from '../../recording/recordingPort.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { durableRowsOf } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

export function scalarRowCharge(row: IContent): number {
  return Buffer.byteLength(JSON.stringify(row), 'utf8');
}

export function expectScalarCharge(
  owners: RowOwnership,
  rows: number,
  serializedBytes: number,
): void {
  expect(owners.snapshot().liveRows).toBe(rows);
  expect(owners.snapshot().liveSerializedBytes).toBe(serializedBytes);
}

export function expectScalarRow(row: IContent, index: number): void {
  expect(row.metadata?.chronology).toStrictEqual({
    seq: index + 1,
    userTurn: Math.floor(index / 3) + 1,
    step: index % 3,
    recordedAt: 1700000000000 + index,
  });
}

export async function expectScalarDurableRows(
  recorder: SessionRecordingPort,
  length: number,
  expected: (index: number) => IContent,
): Promise<void> {
  const rows = await durableRowsOf(recorder);
  expect(rows).toHaveLength(length);
  for (const [index, row] of rows.entries()) {
    expect(row).toStrictEqual(expected(index));
    expectScalarRow(row, index);
  }
}
