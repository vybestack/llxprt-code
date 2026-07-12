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
 * Neutral gap types for agent message input and lossless legacy conversion.
 *
 * These converters own the boundary between provider-shaped legacy input
 * (typed `unknown`) and the neutral `IContent` content model. Every legacy
 * branch is narrowed via a `(x: unknown): x is T` type predicate — NO type
 * assertions (`as`/`as unknown as`) are used anywhere (RULES.md §78-83).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P05
 * @requirement:REQ-001.1, REQ-001.2, REQ-001.3
 * @pseudocode lines 10-82
 */

import type {
  IContent,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
} from '../services/history/IContent.js';
import type {
  ModelGenerationRequest,
  ModelGenerationSettings,
} from './modelRequest.js';

export type {
  ModelGenerationRequest,
  ModelGenerationSettings,
} from './modelRequest.js';

/**
 * Neutral DTO replacing the provider-shaped PartListUnion input vector.
 * Accepts text, neutral blocks, or pre-built IContent turn(s) — never a
 * provider Part/role shape.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P05
 * @requirement:REQ-001.1
 * @pseudocode line 10
 */
export type AgentMessageInput = string | ContentBlock[] | IContent | IContent[];

/**
 * Result type for the lossless legacy converter (ES-2: never silent-drop;
 * the caller MUST handle `{ok:false}`).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P05
 * @requirement:REQ-001.2
 * @pseudocode line 21
 */
export type LegacyConversionResult =
  | { ok: true; value: IContent[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Type predicates (structural guards on `unknown` — NO `as` casts)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSpeaker(value: unknown): value is IContent['speaker'] {
  return value === 'human' || value === 'ai' || value === 'tool';
}

function isIContent(value: unknown): value is IContent {
  return (
    isRecord(value) && isSpeaker(value.speaker) && Array.isArray(value.blocks)
  );
}

function isIContentArray(value: unknown): value is IContent[] {
  return Array.isArray(value) && value.every((item) => isIContent(item));
}

function isContentBlock(value: unknown): value is ContentBlock {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  // Every ContentBlock variant has a literal `type` discriminator that is one
  // of the known neutral block kinds. We do not assert the full block shape
  // here — the caller already holds neutral blocks; this guard only separates
  // neutral-block arrays from other arrays.
  return [
    'text',
    'tool_call',
    'tool_response',
    'media',
    'thinking',
    'code',
  ].includes(value.type);
}

function isContentBlockArray(value: unknown): value is ContentBlock[] {
  return Array.isArray(value) && value.every((item) => isContentBlock(item));
}

const LEGACY_PART_KEYS = [
  'text',
  'thought',
  'inlineData',
  'fileData',
  'functionCall',
  'functionResponse',
] as const;

/**
 * True when the object carries any of the recognized legacy Google `Part`
 * discriminator keys (text/thought/inlineData/fileData/functionCall/
 * functionResponse). Used to distinguish a single legacy part from an
 * unrelated object.
 */
function hasLegacyPartKey(value: unknown): boolean {
  return isRecord(value) && LEGACY_PART_KEYS.some((key) => key in value);
}

function isLegacyPartArray(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => hasLegacyPartKey(item))
  );
}

function isLegacyContent(value: unknown): value is {
  role?: string;
  parts?: unknown[];
} {
  return isRecord(value) && 'role' in value && 'parts' in value;
}

function isLegacyContentArray(value: unknown): value is Array<{
  role?: string;
  parts?: unknown[];
}> {
  return Array.isArray(value) && value.every((item) => isLegacyContent(item));
}

// ---------------------------------------------------------------------------
// mapLegacyParts — pseudocode lines 28-38
// ---------------------------------------------------------------------------

class UnsupportedLegacyPartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedLegacyPartError';
  }
}

function mapTextPart(p: Record<string, unknown>): ContentBlock {
  return { type: 'text', text: readString(p, 'text') };
}

