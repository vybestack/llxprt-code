/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const PARTIAL_OUTPUT_LIMIT_BYTES = 32 * 1024;
const TRUNCATION_MARKER = '[truncated]';

export type PartialOutputItem =
  | {
      readonly type: 'text' | 'thinking';
      readonly text: string;
      readonly original_bytes: number;
      readonly truncated: boolean;
    }
  | {
      readonly type: 'tool_input';
      readonly id: string;
      readonly name: string;
      readonly input: string;
      readonly complete: boolean;
      readonly original_bytes: number;
      readonly truncated: boolean;
    };

export interface PartialOutputSnapshot {
  readonly items: readonly PartialOutputItem[];
  readonly truncated: boolean;
  readonly original_bytes: number;
  readonly preview_bytes: number;
  /** Items past the kept-item limit, counted in original_bytes only. */
  readonly omitted_items: number;
  /** SHA-256 over every streamed output block, kept or not. */
  readonly output_sha256: string;
}

export interface RefusalContextEntryPreview {
  readonly identity: string;
  readonly speaker: string;
  readonly preview: string;
  readonly content_hash: string;
}

export interface RefusalContextFingerprint {
  readonly baseline_available: boolean;
  readonly baseline_prompt_id: string | null;
  readonly baseline_attempt_index: number | null;
  readonly baseline_time: string | null;
  readonly added_entries: RefusalContextEntryPreview[];
  readonly added_entry_count: number;
  readonly omitted_entry_count: number;
  readonly pending_entries: RefusalContextEntryPreview[];
  readonly compression_count: number;
  readonly last_compression_time: string | null;
  readonly summary_author_model: string | null;
  readonly summary_author_provider: string | null;
  readonly compression_strategy: string | null;
  readonly digest: string;
  readonly prompt_tokens: number | null;
  readonly cache_read_tokens: number | null;
}

export function unavailableContextFingerprint(
  usage: UsageStats | undefined,
): RefusalContextFingerprint {
  return {
    baseline_available: false,
    baseline_prompt_id: null,
    baseline_attempt_index: null,
    baseline_time: null,
    added_entries: [],
    added_entry_count: 0,
    omitted_entry_count: 0,
    pending_entries: [],
    compression_count: 0,
    last_compression_time: null,
    summary_author_model: null,
    summary_author_provider: null,
    compression_strategy: null,
    digest: createHash('sha256').update('').digest('hex'),
    prompt_tokens: usage?.promptTokens ?? null,
    cache_read_tokens:
      usage?.cache_read_input_tokens ?? usage?.cachedTokens ?? null,
  };
}

/** Most items one refusal record keeps; later items are counted and hashed only. */
const PARTIAL_OUTPUT_ITEM_LIMIT = 64;

type RecordedItem =
  | {
      readonly type: 'text' | 'thinking';
      text: string;
      originalBytes: number;
      readonly streamId?: string;
    }
  | {
      readonly type: 'tool_input';
      readonly id: string;
      readonly name: string;
      text: string;
      originalBytes: number;
      complete: boolean;
    };

type AuditToolInputs = NonNullable<ModelOutput['refusalAuditToolInputs']>;

const encoder = new TextEncoder();

function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}

/** Prefix of value within limit bytes, without splitting a code point. */
function prefixUtf8(value: string, limit: number): string {
  if (value.length * 3 <= limit) return value;
  const buffer = new Uint8Array(limit);
  const { read } = encoder.encodeInto(value, buffer);
  return read === value.length ? value : value.slice(0, read);
}

function truncateUtf8(value: string, original: number, limit: number): string {
  if (original <= limit) return value;
  const markerBytes = utf8Length(TRUNCATION_MARKER);
  if (limit <= markerBytes) return '';
  return `${prefixUtf8(value, limit - markerBytes)}${TRUNCATION_MARKER}`;
}

/**
 * Bounded record of an attempt's streamed output, fed one chunk at a time so a
 * refusal can be audited without keeping the whole response (#4101 on the
 * journal design, #854). Each kept item retains at most
 * PARTIAL_OUTPUT_LIMIT_BYTES of text and at most PARTIAL_OUTPUT_ITEM_LIMIT items
 * are kept; total byte length and a SHA-256 over everything streamed cover the
 * rest.
 */
export class PartialOutputRecorder {
  private readonly items: RecordedItem[] = [];
  private readonly thinkingStreams = new Map<string, RecordedItem | number>();
  private omittedItems = 0;
  private omittedBytes = 0;
  private toolInputs: AuditToolInputs | undefined;
  private readonly hash = createHash('sha256');

