/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for Gemini response AFC (automatic-function-calling)
 * conversion at the provider boundary.
 *
 * The Gemini SDK returns `GenerateContentResponse.automaticFunctionCallingHistory`
 * as a provider-specific `Content[]`. `createGeminiResponseMapper` must convert
 * that into neutral IContent via `ContentConverters.toIContent`, validate it
 * through the core AFC boundary helper, and stamp the validated neutral history
 * onto the first emitted chunk's provider metadata. The core conversion
 * boundary (`toModelStreamChunk`) then promotes it into the first-class
 * `afcHistory` field and strips the raw key so agents never see it.
 *
 * These tests exercise the REAL mapper and the REAL core boundary against a
 * REAL `GenerateContentResponse` wire fixture (no mocks).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-001.4
 */

import { describe, expect, it } from 'vitest';
import {
  GenerateContentResponse,
  type Content,
  type Candidate,
} from '@google/genai';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  toModelStreamChunk,
  type ModelStreamChunk,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { createGeminiResponseMapper } from './geminiResponseMapper.js';

// ---------------------------------------------------------------------------
// Module-scope helpers (kept outside `it` blocks to satisfy
// vitest/no-conditional-in-test).
// ---------------------------------------------------------------------------

const AFC_KEY = 'automaticFunctionCallingHistory';

/** Narrow a chunk's optional AFC history to a concrete array for assertions. */
function afcOf(chunk: ModelStreamChunk): IContent[] {
  return chunk.afcHistory ?? [];
}

/** Extract a tool_call block id without a type assertion. */
function toolCallIdOf(block: ContentBlock): string {
  return block.type === 'tool_call' ? block.id : '';
}

/** Extract a tool_response block callId without a type assertion. */
function toolResponseCallIdOf(block: ContentBlock): string {
  return block.type === 'tool_response' ? block.callId : '';
}

/**
 * Build a REAL `GenerateContentResponse` instance (the genuine SDK class,
 * mirroring `fromGenerateContentResponse` in core/code_assist/converter.ts).
 */
function makeResponse(options: {
  candidates?: Candidate[];
  afcHistory?: Content[];
  withUsage?: boolean;
}): GenerateContentResponse {
  const response = new GenerateContentResponse();
  response.candidates = options.candidates ?? [];
  if (options.afcHistory !== undefined) {
    response.automaticFunctionCallingHistory = options.afcHistory;
  }
  if (options.withUsage === true) {
    response.usageMetadata = {
      promptTokenCount: 12,
      candidatesTokenCount: 8,
      totalTokenCount: 20,
    };
  }
  return response;
}

/** A single text candidate (the visible model output). */
function textCandidate(text: string): Candidate {
  return { content: { role: 'model', parts: [{ text }] } };
}

/**
 * A well-formed AFC turn sequence: the model calls `get_weather`, then the
 * tool responds. Both share the raw id `call_1`, which `toIContent`
 * canonicalizes to the SAME neutral id for call and response, so the pairing
 * validates in the core boundary helper.
 */
function wellFormedAfc(): Content[] {
  return [
    {
      role: 'model',
      parts: [
        {
          functionCall: {
            id: 'call_1',
            name: 'get_weather',
            args: { city: 'SF' },
          },
        },
      ],
    },
    {
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'call_1',
            name: 'get_weather',
            response: { temperatureF: 72 },
          },
        },
      ],
    },
  ];
}

