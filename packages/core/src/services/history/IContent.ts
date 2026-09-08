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
 * Universal content representation that is provider-agnostic.
 * All conversation content is represented as blocks within a speaker's turn.
 */
export interface IContent {
  /**
   * Who is speaking in this content
   * - 'human': The user
   * - 'ai': The AI assistant
   * - 'tool': A tool/function response
   */
  speaker: 'human' | 'ai' | 'tool';

  /**
   * Array of content blocks that make up this message.
   * A message can contain multiple blocks of different types.
   */
  blocks: ContentBlock[];

  /**
   * Optional metadata for the content
   */
  metadata?: ContentMetadata;
}

/**
 * The span of chronology sequence numbers that a summary entry replaced.
 *
 * Produced when compression destroys history items, so the surviving summary
 * records which part of the conversation it stands in for.
 *
 * @issue #1721
 */
export interface ChronologyReplacedSpan {
  /** Lowest chronology sequence number destroyed by the compression. */
  readonly fromSeq: number;

  /** Highest chronology sequence number destroyed by the compression. */
  readonly toSeq: number;

  /** How many history items the compression destroyed. */
  readonly itemCount: number;
}

/**
 * Client-side ordering marker stamped on every history item.
 *
 * This exists to make request/response ordering reconstructable across retries
 * and tool round-trips. It is a debugging/tracing aid only and is NEVER
 * serialized into a provider request payload — providers reject unknown fields
 * on message objects with HTTP 400.
 *
 * @issue #1721
 */
export interface ChronologyMarker {
  /**
   * Monotonic 1-based insertion ordinal within a HistoryService instance.
   * Sequence numbers are never reused, including across `clear()`.
   */
  readonly seq: number;

  /** 0 before the first human turn, then 1-based per human turn. */
  readonly userTurn: number;

  /** 1-based ordinal of this item within its `userTurn`. */
  readonly step: number;

  /** Epoch milliseconds at the moment the item entered history. */
  readonly recordedAt: number;
}

/**
 * Metadata associated with content
 */
export interface SemanticMediaPurgeBoundaryTag {
  readonly blockIndex: number;
  readonly boundaryId: object;
}

export interface SemanticMediaPurgeCacheWriteEvidence {
  readonly boundaryId: object;
  readonly preparation: 'added' | 'reused';
}

export interface ContentMetadata {
  /** When this content was created */
  timestamp?: number;

  /** Which model generated this (for AI responses) */
  model?: string;

  /**
   * Base URL of the provider endpoint that generated this AI turn.
   * Used to detect cross-endpoint thinking-block signature mismatches
   * (e.g. z.ai vs native Anthropic serving the same model name).
   *
   * @issue #1469
   */
  providerBaseURL?: string;

  /** Token usage statistics */
  usage?: UsageStats;

  /** Unique identifier for this content */
  id?: string;

  /**
   * Whether this AI turn was persisted server-side (e.g. OpenAI Responses
   * API store=true). When true the id is safe to reference via
   * previous_response_id for stateful conversations (#207).
   */
  responsesStored?: boolean;

  /** Provider that generated this content */
  provider?: string;

  /** Whether this is a summary of previous messages */
  isSummary?: boolean;

  /** Additional provider-specific metadata */
  providerMetadata?: Record<string, unknown>;

  /** Whether this content is synthetic (auto-generated) */
  synthetic?: boolean;

  /** Reason for synthetic content generation */
  reason?: string;

  /** Stable identifier for a conversation turn */
  turnId?: string;

  /**
   * The originating prompt identifier for this content's turn, providing the
   * reciprocal join key to the per-session token-usage log. Stamped where
   * `turnId` is stamped for the in-flight prompt send so a recorded content
   * entry locates its cost record and vice-versa. Content created outside a
   * prompt (synthetic, resumed, compression summary) has no `promptId` and the
   * field is absent — not null, not empty string.
   *
   * @issue #3130
   */
  promptId?: string;

  /** Stop reason from provider (e.g., end_turn, max_tokens) */
  stopReason?: string;

  /** Finish reason from OpenAI-style providers (e.g., stop, length, tool_calls) */
  finishReason?: string;

