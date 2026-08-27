/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P07 — thinking configuration (`thinkingConfig` on the wire).
 *
 * llxprt sets `thinkingConfig` by hand today:
 *
 *  - `geminiReasoningTranslation.applyGemini3Thinking` writes
 *    `{ includeThoughts: true, thinkingLevel }` for Gemini 3, and
 *  - `applyBudgetThinking` writes `{ includeThoughts: true, thinkingBudget }`
 *    for Gemini 2.
 *
 * The mapper then turns `thought === true` parts into a `ThinkingBlock`
 * (`geminiResponseMapper.extractThoughtInfo`) and reads
 * `usageMetadata.thoughtsTokenCount` for accounting (`geminiUsageToUsageStats`).
 *
 * Two sub-cases on the Gemini 3 model, through BOTH adapters:
 *   budget form — `{ thinkingBudget: 512, includeThoughts: true }`
 *   level form  — `{ thinkingLevel: 'low', includeThoughts: true }`
 *
 * The budget form also goes through the recording proxy for both adapters so the
 * evidence is the `generationConfig.thinkingConfig` object on the wire. On the
 * AI SDK that object is the providerOptions passthrough; on `@google/genai` it
 * is the direct config field.
 */

import type {
  LanguageModelV2Prompt,
  SharedV2ProviderOptions,
} from '@ai-sdk/provider';
import type { Content, Part } from '@google/genai';

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
import { startRecordingProxy, type WireRecord } from '../recording.ts';

const THINKING_PROMPT =
  'A bat and a ball cost 1.10 total; the bat costs 1.00 more than the ball. ' +
  'What does the ball cost? Think it through.';
const MAX_OUTPUT_TOKENS = 256;
const PAUSE_MS = 3000;

const pause = (): Promise<void> =>
  new Promise((done) => setTimeout(done, PAUSE_MS));

const BUDGET_FORM = {
  thinkingBudget: 512,
  includeThoughts: true,
} as const;

const LEVEL_FORM = {
  thinkingLevel: 'low',
  includeThoughts: true,
} as const;

/** Summarizes a `@google/genai` response's thought evidence. */
function summarizeGenaiThoughts(response: {
  candidates?: Array<{
    content?: { parts?: Part[] };
    finishReason?: string;
  }>;
  usageMetadata?: { thoughtsTokenCount?: number };
}): {
  thoughtPartCount: number;
  thoughtPartLength: number;
  thoughtTextPreview: string;
  partKinds: string[];
  finishReason: string | null;
  thoughtsTokenCount: number | null;
} {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const thoughtParts = parts.filter(
    (part) => part.thought === true && part.text !== undefined,
  );
  return {
    thoughtPartCount: thoughtParts.length,
    thoughtPartLength: thoughtParts.reduce(
      (sum, part) => sum + (part.text?.length ?? 0),
      0,
    ),
    thoughtTextPreview:
      thoughtParts.map((part) => part.text ?? '').join('').slice(0, 120) ??
      '',
    partKinds: parts.map((part) =>
      'text' in part ? 'text' : Object.keys(part).join(','),
    ),
    finishReason: response.candidates?.[0]?.finishReason ?? null,
    thoughtsTokenCount: response.usageMetadata?.thoughtsTokenCount ?? null,
  };
}

/** Pulls `generationConfig.thinkingConfig` out of a captured request body. */
function wireThinkingConfig(record: WireRecord | undefined): unknown {
  const body = record?.requestBody as
    | { generationConfig?: Record<string, unknown> }
    | undefined;
  return body?.generationConfig?.thinkingConfig ?? null;
}

function summarizeRecord(record: WireRecord | undefined): {
  httpStatus: number | null;
  providerError: string | null;
  thinkingConfigOnWire: unknown;
} {
  if (record === undefined) {
    return {
      httpStatus: null,
      providerError: null,
      thinkingConfigOnWire: null,
    };
  }
  return {
    httpStatus: record.status,
    providerError:
      record.status >= 400 ? record.responseBodyPreview.slice(0, 400) : null,
    thinkingConfigOnWire: wireThinkingConfig(record),
  };
}

