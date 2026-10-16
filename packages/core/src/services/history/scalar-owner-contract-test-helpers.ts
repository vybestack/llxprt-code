/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { JournalResolver } from '../../recording/journalResolver.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
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
  recorder: SessionRecordingService,
  length: number,
  expected: (index: number) => IContent,
): Promise<void> {
  const file = recorder.getFilePath();
  if (file === null) throw new Error('Scalar fixture has no journal');
  const resolver = await JournalResolver.open(file);
  try {
    let index = 0;
    for await (const entry of resolver.resolve()) {
      expect(entry.content).toStrictEqual(expected(index));
      expectScalarRow(entry.content, index);
      index++;
    }
    expect(index).toBe(length);
  } finally {
    await resolver.close();
  }
}