  /** Reason the response was incomplete (e.g., max_output_tokens) */
  incompleteReason?: string;

  /**
   * Client-side chronology marker. Stamped by HistoryService on insertion.
   * NEVER serialized to a provider (#1721).
   */
  chronology?: ChronologyMarker;

  /**
   * On a summary entry, the span of chronology sequence numbers this summary
   * replaced. Kept as a sibling of `chronology` because compression builds the
   * summary before it has ever entered history and therefore before it has a
   * marker. NEVER serialized to a provider (#1721).
   */
  chronologyReplaced?: ChronologyReplacedSpan;

  /**
   * Marks this entry as the last item of the compression-preserved head — the
   * cache anchor boundary (#3070). Providers that rely on explicit cache
   * breakpoints (Anthropic) attach a `cache_control` breakpoint to the message
   * derived from this entry, so the byte-stable head is READ from cache after a
   * compression instead of re-billed at cache-WRITE pricing.
   *
   * Exactly one entry (or none) carries this flag at any time; it is stamped by
   * `applyCompressionWithAnchor` and lives on the content itself so a wholesale
   * history replacement drops it automatically. NEVER serialized to a provider.
   */
  cacheAnchor?: boolean;

  /** Session-owned durable cursor for explicit semantic media purge. */
  semanticMediaPurgeFrontier?: {
    readonly contentIndex: number;
    readonly blockIndex: number;
    readonly contentId?: string;
    readonly mediaId?: string;
  };

  /** Request-local marker for the exact semantic purge pre-image boundary. */
  semanticMediaPurgeBoundary?: SemanticMediaPurgeBoundaryTag;

  /** Request-local proof that the provider observed a matching cache write. */
  semanticMediaPurgeCacheWriteEvidence?: SemanticMediaPurgeCacheWriteEvidence;
}

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;

  cachedTokens?: number;
  cacheCreationTokens?: number;
  cacheMissTokens?: number;

  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;

  /**
   * @plan PLAN-20260702-LLMTYPES.P03
   * @requirement REQ-009.2
   * @pseudocode line 91
   */
  reasoningTokens?: number;

  /**
   * @plan PLAN-20260702-LLMTYPES.P03
   * @requirement REQ-009.2
   * @pseudocode line 91
   */
  toolTokens?: number;
}

/**
 * Union type of all possible content blocks
 */
export type ContentBlock =
  | TextBlock
  | ToolCallBlock
  | ToolResponseBlock
  | MediaBlock
  | ThinkingBlock
  | CodeBlock;

/**
 * Regular text content
 */
export interface TextBlock {
  type: 'text';
  text: string;

  /**
   * @plan PLAN-20260702-LLMTYPES.P03
   * @requirement REQ-009.1
   * @pseudocode line 90
   */
  providerMetadata?: Record<string, unknown>;
}

/**
 * AI calling a tool/function
 */
export interface ToolCallBlock {
  type: 'tool_call';

  /** Unique identifier for this tool call */
  id: string;

  /** Name of the tool being called */
  name: string;

  /** Parameters passed to the tool (must be JSON-serializable) */
  parameters: unknown;

  /** Optional description of what this tool call is intended to do */
  description?: string;

  /**
   * @plan PLAN-20260702-LLMTYPES.P03
   * @requirement REQ-009.1
   * @pseudocode line 90
   */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Response from a tool/function call
 */
export interface ToolResponseBlock {
  type: 'tool_response';

  /** References the ToolCallBlock.id this is responding to */
  callId: string;

  /** The tool that generated this response */
  toolName: string;

  /** Result from the tool (must be JSON-serializable) */
  result: unknown;

  /** Error message if the tool call failed */
  error?: string;

  /** Whether this response completes the tool call */
  isComplete?: boolean;

