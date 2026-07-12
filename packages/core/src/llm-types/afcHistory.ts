/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * AFC (automatic-function-calling) history extraction and validation at the
 * provider/core conversion boundary.
 *
 * Per the P13 AFC boundary design (PLAN-20260707-AGENTNEUTRAL): AFC decoding
 * and validation happen HERE (core), populating the first-class
 * `ModelStreamChunk.afcHistory` / `ModelOutput.afcHistory` field. Agents
 * consume ONLY `afcHistory`, never raw `providerMetadata.automaticFunctionCallingHistory`.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-001.4
 */

import type { IContent } from '../services/history/IContent.js';

/** Valid speaker values for AFC entries. */
const VALID_SPEAKERS: ReadonlySet<string> = new Set(['human', 'ai', 'tool']);

/** Valid ContentBlock type discriminators. */
const VALID_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'text',
  'tool_call',
  'tool_response',
  'media',
  'thinking',
  'code',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringField(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === 'string';
}

/**
 * Validate that a single block matches a ContentBlock variant with its
 * required fields. Returns false for unrecognized or incomplete blocks.
 */
function isValidBlock(block: unknown): boolean {
  if (!isRecord(block) || typeof block.type !== 'string') {
    return false;
  }
  if (!VALID_BLOCK_TYPES.has(block.type)) {
    return false;
  }
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string';
    case 'tool_call':
      return (
        isStringField(block, 'id') &&
        isStringField(block, 'name') &&
        block.parameters !== undefined
      );
    case 'tool_response':
      return (
        isStringField(block, 'callId') &&
        isStringField(block, 'toolName') &&
        block.result !== undefined
      );
    case 'media':
      return (
        isStringField(block, 'mimeType') &&
        isStringField(block, 'data') &&
        (block.encoding === 'url' || block.encoding === 'base64')
      );
    case 'thinking':
      return isStringField(block, 'thought');
    case 'code':
      return isStringField(block, 'code');
    default:
      return false;
  }
}

function isValidAfcEntry(entry: unknown): entry is IContent {
  if (!isRecord(entry)) {
    return false;
  }
  if (typeof entry.speaker !== 'string' || !VALID_SPEAKERS.has(entry.speaker)) {
    return false;
  }
  if (!Array.isArray(entry.blocks) || entry.blocks.length === 0) {
    return false;
  }
  return entry.blocks.every(isValidBlock);
}

/**
 * Extracts and validates the automatic-function-calling (AFC) history from
 * provider metadata on an IContent. This is the canonical boundary function
 * called by `toModelStreamChunk` — agents must NOT read
 * `providerMetadata.automaticFunctionCallingHistory` directly.
 *
 * Validation rules:
 *  - Each entry must be a non-null object with a valid `speaker` ('human' |
 *    'ai' | 'tool') and a non-empty `blocks` array.
 *  - Every block must match a valid ContentBlock variant with required fields.
 *  - Validation is structural per entry. Cross-entry pairing, ordering,
 *    uniqueness, and tool-name matching are intentionally not enforced because
 *    providers may expose partial AFC history at stream boundaries.
 *
 * Returns the validated IContent[] or undefined when no valid AFC history
 * is present.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-001.4
 */
export function extractAfcHistory(content: IContent): IContent[] | undefined {
  const metadataValue =
    content.metadata?.providerMetadata?.['automaticFunctionCallingHistory'];
  if (!Array.isArray(metadataValue)) {
    return undefined;
  }
  // Fail closed: if ANY entry is structurally invalid, reject the ENTIRE
  // payload (return undefined). Never partially accept a malformed AFC
  // sequence — a single corrupt entry means the provider's AFC metadata
  // cannot be trusted as a coherent turn sequence.
  if (!metadataValue.every(isValidAfcEntry)) {
    return undefined;
  }
  return metadataValue;
}

/**
 * Returns the providerMetadata record without the AFC key, or undefined if
 * the input was undefined. Called by `toModelStreamChunk` so that raw AFC
 * never leaks through to agents via `providerMetadata`.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-001.4
 */
export function stripAfcFromProviderMetadata(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (meta === undefined) return undefined;
  if ('automaticFunctionCallingHistory' in meta) {
    const { automaticFunctionCallingHistory: _removed, ...rest } = meta;
    void _removed;
    return rest;
  }
  return meta;
}
