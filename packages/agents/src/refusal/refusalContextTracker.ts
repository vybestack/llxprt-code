/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { CompressionAuditProvenance } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { RefusalContextFingerprint } from './refusalAudit.js';

const MAX_PREVIEW_ENTRIES = 128;
const MAX_PREVIEW_BYTES = 32 * 1024;

interface ContextEntryPreview {
  readonly identity: string;
  readonly speaker: string;
  readonly preview: string;
  readonly content_hash: string;
}

interface EntrySnapshot extends ContextEntryPreview {
  readonly compression: boolean;
  readonly recordedAt: number | null;
  readonly seq: number | undefined;
}

/** The request rows one send reads: count plus random access by position. */
export type RefusalContextRows = Pick<ProviderRequestRows, 'count' | 'readAt'>;

function contentText(content: IContent): string {
  return content.blocks
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'thinking') return block.thought;
      if (block.type === 'tool_call')
        return `${block.name} ${JSON.stringify(block.parameters)}`;
      if (block.type === 'tool_response')
        return `${block.toolName} ${JSON.stringify(block.result)}`;
      return '';
    })
    .join('\n');
}

function snapshotEntry(content: IContent, index: number): EntrySnapshot {
  const text = contentText(content);
  const contentHash = createHash('sha256').update(text).digest('hex');
  const chronology = content.metadata?.chronology;
  const reason = content.metadata?.reason;
  return {
    identity:
      chronology === undefined
        ? `position:${index}:${content.speaker}`
        : `seq:${chronology.seq}`,
    speaker: content.speaker,
    preview: text,
    content_hash: contentHash,
    compression:
      reason === 'compression-state-snapshot' ||
      reason === 'compression-continuation',
    recordedAt: chronology?.recordedAt ?? null,
    seq: chronology?.seq,
  };
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[items.length - 1];
}

const encoder = new TextEncoder();

interface Baseline {
  /** Highest chronology seq committed by the last successful attempt. */
  readonly seq: number;
  readonly promptId: string;
  readonly attemptIndex: number;
  readonly time: string;
}

/**
 * Newest-first bounded collector: keeps at most MAX_PREVIEW_ENTRIES previews
 * within MAX_PREVIEW_BYTES, so memory never depends on history length.
 */
class PreviewWindow {
  readonly added: ContextEntryPreview[] = [];
  readonly pending: ContextEntryPreview[] = [];
  omitted = 0;
  private kept = 0;
  private usedBytes = 0;

  offer(kind: 'added' | 'pending', entry: EntrySnapshot): void {
    const bytes = encoder.encode(entry.preview).byteLength;
    if (
      this.kept >= MAX_PREVIEW_ENTRIES ||
      bytes > MAX_PREVIEW_BYTES - this.usedBytes
    ) {
      this.omitted++;
      return;
    }
    this.kept++;
    this.usedBytes += bytes;
    const preview: ContextEntryPreview = {
      identity: entry.identity,
      speaker: entry.speaker,
      preview: entry.preview,
      content_hash: entry.content_hash,
    };
    (kind === 'added' ? this.added : this.pending).unshift(preview);
  }
}

/** True when the row's chronology seq is at or below the given watermark. */
function coveredBy(seq: number | undefined, watermark: number | undefined) {
  return seq !== undefined && watermark !== undefined && seq <= watermark;
}

/** Accumulates the rows one snapshot reads: previews, counts and the digest. */
class ContextScan {
  readonly window = new PreviewWindow();
  private readonly digest = createHash('sha256');
  added = 0;
  scanned = 0;
  compressions = 0;
  latestRecordedCompression: EntrySnapshot | undefined;

  accept(entry: EntrySnapshot): void {
    const pending = entry.seq === undefined;
    if (!pending) {
      this.added++;
      if (entry.compression) {
        this.compressions++;
        this.latestRecordedCompression ??= entry;
      }
    }
    this.window.offer(pending ? 'pending' : 'added', entry);
    this.digest.update(entry.identity);
    this.digest.update('\0');
    this.digest.update(entry.speaker);
    this.digest.update('\0');
    this.digest.update(entry.content_hash);
    this.digest.update('\n');
  }

