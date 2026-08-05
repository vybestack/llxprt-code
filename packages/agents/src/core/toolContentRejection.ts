/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { iContentFromAgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { MediaBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Content-type terms a tool-content 400 tends to mention. Lower-cased for
 * scanning. Matched with a word-boundary requirement (see
 * `containsAnyWordBoundary`) so a bare `image` does not match inside
 * `read_image` or `image_path`. Bare `file` is deliberately excluded so that
 * request-shape errors like "file_path is required" cannot match (AC8).
 */
const CONTENT_TERMS: readonly string[] = [
  'image',
  'image data',
  'image_url',
  'input_image',
  'picture',
  'photo',
  'screenshot',
  'audio',
  'video',
  'document',
  'pdf',
  'media',
  'media type',
  'mime type',
  'content type',
  'attachment',
  'inline data',
  'inline_data',
  'base64',
  'data uri',
  'file format',
  'file type',
  'file data',
  'file_data',
  'uploaded file',
  'multimodal',
];

/**
 * Rejection terms a tool-content 400 tends to mention. Lower-cased for
 * substring scanning. Plain substring scans (no regex) keep this compatible
 * with the sonarjs/slow-regex error-level rule. These are multi-word phrases,
 * so plain substring matching (no word boundary) is sufficient.
 */
const REJECTION_TERMS: readonly string[] = [
  'not a valid',
  'does not represent a valid',
  'is not valid',
  'should be a valid',
  'invalid',
  'unsupported',
  'not supported',
  'unable to process',
  'could not process',
  'cannot process',
  'unable to decode',
  'could not decode',
  'failed to decode',
  'failed to process',
  'failed to parse',
  'failed to download',
  'could not download',
  'unable to download',
  'does not match',
  'malformed',
  'corrupt',
  'unrecognized',
  'unrecognised',
  'supported formats',
];

function containsAnySubstring(
  haystack: string,
  terms: readonly string[],
): boolean {
  for (const term of terms) {
    if (haystack.includes(term)) return true;
  }
  return false;
}

/**
 * Word characters for content-term boundary checks: a-z, 0-9, and _. The
 * haystack is already lower-cased before matching, so only a-z needs covering.
 */
function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const code = ch.charCodeAt(0);
  if (code >= 0x61 && code <= 0x7a) return true; // a-z
  if (code >= 0x30 && code <= 0x39) return true; // 0-9
  return code === 0x5f; // _
}

/**
 * A content term matches only when the characters immediately before and
 * after the match are each absent or NOT a word character, preventing
 * `image` from matching inside `read_image` or `image_path`. Implemented as
 * an index scan — no regular expressions (AC8, sonarjs/slow-regex).
 */
function matchesWordBoundary(haystack: string, term: string): boolean {
  const n = term.length;
  let i = haystack.indexOf(term);
  while (i !== -1) {
    const before = i > 0 ? haystack[i - 1] : undefined;
    const after = i + n < haystack.length ? haystack[i + n] : undefined;
    if (!isWordChar(before) && !isWordChar(after)) return true;
    i = haystack.indexOf(term, i + 1);
  }
  return false;
}

function containsAnyWordBoundary(
  haystack: string,
  terms: readonly string[],
): boolean {
  for (const term of terms) {
    if (matchesWordBoundary(haystack, term)) return true;
  }
  return false;
}

/**
 * Returns true iff `status === 400` and the (lower-cased) `message` contains
 * both at least one content term (word-bounded) and at least one rejection
 * term (plain substring). A missing/non-400 status or a non-string/empty
 * message returns false (AC8).
 */
export function isToolContentRejection(
  status: number | undefined,
  message: unknown,
): boolean {
  if (status !== 400) return false;
  if (typeof message !== 'string') return false;
  const text = message.toLowerCase();
  return (
    containsAnyWordBoundary(text, CONTENT_TERMS) &&
    containsAnySubstring(text, REJECTION_TERMS)
  );
}

/**
 * Extracts a tool name from a single request part in neutral or legacy form.
 *
 * Recognizes:
 * - Neutral `tool_response`: `{ type: 'tool_response', toolName }`
 * - Neutral `tool_call`: `{ type: 'tool_call', name }`
 * - Legacy Google `functionResponse`: `{ functionResponse: { name } }`
 *
 * Returns the extracted name, or `undefined` if the part is not a
 * tool-response/tool-call shape.
 */
export function extractToolName(part: unknown): string | undefined {
  if (part == null || typeof part !== 'object') return undefined;
  const obj = part as Record<string, unknown>;

  if (obj['type'] === 'tool_response') {
    const toolName = obj['toolName'];
    if (typeof toolName === 'string' && toolName.length > 0) return toolName;
    return undefined;
  }

  if (obj['type'] === 'tool_call') {
    const name = obj['name'];
    if (typeof name === 'string' && name.length > 0) return name;
    return undefined;
  }

  if ('functionResponse' in obj) {
    const funcResp = obj['functionResponse'];
    if (isFunctionResponseWithName(funcResp)) {
      return funcResp.name;
    }
  }

  return undefined;
}

/**
 * Extracts de-duplicated tool names (first-seen order) directly from a raw
 * request array. Used by the 413 path on the un-normalised request.
 */
export function extractToolNamesFromRequest(
  request: AgentMessageInput,
): string[] {
  if (!Array.isArray(request)) return [];
  const names = new Set<string>();
  for (const rawPart of request) {
    const name = extractToolName(rawPart);
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names];
}

function isMediaBlock(block: unknown): block is MediaBlock {
  if (block == null || typeof block !== 'object') return false;
  const obj = block as Record<string, unknown>;
  return obj['type'] === 'media' && typeof obj['mimeType'] === 'string';
}

/**
 * Type guard for a legacy Google `functionResponse` value whose `name` is a
 * non-empty string. Extracted so the legacy branch validates the value the
 * same way the neutral branches do, without a cast to `{ name?: string }`.
 */
function isFunctionResponseWithName(value: unknown): value is { name: string } {
  if (value == null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (!('name' in obj)) return false;
  const name = obj['name'];
  return typeof name === 'string' && name.length > 0;
}

function formatMediaDescriptor(block: MediaBlock): string {
  return block.filename
    ? `${block.filename} (${block.mimeType})`
    : block.mimeType;
}

export interface RejectedPayloadDescription {
  readonly toolNames: readonly string[];
  readonly mediaDescriptors: readonly string[];
}

/**
 * Normalises `request` via `iContentFromAgentMessageInput` (so string,
 * ContentBlock[], IContent, and IContent[] all work — AC9), then scans the
 * resulting blocks for tool names and `media` blocks. Duplicate names and
 * descriptors are de-duplicated while preserving first-seen order.
 */
export function describeRejectedPayload(
  request: AgentMessageInput,
): RejectedPayloadDescription {
  const contents = iContentFromAgentMessageInput(request);
  const toolNames: string[] = [];
  const mediaDescriptors: string[] = [];
  const seenTools = new Set<string>();
  const seenMedia = new Set<string>();

  for (const content of contents) {
    for (const block of content.blocks) {
      const toolName = extractToolName(block);
      if (toolName !== undefined && !seenTools.has(toolName)) {
        seenTools.add(toolName);
        toolNames.push(toolName);
      }
      if (!isMediaBlock(block)) continue;
      const descriptor = formatMediaDescriptor(block);
      if (!seenMedia.has(descriptor)) {
        seenMedia.add(descriptor);
        mediaDescriptors.push(descriptor);
      }
    }
  }

  return { toolNames, mediaDescriptors };
}

const MAX_PROVIDER_MESSAGE_LENGTH = 300;

/**
 * Truncates by Unicode code point rather than UTF-16 code unit so an
 * astral-plane character (e.g. an emoji) straddling the limit cannot be split
 * into a lone surrogate in the message shown to the model.
 */
function truncateMessage(message: string): string {
  const codePoints = Array.from(message);
  if (codePoints.length <= MAX_PROVIDER_MESSAGE_LENGTH) return message;
  return `${codePoints.slice(0, MAX_PROVIDER_MESSAGE_LENGTH).join('')}\u2026`;
}

const ADVICE_BASE =
  'System: The provider rejected the previous request with HTTP 400 because content supplied by a tool result was invalid or unsupported for its declared type.';
const ADVICE_NOT_ADDED = 'That content was not added to the conversation.';
const ADVICE_TAIL =
  'Do not resend the same content or repeat the same tool call with the same arguments. Try a different approach instead \u2014 for example, if a file was sent as an image or other binary attachment but is actually text or source code, read it as text.';

/**
 * Builds the synthetic advice message injected before re-issuing the request
 * after a tool-content 400. See the plan's "Advice message template (exact)".
 * An empty/blank provider message drops the whole Provider-message sentence.
 */
export function buildToolContentRejectionAdvice(
  description: RejectedPayloadDescription,
  providerMessage: string,
): string {
  const toolClause =
    description.toolNames.length > 0
      ? ` The tools involved were: ${description.toolNames.join(', ')}.`
      : '';
  const mediaClause =
    description.mediaDescriptors.length > 0
      ? ` The rejected content was: ${description.mediaDescriptors.join(', ')}.`
      : '';

  const trimmed = providerMessage.trim();
  const providerSentence =
    trimmed.length > 0
      ? ` Provider message: "${truncateMessage(trimmed)}".`
      : '';

  return `${ADVICE_BASE}${providerSentence} ${ADVICE_NOT_ADDED}${toolClause}${mediaClause} ${ADVICE_TAIL}`;
}