function mapThoughtPart(p: Record<string, unknown>): ContentBlock {
  const thoughtText = readThoughtText(p);
  // Boolean thought:true must carry its content in the `text` field.
  // When thought is true but text is missing, non-string, or empty, the part
  // is malformed and must NOT silently produce an empty ThinkingBlock.
  if (p.thought === true && thoughtText.length === 0) {
    throw new UnsupportedLegacyPartError(
      'unsupported legacy part: boolean thought:true requires non-empty string text',
    );
  }
  const block: ThinkingBlock = {
    type: 'thinking',
    thought: thoughtText,
    sourceField: 'thought',
  };
  const sig = readString(p, 'thoughtSignature');
  if (sig.length > 0) {
    block.signature = sig;
  }
  return block;
}

function mapInlineDataPart(p: Record<string, unknown>): ContentBlock {
  const inline = p.inlineData;
  if (
    isRecord(inline) &&
    typeof inline.mimeType === 'string' &&
    typeof inline.data === 'string'
  ) {
    return {
      type: 'media',
      mimeType: inline.mimeType,
      data: inline.data,
      encoding: 'base64',
    };
  }
  throw new UnsupportedLegacyPartError(
    'unsupported legacy part: malformed inlineData',
  );
}

function mapFileDataPart(p: Record<string, unknown>): ContentBlock {
  const fd = p.fileData;
  if (
    isRecord(fd) &&
    typeof fd.mimeType === 'string' &&
    typeof fd.fileUri === 'string'
  ) {
    return {
      type: 'media',
      mimeType: fd.mimeType,
      data: fd.fileUri,
      encoding: 'url',
    };
  }
  throw new UnsupportedLegacyPartError(
    'unsupported legacy part: malformed fileData',
  );
}

function mapFunctionCallPart(p: Record<string, unknown>): ContentBlock {
  const fc = p.functionCall;
  if (
    isRecord(fc) &&
    typeof fc.name === 'string' &&
    (typeof fc.id === 'string' || fc.id === undefined)
  ) {
    return {
      type: 'tool_call',
      id: typeof fc.id === 'string' ? fc.id : '',
      name: fc.name,
      parameters: fc.args,
    };
  }
  throw new UnsupportedLegacyPartError(
    'unsupported legacy part: malformed functionCall',
  );
}

function mapFunctionResponsePart(p: Record<string, unknown>): ContentBlock {
  const fr = p.functionResponse;
  if (
    isRecord(fr) &&
    typeof fr.name === 'string' &&
    (typeof fr.id === 'string' || fr.id === undefined)
  ) {
    return {
      type: 'tool_response',
      callId: typeof fr.id === 'string' ? fr.id : '',
      toolName: fr.name,
      result: fr.response,
    };
  }
  throw new UnsupportedLegacyPartError(
    'unsupported legacy part: malformed functionResponse',
  );
}

function mapSingleLegacyPart(p: unknown): ContentBlock {
  if (!isRecord(p)) {
    throw new UnsupportedLegacyPartError(
      'unsupported legacy part: not a record',
    );
  }
  if (hasThought(p)) return mapThoughtPart(p);
  if (hasText(p)) return mapTextPart(p);
  if (hasInlineData(p)) return mapInlineDataPart(p);
  if (hasFileData(p)) return mapFileDataPart(p);
  if (hasFunctionCall(p)) return mapFunctionCallPart(p);
  if (hasFunctionResponse(p)) return mapFunctionResponsePart(p);
  // ES-2: never silent stringify/drop unsupported legacy input.
  throw new UnsupportedLegacyPartError('unsupported legacy part shape');
}

/**
 * Map an array of legacy Google `Part`-like objects to neutral `ContentBlock[]`.
 * Preserves thoughtSignature (BR-5), media, tool responses, and tool-call IDs.
 * Throws {@link UnsupportedLegacyPartError} for an unrecognized part so the
 * caller can surface `{ok:false,error}` (ES-2 — never silent stringify/drop).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P05
 * @requirement:REQ-001.2
 * @pseudocode lines 28-38
 */
