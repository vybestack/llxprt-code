/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  HistoryMediaOwner,
  PreparedHistoryBatchEffect,
} from '../services/history/historyBatchContracts.js';
import { ChronologyStamper } from '../services/history/historyChronology.js';
import type { ContextRange } from '../services/history/historyEventTypes.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { SpanWindow } from '../services/history/historySpanWindow.js';
import type {
  JournalAdoption,
  JournalHistoryStore,
} from '../services/history/journalHistoryStore.js';
import { collectMediaReferences } from '../storage/media-reference-lifecycle.js';
import type { JournalRecordingService } from './journalRecordingService.js';
import { resumedRows, type ResumePoint } from './journalResume.js';

/** What the service derives from a resumed history: one pass, nothing kept but these. */
export interface JournalResumeState {
  readonly chronology: ChronologyStamper;
  readonly tokens: number;
  readonly range: ContextRange;
}

/**
 * Reads the resumed history once, through {@link resumedRows}, and derives
 * the chronology counters, the token total and the context range. Rows carry
 * their chronology from the time they were written, so nothing is stamped
 * onto them (design 4.6).
 */
export async function deriveJournalResumeState(
  recording: JournalRecordingService,
  point: ResumePoint,
  estimate: (contents: readonly IContent[]) => Promise<number>,
): Promise<JournalResumeState> {
  const session = await recording.session();
  const chronology = new ChronologyStamper();
  const spans = new SpanWindow();
  let tokens = 0;
  let firstSeq = 0;
  let lastSeq = 0;
  let totalEntries = 0;
  for await (const { content: row } of resumedRows(session, point)) {
    const marker = row.metadata?.chronology;
    if (marker !== undefined) chronology.stamp(row);
    if (totalEntries === 0) firstSeq = marker?.seq ?? 0;
    lastSeq = marker?.seq ?? 0;
    totalEntries += 1;
    tokens += await estimate([row]);
    const replaced = row.metadata?.chronologyReplaced;
    if (replaced) {
      spans.set([
        ...spans.get(),
        { start: replaced.fromSeq, end: replaced.toSeq, reason: 'compressed' },
      ]);
    }
  }
  return {
    chronology,
    tokens,
    range: {
      firstSeq,
      lastSeq,
      totalEntries,
      approximate: false,
      removedInterior: spans.get(),
    },
  };
}

async function* resumedReferences(
  recording: JournalRecordingService,
  point: ResumePoint,
): AsyncIterable<MediaReferenceBlock> {
  const session = await recording.session();
  for await (const { content } of resumedRows(session, point)) {
    yield* collectMediaReferences([content]);
  }
}

export interface JournalResumeAdoptionInput {
  journal: JournalHistoryStore;
  recording: JournalRecordingService;
  resumePoint: ResumePoint;
  mediaOwner?: HistoryMediaOwner;
  estimate: (contents: readonly IContent[]) => Promise<number>;
  /** Puts the derived state into the service. */
  publish: (state: JournalResumeState) => void;
  /** Takes back what `publish` changed. */
  restore: () => void;
  afterPublication: () => void | Promise<void>;
}

/**
 * Resumes a history onto a journal recorder (decision G5). The prior store
 * stays in place until every step has succeeded: on a failure the adoption
 * and the media effect are rolled back, `restore` takes the service state
 * back, and the error is thrown (with the rollback failures when there are
 * any). The prior store is closed after the swap; a failure to close it is
 * returned as a warning because the resume has already happened.
 */
export async function adoptResumedJournal(
  input: JournalResumeAdoptionInput,
): Promise<string[]> {
  const { mediaOwner } = input;
  if (mediaOwner && !mediaOwner.prepareReferenceReplacement) {
    throw new Error('History media owner does not support journal adoption');
  }
  let adoption: JournalAdoption | undefined;
  let media: PreparedHistoryBatchEffect | undefined;
  try {
    const state = await deriveJournalResumeState(
      input.recording,
      input.resumePoint,
      input.estimate,
    );
    adoption = await input.journal.adoptJournal(
      input.recording,
      input.resumePoint,
    );
    media = await mediaOwner?.prepareReferenceReplacement?.(
      resumedReferences(input.recording, input.resumePoint),
    );
    await media?.publish();
    input.publish(state);
    await input.afterPublication();
  } catch (error) {
    await rollBack(error, [
      () => adoption?.rollback(),
      () => media?.rollback(),
      input.restore,
    ]);
  }
  const warnings: string[] = [];
  for (const cleanup of [() => adoption?.commit(), () => media?.finalize?.()]) {
    try {
      await cleanup();
    } catch (error) {
      warnings.push(
        `Journal adoption committed but cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return warnings;
}

async function rollBack(
  error: unknown,
  steps: ReadonlyArray<() => unknown>,
): Promise<never> {
  const failures: unknown[] = [error];
  for (const step of steps) {
    try {
      await Promise.resolve(step());
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      `Resume adoption rollback failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  throw error;
}
