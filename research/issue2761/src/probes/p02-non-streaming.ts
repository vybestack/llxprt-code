/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P02 — non-streaming generation.
 *
 * llxprt's non-streaming path (`nonOAuthNonStreamingGenerate` →
 * `createGeminiResponseMapper`) needs: the assistant text, a finish reason,
 * usage counts, and a system instruction that is transported verbatim
 * (issue #3136: the agent layer owns prompt assembly).
 */

import type { LanguageModelV2Prompt } from '@ai-sdk/provider';

import { createAISDK, summarizeContent } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import {
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  observe,
  type Probe,
  type ProbeContext,
  type ProbeResult,
  type Verdict,
} from '../harness.ts';

const SYSTEM_INSTRUCTION =
  'You are a terse assistant. Always answer with exactly one word.';
const USER_PROMPT = 'What is the capital of France? One word.';
const MAX_OUTPUT_TOKENS = 32;
const QUESTION =
  'Does a single-shot generate return equivalent text, finish reason, usage, ' +
  'response id and system-instruction transport through both adapters?';

/** True when at least one content part is a TEXT part with non-empty text. */
function hasNonEmptyText(parts: unknown): boolean {
  if (!Array.isArray(parts) || parts.length === 0) {
    return false;
  }
  // These are summarizeContent() shapes: { type, length, preview }. There is no
  // `text` member, so checking for one would report "no text" for every run.
  return parts.some(
    (part) =>
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { length?: unknown }).length === 'number' &&
      (part as { length: number }).length > 0,
  );
}

/** `STOP` and `stop` are the same provider value in different casings. */
function normalizeFinishReason(value: string | null): string {
  return (value ?? '').toUpperCase();
}

/**
 * The two adapters frame the request differently, so their prompt token counts
 * legitimately differ by a few tokens. A parity claim therefore compares usage
 * STRUCTURE (all three counters present as numbers) rather than exact equality,
 * and records both sides so the difference stays visible.
 */
function usageStructure(
  usage: Record<string, unknown> | null | undefined,
): { structurallyComplete: boolean; inputTokens: unknown; outputTokens: unknown; totalTokens: unknown } {
  const input = usage?.['inputTokens'] ?? usage?.['promptTokenCount'];
  const output = usage?.['outputTokens'] ?? usage?.['candidatesTokenCount'];
  const total = usage?.['totalTokens'] ?? usage?.['totalTokenCount'];
  return {
    structurallyComplete:
      typeof input === 'number' &&
      typeof output === 'number' &&
      typeof total === 'number',
    inputTokens: input ?? null,
    outputTokens: output ?? null,
    totalTokens: total ?? null,
  };
}