function mapLegacyParts(parts: unknown[]): ContentBlock[] {
  return parts.map(mapSingleLegacyPart);
}

// --- field detectors (structural, no casts) ---

function hasText(p: Record<string, unknown>): boolean {
  return typeof p.text === 'string';
}

/**
 * Detects a Google-style thinking part. Matches two shapes:
 * - {thought: "text content", ...} (string form, legacy)
 * - {thought: true, text: "text content", ...} (boolean form, Google API)
 */
function hasThought(p: Record<string, unknown>): boolean {
  return (
    'thought' in p && (typeof p.thought === 'string' || p.thought === true)
  );
}

/**
 * Read the text content from a thought part, handling both Google-style
 * {thought:true, text} (text is in `text`) and legacy {thought:"text"}
 * (text is in `thought`).
 */
function readThoughtText(p: Record<string, unknown>): string {
  if (typeof p.thought === 'string') return p.thought;
  // Google-style: thought is boolean true, content is in `text`
  return readString(p, 'text');
}

function hasInlineData(p: Record<string, unknown>): boolean {
  return 'inlineData' in p;
}

function hasFileData(p: Record<string, unknown>): boolean {
  return 'fileData' in p;
}

function hasFunctionCall(p: Record<string, unknown>): boolean {
  return 'functionCall' in p;
}

function hasFunctionResponse(p: Record<string, unknown>): boolean {
  return 'functionResponse' in p;
}

function readString(p: Record<string, unknown>, key: string): string {
  const v = p[key];
  return typeof v === 'string' ? v : '';
}

// ---------------------------------------------------------------------------
// iContentFromAgentMessageInput — pseudocode lines 11-20
// ---------------------------------------------------------------------------

/**
 * Convert a neutral {@link AgentMessageInput} into `IContent[]` with NO
 * provider `Part`/`role` shape.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P05
 * @requirement:REQ-001.1
 * @pseudocode lines 11-20
 */
export function iContentFromAgentMessageInput(
  input: AgentMessageInput,
): IContent[] {
  if (typeof input === 'string') {
    return [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: input } satisfies TextBlock],
      },
    ];
  }

  // Empty array — defensively return [] (pseudocode line 20).
  if (Array.isArray(input) && input.length === 0) {
    return [];
  }

  if (isIContent(input)) {
    return [input];
  }

  if (isIContentArray(input)) {
    return input;
  }

  if (isContentBlockArray(input)) {
    return [{ speaker: 'human', blocks: input }];
  }

  // Legacy PartListUnion fallback: a non-empty array that is NOT
  // IContent[] or ContentBlock[] may be a Google-shaped PartListUnion
  // (e.g. [{text:'hello'}]). Route it through the lossless legacy
  // converter so the content is preserved. Conversion errors are
  // explicit — never fabricated or silently dropped (ES-2).
  const legacy = iContentFromLegacyInput(input);
  if (legacy.ok) {
    return legacy.value;
  }

  throw new Error(
    `iContentFromAgentMessageInput: unsupported input shape — ${legacy.error}`,
  );
}

// ---------------------------------------------------------------------------
// iContentFromLegacyInput — pseudocode lines 21-27
// ---------------------------------------------------------------------------

function okResult(value: IContent[]): LegacyConversionResult {
  return { ok: true, value };
}

function errResult(error: string): LegacyConversionResult {
  return { ok: false, error };
}

function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function tryLegacyConversion(
  convert: () => IContent[],
): LegacyConversionResult {
  try {
    return okResult(convert());
  } catch (e) {
    if (e instanceof UnsupportedLegacyPartError) {
      return errResult(e.message);
    }
    throw e;
  }
}