  finish(unread: number): string {
    if (unread > 0) this.digest.update(`unread:${unread}\n`);
    return this.digest.digest('hex');
  }
}

/**
 * Reads request rows newest first. Stops at the first row `stopSeq` covers,
 * or after MAX_PREVIEW_ENTRIES rows when there is no stop watermark; rows the
 * baseline covers are scanned but not accepted.
 */
async function scanRequestRows(
  rows: RefusalContextRows,
  signal: AbortSignal | undefined,
  baselineSeq: number | undefined,
  stopSeq: number | undefined,
): Promise<ContextScan> {
  const scan = new ContextScan();
  const bounded = stopSeq === undefined;
  for (
    let index = rows.count - 1;
    index >= 0 && !(bounded && scan.scanned >= MAX_PREVIEW_ENTRIES);
    index--
  ) {
    const entry = snapshotEntry(await rows.readAt(index, signal), index);
    if (coveredBy(entry.seq, stopSeq)) break;
    scan.scanned++;
    if (!coveredBy(entry.seq, baselineSeq)) scan.accept(entry);
  }
  return scan;
}

function recordedTime(entry: EntrySnapshot | undefined): string | null {
  return entry?.recordedAt == null
    ? null
    : new Date(entry.recordedAt).toISOString();
}

/**
 * Session-local refusal context cursor on the journal design (#4101, #854).
 * The baseline is the chronology watermark of the last successful commit, not
 * a copy of the history: a send reads its request rows newest first by
 * position and stops at the first row the baseline already covers, so only
 * rows added since the last success are decoded. Rows without a chronology
 * stamp are send-time additions that the journal has not committed (pending).
 * Without a baseline, or after a compression rewrote older rows, the scan is
 * bounded to the preview window and the unread rows are counted as added and
 * omitted; the digest then covers the read window plus the row count.
 */
export class RefusalContextTracker {
  private baseline: Baseline | undefined;
  private readonly compressionEvents: Array<{
    readonly time: string;
    readonly provenance: CompressionAuditProvenance;
  }> = [];

  recordCompression(provenance: CompressionAuditProvenance): void {
    this.compressionEvents.push({ time: new Date().toISOString(), provenance });
  }

  async snapshot(
    rows: RefusalContextRows,
    signal?: AbortSignal,
  ): Promise<RefusalContextFingerprint> {
    const baseline = this.baseline;
    const stopSeq =
      baseline !== undefined && this.compressionEvents.length === 0
        ? baseline.seq
        : undefined;
    const scan = await scanRequestRows(rows, signal, baseline?.seq, stopSeq);
    const unread = stopSeq === undefined ? rows.count - scan.scanned : 0;
    const latestCompression = lastOf(this.compressionEvents);
    const provenance = latestCompression?.provenance;
    return {
      baseline_available: baseline !== undefined,
      baseline_prompt_id: baseline?.promptId ?? null,
      baseline_attempt_index: baseline?.attemptIndex ?? null,
      baseline_time: baseline?.time ?? null,
      added_entries: scan.window.added,
      added_entry_count: scan.added + unread,
      omitted_entry_count: scan.window.omitted + unread,
      pending_entries: scan.window.pending,
      compression_count:
        this.compressionEvents.length > 0
          ? this.compressionEvents.length
          : scan.compressions,
      last_compression_time:
        latestCompression?.time ?? recordedTime(scan.latestRecordedCompression),
      summary_author_model: provenance?.summaryAuthorModel ?? null,
      summary_author_provider: provenance?.summaryAuthorProvider ?? null,
      compression_strategy:
        provenance?.compressionStrategy ??
        (scan.compressions === 0 ? null : 'compression'),
      digest: scan.finish(unread),
      prompt_tokens: null,
      cache_read_tokens: null,
    };
  }

  /** Advances the baseline to the journal's chronology watermark after a successful attempt. */
  commit(watermarkSeq: number, promptId: string, attemptIndex: number): void {
    this.baseline = {
      seq: watermarkSeq,
      promptId,
      attemptIndex,
      time: new Date().toISOString(),
    };
    this.compressionEvents.length = 0;
  }

  resetBaseline(): void {
    this.baseline = undefined;
  }

  reset(): void {
    this.baseline = undefined;
    this.compressionEvents.length = 0;
  }
}