  /**
   * @plan PLAN-20260702-LLMTYPES.P03
   * @requirement REQ-009.1
   * @pseudocode line 90
   */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Media content (images, files, etc.)
 */
interface MediaBlockBase {
  type: 'media';
  mimeType: string;
  caption?: string;
  filename?: string;
  providerMetadata?: Record<string, unknown>;
}

/** Intrinsic media dimensions when admission could determine both values. */
export interface MediaDimensions {
  readonly width: number;
  readonly height: number;
}

/** Deeply immutable, recording-safe semantic metadata values. */
export type MediaSemanticMetadataValue =
  | string
  | number
  | boolean
  | null
  | MediaSemanticMetadata
  | readonly MediaSemanticMetadataValue[];

/** Provider-neutral semantics that remain stable for the referenced bytes. */
export interface MediaSemanticMetadata {
  readonly [key: string]: MediaSemanticMetadataValue;
}

/** Legacy inline media retained for recording and caller compatibility. */
export interface ProviderFileReferenceMetadata {
  readonly cacheKey?: string;
  readonly provider: string;
  readonly baseURL: string;
  readonly credentialHash: string;
  readonly fileId: string;
  readonly byteLength: number;
  readonly scope: 'session' | 'workspace';
  readonly scopeId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly deletion: 'retain' | 'delete';
  readonly zeroDataRetention: 'not-applicable' | 'incompatible-while-retained';
  readonly deletionState: 'active' | 'pending' | 'failed';
}

export interface InlineMediaBlock extends MediaBlockBase {
  encoding: 'url' | 'base64';
  data: string;
  readonly dimensions?: MediaDimensions;
  readonly semanticMetadata?: MediaSemanticMetadata;
  readonly providerFileIds?: Readonly<Record<string, string>>;
  readonly providerFiles?: readonly ProviderFileReferenceMetadata[];
  readonly sourceContentId?: string;
  readonly originalData?: string;
  readonly originalMimeType?: string;
  readonly originalDimensions?: MediaDimensions;
  readonly transformation?: MediaTransformation;
}

/** Exact immutable metadata for one content-addressed media object. */
export interface MediaStoredObject {
  readonly contentId: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly normalizedBase64Length: number;
  readonly dimensions?: MediaDimensions;
}

/** Stable identity of the policy that selected or produced a stored variant. */
export interface MediaTransformation {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly parameters: MediaSemanticMetadata;
}

/**
 * Long-lived local media identity. It records replay and accounting metadata
 * without retaining inline bytes or a machine-specific source path.
 */
export interface MediaReferenceBlock extends MediaBlockBase {
  encoding: 'reference';
  readonly mimeType: string;
  readonly contentId: string;
  readonly originalContentId: string;
  readonly selectedContentId: string;
  readonly originalObject: MediaStoredObject;
  readonly selectedObject: MediaStoredObject;
  readonly transformation: MediaTransformation;
  readonly byteLength: number;
  readonly normalizedBase64Length: number;
  readonly dimensions?: MediaDimensions;
  readonly semanticMetadata: MediaSemanticMetadata;
  readonly providerFileIds?: Readonly<Record<string, string>>;
  readonly providerFiles?: readonly ProviderFileReferenceMetadata[];
  readonly data?: never;
  readonly sourcePath?: never;
}

/** Provider-neutral inline, URL, or local-reference media. */
export type MediaBlock = InlineMediaBlock | MediaReferenceBlock;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContentId(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isMimeType(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)
  );
}

function isLegacyInlineMimeType(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const [essence] = value.split(';', 1);
  return isMimeType(essence.trim());
}

function hasValidDimensions(value: unknown): value is MediaDimensions {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isPositiveInteger(value['width']) &&
    isPositiveInteger(value['height'])
  );
}

function hasValidProviderFileIds(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([provider, fileId]) => provider.length > 0 && isNonEmptyString(fileId),
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasValidProviderFile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value['cacheKey'] !== undefined && !isNonEmptyString(value['cacheKey'])) {
    return false;
  }
  const strings = [
    value['provider'],
    value['baseURL'],
    value['credentialHash'],
    value['fileId'],
    value['scopeId'],
  ];
  if (!strings.every(isNonEmptyString)) return false;
  if (!isPositiveInteger(value['byteLength'])) return false;
  if (value['scope'] !== 'session' && value['scope'] !== 'workspace')
    return false;
  const createdAt = value['createdAt'];
  const expiresAt = value['expiresAt'];
  if (!isNonNegativeInteger(createdAt)) return false;
  if (!isNonNegativeInteger(expiresAt)) return false;
  if (expiresAt <= createdAt) return false;
  if (value['deletion'] !== 'retain' && value['deletion'] !== 'delete')
    return false;
  if (
    value['zeroDataRetention'] !== 'not-applicable' &&
    value['zeroDataRetention'] !== 'incompatible-while-retained'
  ) {
    return false;
  }
  return ['active', 'pending', 'failed'].includes(
    String(value['deletionState']),
  );
}

