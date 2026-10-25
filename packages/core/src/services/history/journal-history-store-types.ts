/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import type { JournalRecordingService } from '../../recording/journalRecordingService.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { JournalSession } from './journalSession.js';
import type { JournalOwners } from './journalOwners.js';
import type { JournalMirrors } from './journalMirrors.js';

/** The published repair owns its original version's pin until `close`. */
export interface JournalRepair {
  readonly inserted: IContent[];
  rollback(): Promise<void>;
  close(): void | Promise<void>;
}

/** Opens the journal a store keeps its rows in; it must yield an empty journal. */
export type JournalSessionOpener = () =>
  | JournalSession
  | Promise<JournalSession>;

export interface JournalHistoryStoreOptions {
  /** Bound as a mirror right after the journal is open (decision D-W7-3). */
  readonly recording?: JournalRecordingService;
  /** Observes every row the stream and batch readers decode (WIRING G9). */
  readonly counters?: JournalReadCounters;
}

/** What opening the journal builds: the file and the bookkeeping over it. */
export interface OpenJournal {
  readonly session: JournalSession;
  readonly owners: JournalOwners;
  readonly mirrors: JournalMirrors;
}
