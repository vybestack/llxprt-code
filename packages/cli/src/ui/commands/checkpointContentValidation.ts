/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type IContent,
  type ContentBlock,
  type TextBlock,
  type CheckpointContent,
  ContentConverters,
} from '@vybestack/llxprt-code-core';

type CheckpointPart = NonNullable<CheckpointContent['parts']>[number];

type BlockRecord = Record<string, unknown>;

/**
 * Sentinel returned by optional-field validators when the field is
 * present but malformed. Callers treat this as a rejection signal
 * (return null) so malformed fields are never silently stripped.
 */
const MALFORMED: unique symbol = Symbol('malformed');

/**
 * Result type for optional-field validators: the field is absent
 * (`undefined`), present-and-valid (`Record`/`string`/etc.), or
 * present-but-malformed (the `MALFORMED` sentinel).
 */
type OptResult<T> = T | undefined | typeof MALFORMED;

// ---------------------------------------------------------------------------
// Shared optional-field validators
// ---------------------------------------------------------------------------

/**
 * Validate an optional `providerMetadata` field.
 *
 * Must be a plain object (not an array) when present; arrays, primitives,
 * and null are rejected as malformed.
 */
function optProviderMeta(b: BlockRecord): OptResult<Record<string, unknown>> {
  const v = b.providerMetadata;
  if (v === undefined) return undefined;
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return MALFORMED;
}

/**
 * Validate an optional string field by key.
 *
 * Returns the string when present-and-valid, `undefined` when absent,
 * or `MALFORMED` when present but not a string.
 */
function optString(b: BlockRecord, key: string): OptResult<string> {
  if (!(key in b)) return undefined;
  const v = b[key];
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v;
  return MALFORMED;
}

/**
 * Validate an optional boolean field by key.
 */
function optBoolean(b: BlockRecord, key: string): OptResult<boolean> {
  if (!(key in b)) return undefined;
  const v = b[key];
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  return MALFORMED;
}

const VALID_SOURCE_FIELDS: ReadonlySet<string> = new Set([
  'reasoning_content',
  'thinking',
  'thought',
  'think_tags',
]);

/**
 * Validate an optional `sourceField` for ThinkingBlock.
 *
 * Must be one of the allowed literal values when present.
 */
function optThinkingSourceField(
  b: BlockRecord,
): OptResult<'reasoning_content' | 'thinking' | 'thought' | 'think_tags'> {
  if (!('sourceField' in b)) return undefined;
  const v = b.sourceField;
  if (v === undefined) return undefined;
  if (typeof v === 'string' && VALID_SOURCE_FIELDS.has(v)) {
    return v as 'reasoning_content' | 'thinking' | 'thought' | 'think_tags';
  }
  return MALFORMED;
}

// ---------------------------------------------------------------------------
// Per-variant validators
// ---------------------------------------------------------------------------

/**
 * Attach optional fields to a result object if they are valid.
 * Returns `false` if any field is malformed (caller must reject the block).
 */
function attachOptionalProviderMeta(
  result: { providerMetadata?: Record<string, unknown> },
  pm: OptResult<Record<string, unknown>>,
): boolean {
  if (pm === MALFORMED) return false;
  if (pm !== undefined) result.providerMetadata = pm;
  return true;
}

function validateTextBlock(block: BlockRecord): TextBlock | null {
  if (typeof block.text !== 'string') return null;
  const pm = optProviderMeta(block);
  const result: TextBlock = { type: 'text', text: block.text };
  if (!attachOptionalProviderMeta(result, pm)) return null;
  return result;
}

function validateToolCallBlock(
  block: BlockRecord,
): Extract<ContentBlock, { type: 'tool_call' }> | null {
  if (typeof block.id !== 'string' || typeof block.name !== 'string') {
    return null;
  }
  const pm = optProviderMeta(block);
  const desc = optString(block, 'description');
  if (desc === MALFORMED) return null;
  const result: Extract<ContentBlock, { type: 'tool_call' }> = {
    type: 'tool_call',
    id: block.id,
    name: block.name,
    parameters: block.parameters,
  };
  if (desc !== undefined) result.description = desc;
  if (!attachOptionalProviderMeta(result, pm)) return null;
  return result;
}