/** One sub-case worth of `@google/genai` observations, always through the proxy. */
async function runGenaiCase(
  ctx: ProbeContext,
  thinkingConfig: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const proxy = await startRecordingProxy();
  try {
    const client = createGenAI(ctx.apiKey, { baseUrl: proxy.origin });
    const userTurn: Content = { role: 'user', parts: [{ text: THINKING_PROMPT }] };
    const response = await client.models.generateContent({
      model: ctx.modelGeneral,
      contents: [userTurn],
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // Cast: this probe deliberately sends a config llxprt's reasoning
        // translation would build, which is exactly what `GenerateContentConfig`
        // is typed to hold; the cast is the XML-safe one-line narrowing boundary.
        thinkingConfig: thinkingConfig as never,
      },
    });
    return {
      ...summarizeGenaiThoughts(response),
      wire: summarizeRecord(proxy.records[0]),
    };
  } finally {
    await proxy.close();
  }
}

/** One sub-case worth of AI SDK observations, always through the proxy. */
async function runAisdkCase(
  ctx: ProbeContext,
  thinkingConfig: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const proxy = await startRecordingProxy();
  try {
    const provider = createAISDK(ctx.apiKey, {
      baseURL: `${proxy.origin}/v1beta`,
    });
    const prompt: LanguageModelV2Prompt = [
      { role: 'user', content: [{ type: 'text', text: THINKING_PROMPT }] },
    ];
    const result = await provider.languageModel(ctx.modelGeneral).doGenerate({
      prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // The AI SDK nests the config one level deeper than the Gemini SDK
      // does: `providerOptions.google.thinkingConfig`, not
      // `providerOptions.google`. The cast is the boundary between the SDK's
      // union-literal option types and this probe's JSON-value bag.
      providerOptions: {
        google: { thinkingConfig } as SharedV2ProviderOptions['google'],
      },
    });
    const reasoning = result.content.filter((part) => part.type === 'reasoning');
    return {
      reasoningPartCount: reasoning.length,
      reasoningPartLength: reasoning.reduce(
        (sum, part) => sum + (part.type === 'reasoning' ? part.text.length : 0),
        0,
      ),
      reasoningTextPreview: reasoning
        .flatMap((part) => (part.type === 'reasoning' ? part.text.slice(0, 120) : []))
        .join(''),
      content: summarizeContent(result.content),
      finishReason: result.finishReason,
      usageReasoningTokens: result.usage.reasoningTokens ?? null,
      warnings: result.warnings,
      providerMetadataGoogle: result.providerMetadata?.google ?? null,
      rawResponseBodyFinishReason: (() => {
        const body = result.response?.body as
          | { candidates?: Array<{ finishReason?: unknown }> }
          | undefined;
        return body?.candidates?.[0]?.finishReason ?? null;
      })(),
      wire: summarizeRecord(proxy.records[0]),
    };
  } finally {
    await proxy.close();
  }
}