function hasValidProviderFiles(value: unknown): boolean {
  return Array.isArray(value) && value.every(hasValidProviderFile);
}

const MAX_SEMANTIC_METADATA_DEPTH = 64;

function isMediaSemanticMetadataValue(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
): value is MediaSemanticMetadataValue {
  if (depth > MAX_SEMANTIC_METADATA_DEPTH) return false;
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    return false;
  }
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
  }
  ancestors.add(value);
  const entries = Array.isArray(value) ? value : Object.values(value);
  const hasValidKeys =
    Array.isArray(value) || Object.keys(value).every((key) => key.length > 0);
  const isValid =
    hasValidKeys &&
    entries.every((entry) =>
      isMediaSemanticMetadataValue(entry, ancestors, depth + 1),
    );
  ancestors.delete(value);
  return isValid;
}

function isMediaSemanticMetadata(
  value: unknown,
): value is MediaSemanticMetadata {
  return (
    isRecord(value) && isMediaSemanticMetadataValue(value, new Set<object>(), 0)
  );
}

function hasValidStoredObject(value: unknown): value is MediaStoredObject {
  if (!isRecord(value) || !isContentId(value['contentId'])) return false;
  if (!isMimeType(value['mimeType'])) return false;
  const byteLength = value['byteLength'];
  if (!isPositiveInteger(byteLength)) return false;
  if (value['normalizedBase64Length'] !== Math.ceil(byteLength / 3) * 4) {
    return false;
  }
  return (
    value['dimensions'] === undefined || hasValidDimensions(value['dimensions'])
  );
}

function hasValidTransformation(value: unknown): value is MediaTransformation {
  return (
    isRecord(value) &&
    isNonEmptyString(value['policyId']) &&
    isPositiveInteger(value['policyVersion']) &&
    isMediaSemanticMetadata(value['parameters'])
  );
}

/** Recognizes valid legacy inline and URL media restored from external data. */
export function isInlineMediaBlock(value: unknown): value is InlineMediaBlock {
  if (!isRecord(value) || value['type'] !== 'media') {
    return false;
  }
  if (value['encoding'] !== 'url' && value['encoding'] !== 'base64') {
    return false;
  }
  if (!isLegacyInlineMimeType(value['mimeType'])) return false;
  const dimensions = value['dimensions'];
  if (dimensions !== undefined && !hasValidDimensions(dimensions)) return false;
  const semanticMetadata = value['semanticMetadata'];
  if (
    semanticMetadata !== undefined &&
    !isMediaSemanticMetadata(semanticMetadata)
  ) {
    return false;
  }
  const providerFileIds = value['providerFileIds'];
  if (
    providerFileIds !== undefined &&
    !hasValidProviderFileIds(providerFileIds)
  ) {
    return false;
  }
  const providerFiles = value['providerFiles'];
  if (providerFiles !== undefined && !hasValidProviderFiles(providerFiles)) {
    return false;
  }
  const sourceContentId = value['sourceContentId'];
  if (sourceContentId !== undefined && !isContentId(sourceContentId))
    return false;
  const originalData = value['originalData'];
  if (originalData !== undefined && !isNonEmptyString(originalData))
    return false;
  const originalMimeType = value['originalMimeType'];
  if (
    originalMimeType !== undefined &&
    !isLegacyInlineMimeType(originalMimeType)
  ) {
    return false;
  }
  const originalDimensions = value['originalDimensions'];
  if (
    originalDimensions !== undefined &&
    !hasValidDimensions(originalDimensions)
  ) {
    return false;
  }
  const transformation = value['transformation'];
  if (transformation !== undefined && !hasValidTransformation(transformation)) {
    return false;
  }
  return isNonEmptyString(value['data']);
}

