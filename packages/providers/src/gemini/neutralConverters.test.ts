/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the additive neutral Gemini boundary converters.
 *
 * These tests exercise the REAL converter code (no mocks) against REAL
 * @google/genai value instances (ApiError, enums) and the REAL
 * cleanGeminiSchema. Round-trip invariance is the core deliverable
 * (REQ-010.2): for every supported Gemini Part shape P,
 * blocksToGeminiParts(geminiPartsToBlocks([P])) deep-equals [P].
 *
 * @plan PLAN-20260702-LLMTYPES.P05
 * @requirement REQ-010.1, REQ-010.2, REQ-010.3, REQ-010.4, REQ-010.5,
 *              REQ-010.6, REQ-010.7, REQ-011
 * @pseudocode lines 10-77
 */

import { describe, expect, it } from 'vitest';
import {
  ApiError,
  Outcome,
  Language,
  type Part,
  type GenerateContentResponseUsageMetadata,
  type GroundingMetadata,
  type UrlMetadata,
} from '@google/genai';
import {
  geminiPartToBlock,
  geminiPartsToBlocks,
  blockToGeminiPart,
  blocksToGeminiParts,
  geminiUsageToUsageStats,
  geminiGroundingToGroundingInfo,
  geminiUrlMetadataToUrlAccessInfo,
  geminiApiErrorToProviderApiError,
  toolDeclarationsToGemini,
} from './neutralConverters.js';
import { ContentConverters } from '@vybestack/llxprt-code-core/services/history/ContentConverters.js';
import {
  isProviderApiError,
  type ToolDeclaration,
  type UsageStats,
  type GroundingInfo,
  type UrlAccessInfo,
} from '@vybestack/llxprt-code-core/llm-types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApiError(status: number, message: string): ApiError {
  return new ApiError({ status, message });
}

function roundTrip(part: Part): Part {
  return blocksToGeminiParts(geminiPartsToBlocks([part]))[0];
}

// ---------------------------------------------------------------------------
// Round-trip invariance (REQ-010.2) — all 10 supported Part shapes
// ---------------------------------------------------------------------------

describe('geminiPartsToBlocks / blocksToGeminiParts round-trip (REQ-010.2)', () => {
  it('round-trips { text }', () => {
    const part: Part = { text: 'hello world' };
    expect(roundTrip(part)).toStrictEqual(part);
  });

  it('round-trips { functionCall: { id, name, args } }', () => {
    const part: Part = {
      functionCall: { id: 'call_1', name: 'getWeather', args: { city: 'SF' } },
    };
    expect(roundTrip(part)).toStrictEqual(part);
  });

  it('round-trips { functionResponse: { id, name, response } }', () => {
    const part: Part = {
      functionResponse: {
        id: 'call_1',
        name: 'getWeather',
        response: { temp: 72 },
      },
    };
    expect(roundTrip(part)).toStrictEqual(part);
  });

  it('round-trips { inlineData: { mimeType, data } }', () => {
    const part: Part = {
      inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' },
    };
    expect(roundTrip(part)).toStrictEqual(part);
  });

  it('round-trips { fileData: { mimeType, fileUri } }', () => {
    const part: Part = {
      fileData: {
        mimeType: 'video/mp4',
        fileUri: 'https://example.com/video.mp4',
      },
    };
    expect(roundTrip(part)).toStrictEqual(part);
  });

  it('round-trips { fileData: { fileUri } } (no mimeType — lossless via marker)', () => {
    const part: Part = {
      fileData: { fileUri: 'https://example.com/file.bin' },
    };
    expect(roundTrip(part)).toStrictEqual(part);
  });

  it('round-trips { executableCode } (casing preserved via providerMetadata)', () => {
    const part: Part = {
      executableCode: { code: 'print(1)', language: Language.PYTHON },
    };
    expect(roundTrip(part)).toStrictEqual(part);
  });

  it('round-trips { codeExecutionResult }', () => {
    const part: Part = {
      codeExecutionResult: { outcome: Outcome.OUTCOME_OK, output: '1\n' },
    };
    expect(roundTrip(part)).toStrictEqual(part);
  });

  it('round-trips { thought: true, text, thoughtSignature }', () => {
    const part: Part = {
      thought: true,
      text: 'reasoning here',
      thoughtSignature: 'sig123',
    };
    expect(roundTrip(part)).toStrictEqual(part);
  });

  it('round-trips a media part with videoMetadata (preserved via gemini.videoMetadata)', () => {
    const part: Part = {
      fileData: {
        mimeType: 'video/mp4',
        fileUri: 'https://example.com/v.mp4',
      },
      videoMetadata: { fps: 24, startOffset: '0s', endOffset: '10s' },
    };
    expect(roundTrip(part)).toStrictEqual(part);
  });

  it('round-trips an inlineData part with videoMetadata (base64 path restores videoMetadata)', () => {
    const part: Part = {
      inlineData: { mimeType: 'video/mp4', data: 'AAAAIGZ0cbQ=' },
      videoMetadata: { fps: 24 },
    };
    expect(roundTrip(part)).toStrictEqual(part);
  });
});