export const p07ThinkingConfig: Probe = {
  id: 'P07',
  area: 'Thinking configuration',

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    // Both forms through the proxy on both sides, so the level-form wire
    // evidence exists too: producing thinking output is NOT transport proof, because
    // Gemini 3 reasons by default.
    const genai = await observe(ADAPTER_GENAI, async () => {
      const budget = await runGenaiCase(ctx, BUDGET_FORM);
      await pause();
      const level = await runGenaiCase(ctx, LEVEL_FORM);
      return {
        budgetForm: budget,
        levelForm: level,
        note:
          'Both forms sent with no llxprt-side reasoning translation, both ' +
          'through the recording proxy, exposing what a plain thinkingConfig ' +
          'does across the adapter boundary.',
      };
    });

    await pause();

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      const budget = await runAisdkCase(ctx, BUDGET_FORM);
      await pause();
      const level = await runAisdkCase(ctx, LEVEL_FORM);
      return {
        budgetForm: budget,
        levelForm: level,
        note:
          'Reasoning parts arrive as `reasoning` content; reasoningTokens is the ' +
          'AI SDK mapping of usageMetadata.thoughtsTokenCount. Both forms ran ' +
          'through the recording proxy.',
      };
    });

    const g = genai.observation as {
      budgetForm?: Record<string, unknown>;
      levelForm?: Record<string, unknown>;
    };
    const a = aisdk.observation as {
      budgetForm?: Record<string, unknown>;
      levelForm?: Record<string, unknown>;
    };

    const gBudgetWire = nestedWire(g.budgetForm);
    const aBudgetWire = nestedWire(a.budgetForm);
    const gLevelWire = nestedWire(g.levelForm);
    const aLevelWire = nestedWire(a.levelForm);
    const budgetWireParity = gBudgetWire !== null && aBudgetWire !== null;
    const levelWireParity = gLevelWire !== null && aLevelWire !== null;

    const bothProducedThoughts =
      genai.ok &&
      aisdk.ok &&
      numberOf(g.budgetForm?.thoughtPartCount) > 0 &&
      numberOf(a.budgetForm?.reasoningPartCount) > 0 &&
      numberOf(g.levelForm?.thoughtPartCount) > 0 &&
      numberOf(a.levelForm?.reasoningPartCount) > 0;

    // Wire evidence for the relevant form decides the verdict: outputting thinking
    // content is not transport proof, because Gemini 3 reasons by default.
    const wireParity = budgetWireParity && levelWireParity;

    const question =
      'Do both adapters carry thinkingConfig to the Gemini wire and surface ' +
      'thought content plus thoughtsTokenCount for both the budget and level forms?';

    if (!genai.ok || !aisdk.ok) {
      return {
        id: 'P07',
        area: 'Thinking configuration',
        question,
        models: [ctx.modelGeneral],
        genai,
        aisdk,
        verdict: 'gap',
        finding:
          `One adapter run did not complete (genai ok=${genai.ok}, ` +
          `ai-sdk ok=${aisdk.ok}); see the recorded error. No thinking-config ` +
          `conclusion can be drawn from this run.`,
      };
    }

    return {
      id: 'P07',
      area: 'Thinking configuration',
      question,
      models: [ctx.modelGeneral],
      genai,
      aisdk,
      verdict: bothProducedThoughts && wireParity ? 'parity' : 'partial',
      finding:
        `Budget form: @google/genai surfaced ` +
        `${numberOf(g.budgetForm?.thoughtPartCount)} thought part(s) ` +
        `(${numberOf(g.budgetForm?.thoughtsTokenCount)} thoughtsTokenCount); the AI SDK ` +
        `surfaced ${numberOf(a.budgetForm?.reasoningPartCount)} reasoning part(s) ` +
        `(${numberOf(a.budgetForm?.usageReasoningTokens)} reasoningTokens). ` +
        `Level form: genai ${numberOf(g.levelForm?.thoughtPartCount)} thought part(s), ` +
        `AI SDK ${numberOf(a.levelForm?.reasoningPartCount)} reasoning part(s). ` +
        `On the wire, budget form: genai sent ` +
        `generationConfig.thinkingConfig=${jsonOfNested(gBudgetWire)} and the AI SDK ` +
        `sent ${jsonOfNested(aBudgetWire)}. ` +
        `Level form: genai sent generationConfig.thinkingConfig=` +
        `${jsonOfNested(gLevelWire)} and the AI SDK sent ` +
        `${jsonOfNested(aLevelWire)}. ` +
        (budgetWireParity
          ? 'Budget form reached generationConfig.thinkingConfig on both, so the ' +
            'budget translation still has a wire home. '
          : 'Budget-form wire capture did not show the config on both sides, so ' +
            'budget transport is unproven for this run. ') +
        (levelWireParity
          ? 'Level form reached generationConfig.thinkingConfig on both, so ' +
            'thinkingLevel transport is proven on the wire for both forms. '
          : 'Level-form wire capture did not show the config on both sides, so ' +
            'thinkingLevel transport is unproven for this run. ') +
        (bothProducedThoughts
          ? 'Both surfaced thinking content and a thinking-token count, so the ' +
            'ThinkingBlock geminiResponseMapper emits can still be built.'
          : 'At least one side returned no thinking content in this run, so the ' +
            'ThinkingBlock path is not fully demonstrated here.'),
    };
  },
};

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/**
 * The budget-form observation embeds `wire: { thinkingConfigOnWire }`; pull the
 * config out so the finding can quote it. Returns null when absent.
 */
function nestedWire(
  caseObs: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  const wire = caseObs?.wire;
  if (typeof wire !== 'object' || wire === null || Array.isArray(wire)) {
    return null;
  }
  const asRecord = wire as Record<string, unknown>;
  const config = asRecord['thinkingConfigOnWire'];
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return null;
  }
  return config as Record<string, unknown>;
}

function jsonOfNested(value: Record<string, unknown> | null): string {
  return value === null ? 'null' : JSON.stringify(value);
}
