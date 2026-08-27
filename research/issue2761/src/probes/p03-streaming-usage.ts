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
      // A stream that reports usage only on its terminal chunk is NOT per-chunk
      // placement. Classify by construction: usage on the terminal chunk only is
      // `finish-part`, on non-terminal chunks too is `per-chunk`, on both is
      // `mixed`.
      const terminalIndex = chunks.length - 1;
      const usageOnNonTerminal =
        chunksWithUsage.length > 0 &&
        chunksWithUsage.some((index) => index !== terminalIndex);
      const usageOnTerminal = chunksWithUsage.includes(terminalIndex);
      const usageLocation =
        usageOnNonTerminal && usageOnTerminal
          ? 'mixed'
          : usageOnNonTerminal
            ? 'per-chunk'
            : usageOnTerminal
              ? 'finish-part'
              : 'none';
      return {
        totalChunks: chunks.length,
        chunkKinds: chunks.map((c) => c.partKinds),
        textIncrements:
          chunks.filter((c) => c.textLength > 0).length,
        textArrivedInMultipleIncrements:
          chunks.filter((c) => c.textLength > 0).length > 1,
        assembledTextLength: totalText.length,
        usageLocation,
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
      const nonTerminalParts = parts.slice(0, parts.length - 1);
      const terminalPart = parts[parts.length - 1];
      // Classify by construction, mirroring the genai side: usage on the
      // terminal part only is `finish-part`, on non-terminal parts too is
      // `per-chunk`, on both is `mixed`. These count usage-carrying stream
      // parts wherever they occur, not the first non-finish part, which is what
      // mislabeled a finish-part-only stream as per-chunk.
      const usageOnNonTerminal = nonTerminalParts.some((part) => 'usage' in part);
      const usageOnTerminal =
        terminalPart !== undefined && 'usage' in terminalPart;
      const derivedUsageLocation =
        usageOnNonTerminal && usageOnTerminal
          ? 'mixed'
          : usageOnNonTerminal
            ? 'per-chunk'
            : usageOnTerminal
              ? 'finish-part'
              : 'none';
      return {
        totalChunks: parts.length,
        partKindSequence: partTypes,
        textDeltaCount: textDeltas.length,
        textArrivedInMultipleIncrements:
          textDeltas.filter((p) => p.type === 'text-delta' && p.delta.length > 0).length > 1,
        assembledTextLength: textDeltas
          .map((p) => (p.type === 'text-delta' ? p.delta.length : 0))
          .reduce((a, b) => a + b, 0),
        usageLocation: derivedUsageLocation,
        finishUsage:
          finishObj === null
            ? null
            : (finishObj as unknown as { usage?: unknown }).usage ?? null,
        finishReason: finishObj?.finishReason ?? null,
        requestBodySent: result.request?.body ?? null,
      };
    });

    const genaiUsage = (genai.observation as { usageLocation?: string })[
      'usageLocation'
    ] ?? 'none';
    const aisdkUsage = (aisdk.observation as { usageLocation?: string })[
      'usageLocation'
    ] ?? 'none';
    const aisdkFinishUsage =
      (aisdk.observation as { finishUsage?: unknown })['finishUsage'] != null;
    // Usage placement is judged on the classified location (`finish-part`,
    // `per-chunk`, `mixed`, `none`), where a stream carrying usage only on
    // its terminal chunk is `finish-part`, not `per-chunk`.
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
    // usage onto every chunk it maps. Each side is classified as `finish-part`,
    // `per-chunk`, `mixed` or `none` by construction; parity means the two
    // adapters place usage the same way, and differing placements can never report
    // parity.
    const usagePlacementMatches = genaiUsage === aisdkUsage;
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
        `ai-sdk=${String(aisdkUsage)} (finish usage present=${aisdkFinishUsage}). ` +
        (usagePlacementMatches
          ? 'Both place usage the same way, so the per-response usage stamping ' +
            'in geminiResponseMapper carries over directly.'
          : 'The placements differ: geminiResponseMapper copies usage onto the ' +
            'text, tool-call and fallback chunks it emits for each mapped ' +
            'response, so on the AI SDK path an adapter would have to hold the ' +
            'terminal usage and attach it to the IContent metadata itself.'),
    };
  },
};
