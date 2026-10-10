/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { JournalCursor } from './journalCursor.js';
import { JournalResolver } from './journalResolver.js';
import type { JournalReadCounters } from './journalCounters.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '../services/history/IContent.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import { HistoryMediaIndex } from '../storage/history-media-index.js';
import { historyOwnerIdFor } from '../storage/media-admission-service.js';
import { collectMediaReferences } from '../storage/media-reference-lifecycle.js';
import { MediaAdmissionService } from '../storage/media-admission-service.js';
import { verifyHistoryMedia } from '../storage/media-reference-lifecycle.js';

export class ResumeCursorBoot {
  private readonly reservationOwnerScope = `resume:${randomUUID()}`;
  private readonly reservations = new HistoryMediaIndex();
  private closed = false;
  private mediaAdopted = false;
  private active = false;
  private resolver: JournalResolver | undefined;

  private constructor(
    readonly cursor: JournalCursor,
    readonly filePath: string,
    readonly lastSeq: number,
    readonly watermark: number,
    readonly counters?: JournalReadCounters,
    private readonly mediaStore?: LocalMediaStore,
  ) {}

  get ownership(): JournalReadCounters['ownership'] {
    return this.counters?.ownership;
  }

  static async open(
    filePath: string,
    lastSeq: number,
    watermark: number,
    counters?: JournalReadCounters,
    mediaStore?: LocalMediaStore,
  ): Promise<ResumeCursorBoot> {
    if (
      !Number.isSafeInteger(lastSeq) ||
      lastSeq < 0 ||
      !Number.isSafeInteger(watermark) ||
      watermark < 0
    ) {
      throw new RangeError('Invalid resume sequence or byte watermark');
    }
    const handle = await open(filePath, 'r');
    try {
      if (watermark > (await handle.stat()).size)
        throw new RangeError('Resume watermark exceeds journal size');
      if (watermark > 0) {
        const last = Buffer.alloc(1);
        await handle.read(last, 0, 1, watermark - 1);
        if (last[0] !== 10)
          throw new RangeError(
            'Resume watermark is not a complete record boundary',
          );
      }
    } finally {
      await handle.close();
    }
    const cursor = await JournalCursor.open(filePath, { counters });
    return new ResumeCursorBoot(
      cursor,
      filePath,
      lastSeq,
      watermark,
      counters,
      mediaStore,
    );
  }

  async *streamRows(): AsyncIterable<IContent> {
    if (this.closed) throw new Error('Resume boot is closed');
    if (this.active) throw new Error('Resume boot stream already active');
    this.active = true;
    let complete = false;
    try {
      this.resolver = await JournalResolver.open(this.filePath, {
        counters: this.counters,
        maxBytes: this.watermark,
      });
      for await (const entry of this.resolver.resolve()) {
        if (entry.seq > this.lastSeq)
          throw new Error('Resume row exceeds sequence watermark');
        const prepared = await this.prepareRow(entry.content);
        try {
          yield prepared;
        } finally {
          await this.releasePreparedRow(prepared);
        }
      }
      complete = true;
    } finally {
      await this.resolver?.close();
      this.resolver = undefined;
      this.active = false;
      if (!complete) await this.close();
    }
  }

  private async releasePreparedRow(content: IContent): Promise<void> {
    this.ownership?.release(content);
    if (this.mediaAdopted) await this.releaseReservations();
  }

  private async prepareRow(content: IContent): Promise<IContent> {
    const context = {
      turnId: 'session-replay',
      source: 'session-replay',
      preserveLegacyMimeParameters: true,
      reservationOwnerScope: this.reservationOwnerScope,
    };
    const admission =
      this.mediaStore === undefined
        ? undefined
        : new MediaAdmissionService(this.mediaStore);
    const rows =
      admission === undefined
        ? [content]
        : await admission.admitContents([content], context);
    for (const row of rows) this.ownership?.retain(row);
    let prepared: IContent | undefined;
    try {
      try {
        for (const reference of collectMediaReferences(rows))
          this.reservations.set(reference);
        await verifyHistoryMedia(rows, this.mediaStore, 'session-replay');
        prepared = invalidateResponsesStatefulChain(rows)[0];
        this.ownership?.retain(prepared);
      } catch (error) {
        await admission?.releaseContents(rows, context);
        throw error;
      }
      return prepared;
    } catch (error) {
      if (prepared !== undefined) this.ownership?.release(prepared);
      throw error;
    } finally {
      for (const row of rows) this.ownership?.release(row);
    }
  }

  async markMediaAdopted(): Promise<void> {
    await this.releaseReservations();
    this.mediaAdopted = true;
  }

  private async releaseReservations(): Promise<void> {
    try {
      for (const reference of this.reservations.values(this.ownership)) {
        await this.mediaStore?.release(
          reference.contentId,
          historyOwnerIdFor(reference.contentId, this.reservationOwnerScope),
        );
        this.reservations.delete(reference.contentId);
      }
    } finally {
      this.reservations.close();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.resolver?.close();
    } finally {
      try {
        await this.cursor.close();
      } finally {
        await this.releaseReservations();
      }
    }
  }
}