describe('geminiPartToBlock direction (REQ-010.1, pseudocode lines 10-25)', () => {
  it('maps { text } to a TextBlock', () => {
    const block = geminiPartToBlock({ text: 'hi' });
    expect(block).toStrictEqual({ type: 'text', text: 'hi' });
  });

  it('maps { functionCall } to a ToolCallBlock', () => {
    const block = geminiPartToBlock({
      functionCall: { id: 'c1', name: 'fn', args: { a: 1 } },
    });
    expect(block).toStrictEqual({
      type: 'tool_call',
      id: 'c1',
      name: 'fn',
      parameters: { a: 1 },
    });
  });

  it('maps { functionCall } without id to empty id', () => {
    const block = geminiPartToBlock({
      functionCall: { name: 'fn', args: {} },
    });
    expect(block).toStrictEqual({
      type: 'tool_call',
      id: '',
      name: 'fn',
      parameters: {},
    });
  });

  it('maps { functionResponse } to a ToolResponseBlock', () => {
    const block = geminiPartToBlock({
      functionResponse: { id: 'c1', name: 'fn', response: { ok: true } },
    });
    expect(block).toStrictEqual({
      type: 'tool_response',
      callId: 'c1',
      toolName: 'fn',
      result: { ok: true },
    });
  });

  it('maps { inlineData } to a MediaBlock (base64)', () => {
    const block = geminiPartToBlock({
      inlineData: { mimeType: 'image/png', data: 'abc' },
    });
    expect(block).toStrictEqual({
      type: 'media',
      mimeType: 'image/png',
      data: 'abc',
      encoding: 'base64',
    });
  });

  it('maps { fileData } with mimeType to a MediaBlock (url)', () => {
    const block = geminiPartToBlock({
      fileData: { mimeType: 'video/mp4', fileUri: 'https://x.com/v.mp4' },
    });
    expect(block).toStrictEqual({
      type: 'media',
      mimeType: 'video/mp4',
      data: 'https://x.com/v.mp4',
      encoding: 'url',
    });
  });

  it('maps { fileData } without mimeType to MediaBlock with octet-stream + marker', () => {
    const block = geminiPartToBlock({
      fileData: { fileUri: 'https://x.com/f.bin' },
    });
    expect(block).toStrictEqual({
      type: 'media',
      mimeType: 'application/octet-stream',
      data: 'https://x.com/f.bin',
      encoding: 'url',
      providerMetadata: { 'gemini.fileData': true },
    });
  });

  it('maps { executableCode } to a CodeBlock with providerMetadata preserving casing', () => {
    const block = geminiPartToBlock({
      executableCode: { code: 'print(1)', language: Language.PYTHON },
    });
    expect(block).toStrictEqual({
      type: 'code',
      code: 'print(1)',
      language: 'python',
      providerMetadata: { 'gemini.executableCode': { language: 'PYTHON' } },
    });
  });

  it('maps { codeExecutionResult } to a ToolResponseBlock with providerMetadata', () => {
    const block = geminiPartToBlock({
      codeExecutionResult: { outcome: Outcome.OUTCOME_OK, output: '1' },
    });
    expect(block).toStrictEqual({
      type: 'tool_response',
      callId: '',
      toolName: 'code_execution',
      result: { output: '1' },
      providerMetadata: {
        'gemini.codeExecutionResult': { outcome: 'OUTCOME_OK' },
      },
    });
  });

  it('maps { thought: true, text } to a ThinkingBlock', () => {
    const block = geminiPartToBlock({
      thought: true,
      text: 'thinking',
      thoughtSignature: 'sig',
    });
    expect(block).toStrictEqual({
      type: 'thinking',
      thought: 'thinking',
      isHidden: true,
      sourceField: 'thought',
      signature: 'sig',
    });
  });

  it('merges videoMetadata under providerMetadata[gemini.videoMetadata] for a media part', () => {
    const block = geminiPartToBlock({
      fileData: {
        mimeType: 'video/mp4',
        fileUri: 'https://x.com/v.mp4',
      },
      videoMetadata: { fps: 30 },
    });
    expect(block).toMatchObject({
      type: 'media',
      providerMetadata: { 'gemini.videoMetadata': { fps: 30 } },
    });
  });

  it('returns null for an unrecognized/empty part', () => {
    expect(geminiPartToBlock({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Direction tests — blockToGeminiPart
// ---------------------------------------------------------------------------

describe('blockToGeminiPart direction (REQ-010.1, pseudocode lines 27-38)', () => {
  it('MediaBlock url encoding emits fileData (consistent with GeminiMessageConverter)', () => {
    const block = {
      type: 'media' as const,
      mimeType: 'video/mp4',
      data: 'https://example.com/v.mp4',
      encoding: 'url' as const,
    };
    expect(blockToGeminiPart(block)).toStrictEqual({
      fileData: { mimeType: 'video/mp4', fileUri: 'https://example.com/v.mp4' },
    });
  });

  it('MediaBlock url with fileData marker omits mimeType', () => {
    const block = {
      type: 'media' as const,
      mimeType: 'application/octet-stream',
      data: 'https://example.com/f.bin',
      encoding: 'url' as const,
      providerMetadata: { 'gemini.fileData': true },
    };
    expect(blockToGeminiPart(block)).toStrictEqual({
      fileData: { fileUri: 'https://example.com/f.bin' },
    });
  });

  it('MediaBlock base64 emits inlineData', () => {
    const block = {
      type: 'media' as const,
      mimeType: 'image/png',
      data: 'abc=',
      encoding: 'base64' as const,
    };
    expect(blockToGeminiPart(block)).toStrictEqual({
      inlineData: { mimeType: 'image/png', data: 'abc=' },
    });
  });

  it('plain CodeBlock (no gemini providerMetadata) emits fenced text (matches ContentConverters)', () => {
    // Matches ContentConverters.blockToPart code branch: ```lang\ncode\n```
    const block = {
      type: 'code' as const,
      code: 'print(1)',
      language: 'python',
    };
    expect(blockToGeminiPart(block)).toStrictEqual({
      text: '```python\nprint(1)\n```',
    });
  });

  it('plain CodeBlock without language emits raw code text', () => {
    const block = { type: 'code' as const, code: 'x = 1' };
    expect(blockToGeminiPart(block)).toStrictEqual({ text: 'x = 1' });
  });

  it('CodeBlock with gemini.executableCode providerMetadata emits executableCode', () => {
    const block = {
      type: 'code' as const,
      code: 'print(1)',
      language: 'python',
      providerMetadata: {
        'gemini.executableCode': { language: 'PYTHON' },
      },
    };
    expect(blockToGeminiPart(block)).toStrictEqual({
      executableCode: { code: 'print(1)', language: 'PYTHON' },
    });
  });

  it('ToolResponseBlock with gemini.codeExecutionResult emits codeExecutionResult', () => {
    const block = {
      type: 'tool_response' as const,
      callId: '',
      toolName: 'code_execution',
      result: { output: '1' },
      providerMetadata: {
        'gemini.codeExecutionResult': { outcome: 'OUTCOME_OK' },
      },
    };
    expect(blockToGeminiPart(block)).toStrictEqual({
      codeExecutionResult: { outcome: 'OUTCOME_OK', output: '1' },
    });
  });

  it('plain ToolResponseBlock emits functionResponse', () => {
    const block = {
      type: 'tool_response' as const,
      callId: 'c1',
      toolName: 'fn',
      result: { ok: true },
    };
    expect(blockToGeminiPart(block)).toStrictEqual({
      functionResponse: { id: 'c1', name: 'fn', response: { ok: true } },
    });
  });

  it('ThinkingBlock emits { thought: true, text, thoughtSignature }', () => {
    const block = {
      type: 'thinking' as const,
      thought: 'reasoning',
      isHidden: true,
      sourceField: 'thought' as const,
      signature: 'sig',
    };
    expect(blockToGeminiPart(block)).toStrictEqual({
      thought: true,
      text: 'reasoning',
      thoughtSignature: 'sig',
    });
  });

  it('ThinkingBlock without signature omits thoughtSignature', () => {
    const block = {
      type: 'thinking' as const,
      thought: 'reasoning',
      isHidden: true,
      sourceField: 'thought' as const,
    };
    expect(blockToGeminiPart(block)).toStrictEqual({
      thought: true,
      text: 'reasoning',
    });
  });

  it('TextBlock emits { text }', () => {
    expect(blockToGeminiPart({ type: 'text', text: 'hi' })).toStrictEqual({
      text: 'hi',
    });
  });

  it('ToolCallBlock emits { functionCall }', () => {
    const block = {
      type: 'tool_call' as const,
      id: 'c1',
      name: 'fn',
      parameters: { a: 1 },
    };
    expect(blockToGeminiPart(block)).toStrictEqual({
      functionCall: { id: 'c1', name: 'fn', args: { a: 1 } },
    });
  });

  it('restores videoMetadata from providerMetadata on url MediaBlock', () => {
    const block = {
      type: 'media' as const,
      mimeType: 'video/mp4',
      data: 'https://example.com/v.mp4',
      encoding: 'url' as const,
      providerMetadata: { 'gemini.videoMetadata': { fps: 30 } },
    };
    expect(blockToGeminiPart(block)).toStrictEqual({
      fileData: {
        mimeType: 'video/mp4',
        fileUri: 'https://example.com/v.mp4',
      },
      videoMetadata: { fps: 30 },
    });
  });
});

// ---------------------------------------------------------------------------
// geminiPartsToBlocks — array semantics
// ---------------------------------------------------------------------------

describe('geminiPartsToBlocks (pseudocode line 26)', () => {
  it('maps and filters nulls from a mixed parts array', () => {
    const parts: Part[] = [
      { text: 'hello' },
      {},
      { functionCall: { id: 'c1', name: 'fn', args: {} } },
    ];
    const blocks = geminiPartsToBlocks(parts);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toStrictEqual({ type: 'text', text: 'hello' });
    expect(blocks[1]).toHaveProperty('type', 'tool_call');
  });

  it('returns empty array for empty input', () => {
    expect(geminiPartsToBlocks([])).toStrictEqual([]);
  });
});

describe('blocksToGeminiParts (pseudocode line 39)', () => {
  it('maps and filters nulls from a mixed blocks array', () => {
    const blocks = [
      { type: 'text' as const, text: 'a' },
      { type: 'text' as const, text: 'b' },
    ];
    expect(blocksToGeminiParts(blocks)).toStrictEqual([
      { text: 'a' },
      { text: 'b' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// geminiUsageToUsageStats (REQ-010.3)
// ---------------------------------------------------------------------------

describe('geminiUsageToUsageStats (REQ-010.3, pseudocode lines 50-56)', () => {
  it('maps thoughtsTokenCount → reasoningTokens, toolUsePromptTokenCount → toolTokens, cachedContentTokenCount → cachedTokens', () => {
    const u: GenerateContentResponseUsageMetadata = {
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      totalTokenCount: 30,
      cachedContentTokenCount: 5,
      thoughtsTokenCount: 7,
      toolUsePromptTokenCount: 3,
    };
    const result: UsageStats = geminiUsageToUsageStats(u);
    expect(result).toStrictEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      cachedTokens: 5,
      reasoningTokens: 7,
      toolTokens: 3,
    });
  });

  it('missing required fields default to 0', () => {
    const u: GenerateContentResponseUsageMetadata = {};
    const result = geminiUsageToUsageStats(u);
    expect(result).toStrictEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('missing optional fields are omitted', () => {
    const u: GenerateContentResponseUsageMetadata = {
      promptTokenCount: 1,
      candidatesTokenCount: 2,
      totalTokenCount: 3,
    };
    const result = geminiUsageToUsageStats(u);
    expect(result).not.toHaveProperty('cachedTokens');
    expect(result).not.toHaveProperty('reasoningTokens');
    expect(result).not.toHaveProperty('toolTokens');
  });

  it('partial optional fields present only when defined', () => {
    const u: GenerateContentResponseUsageMetadata = {
      promptTokenCount: 1,
      candidatesTokenCount: 2,
      totalTokenCount: 3,
      thoughtsTokenCount: 9,
    };
    const result = geminiUsageToUsageStats(u);
    expect(result).toStrictEqual({
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      reasoningTokens: 9,
    });
    expect(result).not.toHaveProperty('cachedTokens');
    expect(result).not.toHaveProperty('toolTokens');
  });
});

// ---------------------------------------------------------------------------
// geminiGroundingToGroundingInfo (REQ-010.4)
// ---------------------------------------------------------------------------

describe('geminiGroundingToGroundingInfo (REQ-010.4, pseudocode lines 60-64)', () => {
  it('maps web groundingChunks + groundingSupports to GroundingInfo', () => {
    const g: GroundingMetadata = {
      groundingChunks: [
        { web: { title: 'A', uri: 'https://a.com' } },
        { web: { title: 'B', uri: 'https://b.com' } },
      ],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 5, text: 'hello' },
          groundingChunkIndices: [0],
        },
        {
          segment: { startIndex: 6, endIndex: 11, text: 'world' },
          groundingChunkIndices: [0, 1],
        },
      ],
    };
    const result: GroundingInfo = geminiGroundingToGroundingInfo(g);
    expect(result).toStrictEqual({
      sources: [
        { title: 'A', url: 'https://a.com' },
        { title: 'B', url: 'https://b.com' },
      ],
      segments: [
        { startIndex: 0, endIndex: 5, text: 'hello', sourceIndices: [0] },
        { startIndex: 6, endIndex: 11, text: 'world', sourceIndices: [0, 1] },
      ],
    });
  });

  it('omits segments key when no groundingSupports', () => {
    const g: GroundingMetadata = {
      groundingChunks: [{ web: { uri: 'https://x.com' } }],
    };
    const result = geminiGroundingToGroundingInfo(g);
    expect(result).toStrictEqual({
      sources: [{ url: 'https://x.com' }],
    });
    expect(result).not.toHaveProperty('segments');
  });

  it('handles empty grounding metadata', () => {
    const g: GroundingMetadata = {};
    const result = geminiGroundingToGroundingInfo(g);
    expect(result).toStrictEqual({ sources: [] });
  });
});

// ---------------------------------------------------------------------------
// geminiUrlMetadataToUrlAccessInfo (REQ-010.4)
// ---------------------------------------------------------------------------

describe('geminiUrlMetadataToUrlAccessInfo (REQ-010.4, pseudocode lines 65-66)', () => {
  it('maps retrievedUrl and urlRetrievalStatus', () => {
    const m: UrlMetadata = {
      retrievedUrl: 'https://x.com',
      urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_OK',
    };
    const result: UrlAccessInfo = geminiUrlMetadataToUrlAccessInfo(m);
    expect(result).toStrictEqual({
      url: 'https://x.com',
      status: 'URL_RETRIEVAL_STATUS_OK',
    });
  });

  it('defaults url to empty and status to empty string when missing', () => {
    const m: UrlMetadata = {};
    const result = geminiUrlMetadataToUrlAccessInfo(m);
    expect(result).toStrictEqual({ url: '', status: '' });
  });
});

// ---------------------------------------------------------------------------
// geminiApiErrorToProviderApiError (REQ-010.5)
// ---------------------------------------------------------------------------

describe('geminiApiErrorToProviderApiError (REQ-010.5, pseudocode lines 70-72)', () => {
  it('429 → quota + transient flags', () => {
    const err = makeApiError(429, 'rate limited');
    const result = geminiApiErrorToProviderApiError(err);
    expect(result).toStrictEqual({
      provider: 'gemini',
      status: 429,
      message: 'rate limited',
      raw: err,
      isQuotaError: true,
      isTransient: true,
    });
    expect(result.isAuthError).toBeFalsy();
    expect(isProviderApiError(result)).toBe(true);
  });

  it('401 → auth flag', () => {
    const err = makeApiError(401, 'unauthorized');
    const result = geminiApiErrorToProviderApiError(err);
    expect(result.isAuthError).toBe(true);
    expect(result.isQuotaError).toBeFalsy();
    expect(result.isTransient).toBeFalsy();
    expect(isProviderApiError(result)).toBe(true);
  });

  it('403 → auth flag', () => {
    const err = makeApiError(403, 'forbidden');
    const result = geminiApiErrorToProviderApiError(err);
    expect(result.isAuthError).toBe(true);
    expect(isProviderApiError(result)).toBe(true);
  });

  it('500 → transient flag', () => {
    const err = makeApiError(500, 'server error');
    const result = geminiApiErrorToProviderApiError(err);
    expect(result.isTransient).toBe(true);
    expect(result.isQuotaError).toBeFalsy();
    expect(result.isAuthError).toBeFalsy();
    expect(isProviderApiError(result)).toBe(true);
  });

  it('400 → no flags', () => {
    const err = makeApiError(400, 'bad request');
    const result = geminiApiErrorToProviderApiError(err);
    expect(result.isQuotaError).toBeFalsy();
    expect(result.isAuthError).toBeFalsy();
    expect(result.isTransient).toBeFalsy();
    expect(isProviderApiError(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toolDeclarationsToGemini (REQ-010.6)
// ---------------------------------------------------------------------------

describe('toolDeclarationsToGemini (REQ-010.6, pseudocode lines 75-77)', () => {
  it('strips $ref via REAL cleanGeminiSchema, preserves name/description', () => {
    const decls: ToolDeclaration[] = [
      {
        name: 'getWeather',
        description: 'Get weather',
        parametersJsonSchema: {
          type: 'object',
          $ref: '#/$defs/Foo',
          properties: { city: { type: 'string' } },
        },
      },
    ];
    const result = toolDeclarationsToGemini(decls);
    expect(result).toHaveLength(1);
    const fd = result[0];
    expect(fd.name).toBe('getWeather');
    expect(fd.description).toBe('Get weather');
    expect(fd.parameters).not.toHaveProperty('$ref');
    expect(fd.parameters).toHaveProperty('type', 'object');
  });

  it('strips oneOf via REAL cleanGeminiSchema', () => {
    const decls: ToolDeclaration[] = [
      {
        name: 'fn',
        parametersJsonSchema: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
    ];
    const result = toolDeclarationsToGemini(decls);
    expect(result[0].parameters).not.toHaveProperty('oneOf');
    // After stripping oneOf, only whitelisted keys remain (none here → {})
    expect(result[0].parameters).toStrictEqual({});
  });
});

// ---------------------------------------------------------------------------
// Consistency with existing ContentConverters (REQ-010.7)
// ---------------------------------------------------------------------------

describe('consistency with ContentConverters.toIContent (REQ-010.7)', () => {
  // ContentConverters.toIContent applies ID canonicalization:
  //  - functionCall: if no raw id, it generates a canonical id via
  //    canonicalizeToolCallId(providerName, rawId, toolName, turnKey, callIndex).
  //    If a raw id IS present, toIContent uses it directly.
  //  - functionResponse: same pattern via canonicalizeToolResponseId.
  // The neutral geminiPartToBlock uses the raw id directly ('' when absent),
  // WITHOUT canonicalization — it is a lossless, id-free boundary helper.
  // Therefore:
  //  - text/thought: deep-equal identical (no id involved)
  //  - functionCall/functionResponse WITH a raw id: the block body deep-equals
  //    modulo metadata.turnId (toIContent stamps a turnKey).
  //  - functionCall/functionResponse WITHOUT a raw id: IDs DIFFER — toIContent
  //    canonicalizes, neutralConverter returns ''. This difference is documented.

  function blockId(block: { type?: string; id?: unknown }): string {
    return typeof block.id === 'string' ? block.id : '';
  }

  function blockCallId(block: { type?: string; callId?: unknown }): string {
    return typeof block.callId === 'string' ? block.callId : '';
  }

  /**
   * Normalize a block by deleting all ID-bearing fields so that the deep
   * comparison focuses on the non-ID payload (text, args, response, etc.).
   */
  function stripIds(block: Record<string, unknown>): Record<string, unknown> {
    const clone = { ...block };
    delete clone['id'];
    delete clone['callId'];
    return clone;
  }

  it('text part: neutral block deep-equals toIContent block', () => {
    const part: Part = { text: 'hello' };
    const neutralBlock = geminiPartToBlock(part);
    const icontent = ContentConverters.toIContent({
      role: 'model',
      parts: [part],
    });
    expect(neutralBlock).toStrictEqual(icontent.blocks[0]);
  });

  it('thought part: neutral block deep-equals toIContent block', () => {
    const part: Part = {
      thought: true,
      text: 'reasoning',
      thoughtSignature: 's',
    };
    const neutralBlock = geminiPartToBlock(part);
    const icontent = ContentConverters.toIContent({
      role: 'model',
      parts: [part],
    });
    expect(neutralBlock).toStrictEqual(icontent.blocks[0]);
  });

  it('functionCall WITH id — full block deep-equals modulo id fields', () => {
    const part: Part = {
      functionCall: { id: 'call_42', name: 'fn', args: { x: 1 } },
    };
    const neutralBlock = geminiPartToBlock(part);
    const icontent = ContentConverters.toIContent({
      role: 'model',
      parts: [part],
    });
    // Canonicalization difference: toIContent always rewrites the id.
    expect(blockId(neutralBlock)).toBe('call_42');
    const ccId = blockId(icontent.blocks[0]);
    expect(ccId).not.toBe('call_42');
    expect(ccId.length).toBeGreaterThan(0);
    // Full payload (name, parameters, type) deep-equals modulo the id field.
    expect(stripIds(neutralBlock as Record<string, unknown>)).toStrictEqual(
      stripIds(icontent.blocks[0] as Record<string, unknown>),
    );
  });

  it('functionResponse WITH id — full block deep-equals modulo id fields', () => {
    const part: Part = {
      functionResponse: { id: 'call_42', name: 'fn', response: { ok: true } },
    };
    const neutralBlock = geminiPartToBlock(part);
    const icontent = ContentConverters.toIContent({
      role: 'model',
      parts: [part],
    });
    // Canonicalization difference: toIContent always rewrites the callId.
    expect(blockCallId(neutralBlock)).toBe('call_42');
    const ccCallId = blockCallId(icontent.blocks[0]);
    expect(ccCallId).not.toBe('call_42');
    // Full payload (toolName, result, type) deep-equals modulo the callId field.
    expect(stripIds(neutralBlock as Record<string, unknown>)).toStrictEqual(
      stripIds(icontent.blocks[0] as Record<string, unknown>),
    );
  });

  it('functionCall WITHOUT id — full block deep-equals modulo id fields', () => {
    const part: Part = { functionCall: { name: 'fn', args: { a: 1 } } };
    const neutralBlock = geminiPartToBlock(part);
    const icontent = ContentConverters.toIContent({
      role: 'model',
      parts: [part],
    });
    // Neutral converter: id === '' (no canonicalization).
    // ContentConverters: id is a canonicalized non-empty string.
    expect(blockId(neutralBlock)).toBe('');
    const ccId = blockId(icontent.blocks[0]);
    expect(ccId).not.toBe('');
    expect(ccId.length).toBeGreaterThan(0);
    // Full payload deep-equals modulo the id field.
    expect(stripIds(neutralBlock as Record<string, unknown>)).toStrictEqual(
      stripIds(icontent.blocks[0] as Record<string, unknown>),
    );
  });

  it('functionResponse WITHOUT id — full block deep-equals modulo id fields', () => {
    const part: Part = {
      functionResponse: { name: 'fn', response: { r: 2 } },
    };
    const neutralBlock = geminiPartToBlock(part);
    const icontent = ContentConverters.toIContent({
      role: 'model',
      parts: [part],
    });
    expect(blockCallId(neutralBlock)).toBe('');
    const ccCallId = blockCallId(icontent.blocks[0]);
    expect(ccCallId).not.toBe('');
    // Full payload deep-equals modulo the callId field.
    expect(stripIds(neutralBlock as Record<string, unknown>)).toStrictEqual(
      stripIds(icontent.blocks[0] as Record<string, unknown>),
    );
  });
});
