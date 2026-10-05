/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { SessionRecordLine } from '../../recording/types.js';
import { HistoryPendingTickets } from './history-pending-tickets.js';
import type { ResumeProjection } from './historyResumeProjection.js';

export interface JournalBinding {
  readonly retired: Set<() => void>;
  recorder: SessionRecordingService | undefined;
  ownsRecorder: boolean;
  tempDir: string | null;
  pending: HistoryPendingTickets;
  unsubscribeWatermark?: () => void;
  rowCount: number | null;
  externalBoundarySeq: number | null;
  durableTail: number;
  seeded: boolean;
  lastLine: SessionRecordLine | null;
  lastSeq: number | null;
  readonly resumeBoundary?: number;
  readonly projection?: ResumeProjection;
}

export function journalBinding(
  recording?: SessionRecordingService,
): JournalBinding {
  return {
    retired: new Set(),
    recorder: recording,
    ownsRecorder: recording === undefined,
    tempDir: null,
    pending: new HistoryPendingTickets(),
    rowCount: recording === undefined ? 0 : null,
    externalBoundarySeq: null,
    durableTail: 0,
    seeded: false,
    lastLine: null,
    lastSeq: null,
  };
}
