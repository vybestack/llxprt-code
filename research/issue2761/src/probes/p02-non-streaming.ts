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
} from '../harness.ts';

const SYSTEM_INSTRUCTION =
  'You are a terse assistant. Always answer with exactly one word.';
const USER_PROMPT = 'What is the capital of France? One word.';
const MAX_OUTPUT_TOKENS = 32;
const QUESTION =
  'Does a single-shot generate return equivalent text, finish reason, usage, ' +
  'response id and system-instruction transport through both adapters?';

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

    const bothProducedText =
      typeof genai.observation.text === 'string' &&
      genai.observation.text.length > 0 &&
      Array.isArray(aisdk.observation.content) &&
      aisdk.observation.content.length > 0;

    // llxprt carries `responseId` as a first-class ModelOutput field, so a
    // missing one on either side is a real (if small) loss, not cosmetic.
    const genaiHasResponseId = typeof genai.observation.responseId === 'string';
    const aisdkHasResponseId = typeof aisdk.observation.responseId === 'string';
    const responseIdParity = genaiHasResponseId === aisdkHasResponseId;

    if (!genai.ok || !aisdk.ok || !bothProducedText) {
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

    return {
      id: 'P02',
      area: 'Non-streaming generation',
      question: QUESTION,
      models: [ctx.modelGeneral],
      genai,
      aisdk,
      verdict: responseIdParity ? 'parity' : 'partial',
      finding: responseIdParity
        ? 'Both adapters returned assistant text, a finish reason, usage and a ' +
          'response id for the same system instruction and prompt; the AI SDK ' +
          'additionally surfaces the exact request body it sent.'
        : `Text, finish reason and usage match, but response-id availability ` +
          `differs (genai=${genaiHasResponseId}, ai-sdk=${aisdkHasResponseId}). ` +
          `llxprt treats responseId as a first-class ModelOutput field, so an ` +
          `adapter would have to recover it from the raw response body.`,
    };
  },
};