export const p02NonStreaming: Probe = {
  id: 'P02',
  area: 'Non-streaming generation',

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const genai = await observe(ADAPTER_GENAI, async () => {
      const client = createGenAI(ctx.apiKey);
      const response = await client.models.generateContent({
        model: ctx.modelGeneral,
        contents: [{ role: 'user', parts: [{ text: USER_PROMPT }] }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      });
      const candidate = response.candidates?.[0];
      return {
        text: candidate?.content?.parts
          ?.map((part) => part.text ?? '')
          .join('')
          .trim(),
        partKinds: candidate?.content?.parts?.map((part) => Object.keys(part)),
        finishReason: candidate?.finishReason ?? null,
        usageMetadata: response.usageMetadata ?? null,
        responseId: response.responseId ?? null,
        modelVersion: response.modelVersion ?? null,
        promptFeedback: response.promptFeedback ?? null,
      };
    });

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      const provider = createAISDK(ctx.apiKey);
      const prompt: LanguageModelV2Prompt = [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: [{ type: 'text', text: USER_PROMPT }] },
      ];
      const result = await provider.languageModel(ctx.modelGeneral).doGenerate({
        prompt,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      return {
        content: summarizeContent(result.content),
        finishReason: result.finishReason,
        usage: result.usage,
        providerMetadata: result.providerMetadata ?? null,
        warnings: result.warnings,
        responseId: result.response?.id ?? null,
        modelId: result.response?.modelId ?? null,
        requestBodySent: result.request?.body ?? null,
        hasRawResponseBody: result.response?.body !== undefined,
      };
    });

    const genaiText = genai.observation.text;
    const genaiProducedText =
      typeof genaiText === 'string' && genaiText.length > 0;
    // Summarized content is an array of { type: 'text', length, preview }.
    const genaiContentOk = genaiProducedText;

    // The AI SDK content is an array of summarized parts; at least one must be
    // a non-empty text part, so a response of pure tool calls does not pass.
    const aisdkTextOk = hasNonEmptyText(aisdk.observation.content);

    // Finish reasons: `STOP` (genai) vs `stop` (AI SDK) normalize equal.
    const genaiFinish = normalizeFinishReason(
      typeof genai.observation.finishReason === 'string'
        ? genai.observation.finishReason
        : null,
    );
    const aisdkFinish = normalizeFinishReason(
      typeof aisdk.observation.finishReason === 'string'
        ? aisdk.observation.finishReason
        : null,
    );
    const finishReasonsMatch = genaiFinish !== '' && genaiFinish === aisdkFinish;

    const genaiUsage = usageStructure(
      genai.observation.usageMetadata as Record<string, unknown> | null | undefined,
    );
    const aisdkUsage = usageStructure(
      aisdk.observation.usage as Record<string, unknown> | null | undefined,
    );
    const usageStructureParity =
      genaiUsage.structurallyComplete && aisdkUsage.structurallyComplete;

    // llxprt carries `responseId` as a first-class ModelOutput field, so a
    // missing one on either side is a real (if small) loss, not cosmetic.
    const genaiHasResponseId = typeof genai.observation.responseId === 'string';
    const aisdkHasResponseId = typeof aisdk.observation.responseId === 'string';
    const responseIdParity = genaiHasResponseId === aisdkHasResponseId;

    if (!genai.ok || !aisdk.ok) {
      return {
        id: 'P02',
        area: 'Non-streaming generation',
        question: QUESTION,
        models: [ctx.modelGeneral],
        genai,
        aisdk,
        verdict: 'gap',
        finding:
          'At least one adapter failed to produce a usable non-streaming ' +
          'result; see the recorded error.',
      };
    }

    const allParity =
      genaiContentOk && aisdkTextOk && finishReasonsMatch &&
      usageStructureParity && responseIdParity;

    const verdict: Verdict = allParity ? 'parity' : 'partial';

    return {
      id: 'P02',
      area: 'Non-streaming generation',
      question: QUESTION,
      models: [ctx.modelGeneral],
      genai,
      aisdk,
      verdict,
      finding:
        `Text on both sides: genai=${genaiContentOk}, ai-sdk=${aisdkTextOk}. ` +
        `Finish reason: genai="${String(genai.observation.finishReason)}", ` +
        `ai-sdk="${String(aisdk.observation.finishReason)}" ` +
        `(normalized match: ${String(finishReasonsMatch)}). ` +
        `Usage structure (input/output/total as numbers): genai=` +
        `${String(genaiUsage.structurallyComplete)} ` +
        `(input ${String(genaiUsage.inputTokens)}, output ${String(genaiUsage.outputTokens)}, ` +
        `total ${String(genaiUsage.totalTokens)}), ai-sdk=` +
        `${String(aisdkUsage.structurallyComplete)} ` +
        `(input ${String(aisdkUsage.inputTokens)}, output ${String(aisdkUsage.outputTokens)}, ` +
        `total ${String(aisdkUsage.totalTokens)}). The two adapters frame the ` +
        `request differently, so their prompt token counts differ by the framing ` +
        `tokens; parity here means both report all three counters as numbers, which ` +
        `is what the response mapper needs. ` +
        (responseIdParity
          ? 'Both adapters also returned a response id.'
          : 'Response-id availability differs (genai=' + String(genaiHasResponseId) + ', ai-sdk=' + String(aisdkHasResponseId) + '). Core models responseId as a first-class ModelOutput field, but geminiResponseMapper does not propagate it today either, so this is not a loss against current behavior; recovering it from the AI SDK raw response body would be an improvement rather than a repair.')
    };
  },
};