function validateToolResponseBlock(
  block: BlockRecord,
): Extract<ContentBlock, { type: 'tool_response' }> | null {
  if (typeof block.callId !== 'string' || typeof block.toolName !== 'string') {
    return null;
  }
  const pm = optProviderMeta(block);
  const error = optString(block, 'error');
  if (error === MALFORMED) return null;
  const isComplete = optBoolean(block, 'isComplete');
  if (isComplete === MALFORMED) return null;
  const result: Extract<ContentBlock, { type: 'tool_response' }> = {
    type: 'tool_response',
    callId: block.callId,
    toolName: block.toolName,
    result: block.result,
  };
  if (error !== undefined) result.error = error;
  if (isComplete !== undefined) result.isComplete = isComplete;
  if (!attachOptionalProviderMeta(result, pm)) return null;
  return result;
}

function validateMediaBlock(
  block: BlockRecord,
): Extract<ContentBlock, { type: 'media' }> | null {
  if (
    typeof block.mimeType !== 'string' ||
    typeof block.data !== 'string' ||
    (block.encoding !== 'url' && block.encoding !== 'base64')
  ) {
    return null;
  }
  const pm = optProviderMeta(block);
  const caption = optString(block, 'caption');
  if (caption === MALFORMED) return null;
  const filename = optString(block, 'filename');
  if (filename === MALFORMED) return null;
  const result: Extract<ContentBlock, { type: 'media' }> = {
    type: 'media',
    mimeType: block.mimeType,
    data: block.data,
    encoding: block.encoding,
  };
  if (caption !== undefined) result.caption = caption;
  if (filename !== undefined) result.filename = filename;
  if (!attachOptionalProviderMeta(result, pm)) return null;
  return result;
}

function validateThinkingBlock(
  block: BlockRecord,
): Extract<ContentBlock, { type: 'thinking' }> | null {
  if (typeof block.thought !== 'string') return null;
  const pm = optProviderMeta(block);
  const isHidden = optBoolean(block, 'isHidden');
  if (isHidden === MALFORMED) return null;
  const sourceField = optThinkingSourceField(block);
  if (sourceField === MALFORMED) return null;
  const signature = optString(block, 'signature');
  if (signature === MALFORMED) return null;
  const encryptedContent = optString(block, 'encryptedContent');
  if (encryptedContent === MALFORMED) return null;
  const result: Extract<ContentBlock, { type: 'thinking' }> = {
    type: 'thinking',
    thought: block.thought,
  };
  if (isHidden !== undefined) result.isHidden = isHidden;
  if (sourceField !== undefined) result.sourceField = sourceField;
  if (signature !== undefined) result.signature = signature;
  if (encryptedContent !== undefined)
    result.encryptedContent = encryptedContent;
  if (!attachOptionalProviderMeta(result, pm)) return null;
  return result;
}