/**
 * Lossless legacy PartListUnion/Content → IContent converter. Preserves
 * thoughtSignature/media/toolResponse/toolCallId. Returns a Result — the
 * caller MUST handle `{ok:false}` (ES-2: never silent-drop).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P05
 * @requirement:REQ-001.2
 * @pseudocode lines 21-27
 */
export function iContentFromLegacyInput(
  input: unknown,
): LegacyConversionResult {
  if (typeof input === 'string') {
    return okResult([humanText(input)]);
  }

  if (isLegacyPartArray(input)) {
    return tryLegacyConversion(() => [
      { speaker: 'human', blocks: mapLegacyParts(input) },
    ]);
  }

  // A single legacy part (not wrapped in an array) — wrap and convert.
  if (hasLegacyPartKey(input)) {
    return tryLegacyConversion(() => [
      { speaker: 'human', blocks: mapLegacyParts([input]) },
    ]);
  }

  if (isLegacyContent(input)) {
    return tryLegacyConversion(() => [legacyContentToIContent(input)]);
  }

  if (isLegacyContentArray(input)) {
    return tryLegacyConversion(() =>
      input.map((item) => legacyContentToIContent(item)),
    );
  }

  return errResult('unsupported legacy input shape');
}

// ---------------------------------------------------------------------------
// legacyContentToIContent — pseudocode lines 39-41
// ---------------------------------------------------------------------------

/**
 * Convert a legacy Google `Content` (`{role, parts}`) into a neutral
 * `IContent`. The speaker is derived from `role`; NO `role`/`parts` keys
 * appear in the output.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P05
 * @requirement:REQ-001.2
 * @pseudocode lines 39-41
 */
function roleToSpeaker(role: string): IContent['speaker'] {
  if (role === 'model') return 'ai';
  if (role === 'function' || role === 'tool') return 'tool';
  return 'human';
}

function legacyContentToIContent(c: {
  role?: string;
  parts?: unknown[];
}): IContent {
  const role = typeof c.role === 'string' ? c.role : '';
  const speaker = roleToSpeaker(role);
  const parts = Array.isArray(c.parts) ? c.parts : [];
  return { speaker, blocks: mapLegacyParts(parts) };
}

// ---------------------------------------------------------------------------
// iContentFromBlocks — pseudocode lines 42-48
// ---------------------------------------------------------------------------

/**
 * Direct, lossless wrapper: builds ONE neutral `IContent` from already-neutral
 * `ContentBlock[]`. Used where the caller already holds filtered/derived
 * neutral blocks (StreamProcessor after-model hook filtering P07,
 * DirectMessageProcessor after-model hook filtering P13) and must hand a
 * neutral `IContent` to `fireAfterModelEvent` WITHOUT any Google-shaped
 * intermediary.
 *
 * NO Google shape (no role/parts/candidates); returns `{speaker, blocks}`
 * only. Immutable (new object; the input `blocks` reference is carried
 * as-is — callers must not mutate).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P05
 * @requirement:REQ-001.2
 * @pseudocode lines 42-48
 */
export function iContentFromBlocks(
  blocks: ContentBlock[],
  speaker: IContent['speaker'] = 'ai',
): IContent {
  return { speaker, blocks };
}

// ---------------------------------------------------------------------------
// sendParamsToRequest — pseudocode lines 76-77
// ---------------------------------------------------------------------------

/**
 * Map a legacy `SendMessageParameters`-style call (message + settings) to a
 * neutral {@link ModelGenerationRequest}. The resulting request carries NO
 * Google-shaped config or message — no `role`/`parts`/`candidates`, no
 * `GenerateContentConfig`; `contents` is `IContent[]` only.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P05
 * @requirement:REQ-001.3
 * @pseudocode lines 76-77
 */
export function sendParamsToRequest(
  message: AgentMessageInput,
  settings?: ModelGenerationSettings,
): ModelGenerationRequest {
  return {
    contents: iContentFromAgentMessageInput(message),
    settings,
  };
}