  add(output: Pick<ModelOutput, 'content' | 'refusalAuditToolInputs'>): void {
    if (output.refusalAuditToolInputs !== undefined)
      this.toolInputs = output.refusalAuditToolInputs;
    for (const block of output.content.blocks) {
      if (block.type === 'text') this.addText(block.text);
      else if (block.type === 'thinking')
        this.addThinking(block.thought, block.streamId);
      else if (block.type === 'tool_call')
        this.addItem({
          type: 'tool_input',
          id: block.id,
          name: block.name,
          ...this.capture(JSON.stringify(block.parameters)),
          complete: true,
        });
    }
  }

  private capture(text: string): { text: string; originalBytes: number } {
    this.hash.update(text);
    this.hash.update('\0');
    return {
      text: prefixUtf8(text, PARTIAL_OUTPUT_LIMIT_BYTES),
      originalBytes: utf8Length(text),
    };
  }

  private addText(text: string): void {
    const last =
      this.items.length > 0 ? this.items[this.items.length - 1] : undefined;
    if (this.omittedItems === 0 && last?.type === 'text') {
      const captured = this.capture(text);
      last.originalBytes += captured.originalBytes;
      last.text = prefixUtf8(
        `${last.text}${captured.text}`,
        PARTIAL_OUTPUT_LIMIT_BYTES,
      );
      return;
    }
    this.addItem({ type: 'text', ...this.capture(text) });
  }

  private addThinking(thought: string, streamId: string | undefined): void {
    const previous =
      streamId === undefined ? undefined : this.thinkingStreams.get(streamId);
    const captured = this.capture(thought);
    if (typeof previous === 'number' && streamId !== undefined) {
      this.omittedBytes += captured.originalBytes - previous;
      this.thinkingStreams.set(streamId, captured.originalBytes);
      return;
    }
    if (previous !== undefined && typeof previous !== 'number') {
      previous.text = captured.text;
      previous.originalBytes = captured.originalBytes;
      return;
    }
    const item: RecordedItem = {
      type: 'thinking',
      ...captured,
      ...(streamId === undefined ? {} : { streamId }),
    };
    const kept = this.addItem(item);
    if (streamId !== undefined)
      this.thinkingStreams.set(streamId, kept ? item : captured.originalBytes);
  }

  private addItem(item: RecordedItem): boolean {
    if (this.items.length < PARTIAL_OUTPUT_ITEM_LIMIT) {
      this.items.push(item);
      return true;
    }
    this.omittedItems++;
    this.omittedBytes += item.originalBytes;
    return false;
  }

  private toolItems(): RecordedItem[] {
    const items = this.items.map((item): RecordedItem => {
      if (item.type !== 'tool_input') return item;
      const raw = this.toolInputs?.find(
        (tool) => tool.id === item.id && tool.complete,
      );
      if (raw === undefined) return item;
      return {
        ...item,
        text: prefixUtf8(raw.input, PARTIAL_OUTPUT_LIMIT_BYTES),
        originalBytes: utf8Length(raw.input),
      };
    });
    const unrecorded = (this.toolInputs ?? []).filter(
      (tool) =>
        !tool.complete ||
        !this.items.some(
          (item) => item.type === 'tool_input' && item.id === tool.id,
        ),
    );
    for (const tool of unrecorded) {
      if (items.length >= PARTIAL_OUTPUT_ITEM_LIMIT) break;
      items.push({
        type: 'tool_input',
        id: tool.id,
        name: tool.name,
        text: prefixUtf8(tool.input, PARTIAL_OUTPUT_LIMIT_BYTES),
        originalBytes: utf8Length(tool.input),
        complete: tool.complete,
      });
    }
    return items;
  }

  snapshot(): PartialOutputSnapshot {
    let remaining = PARTIAL_OUTPUT_LIMIT_BYTES;
    let originalBytes = this.omittedBytes;
    let previewBytes = 0;
    let truncated = this.omittedItems > 0;
    const items = this.toolItems().map((item): PartialOutputItem => {
      const original = item.originalBytes;
      originalBytes += original;
      const preview = truncateUtf8(item.text, original, remaining);
      const previewLength = utf8Length(preview);
      remaining -= previewLength;
      previewBytes += previewLength;
      const itemTruncated = previewLength < original;
      truncated ||= itemTruncated;
      if (item.type === 'tool_input') {
        return {
          type: item.type,
          id: item.id,
          name: item.name,
          input: preview,
          complete: item.complete,
          original_bytes: original,
          truncated: itemTruncated,
        };
      }
      return {
        type: item.type,
        text: preview,
        original_bytes: original,
        truncated: itemTruncated,
      };
    });
    return {
      items,
      truncated,
      original_bytes: originalBytes,
      preview_bytes: previewBytes,
      omitted_items: this.omittedItems,
      output_sha256: this.hash.copy().digest('hex'),
    };
  }
}

/** Bounded snapshot of a complete output; the stream path feeds the recorder per chunk. */
export function buildPartialOutputSnapshot(
  output: ModelOutput,
): PartialOutputSnapshot {
  const recorder = new PartialOutputRecorder();
  recorder.add(output);
  return recorder.snapshot();
}