function validateCodeBlock(
  block: BlockRecord,
): Extract<ContentBlock, { type: 'code' }> | null {
  if (typeof block.code !== 'string') return null;
  const pm = optProviderMeta(block);
  const language = optString(block, 'language');
  if (language === MALFORMED) return null;
  const result: Extract<ContentBlock, { type: 'code' }> = {
    type: 'code',
    code: block.code,
  };
  if (language !== undefined) result.language = language;
  if (!attachOptionalProviderMeta(result, pm)) return null;
  return result;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Runtime validator: fully discriminates all ContentBlock variants and
 * required fields by the `type` discriminant. Returns null for corrupted,
 * incomplete, or unknown blocks so they cannot reach the conversation history.
 *
 * Losslessly preserves all valid optional fields for every ContentBlock
 * variant: providerMetadata, description, error, isComplete, caption,
 * filename, isHidden, sourceField, signature, encryptedContent, language.
 * Each optional field is type-checked before inclusion; malformed optionals
 * are rejected (return null) rather than silently stripped.
 */
export function validateCheckpointContentBlock(
  part: unknown,
): ContentBlock | null {
  if (typeof part !== 'object' || part === null) return null;
  const block = part as BlockRecord;
  if (typeof block.type !== 'string') return null;

  switch (block.type) {
    case 'text':
      return validateTextBlock(block);
    case 'tool_call':
      return validateToolCallBlock(block);
    case 'tool_response':
      return validateToolResponseBlock(block);
    case 'media':
      return validateMediaBlock(block);
    case 'thinking':
      return validateThinkingBlock(block);
    case 'code':
      return validateCodeBlock(block);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Checkpoint part → ContentBlock (with legacy fallback)
// ---------------------------------------------------------------------------

const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'text',
  'tool_call',
  'tool_response',
  'media',
  'thinking',
  'code',
]);

/**
 * Convert a single checkpoint part to a ContentBlock.
 *
 * First runs the strict runtime validator. If that fails, falls back to
 * the legacy `{ text }` shape — but ONLY for blocks that lack a recognized
 * `type` field. Blocks that HAVE a `type` but were rejected by the validator
 * (e.g. malformed optional fields) must NOT be rescued by the fallback;
 * that would silently strip the malformed fields and produce a partial block.
 */
export function checkpointPartToContentBlock(
  part: CheckpointPart,
): ContentBlock | null {
  const validated = validateCheckpointContentBlock(part);
  if (validated !== null) {
    return validated;
  }
  const raw = part as unknown;
  if (typeof raw === 'object' && raw !== null && 'text' in raw) {
    const rawRecord = raw as BlockRecord;
    if (
      typeof rawRecord.type !== 'string' ||
      !KNOWN_BLOCK_TYPES.has(rawRecord.type)
    ) {
      const textVal = rawRecord.text;
      if (typeof textVal === 'string') {
        return { type: 'text', text: textVal };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// IContent ↔ CheckpointContent converters (lossless)
// ---------------------------------------------------------------------------

/**
 * Lossless converter: IContent → CheckpointContent.
 *
 * Stores neutral ContentBlocks directly in `parts` (no Gemini conversion),
 * alongside the `speaker` and `metadata` fields. This preserves tool_call IDs,
 * tool_response callIds, thinking blocks, media blocks, and all metadata
 * through a save/resume round-trip without any conversion lossiness.
 *
 * Also writes the legacy `role` for backward compatibility with older code
 * that may inspect it.
 */
export function iContentToCheckpoint(ic: IContent): CheckpointContent {
  const role = ic.speaker === 'human' ? 'user' : 'model';
  const parts: CheckpointPart[] = ic.blocks.map((b) => ({ ...b }));
  return {
    role,
    parts,
    speaker: ic.speaker,
    ...(ic.metadata ? { metadata: ic.metadata } : {}),
  };
}

/**
 * Lossless converter: CheckpointContent → IContent.
 *
 * If the checkpoint carries the neutral `speaker` field (written by
 * iContentToCheckpoint), restores blocks directly from `parts` (which are
 * neutral ContentBlocks), preserving the exact speaker, IDs, and metadata.
 *
 * For legacy checkpoints without a neutral speaker field, falls back to
 * ContentConverters.toIContent (role→speaker inference from Gemini parts).
 */
export function checkpointToIContent(cp: CheckpointContent): IContent {
  if (cp.speaker === 'human' || cp.speaker === 'ai' || cp.speaker === 'tool') {
    const convertedBlocks = (cp.parts ?? []).map(checkpointPartToContentBlock);
    if (convertedBlocks.some((block) => block === null)) {
      throw new Error('Checkpoint contains an invalid neutral content block.');
    }
    const blocks = convertedBlocks.filter(
      (block): block is ContentBlock => block !== null,
    );
    const result: IContent = {
      speaker: cp.speaker,
      blocks,
    };
    if (cp.metadata !== undefined) {
      result.metadata = cp.metadata as IContent['metadata'];
    }
    return result;
  }
  return ContentConverters.toIContent({
    role: cp.role,
    parts: cp.parts as never,
  });
}
