/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ResumeCursorBoot } from '../../recording/resumeCursorBoot.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import type { HistoryJournalStore } from './historyJournalStore.js';
import type {
  HistoryMediaOwner,
  PreparedHistoryBatchEffect,
} from './historyBatchContracts.js';
import { ChronologyStamper } from './historyChronology.js';
import { collectMediaReferences } from '../../storage/media-reference-lifecycle.js';
import type { ContextRange } from './historyEventTypes.js';
import { SpanWindow } from './historySpanWindow.js';
import { rm } from 'node:fs/promises';
import {
  writeResumeProjection,
  persistResumeChronology,
  type ResumeProjection,
} from './historyResumeProjection.js';

export interface ResumeDerivedState {
  readonly chronology: ChronologyStamper;
  readonly tokens: number;
  readonly range: ContextRange;
}

export async function deriveResumeState(
  boot: ResumeCursorBoot,
  estimate: (contents: readonly IContent[]) => Promise<number>,
): Promise<
  ResumeDerivedState & {
    projection: ResumeProjection;
  }
> {
  const chronology = new ChronologyStamper();
  for await (const row of boot.streamRows()) {
    if (row.metadata?.chronology !== undefined) chronology.stamp(row);
  }
  const spans = new SpanWindow();
  let tokens = 0;
  let firstSeq = 0;
  let lastSeq = 0;
  let totalEntries = 0;
  const projection = await writeResumeProjection(
    boot.streamRows(),
    async (row) => {
      chronology.stamp(row);
      const marker = row.metadata?.chronology;
      if (totalEntries === 0) firstSeq = marker?.seq ?? 0;
      lastSeq = marker?.seq ?? 0;
      totalEntries += 1;
      tokens += await estimate([row]);
      const replaced = row.metadata?.chronologyReplaced;
      if (replaced)
        spans.set([
          ...spans.get(),
          {
            start: replaced.fromSeq,
            end: replaced.toSeq,
            reason: 'compressed',
          },
        ]);
    },
  );
  return {
    projection,
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

export async function adoptResumeJournal(input: {
  journal: HistoryJournalStore;
  recording: SessionRecordingService;
  boot: ResumeCursorBoot;
  mediaOwner?: HistoryMediaOwner;
  estimate: (contents: readonly IContent[]) => Promise<number>;
  publish: (state: ResumeDerivedState) => void;
  restore: () => void;
  afterPublication: () => void | Promise<void>;
}): Promise<string[]> {
  if (input.mediaOwner && !input.mediaOwner.prepareReferenceReplacement)
    throw new Error('History media owner does not support journal adoption');
  let media: PreparedHistoryBatchEffect | undefined;
  let adoption: ReturnType<HistoryJournalStore['adoptJournal']> | undefined;
  let projection: ResumeProjection | undefined;
  try {
    const state = await deriveResumeState(input.boot, input.estimate);
    projection = state.projection;
    adoption = input.journal.adoptJournal(
      input.recording,
      { seq: input.boot.lastSeq, byteOffset: input.boot.watermark },
      true,
      projection,
    );
    media = await input.mediaOwner?.prepareReferenceReplacement?.(
      streamResumeReferences(input.boot),
      input.boot.ownership,
    );
    await media?.publish();
    input.publish(state);
    await input.afterPublication();
    const watermark = await persistResumeChronology(
      projection,
      input.recording,
      input.boot,
    );
    adoption.useDurableProjection(watermark);
  } catch (error) {
    const failures: unknown[] = [error];
    for (const rollback of [
      () => adoption?.rollback(),
      () => media?.rollback(),
      input.restore,
      () =>
        projection &&
        rm(projection.directory, { recursive: true, force: true }),
      () => input.boot.close(),
    ]) {
      try {
        await Promise.resolve(rollback());
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        `Resume adoption rollback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    throw error;
  }
  const warnings: string[] = [];
  for (const cleanup of [
    () => adoption.commit(),
    () => rm(projection.directory, { recursive: true, force: true }),
    async () => {
      await media?.finalize?.();
      if (media) await input.boot.markMediaAdopted();
    },
  ]) {
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

async function* streamResumeReferences(
  boot: ResumeCursorBoot,
): AsyncIterable<MediaReferenceBlock> {
  for await (const row of boot.streamRows()) {
    for (const reference of collectMediaReferences([row])) {
      boot.ownership?.retain(reference);
      try {
        yield reference;
      } finally {
        boot.ownership?.release(reference);
      }
    }
  }
}
