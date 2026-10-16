/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendFileSync } from 'node:fs';
import type { IContent } from './IContent.js';
import {
  rejectedValue,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';
import { withPhaseFixture } from './snapshot-phase-test-helpers.js';

export type CallerFixture = Parameters<
  Parameters<typeof withPhaseFixture>[0]
>[0];

function emit(record: object): void {
  const output = process.env['CALLER_STAGE_OUTPUT'];
  if (output !== undefined)
    appendFileSync(output, JSON.stringify(record) + '\n');
}

export async function withCallerFixture(
  action: (fixture: CallerFixture) => Promise<void>,
): Promise<void> {
  await withPhaseFixture(async (fixture) => {
    const unsubscribe = fixture.recorder.onCommitWatermark((watermark) => {
      emit({
        stage: 'actual-recorder-commit-watermark',
        watermark,
        references: fixture.owners.references,
      });
    });
    try {
      await action(fixture);
    } finally {
      unsubscribe();
    }
  });
}

export function callerRow(): IContent {
  return {
    ...rollbackRow(0),
    metadata: { chronology: { seq: 1, userTurn: 1, step: 1, recordedAt: 42 } },
  };
}

export function witness(
  stage: string,
  fixture: CallerFixture,
  row: IContent,
): void {
  emit({
    stage,
    callerId: fixture.owners.identity(row),
    owners: {
      ...fixture.owners.snapshot(),
      references: fixture.owners.references,
    },
    transaction: {
      ...fixture.transaction.snapshot(),
      references: fixture.transaction.references,
    },
    events: fixture.owners.events,
  });
}

function traceTickets(fixture: CallerFixture, row: IContent): void {
  const captured = fixture.store.capturePendingFold();
  try {
    const first = captured.pending.read(0).op;
    const second = captured.pending.read(0).op;
    if (first.kind !== 'content' || second.kind !== 'content')
      throw new Error('Missing content ticket');
    emit({
      stage: 'actual-pinned-disk-ticket-reads',
      pendingLength: captured.pendingLength,
      firstIsCaller: first.content === row,
      secondIsFirst: second.content === first.content,
      markerIsCaller:
        first.content.metadata?.chronology === row.metadata?.chronology,
      valueEquality: JSON.stringify(first.content) === JSON.stringify(row),
    });
  } finally {
    captured.release();
  }
}

export async function borrowCaller(
  fixture: CallerFixture,
  row: IContent,
  primary: Error,
  retain = false,
  signal?: AbortSignal,
  cancel?: () => void,
): Promise<{ borrowed: IContent; error: unknown; readerClosed: boolean }> {
  traceTickets(fixture, row);
  let borrowed: IContent | undefined;
  let reader: Generator<IContent, void, unknown> | undefined;
  const error = await rejectedValue(
    fixture.store.withMutationSnapshot(async (snapshot) => {
      reader = snapshot[Symbol.iterator]();
      const result = reader.next();
      if (result.done === true) throw new Error('Missing pending caller row');
      borrowed = result.value;
      if (retain) fixture.owners.retain(borrowed);
      emit({
        stage: 'borrowed-before-callback-failure',
        rowIdentity: borrowed === row,
        markerIdentity:
          borrowed.metadata?.chronology === row.metadata?.chronology,
        borrowedId: fixture.owners.identity(borrowed),
        callerId: fixture.owners.identity(row),
      });
      witness('reader-held', fixture, row);
      cancel?.();
      signal?.throwIfAborted();
      throw primary;
    }, signal),
  );
  if (borrowed === undefined || reader === undefined) throw error;
  const readerClosed = reader.next().done === true;
  witness('callback-exited-reader-closed', fixture, row);
  return { borrowed, error, readerClosed };
}
