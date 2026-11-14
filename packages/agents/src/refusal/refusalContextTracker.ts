/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
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
}

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
  };
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[items.length - 1];
}

function boundedPreviews(entries: readonly EntrySnapshot[]): {
  previews: ContextEntryPreview[];
  omitted: number;
} {
  const previews: ContextEntryPreview[] = [];
  let remaining = MAX_PREVIEW_BYTES;
  let omitted = Math.max(0, entries.length - MAX_PREVIEW_ENTRIES);
  for (const entry of entries.slice(-MAX_PREVIEW_ENTRIES)) {
    const bytes = new TextEncoder().encode(entry.preview).byteLength;
    if (bytes > remaining) {
      omitted++;
      continue;
    }
    remaining -= bytes;
    previews.push({
      identity: entry.identity,
      speaker: entry.speaker,
      preview: entry.preview,
      content_hash: entry.content_hash,
    });
  }
  return { previews, omitted };
}

/** Compact session-local cursor; it retains hashes/previews, never IContent objects. */
export class RefusalContextTracker {
  private baseline: readonly EntrySnapshot[] | undefined;
  private baselinePromptId: string | null = null;
  private baselineAttemptIndex: number | null = null;
  private baselineTime: string | null = null;
  private readonly compressionEvents: Array<{
    readonly time: string;
    readonly provenance: CompressionAuditProvenance;
  }> = [];

  recordCompression(provenance: CompressionAuditProvenance): void {
    this.compressionEvents.push({ time: new Date().toISOString(), provenance });
  }

  snapshot(
    committed: readonly IContent[],
    requestContents: readonly IContent[],
  ): RefusalContextFingerprint {
    const current = committed.map(snapshotEntry);
    const baselineEntries = new Set(
      this.baseline?.map(
        (entry) => `${entry.identity}:${entry.content_hash}`,
      ) ?? [],
    );
    const added = current.filter(
      (entry) =>
        !baselineEntries.has(`${entry.identity}:${entry.content_hash}`),
    );
    const committedEntries = new Set(
      current.map((entry) => `${entry.identity}:${entry.content_hash}`),
    );
    const pending = requestContents
      .map(snapshotEntry)
      .filter(
        (entry) =>
          !committedEntries.has(`${entry.identity}:${entry.content_hash}`),
      );
    const previews = boundedPreviews([...added, ...pending]);
    const digest = createHash('sha256');
    for (const entry of [...added, ...pending]) {
      digest.update(entry.identity);
      digest.update('\0');
      digest.update(entry.speaker);
      digest.update('\0');
      digest.update(entry.content_hash);
      digest.update('\n');
    }
    const compressions = added.filter((entry) => entry.compression);
    const latestCompression = lastOf(this.compressionEvents);
    const latestRecordedCompression = lastOf(compressions);
    const lastCompressionTime =
      latestCompression?.time ??
      (latestRecordedCompression?.recordedAt == null
        ? null
        : new Date(latestRecordedCompression.recordedAt).toISOString());
    return {
      baseline_available: this.baseline !== undefined,
      baseline_prompt_id: this.baselinePromptId,
      baseline_attempt_index: this.baselineAttemptIndex,
      baseline_time: this.baselineTime,
      added_entries: previews.previews.slice(0, added.length),
      added_entry_count: added.length,
      omitted_entry_count: previews.omitted,
      pending_entries: previews.previews.slice(added.length),
      compression_count:
        this.compressionEvents.length > 0
          ? this.compressionEvents.length
          : compressions.length,
      last_compression_time: lastCompressionTime,
      summary_author_model:
        latestCompression?.provenance.summaryAuthorModel ?? null,
      summary_author_provider:
        latestCompression?.provenance.summaryAuthorProvider ?? null,
      compression_strategy:
        latestCompression?.provenance.compressionStrategy ??
        (compressions.length === 0 ? null : 'compression'),
      digest: digest.digest('hex'),
      prompt_tokens: null,
      cache_read_tokens: null,
    };
  }

  commit(
    committed: readonly IContent[],
    promptId: string,
    attemptIndex: number,
  ): void {
    this.baseline = committed.map((content, index) => ({
      ...snapshotEntry(content, index),
      preview: '',
    }));
    this.baselinePromptId = promptId;
    this.baselineAttemptIndex = attemptIndex;
    this.baselineTime = new Date().toISOString();
    this.compressionEvents.length = 0;
  }

  resetBaseline(): void {
    this.baseline = undefined;
    this.baselinePromptId = null;
    this.baselineAttemptIndex = null;
    this.baselineTime = null;
  }

  reset(): void {
    this.baseline = undefined;
    this.baselinePromptId = null;
    this.baselineAttemptIndex = null;
    this.baselineTime = null;
    this.compressionEvents.length = 0;
  }
}
