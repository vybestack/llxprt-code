/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import type { IContent, ContentBlock } from './IContent.js';

export const TOOL_OUTPUT_TRUNCATION_MARKER =
  '[Output truncated due to token limit]';

export type TokenCountFn = (text: string) => number;

function serializeBlockForCounting(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'thinking':
      return block.thought;
    case 'tool_call':
      return block.name + stableStringify(block.parameters);
    case 'tool_response':
      return stableStringify(block.result);
    case 'media': {
      // Length proxy avoids re-tokenizing large base64 payloads.
      const encodedLength =
        block.encoding === 'reference'
          ? block.normalizedBase64Length
          : block.data.length;
      return `${block.mimeType}:${encodedLength}`;
    }
    case 'code':
      return block.code;
    default: {
      // Exhaustive guard: every ContentBlock variant is handled above.
      const exhaustive: never = block;
      void exhaustive;
      return '';
    }
  }
}

/** A tool result measured from its already-serialized body. */
interface MeasuredToolResult {
  readonly callId: string;
  readonly blockToolName: string;
  readonly resultTokens: number;
  readonly wasTruncated: boolean;
}

/**
 * A content's measured token costs. Deliberately holds no serialized text, so
 * caching one across a session does not retain a large tool-result body.
 */
export interface ContentMeasurement {
  readonly tokens: number;
  readonly toolResults: readonly MeasuredToolResult[];
}

export function contentFingerprintKey(content: IContent): string | null {
  const id = content.metadata?.id;
  if (id !== undefined && id.length > 0)
    return `${id}:${content.blocks.length}`;
  // The history pipeline does not preserve `metadata.id` on tool contents, which
  // are the expensive ones. Their blocks carry their own stable identities, so
  // fall back to those rather than leaving a large body uncacheable.
  const blockKeys = content.blocks.map(blockCacheKey);
  if (blockKeys.some((key) => key === null)) return null;
  return `blocks:${blockKeys.join(',')}`;
}

/**
 * Stable identity for a block, when it has one. A tool result is identified by
 * the call it answers and a tool call by its own id; both are unique and
 * immutable, so a body carried across many turns is measured once.
 */
function blockCacheKey(block: ContentBlock): string | null {
  if (block.type === 'tool_response') return `tr:${block.callId}`;
  if (block.type === 'tool_call') return `tc:${block.id}`;
  return null;
}

export function measureContent(
  content: IContent,
  countTokens: TokenCountFn,
): { measurement: ContentMeasurement; serialized: string } {
  const serializedBlocks = content.blocks.map(serializeBlockForCounting);
  const toolResults: ContentMeasurement['toolResults'] = content.blocks.flatMap(
    (block, index) =>
      block.type === 'tool_response'
        ? [
            {
              callId: block.callId,
              blockToolName: block.toolName,
              resultTokens: countTokens(serializedBlocks[index]),
              wasTruncated: serializedBlocks[index].includes(
                TOOL_OUTPUT_TRUNCATION_MARKER,
              ),
            },
          ]
        : [],
  );
  const serialized = serializedBlocks.join('\n');
  const tokens =
    content.blocks.length === 1 && toolResults.length === 1
      ? toolResults[0].resultTokens
      : countTokens(serialized);
  return {
    measurement: { tokens, toolResults },
    serialized,
  };
}

/** True when a content carries at least one MediaBlock. */
function hasMediaBlock(content: IContent): boolean {
  return content.blocks.some((b) => b.type === 'media');
}

/** True when a content carries a tool call or tool result. */
function hasToolBlock(content: IContent): boolean {
  return content.blocks.some(
    (b) => b.type === 'tool_call' || b.type === 'tool_response',
  );
}

/**
 * Determine the bucket assignment for a single content. The precedence ensures
 * every content lands in EXACTLY one bucket:
 *   1. media     — contains a media block
 *   2. history   — carries a tool call or tool result
 *   3. injected  — metadata.synthetic === true
 *   4. history   — everything else
 *
 * Tool content is classified structurally, ahead of the `synthetic` flag,
 * because genuinely rebuilt or reordered tool turns carry `synthetic: true`
 * with `reason: 'reordered_tool_responses'`. Those tool results remain part of
 * the conversation history. Trusting the flag alone put them in
 * `injected_tokens` and excluded them from `history_tokens`, which inverted what
 * both fields mean. Genuine injections such as IDE context and system reminders
 * carry no tool blocks.
 */
type ContentBucket = 'injected' | 'media' | 'history';

export function classifyContent(content: IContent): ContentBucket {
  if (hasMediaBlock(content)) return 'media';
  if (hasToolBlock(content)) return 'history';
  if (content.metadata?.synthetic === true) return 'injected';
  return 'history';
}

function compareKeys(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function stableStringify(
  value: unknown,
  seen?: WeakSet<object>,
): string {
  // Symbols belong here, not below: `JSON.stringify(Symbol())` returns
  // undefined, which would break this function's string contract and surface as
  // a TypeError further along the request path.
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    return '';
  }
  if (typeof value === 'bigint') return `"${value.toString()}"`;
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  // Ancestors only. A shared sub-schema referenced by several tool
  // declarations is repetition, not a cycle: leaving it in the set would
  // collapse it to the marker and understate tools_schema_tokens.
  const visited = seen ?? new WeakSet<object>();
  if (visited.has(value)) return '"[circular]"';
  visited.add(value);
  const serialized = Array.isArray(value)
    ? `[${value.map((entry) => stableStringify(entry, visited)).join(',')}]`
    : `{${Object.entries(value)
        .sort(([a], [b]) => compareKeys(a, b))
        .map(
          ([key, val]) =>
            `${JSON.stringify(key)}:${stableStringify(val, visited)}`,
        )
        .join(',')}}`;
  visited.delete(value);
  return serialized;
}

export interface RequestRowMeasurement extends ContentMeasurement {
  readonly bucket: ContentBucket;
  readonly fingerprintKey: string | null;
  readonly toolCalls: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
  }>;
}

export function measureRequestRow(
  content: IContent,
  countTokens: TokenCountFn,
): RequestRowMeasurement {
  return {
    ...measureContent(content, countTokens).measurement,
    bucket: classifyContent(content),
    fingerprintKey: contentFingerprintKey(content),
    toolCalls: content.blocks.flatMap((block) =>
      block.type === 'tool_call' ? [{ id: block.id, name: block.name }] : [],
    ),
  };
}

export function serializeRequestRow(content: IContent): string {
  return content.blocks.map(serializeBlockForCounting).join('\n');
}
