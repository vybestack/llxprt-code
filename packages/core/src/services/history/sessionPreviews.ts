/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalRecordingService } from '../../recording/journalRecordingService.js';

/**
 * Whether the recorder bound for `recorderOrigin` holds a row written under
 * `rowOrigin`: its own rows and the unowned ones (design 5.3).
 */
export function recorderAcceptsRow(
  recorderOrigin: string | undefined,
  rowOrigin: string | undefined,
): boolean {
  return rowOrigin === undefined || rowOrigin === recorderOrigin;
}

interface FirstUserRow {
  readonly text: string;
  readonly order: number;
}

/**
 * The first user row of each origin of one history (decision G7): at most
 * one short text per origin, so the history needs no row to answer which row
 * is the first one a recorder accepts.
 */
export class SessionPreviews {
  private offered = 0;
  private readonly firsts = new Map<string | undefined, FirstUserRow>();

  /** Whether `origin` already has its first user row, so a later one is of no use. */
  has(origin: string | undefined): boolean {
    return this.firsts.has(origin);
  }

  offer(origin: string | undefined, text: string): void {
    if (this.firsts.has(origin)) return;
    this.firsts.set(origin, { text, order: this.offered });
    this.offered += 1;
  }

  /**
   * Writes into `recorder` the earliest first user row it accepts, if any. The
   * attach that calls it returns with the preview written, so no write of it
   * is still in flight.
   */
  async recordFirstFor(
    recorder: JournalRecordingService,
    origin: string | undefined,
  ): Promise<void> {
    const preview = this.first((rowOrigin) =>
      recorderAcceptsRow(origin, rowOrigin),
    );
    if (preview === undefined) return;
    recorder.recordFirstUserPreview(preview);
    await recorder.flush();
  }

  /** The earliest first user row among the origins `accepts` selects. */
  first(
    accepts: (rowOrigin: string | undefined) => boolean,
  ): string | undefined {
    let found: FirstUserRow | undefined;
    for (const [origin, row] of this.firsts) {
      if (accepts(origin) && (found === undefined || row.order < found.order)) {
        found = row;
      }
    }
    return found?.text;
  }
}