describe('createGeminiResponseMapper — AFC response conversion (provider boundary)', () => {
  it('converts Gemini AFC Content[] to neutral afcHistory via the core boundary, retaining main content and usage', () => {
    const response = makeResponse({
      candidates: [textCandidate('The weather is sunny.')],
      afcHistory: wellFormedAfc(),
      withUsage: true,
    });

    const mapResponseToChunks = createGeminiResponseMapper();
    const chunks = mapResponseToChunks(response);

    // Mapper output: a single visible text chunk that also carries the
    // neutral AFC history on its provider metadata (the carrier).
    expect(chunks).toHaveLength(1);
    expect(chunks[0].speaker).toBe('ai');
    expect(chunks[0].blocks).toStrictEqual([
      { type: 'text', text: 'The weather is sunny.' },
    ]);
    const carrierAfc = chunks[0].metadata?.providerMetadata?.[AFC_KEY];
    expect(carrierAfc).toBeDefined();
    expect(carrierAfc).toHaveLength(2);
    // Usage metadata is preserved alongside the AFC carrier.
    expect(chunks[0].metadata?.usage).toStrictEqual({
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });

    // Core boundary promotes the carrier into the first-class afcHistory
    // field and strips the raw key.
    const chunk = toModelStreamChunk(chunks[0]);
    const afc = afcOf(chunk);
    expect(afc).toHaveLength(2);

    // Correct neutral tool names.
    expect(afc[0].speaker).toBe('ai');
    expect(afc[0].blocks[0]).toMatchObject({
      type: 'tool_call',
      name: 'get_weather',
      parameters: { city: 'SF' },
    });
    expect(afc[1].speaker).toBe('tool');
    expect(afc[1].blocks[0]).toMatchObject({
      type: 'tool_response',
      toolName: 'get_weather',
      result: { temperatureF: 72 },
    });

    // Correct neutral tool IDs: the response callId pairs the call id.
    const callId = toolCallIdOf(afc[0].blocks[0]);
    const responseCallId = toolResponseCallIdOf(afc[1].blocks[0]);
    expect(callId).not.toBe('');
    expect(callId).toBe(responseCallId);

    // Raw AFC key is absent from BOTH provider-metadata surfaces.
    expect(chunk.providerMetadata?.[AFC_KEY]).toBeUndefined();
    expect(chunk.content.metadata?.providerMetadata?.[AFC_KEY]).toBeUndefined();

    // Main visible content is retained through the boundary.
    expect(chunk.content.blocks).toStrictEqual([
      { type: 'text', text: 'The weather is sunny.' },
    ]);

    // Usage survives the boundary.
    expect(chunk.usage).toStrictEqual({
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });
  });

  it('attaches the AFC carrier to the no-visible-content fallback chunk', () => {
    // No candidates and no usage → mapper emits only the empty fallback chunk.
    const response = makeResponse({
      candidates: [],
      afcHistory: wellFormedAfc(),
    });

    const mapResponseToChunks = createGeminiResponseMapper();
    const chunks = mapResponseToChunks(response);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].blocks).toStrictEqual([]);
    const carrierAfc = chunks[0].metadata?.providerMetadata?.[AFC_KEY];
    expect(carrierAfc).toBeDefined();
    expect(carrierAfc).toHaveLength(2);

    const chunk = toModelStreamChunk(chunks[0]);
    const afc = afcOf(chunk);
    expect(afc).toHaveLength(2);
    expect(chunk.content.blocks).toStrictEqual([]);
    expect(chunk.providerMetadata?.[AFC_KEY]).toBeUndefined();
  });

  it('retains a structurally-valid orphaned tool call on the carrier and in afcHistory', () => {
    const response = makeResponse({
      candidates: [textCandidate('hi')],
      afcHistory: [
        {
          role: 'model',
          parts: [
            {
              functionCall: { id: 'call_1', name: 'get_weather', args: {} },
            },
          ],
        },
      ],
    });

    const mapResponseToChunks = createGeminiResponseMapper();
    const chunks = mapResponseToChunks(response);

    expect(chunks).toHaveLength(1);
    // Structural preservation (neutral contract): a well-formed orphaned
    // tool call (valid speaker + non-empty blocks + valid tool_call block) is
    // a valid AFC carrier. Call/response pairing is NOT enforced at the
    // provider boundary, so the neutral history is stamped onto the carrier.
    const carrierAfc = chunks[0].metadata?.providerMetadata?.[AFC_KEY];
    expect(carrierAfc).toBeDefined();
    expect(carrierAfc).toHaveLength(1);

    const chunk = toModelStreamChunk(chunks[0]);
    const afc = afcOf(chunk);
    expect(afc).toHaveLength(1);
    expect(afc[0].speaker).toBe('ai');
    expect(afc[0].blocks[0]).toMatchObject({
      type: 'tool_call',
      name: 'get_weather',
    });
    // The raw provider wire key is stripped from provider metadata so agents
    // consume ONLY the neutral afcHistory field.
    expect(chunk.providerMetadata?.[AFC_KEY]).toBeUndefined();
    // Main content is still present through the boundary.
    expect(chunk.content.blocks).toStrictEqual([{ type: 'text', text: 'hi' }]);
  });

  describe('empty, absent, or invalid AFC is not attached', () => {
    it('does not attach when AFC history is an empty array', () => {
      const response = makeResponse({
        candidates: [textCandidate('hi')],
        afcHistory: [],
      });

      const mapResponseToChunks = createGeminiResponseMapper();
      const chunks = mapResponseToChunks(response);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].metadata?.providerMetadata?.[AFC_KEY]).toBeUndefined();
      expect(toModelStreamChunk(chunks[0]).afcHistory).toBeUndefined();
    });

    it('does not attach structurally invalid AFC history', () => {
      const response = makeResponse({
        candidates: [textCandidate('hi')],
        afcHistory: [{ role: 'model', parts: [] }],
      });

      const chunks = createGeminiResponseMapper()(response);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].metadata?.providerMetadata?.[AFC_KEY]).toBeUndefined();
      expect(toModelStreamChunk(chunks[0]).afcHistory).toBeUndefined();
    });
    it('does not attach when AFC history is absent', () => {
      const response = makeResponse({
        candidates: [textCandidate('hi')],
      });

      const mapResponseToChunks = createGeminiResponseMapper();
      const chunks = mapResponseToChunks(response);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].metadata?.providerMetadata?.[AFC_KEY]).toBeUndefined();
      expect(toModelStreamChunk(chunks[0]).afcHistory).toBeUndefined();
    });
  });
});
