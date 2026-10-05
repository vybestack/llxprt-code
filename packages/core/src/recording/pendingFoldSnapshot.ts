/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SessionRecordingService } from './SessionRecordingService.js';
import type {
  HistoryPendingTickets,
  PendingHistoryTicket,
} from '../services/history/history-pending-tickets.js';
import type { ValueTicketReader } from './synchronous-value-spool.js';
import type { ResumeProjection } from '../services/history/historyResumeProjection.js';
import { pinReadableFile, type PinnedFile } from './durableRowFold.js';

/** Private fold input with pinned disk tickets and scalar membership boundaries. */
export interface PendingFoldSnapshot {
  readonly pending: ValueTicketReader<PendingHistoryTicket>;
  readonly pendingLength: number;
  readonly filePath: string | null;
  readonly durableTail: number;
  readonly resumeBoundary: number;
  readonly projectionPath?: string;
  readonly pinnedJournal: PinnedFile | null;
  readonly pinnedProjection: PinnedFile | null;
  release(): void;
}

interface FoldBinding {
  readonly recorder: SessionRecordingService | undefined;
  readonly seeded: boolean;
  readonly durableTail: number;
  readonly pending: HistoryPendingTickets;
  readonly resumeBoundary?: number;
  readonly projection?: ResumeProjection;
}

function pinJournal(
  path: string,
  externallySeeded: boolean,
): PinnedFile | null {
  try {
    return pinReadableFile(path);
  } catch (error) {
    if (externallySeeded && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return null;
    throw error;
  }
}

/**
 * Capture membership and binding together, and pin every readable descriptor
 * synchronously, before any await. Retirement, adoption, commit, and unlink
 * therefore cannot invalidate a fold that reads through the pinned inodes.
 */
export function capturePendingFold(binding: FoldBinding): PendingFoldSnapshot {
  const pending = binding.pending.capture();
  const filePath = binding.recorder?.getFilePath() ?? null;
  const resumeBoundary = binding.resumeBoundary ?? 0;
  const projectionPath = binding.projection?.filePath;
  const externallySeeded =
    !binding.seeded && binding.durableTail === 0 && pending.length === 0;
  let pinnedJournal: PinnedFile | null = null;
  let pinnedProjection: PinnedFile | null = null;
  const release = (): void => {
    try {
      pinnedProjection?.release();
    } finally {
      try {
        pinnedJournal?.release();
      } finally {
        pending.close();
      }
    }
  };
  try {
    if (filePath !== null && (binding.durableTail > 0 || externallySeeded))
      pinnedJournal = pinJournal(filePath, externallySeeded);
    const durableTail =
      externallySeeded && pinnedJournal !== null
        ? pinnedJournal.size
        : binding.durableTail;
    if (durableTail > 0 && resumeBoundary > 0 && projectionPath !== undefined)
      pinnedProjection = pinReadableFile(projectionPath);
    return {
      pending,
      pendingLength: pending.length,
      filePath,
      durableTail,
      resumeBoundary,
      projectionPath,
      pinnedJournal,
      pinnedProjection,
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
