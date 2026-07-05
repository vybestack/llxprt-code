/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Additive neutral Gemini boundary converters — lossless round-trip helpers
 * between `@google/genai` Part[]/usage/grounding/error shapes and the neutral
 * llxprt llm-types (ContentBlock[], UsageStats, GroundingInfo, ProviderApiError).
 *
 * This file lives in the providers/src/gemini enclave and MAY import
 * `@google/genai`. It does NOT modify the existing ContentConverters or
 * GeminiMessageConverter entry points (additive-only).
 *
 * Round-trip invariant (REQ-010.2): for every supported Gemini Part shape P,
 * blocksToGeminiParts(geminiPartsToBlocks([P])) deep-equals [P]. Losslessness
 * for shapes without a direct neutral equivalent is achieved via block-level
 * providerMetadata with 'gemini.'-namespaced keys.
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.1, REQ-010.2, REQ-010.3, REQ-010.4, REQ-010.5, REQ-010.6
 * @pseudocode lines 10-77
 */

import type {
  Part,
  FunctionDeclaration,
  GenerateContentResponseUsageMetadata,
  GroundingMetadata,
  UrlMetadata,
  Outcome,
  Language,
  ApiError,
} from '@google/genai';
import type {
  ContentBlock,
  TextBlock,
  ToolCallBlock,
  ToolResponseBlock,
  MediaBlock,
  ThinkingBlock,
  CodeBlock,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  GroundingInfo,
  GroundingSource,
  GroundingSegment,
  UrlAccessInfo,
  ProviderApiError,
  ToolDeclaration,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { isRecord } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { cleanGeminiSchema } from './geminiSchemaHelpers.js';

/** Marker key set on a MediaBlock when fileData had no mimeType (lossless round-trip). */
const FILE_DATA_MARKER = 'gemini.fileData';
/** Key under which executableCode original-casing language is preserved. */
const EXECUTABLE_CODE_KEY = 'gemini.executableCode';
/** Key under which codeExecutionResult outcome is preserved. */
const CODE_EXEC_RESULT_KEY = 'gemini.codeExecutionResult';
/** Key under which videoMetadata is preserved on a media block. */
const VIDEO_METADATA_KEY = 'gemini.videoMetadata';
/**
 * Key under which a non-record functionResponse.response (null/array/primitive)
 * is preserved so the round-trip is lossless (mirrors executableCode/fileData).
 */
const FUNCTION_RESPONSE_KEY = 'gemini.functionResponse';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const OUTCOME_VALUES = new Set<unknown>([
  'OUTCOME_UNSPECIFIED',
  'OUTCOME_OK',
  'OUTCOME_FAILED',
  'OUTCOME_DEADLINE_EXCEEDED',
]);

function isOutcome(value: unknown): value is Outcome {
  return OUTCOME_VALUES.has(value);
}

const LANGUAGE_VALUES = new Set<unknown>(['LANGUAGE_UNSPECIFIED', 'PYTHON']);

function isLanguage(value: unknown): value is Language {
  return LANGUAGE_VALUES.has(value);
}

function thoughtPartToBlock(part: Part): ThinkingBlock {
  const block: ThinkingBlock = {
    type: 'thinking',
    thought: part.text ?? '',
    isHidden: true,
    sourceField: 'thought',
  };
  if (part.thoughtSignature !== undefined) {
    block.signature = part.thoughtSignature;
  }
  return block;
}

function inlineDataToBlock(part: Part): MediaBlock {
  const block: MediaBlock = {
    type: 'media',
    mimeType: part.inlineData?.mimeType ?? '',
    data: part.inlineData?.data ?? '',
    encoding: 'base64',
  };
  if (part.videoMetadata !== undefined) {
    block.providerMetadata = { [VIDEO_METADATA_KEY]: part.videoMetadata };
  }
  return block;
}

function fileDataToBlock(part: Part): MediaBlock {
  const fd = part.fileData;
  const rawMimeType = fd?.mimeType;
  const mimeType =
    typeof rawMimeType === 'string' && rawMimeType.length > 0
      ? rawMimeType
      : undefined;
  const hasMimeType = mimeType !== undefined;
  const block: MediaBlock = {
    type: 'media',
    mimeType: mimeType ?? 'application/octet-stream',
    data: fd?.fileUri ?? '',
    encoding: 'url',
  };
  const meta: Record<string, unknown> = {};
  if (!hasMimeType) {
    meta[FILE_DATA_MARKER] = true;
  }
  if (part.videoMetadata !== undefined) {
    meta[VIDEO_METADATA_KEY] = part.videoMetadata;
  }
  if (Object.keys(meta).length > 0) {
    block.providerMetadata = meta;
  }
  return block;
}

function executableCodeToBlock(part: Part): CodeBlock {
  const ec = part.executableCode;
  return {
    type: 'code',
    code: ec?.code ?? '',
    language:
      ec?.language !== undefined ? ec.language.toLowerCase() : undefined,
    providerMetadata: { [EXECUTABLE_CODE_KEY]: { language: ec?.language } },
  };
}

function codeExecutionResultToBlock(part: Part): ToolResponseBlock {
  const cer = part.codeExecutionResult;
  return {
    type: 'tool_response',
    callId: '',
    toolName: 'code_execution',
    result: { output: cer?.output ?? '' },
    providerMetadata: {
      [CODE_EXEC_RESULT_KEY]: { outcome: cer?.outcome },
    },
  };
}

/**
 * Convert a single Gemini {@link Part} into a neutral {@link ContentBlock}.
 * Returns null for unrecognized/empty parts.
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.1
 * @pseudocode lines 10-25
 */
export function geminiPartToBlock(part: Part): ContentBlock | null {
  if (part.thought === true) {
    return thoughtPartToBlock(part);
  }
  if (part.text !== undefined) {
    return { type: 'text', text: part.text } satisfies TextBlock;
  }
  if (part.functionCall) {
    const fc = part.functionCall;
    return {
      type: 'tool_call',
      id: fc.id ?? '',
      name: fc.name ?? '',
      parameters: isRecord(fc.args) ? fc.args : {},
    };
  }
  if (part.functionResponse) {
    const fr = part.functionResponse;
    const rawResponse: unknown = fr.response;
    const block: ToolResponseBlock = {
      type: 'tool_response',
      callId: fr.id ?? '',
      toolName: fr.name ?? '',
      result: isRecord(rawResponse) ? rawResponse : {},
    };
    // Lossless preservation: when response is a non-record (null/array/
    // primitive) and present, stash it in providerMetadata so the reverse
    // converter can restore it byte-identical (mirrors executableCode/fileData).
    if (!isRecord(rawResponse) && rawResponse !== undefined) {
      block.providerMetadata = { [FUNCTION_RESPONSE_KEY]: rawResponse };
    }
    return block;
  }
  if (part.inlineData) {
    return inlineDataToBlock(part);
  }
  if (part.fileData) {
    return fileDataToBlock(part);
  }
  if (part.executableCode) {
    return executableCodeToBlock(part);
  }
  if (part.codeExecutionResult) {
    return codeExecutionResultToBlock(part);
  }
  return null;
}

/**
 * Map an array of Gemini {@link Part}s to neutral {@link ContentBlock}s,
 * filtering out unrecognized parts (null results).
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.1
 * @pseudocode line 26
 */
export function geminiPartsToBlocks(parts: readonly Part[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  for (const part of parts) {
    const block = geminiPartToBlock(part);
    if (block !== null) {
      result.push(block);
    }
  }
  return result;
}

function buildToolCallPart(block: ToolCallBlock): Part {
  const fc: NonNullable<Part['functionCall']> = {
    name: block.name,
    args: isRecord(block.parameters) ? block.parameters : {},
  };
  // Only set id when present — an empty-string id (from an id-absent Gemini
  // functionCall) must NOT be emitted, preserving the lossless round-trip
  // invariant (REQ-010.2).
  if (block.id !== '') {
    fc.id = block.id;
  }
  return { functionCall: fc };
}

function buildFunctionResponsePart(block: ToolResponseBlock): Part {
  // If a non-record response was preserved in providerMetadata (lossless
  // round-trip), restore it verbatim; otherwise map the record result.
  const meta = block.providerMetadata;
  const fr: NonNullable<Part['functionResponse']> = {
    name: block.toolName,
    response: isRecord(block.result) ? block.result : {},
  };
  if (meta !== undefined && FUNCTION_RESPONSE_KEY in meta) {
    // The SDK types FunctionResponse.response as Record<string, unknown>,
    // but the lossless-preservation contract can hold any JSON value
    // (null/array/primitive). The field is read back verbatim on the
    // reverse path, so the widening is intentional and safe.
    fr.response = meta[FUNCTION_RESPONSE_KEY] as NonNullable<
      Part['functionResponse']
    >['response'];
  }
  if (block.callId !== '') {
    fr.id = block.callId;
  }
  return { functionResponse: fr };
}

function buildCodeExecutionResultPart(block: ToolResponseBlock): Part | null {
  const meta = block.providerMetadata;
  const preservedRaw = meta ? meta[CODE_EXEC_RESULT_KEY] : undefined;
  if (!isRecord(preservedRaw)) {
    return null;
  }
  const resultObj = block.result;
  const output = isRecord(resultObj)
    ? optionalString(resultObj['output'])
    : undefined;
  const part: Part = {
    codeExecutionResult: {},
  };
  if (part.codeExecutionResult) {
    if ('outcome' in preservedRaw && isOutcome(preservedRaw.outcome)) {
      part.codeExecutionResult.outcome = preservedRaw.outcome;
    }
    part.codeExecutionResult.output = output ?? '';
  }
  return part;
}

function buildExecutableCodePart(block: CodeBlock): Part | null {
  const meta = block.providerMetadata;
  const preservedRaw = meta ? meta[EXECUTABLE_CODE_KEY] : undefined;
  if (!isRecord(preservedRaw)) {
    return null;
  }
  const part: Part = { executableCode: { code: block.code } };
  if (part.executableCode && isLanguage(preservedRaw.language)) {
    part.executableCode.language = preservedRaw.language;
  }
  return part;
}

function buildMediaPart(block: MediaBlock): Part {
  const part: Part = {};
  if (block.encoding === 'base64') {
    part.inlineData = { mimeType: block.mimeType, data: block.data };
  } else {
    // url encoding → fileData
    const fileData: NonNullable<Part['fileData']> = { fileUri: block.data };
    const hasFileMarker =
      block.providerMetadata !== undefined &&
      block.providerMetadata[FILE_DATA_MARKER] === true;
    if (!hasFileMarker) {
      fileData.mimeType = block.mimeType;
    }
    part.fileData = fileData;
  }
  if (
    block.providerMetadata !== undefined &&
    isRecord(block.providerMetadata[VIDEO_METADATA_KEY])
  ) {
    part.videoMetadata = block.providerMetadata[VIDEO_METADATA_KEY];
  }
  return part;
}

/**
 * Convert a single neutral {@link ContentBlock} into a Gemini {@link Part}.
 * Returns null for block types with no Gemini equivalent.
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.1
 * @pseudocode lines 27-38
 */
export function blockToGeminiPart(block: ContentBlock): Part | null {
  switch (block.type) {
    case 'text': {
      return { text: block.text };
    }
    case 'tool_call': {
      return buildToolCallPart(block);
    }
    case 'tool_response': {
      const cerPart = buildCodeExecutionResultPart(block);
      if (cerPart !== null) {
        return cerPart;
      }
      return buildFunctionResponsePart(block);
    }
    case 'media': {
      return buildMediaPart(block);
    }
    case 'code': {
      const execPart = buildExecutableCodePart(block);
      if (execPart !== null) {
        return execPart;
      }
      // plain CodeBlock → fenced text (matches ContentConverters convention)
      const codeText = block.language
        ? '```' + block.language + '\n' + block.code + '\n```'
        : block.code;
      return { text: codeText };
    }
    case 'thinking': {
      const part: Part = { thought: true, text: block.thought };
      if (block.signature !== undefined) {
        part.thoughtSignature = block.signature;
      }
      return part;
    }
    default: {
      return null;
    }
  }
}

/**
 * Map an array of neutral {@link ContentBlock}s to Gemini {@link Part}s,
 * filtering out blocks with no Gemini equivalent (null results).
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.2
 * @pseudocode line 39
 */
export function blocksToGeminiParts(blocks: readonly ContentBlock[]): Part[] {
  const result: Part[] = [];
  for (const block of blocks) {
    const part = blockToGeminiPart(block);
    if (part !== null) {
      result.push(part);
    }
  }
  return result;
}

/**
 * Convert Gemini usage metadata to neutral {@link UsageStats}.
 * thoughtsTokenCount → reasoningTokens, toolUsePromptTokenCount → toolTokens,
 * cachedContentTokenCount → cachedTokens. Required fields default to 0;
 * optional fields are omitted when undefined.
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.3
 * @pseudocode lines 50-56
 */
export function geminiUsageToUsageStats(
  u: GenerateContentResponseUsageMetadata,
): UsageStats {
  const result: UsageStats = {
    promptTokens: u.promptTokenCount ?? 0,
    completionTokens: u.candidatesTokenCount ?? 0,
    totalTokens: u.totalTokenCount ?? 0,
  };
  if (u.cachedContentTokenCount !== undefined) {
    result.cachedTokens = u.cachedContentTokenCount;
  }
  if (u.thoughtsTokenCount !== undefined) {
    result.reasoningTokens = u.thoughtsTokenCount;
  }
  if (u.toolUsePromptTokenCount !== undefined) {
    result.toolTokens = u.toolUsePromptTokenCount;
  }
  return result;
}

/**
 * Convert Gemini {@link GroundingMetadata} to neutral {@link GroundingInfo}.
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.4
 * @pseudocode lines 60-64
 */
export function geminiGroundingToGroundingInfo(
  g: GroundingMetadata,
): GroundingInfo {
  const chunks = g.groundingChunks ?? [];
  const sources: GroundingSource[] = chunks.map((chunk) => {
    const source: GroundingSource = {};
    if (chunk.web?.title !== undefined) {
      source.title = chunk.web.title;
    }
    if (chunk.web?.uri !== undefined) {
      source.url = chunk.web.uri;
    }
    return source;
  });

  const supports = g.groundingSupports;
  if (supports === undefined || supports.length === 0) {
    return { sources };
  }

  const segments: GroundingSegment[] = supports.map((s) => {
    const seg: GroundingSegment = {};
    if (s.segment?.startIndex !== undefined) {
      seg.startIndex = s.segment.startIndex;
    }
    if (s.segment?.endIndex !== undefined) {
      seg.endIndex = s.segment.endIndex;
    }
    if (s.segment?.text !== undefined) {
      seg.text = s.segment.text;
    }
    if (s.groundingChunkIndices !== undefined) {
      seg.sourceIndices = s.groundingChunkIndices;
    }
    return seg;
  });

  return { sources, segments };
}

/**
 * Convert Gemini {@link UrlMetadata} to neutral {@link UrlAccessInfo}.
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.4
 * @pseudocode lines 65-66
 */
export function geminiUrlMetadataToUrlAccessInfo(
  m: UrlMetadata,
): UrlAccessInfo {
  return {
    url: m.retrievedUrl ?? '',
    status: String(m.urlRetrievalStatus ?? ''),
  };
}

/**
 * Convert a Gemini SDK {@link ApiError} instance to a neutral
 * {@link ProviderApiError}. Flag derivation: 429 → quota+transient,
 * 401/403 → auth, ≥500 → transient.
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.5
 * @pseudocode lines 70-72
 */
export function geminiApiErrorToProviderApiError(
  e: ApiError,
): ProviderApiError {
  // The @google/genai SDK declares ApiError.status as a `number`, but in
  // practice a gRPC string status (e.g. 'RESOURCE_EXHAUSTED') can surface.
  // Read defensively via a widened local so string-based statuses are still
  // classified — no type assertion is needed since we branch on typeof.
  const rawStatus: unknown = e.status;
  const result: ProviderApiError = {
    provider: 'gemini',
    message: e.message,
    raw: e,
  };
  if (typeof rawStatus === 'number') {
    const status = rawStatus;
    result.status = status;
    if (status === 429) {
      result.isQuotaError = true;
      result.isTransient = true;
    }
    if (status === 401 || status === 403) {
      result.isAuthError = true;
    }
    if (status >= 500) {
      result.isTransient = true;
    }
  } else if (typeof rawStatus === 'string') {
    const status = rawStatus;
    result.code = status;
    if (status === 'RESOURCE_EXHAUSTED') {
      result.isQuotaError = true;
      result.isTransient = true;
    }
    if (status === 'UNAUTHENTICATED' || status === 'PERMISSION_DENIED') {
      result.isAuthError = true;
    }
    if (
      status === 'UNAVAILABLE' ||
      status === 'DEADLINE_EXCEEDED' ||
      status === 'INTERNAL'
    ) {
      result.isTransient = true;
    }
  }
  return result;
}

/**
 * Convert neutral {@link ToolDeclaration}[] to Gemini
 * {@link FunctionDeclaration}[], running each parametersJsonSchema through
 * REAL {@link cleanGeminiSchema} (lossy-by-design: $ref/$defs/oneOf/allOf/not/
 * additionalProperties are stripped).
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.6
 * @pseudocode lines 75-77
 */
export function toolDeclarationsToGemini(
  decls: readonly ToolDeclaration[],
): FunctionDeclaration[] {
  return decls.map((d) => {
    const cleaned = cleanGeminiSchema(d.parametersJsonSchema);
    const fd: FunctionDeclaration = {
      name: d.name,
      parameters: cleaned,
    };
    if (d.description !== undefined) {
      fd.description = d.description;
    }
    return fd;
  });
}
