/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import type { SessionRecordingPort } from '../../recording/recordingPort.js';
import { durableRowsOf } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

export async function expectTicketDiskContents(
  recorder: SessionRecordingPort,
  count: number,
  expected: (index: number) => IContent,
): Promise<void> {
  const rows = await durableRowsOf(recorder);
  expect(rows).toHaveLength(count);
  for (const [index, row] of rows.entries()) {
    expect(row).toStrictEqual(expected(index));
    expect(JSON.stringify(row)).toBe(JSON.stringify(expected(index)));
  }
}
