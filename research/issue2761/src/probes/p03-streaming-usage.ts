/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P03 — streaming + usage.
 *
 * llxprt's streaming path runs every chunk through
 * `createGeminiResponseMapper` (`consumeGeminiStream`), which reads
 * `usageMetadata` off each `GenerateContentResponse`. This probe records, per
 * adapter, the chunk/part sequence, whether text arrived in more than one
 * increment, and WHERE usage lands (per-chunk for `@google/genai`; terminal
 * `finish` stream part for the AI SDK).
 */

import type { LanguageModelV2Prompt } from '@ai-sdk/provider';
import type { GenerateContentResponse } from '@google/genai';

import { createAISDK, drainStream } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import {
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  observe,
  type Probe,
  type ProbeResult,
} from '../harness.ts';

const PROMPT_TEXT =
  'Write exactly three sentences about Paris in three short lines.';

const PROMPT: LanguageModelV2Prompt = [
  { role: 'user', content: [{ type: 'text', text: PROMPT_TEXT }] },
];

function summarizeResponse(response: GenerateContentResponse): {
  textLength: number;
  partKinds: string[];
  usageKeys: string[];
  hasUsage: boolean;
  finishReason: string | null;
} {
  const candidate = response.candidates?.[0];
  return {
    textLength: candidate?.content?.parts
      ? (candidate.content.parts
          .map((part) => part.text ?? '')
          .join('')
          .length ?? 0)
      : 0,
    partKinds: (candidate?.content?.parts ?? []).map((part) => {
      const keys = (Object.keys(part) as string[]).sort();
      const kind = 'text' in part ? 'text' : keys.join(',');
      return kind;
    }),
    hasUsage: response.usageMetadata !== undefined,
    usageKeys: Object.keys(response.usageMetadata ?? {}).sort(),
    finishReason: candidate?.finishReason ?? null,
  };
}

export const p03StreamingUsage: Probe = {
  id: 'P03',
  area: 'Streaming + usage',
  run: async (ctx): Promise<ProbeResult> => {
    const genai = await observe(ADAPTER_GENAI, async (): Promise<Record<string, unknown>> => {
      const client = createGenAI(ctx.apiKey);
      const stream = await client.models.generateContentStream({
        model: ctx.modelGeneral,
        contents: [{ role: 'user', parts: [{ text: PROMPT_TEXT }] }],
        config: { maxOutputTokens: 200 },
      });
      const chunks: ReturnType<typeof summarizeResponse>[] = [];
      let totalText = '';
      for await (const chunk of stream) {
        chunks.push(summarizeResponse(chunk));
        const t = chunk.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? '')
          .join('');
        totalText += t ?? '';
      }
      const chunksWithUsage = chunks
        .map((c, i) => i)
        .filter((i) => chunks[i].hasUsage);
      const finalFinish = chunks[chunks.length - 1]?.finishReason ?? null;
      return {
        totalChunks: chunks.length,
        chunkKinds: chunks.map((c) => c.partKinds),
        textIncrements:
          chunks.filter((c) => c.textLength > 0).length,
        textArrivedInMultipleIncrements:
          chunks.filter((c) => c.textLength > 0).length > 1,
        assembledTextLength: totalText.length,
        usageAppears: chunksWithUsage.length > 0 ? 'per-chunk' : 'none',
        chunkIndicesWithUsage: chunksWithUsage,
        finalFinishReason: finalFinish,
        firstUsageKeys: chunksWithUsage[0] !== undefined ? chunks[chunksWithUsage[0]].usageKeys : [],
      };
    });

    const aisdk = await observe(ADAPTER_AISDK, async (): Promise<Record<string, unknown>> => {
      const provider = createAISDK(ctx.apiKey);
      const result = await provider.languageModel(ctx.modelGeneral).doStream({
        prompt: PROMPT,
        maxOutputTokens: 200,
      });
      const parts = await drainStream(result.stream);
      const partTypes = parts.map((part) => part.type);
      const finish = parts.find((part) => part.type === 'finish');
      const textDeltas = parts.filter((part) => part.type === 'text-delta');
      const finishObj = finish === undefined ? null : (finish as { usage?: unknown; finishReason?: unknown });
      return {
        totalChunks: parts.length,
        partKindSequence: partTypes,
        textDeltaCount: textDeltas.length,
        textArrivedInMultipleIncrements:
          textDeltas.filter((p) => p.type === 'text-delta' && p.delta.length > 0).length > 1,
        assembledTextLength: textDeltas
          .map((p) => (p.type === 'text-delta' ? p.delta.length : 0))
          .reduce((a, b) => a + b, 0),
        usageLocation: 'finish-part',
        finishUsage:
          finishObj === null
            ? null
            : (finishObj as unknown as { usage?: unknown }).usage ?? null,
        finishReason: finishObj?.finishReason ?? null,
        requestBodySent: result.request?.body ?? null,
      };
    });

    const genaiUsage = (genai.observation as { usageAppears?: string })[
      'usageAppears'
    ];
    const aisdkFinishUsage =
      (aisdk.observation as { finishUsage?: unknown })['finishUsage'] != null;
    const genaiIncremental =
      (genai.observation as { textArrivedInMultipleIncrements?: unknown })
        .textArrivedInMultipleIncrements === true;
    const aisdkIncremental =
      (aisdk.observation as { textArrivedInMultipleIncrements?: unknown })
        .textArrivedInMultipleIncrements === true;

    const question =
      'Where does usage metadata land in a stream, and does text arrive ' +
      'incrementally on both adapters?';

    if (!genai.ok || !aisdk.ok) {
      return {
        id: 'P03',
        area: 'Streaming + usage',
        question,
        models: [ctx.modelGeneral],
        genai,
        aisdk,
        verdict: 'gap',
        finding: `One adapter stream did not complete (genai ok=${genai.ok}, ` +
          `ai-sdk ok=${aisdk.ok}); see the recorded error.`,
      };
    }

    // Usage placement is the whole point here: geminiResponseMapper stamps
    // usage onto every chunk it maps. If the two adapters place usage
    // differently, that is adapter work, not parity.
    const usagePlacementMatches = genaiUsage === 'finish-part';
    const bothIncremental = genaiIncremental && aisdkIncremental;

    return {
      id: 'P03',
      area: 'Streaming + usage',
      question,
      models: [ctx.modelGeneral],
      genai,
      aisdk,
      verdict:
        bothIncremental && aisdkFinishUsage && usagePlacementMatches
          ? 'parity'
          : 'partial',
      finding:
        `Text arrived in multiple increments: genai=${genaiIncremental}, ` +
        `ai-sdk=${aisdkIncremental}. Usage placement: genai=${String(genaiUsage)}, ` +
        `ai-sdk=finish-part (present=${aisdkFinishUsage}). ` +
        (usagePlacementMatches
          ? 'Both place usage the same way, so the per-chunk usage stamping in ' +
            'geminiResponseMapper carries over directly.'
          : 'The placements differ: geminiResponseMapper stamps usage onto every ' +
            'chunk it maps, so on the AI SDK path an adapter would have to hold ' +
            'the terminal usage and attach it to the IContent metadata itself.'),
    };
  },
};
