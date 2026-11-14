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

interface RawPartialItem {
  readonly type: PartialOutputItem['type'];
  readonly text: string;
  readonly id?: string;
  readonly name?: string;
  readonly complete?: boolean;
  readonly streamId?: string;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateUtf8(value: string, limit: number): string {
  if (utf8Length(value) <= limit) return value;
  const markerBytes = utf8Length(TRUNCATION_MARKER);
  if (limit <= markerBytes) return '';
  let result = '';
  let used = 0;
  for (const character of value) {
    const size = utf8Length(character);
    if (used + size + markerBytes > limit) break;
    result += character;
    used += size;
  }
  return `${result}${TRUNCATION_MARKER}`;
}

function rawItems(output: ModelOutput): RawPartialItem[] {
  const items: RawPartialItem[] = [];
  for (const block of output.content.blocks) {
    if (block.type === 'text') {
      items.push({ type: 'text', text: block.text });
    } else if (block.type === 'thinking') {
      items.push({
        type: 'thinking',
        text: block.thought,
        streamId: block.streamId,
      });
    } else if (block.type === 'tool_call') {
      const raw = output.refusalAuditToolInputs?.find(
        (tool) => tool.id === block.id && tool.complete,
      );
      items.push({
        type: 'tool_input',
        id: block.id,
        name: block.name,
        text: raw?.input ?? JSON.stringify(block.parameters),
        complete: true,
      });
    }
  }
  for (const tool of output.refusalAuditToolInputs ?? []) {
    if (
      tool.complete &&
      output.content.blocks.some(
        (block) => block.type === 'tool_call' && block.id === tool.id,
      )
    )
      continue;
    items.push({
      type: 'tool_input',
      id: tool.id,
      name: tool.name,
      text: tool.input,
      complete: tool.complete,
    });
  }
  return items;
}

export function buildPartialOutputSnapshot(
  output: ModelOutput,
): PartialOutputSnapshot {
  const source = rawItems(output);
  const thinkingPositions = new Map<string, number>();
  const repeatedThinkingPositions = new Set<number>();
  for (let index = 0; index < source.length; index++) {
    const item = source[index];
    if (item.type !== 'thinking' || item.streamId === undefined) continue;
    const previous = thinkingPositions.get(item.streamId);
    if (previous === undefined) {
      thinkingPositions.set(item.streamId, index);
    } else {
      source[previous] = item;
      repeatedThinkingPositions.add(index);
    }
  }
  const coalesced = source.filter(
    (_, index) => !repeatedThinkingPositions.has(index),
  );
  let remaining = PARTIAL_OUTPUT_LIMIT_BYTES;
  let originalBytes = 0;
  let previewBytes = 0;
  let truncated = false;
  const items = coalesced.map((item): PartialOutputItem => {
    const original = utf8Length(item.text);
    originalBytes += original;
    const preview = truncateUtf8(item.text, remaining);
    const previewLength = utf8Length(preview);
    remaining -= previewLength;
    previewBytes += previewLength;
    const itemTruncated = previewLength < original;
    truncated ||= itemTruncated;
    if (item.type === 'tool_input') {
      return {
        type: item.type,
        id: item.id ?? '',
        name: item.name ?? '',
        input: preview,
        complete: item.complete ?? false,
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
  };
}