function dimensionsMatch(
  left: MediaDimensions | undefined,
  right: MediaDimensions | undefined,
): boolean {
  return left?.width === right?.width && left?.height === right?.height;
}

function storedObjectMetadataMatches(
  left: MediaStoredObject,
  right: MediaStoredObject,
): boolean {
  return (
    left.mimeType === right.mimeType &&
    left.byteLength === right.byteLength &&
    left.normalizedBase64Length === right.normalizedBase64Length &&
    dimensionsMatch(left.dimensions, right.dimensions)
  );
}

function referenceObjectsMatch(
  value: Readonly<Record<string, unknown>>,
  originalObject: MediaStoredObject,
  selectedObject: MediaStoredObject,
): boolean {
  return [
    originalObject.contentId === value['originalContentId'],
    selectedObject.contentId === value['selectedContentId'],
    selectedObject.contentId === value['contentId'],
    selectedObject.mimeType === value['mimeType'],
    selectedObject.byteLength === value['byteLength'],
    selectedObject.normalizedBase64Length === value['normalizedBase64Length'],
    dimensionsMatch(
      selectedObject.dimensions,
      hasValidDimensions(value['dimensions']) ? value['dimensions'] : undefined,
    ),
    originalObject.contentId !== selectedObject.contentId ||
      storedObjectMetadataMatches(originalObject, selectedObject),
  ].every(Boolean);
}

/** Validates the complete persisted local-reference shape and its invariants. */
export function isMediaReferenceBlock(
  value: unknown,
): value is MediaReferenceBlock {
  if (!isRecord(value) || value['type'] !== 'media') {
    return false;
  }
  if (value['encoding'] !== 'reference') {
    return false;
  }
  if ('data' in value || 'sourcePath' in value) {
    return false;
  }
  if (!isMimeType(value['mimeType'])) {
    return false;
  }
  if (!isContentId(value['contentId'])) {
    return false;
  }
  if (!isContentId(value['originalContentId'])) {
    return false;
  }
  if (!isContentId(value['selectedContentId'])) {
    return false;
  }
  if (value['contentId'] !== value['selectedContentId']) {
    return false;
  }
  const byteLength = value['byteLength'];
  if (!isPositiveInteger(byteLength)) {
    return false;
  }
  const normalizedBase64Length = value['normalizedBase64Length'];
  if (!isPositiveInteger(normalizedBase64Length)) {
    return false;
  }
  if (normalizedBase64Length !== Math.ceil(byteLength / 3) * 4) {
    return false;
  }
  const originalObject = value['originalObject'];
  const selectedObject = value['selectedObject'];
  if (!hasValidStoredObject(originalObject)) return false;
  if (!hasValidStoredObject(selectedObject)) return false;
  if (!hasValidTransformation(value['transformation'])) return false;
  if (!referenceObjectsMatch(value, originalObject, selectedObject)) {
    return false;
  }
  if (!isMediaSemanticMetadata(value['semanticMetadata'])) {
    return false;
  }
  const dimensions = value['dimensions'];
  if (dimensions !== undefined && !hasValidDimensions(dimensions)) {
    return false;
  }
  const providerFileIds = value['providerFileIds'];
  if (
    providerFileIds !== undefined &&
    !hasValidProviderFileIds(providerFileIds)
  ) {
    return false;
  }
  const providerFiles = value['providerFiles'];
  return providerFiles === undefined || hasValidProviderFiles(providerFiles);
}

/** Rejects local references before a converter attempts inline transport. */
export function requireInlineMediaBlock(block: MediaBlock): InlineMediaBlock {
  if (block.encoding !== 'reference') {
    return block;
  }
  if (!isMediaReferenceBlock(block)) {
    throw new Error('Malformed media reference');
  }
  throw new Error(`Unresolved media reference ${block.contentId}`);
}

/**
 * Thinking/reasoning content (for models that support it)
 * @plan PLAN-20251202-THINKING.P03
 * @requirement REQ-THINK-001.1, REQ-THINK-001.2
 */
export interface ThinkingBlock {
  type: 'thinking';

  /** The thinking/reasoning text */
  thought: string;

  /** Whether this thinking should be hidden from the user */
  isHidden?: boolean;

