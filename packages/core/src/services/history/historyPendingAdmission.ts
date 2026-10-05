/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type {
  CommitWatermark,
  SessionRecordLine,
} from '../../recording/types.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { HistoryJournalOp } from './historyJournalStore.js';
import type { HistoryPendingTickets } from './history-pending-tickets.js';
import { opToEnvelope } from './historyJournalEnvelope.js';
import { journalPublicationOwners } from './historyPublicationOwners.js';

export function admitHistoryPending(
  recorder: SessionRecordingService,
  op: HistoryJournalOp,
  ownership?: RowOwnership,
): { readonly line: SessionRecordLine | null } {
  const { type, payload } = opToEnvelope(op);
  for (const owner of journalPublicationOwners(op)) ownership?.retain(owner);
  try {
    return { line: recorder.enqueue(type, payload) };
  } finally {
    for (const owner of journalPublicationOwners(op)) ownership?.release(owner);
  }
}

interface PendingHistoryBinding {
  pending: HistoryPendingTickets;
  durableTail: number;
  rowCount: number | null;
  externalBoundarySeq: number | null;
  lastLine: SessionRecordLine | null;
  readonly lastSeq: number | null;
  unsubscribeWatermark?: () => void;
}

export function absorbHistoryPending(
  binding: PendingHistoryBinding,
  seq: number,
  watermark: CommitWatermark,
): void {
  const externalGapCovered =
    binding.externalBoundarySeq !== null &&
    watermark.seq >= binding.externalBoundarySeq;
  const beyondLocalTail =
    binding.lastSeq !== null && watermark.seq > binding.lastSeq;
  if (
    watermark.byteOffset > binding.durableTail &&
    (externalGapCovered || beyondLocalTail)
  )
    binding.rowCount = null;
  if (
    externalGapCovered &&
    binding.lastSeq !== null &&
    watermark.seq >= binding.lastSeq
  )
    binding.externalBoundarySeq = null;
  binding.durableTail = Math.max(binding.durableTail, watermark.byteOffset);
  binding.pending.acknowledge(seq);
  binding.lastLine = null;
}

export function retireHistoryPending(binding: PendingHistoryBinding): void {
  binding.unsubscribeWatermark?.();
  binding.unsubscribeWatermark = undefined;
  binding.pending.close();
  binding.lastLine = null;
}