  /**
   * Source field name for round-trip serialization.
   * Known values: 'reasoning_content', 'reasoning', 'thinking', 'thought', 'think_tags'.
   * May also contain arbitrary user-configured field names (issue #2488).
   */
  sourceField?: string;

  /** Signature for Anthropic extended thinking */
  signature?: string;

  /** Provider-scoped stream identity for replacing incremental thinking updates */
  streamId?: string;

  /** Whether this block is an incremental update or the completed thinking block */
  streamStatus?: 'delta' | 'complete';

  /** Base64-encoded reasoning content (for OpenAI Codex/Responses API) */
  encryptedContent?: string;

  /**
   * @plan PLAN-20260702-LLMTYPES.P03
   * @requirement REQ-009.1
   * @pseudocode line 90
   */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Code content with syntax highlighting support
 */
export interface CodeBlock {
  type: 'code';

  /** The code content */
  code: string;

  /** Programming language for syntax highlighting */
  language?: string;

  /**
   * @plan PLAN-20260702-LLMTYPES.P03
   * @requirement REQ-009.1
   * @pseudocode line 90
   */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Utility class for content validation operations
 */
export const ContentValidation = {
  /**
   * Check if IContent has valid content (non-empty blocks, at least one block with actual content)
   */
  hasContent(content: IContent): boolean {
    if (content.blocks.length === 0) {
      return false;
    }

    // Check if any block has actual content
    return content.blocks.some((block) => {
      if (block.type === 'text') {
        return Boolean(block.text) && block.text.trim().length > 0;
      }
      if (block.type === 'tool_call') {
        return Boolean(block.name) && Boolean(block.parameters);
      }
      if (block.type === 'tool_response') {
        return Boolean(block.callId) && block.result !== undefined;
      }
      if (block.type === 'media') {
        return isInlineMediaBlock(block) || isMediaReferenceBlock(block);
      }
      if (block.type === 'thinking') {
        // A thinking block is valid if it has:
        // 1. Thought content (text), OR
        // 2. Encrypted content (for OpenAI Codex round-trip reasoning)
        const hasThought =
          Boolean(block.thought) && block.thought.trim().length > 0;
        const encryptedContent = block.encryptedContent as unknown;
        const hasEncrypted =
          typeof encryptedContent === 'string' &&
          Boolean(encryptedContent) &&
          encryptedContent.trim().length > 0;

        // For Anthropic extended thinking, require signature
        if (block.sourceField === 'thinking') {
          return hasThought && Boolean(block.signature);
        }

        // For OpenAI/Codex, either thought OR encrypted content is valid
        return hasThought || hasEncrypted;
      }
      // CodeBlock - code is always a string on this type
      return Boolean(block.code) && block.code.trim().length > 0;
    });
  },
};

export function createUserMessage(
  text: string,
  metadata?: { timestamp?: number; provider?: string },
): IContent {
  const content: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
  };
  if (metadata) {
    content.metadata = metadata;
  }
  return content;
}

export function createToolResponse(
  callId: string,
  toolName: string,
  result: unknown,
  error?: string,
): IContent {
  const block: ToolResponseBlock = {
    type: 'tool_response',
    callId,
    toolName,
    result,
  };
  if (error) {
    block.error = error;
  }
  return {
    speaker: 'tool',
    blocks: [block],
  };
}

/**
 * Stamp the originating model and provider base URL onto a freshly generated
 * AI turn's metadata.
 *
 * This MUST only be called at generation-recording boundaries (where an AI
 * turn that was JUST produced by the model is converted to IContent). It must
 * NOT be applied to imported, restored, or rebuilt history, whose true origin
 * model may differ from the current session model. Leaving such turns unstamped
 * lets downstream consumers (e.g. the Anthropic cross-model thinking strip)
 * treat them as unknown and apply conservative stripping.
 *
 * The function is pure: it returns the input unchanged when the speaker is not
 * 'ai' or when there is nothing new to stamp. Existing stamps are never
 * overwritten — if `metadata.model` or `metadata.providerBaseURL` is already
 * set, that value is preserved. This allows a turn that was stamped with a
 * model (pre-#1469) to still receive a `providerBaseURL` stamp on a later
 * recording boundary without losing the original model origin.
 *
 * @issue #2335 — model stamping for cross-model thinking strip
 * @issue #1469 — base URL stamping for cross-endpoint thinking strip
 */
export function stampAiTurnModel(
  content: IContent,
  model: string | undefined,
  baseURL?: string,
): IContent {
  if (content.speaker !== 'ai') {
    return content;
  }

  const hasModel = content.metadata?.model !== undefined;
  const hasBaseURL = content.metadata?.providerBaseURL !== undefined;
  const shouldStampModel = !hasModel && model !== undefined && model.length > 0;
  const shouldStampBaseURL =
    !hasBaseURL && baseURL !== undefined && baseURL.trim().length > 0;

  if (!shouldStampModel && !shouldStampBaseURL) {
    return content;
  }

  const metadata = { ...content.metadata };
  if (shouldStampModel) {
    metadata.model = model;
  }
  if (shouldStampBaseURL) {
    metadata.providerBaseURL = baseURL;
  }

  return { ...content, metadata };
}

/**
 * Strip `responsesStored` from all AI entries in the given history so the
 * Responses stateful chain is invalidated.
 *
 * Any operation that rewrites history behind the current head (compression,
 * density optimization, tool-response replacement) breaks the invariant that
 * retained AI entries still represent what the server holds behind
 * `previous_response_id`. Without this strip, the next turn would select a
 * pre-rewrite parent and the server would replay stale/missing context.
 * Stripping forces a full-history send with `store: true`, starting a fresh
 * correct chain (#3134 Fix 3).
 *
 * Aliasing contract, deliberate: this returns a NEW array, but the entries in
 * it are the CALLER'S OWN `IContent` objects, shared by reference. Only AI
 * entries that actually carried `responsesStored` are replaced, and those get a
 * new object plus a new `metadata` object. `blocks` is never cloned for any
 * entry. Treat the result as read-only and do not mutate entries through it.
 *
 * The return type is `readonly IContent[]` to say so at the type level. Copying
 * every entry was considered and rejected: a shallow `{...entry}` would still
 * share `blocks` and `metadata`, so it would advertise immutability it does not
 * provide, and a deep clone would be real cost on every compression for a
 * hazard no caller exhibits. Sharing entry references is also the established
 * convention here: `HistoryService.getCurated()` and the compression
 * strategies' `history.slice(...)` hand out the same objects.
 *
 * Call sites and why each is safe:
 * - `applyCompressionWithAnchor` and `applyDensityMutations` use the result as
 *   a replacement history and never write through it.
 * - `finalizeReplay` returns the result as `ReplayResult.history` (#3160). Its
 *   consumers DO install those entries into a `HistoryService`, whose
 *   chronology stamper writes `metadata` in place. What is shared is the
 *   ENTRIES, not the array: the returned array is new. That is safe here only
 *   because the entries belong to the replay accumulator, which is discarded
 *   when `finalizeReplay` returns, so no second owner can observe the
 *   mutation. Any future caller whose input entries outlive the call must
 *   clone the ENTRIES first; copying the array would not help.
 */
export function invalidateResponsesStatefulChain(
  history: readonly IContent[],
): readonly IContent[] {
  return history.map((entry) => {
    if (entry.speaker === 'ai' && entry.metadata?.responsesStored === true) {
      const metadata = { ...entry.metadata };
      delete metadata.responsesStored;
      return { ...entry, metadata };
    }
    return entry;
  });
}

/**
 * Invalidates a Responses chain only when a rewrite touches content retained by
 * a stored parent.
 *
 * @param history History after the successful rewrite.
 * @param rewriteStartIndex First rewritten entry.
 * @returns History with stale parent markers removed when required.
 */
export function invalidateResponsesStatefulChainForRetainedRewrite(
  history: IContent[],
  rewriteStartIndex: number,
): IContent[] {
  const rewritesRetainedHistory = history
    .slice(rewriteStartIndex)
    .some(
      (entry) =>
        entry.speaker === 'ai' && entry.metadata?.responsesStored === true,
    );
  return rewritesRetainedHistory
    ? [...invalidateResponsesStatefulChain(history)]
    : history;
}
