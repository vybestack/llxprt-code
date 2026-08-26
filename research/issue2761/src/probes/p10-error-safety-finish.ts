/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P10 - errors, safety and finish reasons.
 *
 * llxprt maps a `@google/genai` `ApiError` to a neutral `ProviderApiError`
 * in `packages/providers/src/gemini/neutralConverters.ts`
 * (`geminiApiErrorToProviderApiError`: provider, message, status or code,
 * isQuotaError / isAuthError / isTransient, raw). The neutral `FinishInfo` in
 * `packages/core/src/llm-types/finishReasons.ts` keeps a `rawStopReason`
 * passthrough on top of the canonical finishReason, so a finish-reason raw value
 * the AI SDK hides is a real parity loss.
 *
 * Three sub-cases per adapter:
 *   1. Nonexistent model (`gemini-does-not-exist-2761`) - error class name,
 *      HTTP status, whether the provider JSON error body survives on the thrown
 *      object, and whether those fields can build the same neutral
 *      `ProviderApiError`.
 *   2. Truncation at maxOutputTokens: 4 - finish reason from each adapter, and
 *      whether the RAW provider finish-reason string is reachable through the AI SDK
 *      (providerMetadata.google and response.body).
 *   3. Safety surface - one call with safetySettings
 *      (HARM_CATEGORY_DANGEROUS_CONTENT at BLOCK_ONLY_HIGH), recording where
 *      candidate safetyRatings and promptFeedback land on each adapter. No attempt
 *      to force a real safety block.
 */

import type { LanguageModelV2Prompt } from '@ai-sdk/provider';
import {
  HarmBlockThreshold,
  HarmCategory,
  type Content,
} from '@google/genai';

import { createAISDK, summarizeContent } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import {
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  type AdapterObservation,
  captureError,
  observe,
  type Probe,
  type ProbeContext,
  type ProbeResult,
} from '../harness.ts';

const MISSING_MODEL = 'gemini-does-not-exist-2761';
const TRUNCATION_PROMPT =
  'Count from one to one thousand. Do not stop before one thousand.';
const TRUNCATION_MAX_TOKENS = 4;
const PAUSE_MS = 3000;

const pause = (): Promise<void> =>
  new Promise((done) => setTimeout(done, PAUSE_MS));

/** The exact shape llxprt's neutral error needs (ProviderApiError). */
interface NeutralErrorShape {
  readonly hasMessage: boolean;
  readonly hasStatus: boolean;
  readonly hasRetryabilitySignal: boolean;
  readonly hasRawBody: boolean;
  readonly bodyKeys: string[];
}

function errorShape(error: unknown): NeutralErrorShape {
  const raw = error as {
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
    responseBody?: unknown;
    data?: unknown;
    isRetryable?: unknown;
  };
  const status = raw.status ?? raw.statusCode;
  const body = raw.responseBody ?? raw.data;
  const bodyKeys =
    typeof body === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(body) as unknown;
            return typeof parsed === 'object' &&
              parsed !== null &&
              !Array.isArray(parsed)
              ? Object.keys(parsed as Record<string, unknown>)
              : [];
          } catch {
            return [];
          }
        })()
      : [];
  return {
    hasMessage: typeof raw.message === 'string',
    hasStatus: typeof status === 'number',
    hasRetryabilitySignal: raw.isRetryable === true || status === 429,
    hasRawBody: typeof raw.responseBody === 'string' || raw.data !== undefined,
    bodyKeys,
  };
}

const TRUNCATION_USER: Content = {
  role: 'user',
  parts: [{ text: TRUNCATION_PROMPT }],
};

const TRUNCATION_PROMPT_V2: LanguageModelV2Prompt = [
  { role: 'user', content: [{ type: 'text', text: TRUNCATION_PROMPT }] },
];

const HELLO_USER: Content = { role: 'user', parts: [{ text: 'Say hello.' }] };

const HELLO_PROMPT_V2: LanguageModelV2Prompt = [
  { role: 'user', content: [{ type: 'text', text: 'Say hello.' }] },
];

const SAFETY_SETTING = {
  category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
};

export const p10ErrorSafetyFinish: Probe = {
  id: 'P10',
  area: 'Errors, safety and finish reasons',

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const genai = await observe(ADAPTER_GENAI, async () => {
      const client = createGenAI(ctx.apiKey);
      const results: Record<string, unknown> = {};

      // 1. Nonexistent model. Inspected out-of-band so the raw thrown object is
      // captured before captureError normalizes it.
      try {
        await client.models.generateContent({
          model: MISSING_MODEL,
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
          config: { maxOutputTokens: 8 },
        });
        results.missingModel = { threw: false };
      } catch (error) {
        const captured = captureError(error);
        results.missingModel = {
          threw: true,
          errorName: captured.name,
          message: captured.message.slice(0, 220),
          statusCode: captured.statusCode ?? null,
          isApiErrorClass: captured.name === 'ApiError',
          neutralFields: errorShape(error),
        };
      }

      await pause();

      // 2. Truncation.
      const truncation = await client.models.generateContent({
        model: ctx.modelGeneral,
        contents: [TRUNCATION_USER],
        config: { maxOutputTokens: TRUNCATION_MAX_TOKENS },
      });
      const candidate = truncation.candidates?.[0];
      const textLength: number =
        candidate?.content?.parts?.reduce(
          (sum: number, part: { text?: string }) =>
            sum + (part?.text?.length ?? 0),
          0,
        ) ?? 0;
      results.truncation = {
        textLength,
        finishReasonRaw: candidate?.finishReason ?? null,
        httpStatus:
          truncation.sdkHttpResponse?.responseInternal !== undefined
            ? truncation.sdkHttpResponse.responseInternal.status
            : null,
      };

      await pause();

      // 3. Safety surface.
      const safety = await client.models.generateContent({
        model: ctx.modelGeneral,
        contents: [HELLO_USER],
        config: {
          maxOutputTokens: 8,
          safetySettings: [SAFETY_SETTING],
        },
      });
      const firstRating = safety.candidates?.[0]?.safetyRatings?.[0];
      results.safety = {
        candidateSafetyRatingsCount:
          safety.candidates?.[0]?.safetyRatings?.length ?? null,
        firstSafetyRatingKeys:
          firstRating === undefined ? [] : Object.keys(firstRating).sort(),
        promptFeedback: safety.promptFeedback ?? null,
        finishReason: safety.candidates?.[0]?.finishReason ?? null,
      };

      return results;
    });

    await pause();

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      const provider = createAISDK(ctx.apiKey);
      const model = provider.languageModel(ctx.modelGeneral);
      const results: Record<string, unknown> = {};

      // 1. Nonexistent model.
      try {
        await provider.languageModel(MISSING_MODEL).doGenerate({
          prompt: HELLO_PROMPT_V2,
          maxOutputTokens: 8,
        });
        results.missingModel = { threw: false };
      } catch (error) {
        const captured = captureError(error);
        results.missingModel = {
          threw: true,
          errorName: captured.name,
          message: captured.message.slice(0, 220),
          statusCode: captured.statusCode ?? null,
          neutralFields: errorShape(error),
        };
      }

      await pause();

      // 2. Truncation.
      const truncation = await model.doGenerate({
        prompt: TRUNCATION_PROMPT_V2,
        maxOutputTokens: TRUNCATION_MAX_TOKENS,
      });
      results.truncation = {
        finishReasonNormalized: truncation.finishReason,
        rawInResponseBody: (() => {
          const body = truncation.response?.body as
            | { candidates?: Array<{ finishReason?: unknown }> }
            | undefined;
          return body?.candidates?.[0]?.finishReason ?? null;
        })(),
        content: summarizeContent(truncation.content),
        responseBodyOpaque: truncation.response?.body !== undefined,
      };

      await pause();

      // 3. Safety surface via providerOptions.google.safetySettings.
      const safety = await model.doGenerate({
        prompt: HELLO_PROMPT_V2,
        maxOutputTokens: 8,
        providerOptions: {
          google: {
            safetySettings: [
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                threshold: 'BLOCK_ONLY_HIGH',
              },
            ],
          } as never,
        },
      });
      const googleMeta = (safety.providerMetadata?.google ?? {}) as Record<
        string,
        unknown
      >;
      const googleSafetyRatings = googleMeta['safetyRatings'];
      const googlePromptFeedback = googleMeta['promptFeedback'];
      const rawBodySafety = (() => {
        const body = safety.response?.body as
          | { candidates?: Array<{ safetyRatings?: unknown }> }
          | undefined;
        return body?.candidates?.[0]?.safetyRatings;
      })();
      results.safety = {
        safetyRatingsPresent: Array.isArray(googleSafetyRatings),
        safetyRatingsCount: Array.isArray(googleSafetyRatings)
          ? googleSafetyRatings.length
          : null,
        promptFeedbackPresent:
          typeof googlePromptFeedback === 'object' &&
          googlePromptFeedback !== null,
        googleMetadataKeys: Object.keys(googleMeta).sort(),
        rawBodySafetyRatingsPresent: Array.isArray(rawBodySafety),
        content: summarizeContent(safety.content),
      };

      return results;
    });

    return {
      id: 'P10',
      area: 'Errors, safety and finish reasons',
      question:
        'Do both adapters throw an identifyable unfurlable error, surface a raw ' +
        'finish reason after truncation, and expose the safety surface, so ' +
        'geminiApiErrorToProviderApiError and the rawStopReason passthrough still work?',
      models: [ctx.modelGeneral],
      genai,
      aisdk,
      ...judge(genai, aisdk),
    };
  },
};

interface MissingShape {
  readonly threw?: boolean;
  readonly errorName?: string;
  readonly statusCode?: number | null;
  readonly neutralFields?: NeutralErrorShape;
}

interface TruncationShape {
  readonly finishReasonRaw?: string;
  readonly textLength: number;
  readonly finishReasonNormalized?: string;
  readonly rawInResponseBody?: unknown;
}

interface SafetyShape {
  readonly candidateSafetyRatingsCount?: number | null;
  readonly safetyRatingsPresent?: boolean;
  readonly promptFeedbackPresent?: boolean;
}

function judge(
  genai: AdapterObservation,
  aisdk: AdapterObservation,
): Pick<ProbeResult, 'verdict' | 'finding'> {
  if (!genai.ok || !aisdk.ok) {
    return {
      verdict: 'gap',
      finding:
        'One adapter run did not complete (genai ok=' + genai.ok +
        ', ai-sdk ok=' + aisdk.ok +
        '); see the recorded error. No error/safety/finish conclusion drawn.',
    };
  }

  const gMissing = genai.observation.missingModel as MissingShape;
  const aMissing = aisdk.observation.missingModel as MissingShape;
  const gTrunc = genai.observation.truncation as TruncationShape;
  const aTrunc = aisdk.observation.truncation as TruncationShape;
  const gSafety = genai.observation.safety as SafetyShape;
  const aSafety = aisdk.observation.safety as SafetyShape;

  const gNeutral = gMissing.neutralFields;
  const aNeutral = aMissing.neutralFields;
  const bothThrew = gMissing.threw === true && aMissing.threw === true;
  const aisdkRawFinish =
    aTrunc.finishReasonNormalized !== undefined &&
    aTrunc.rawInResponseBody != null;
  const genaiRawFinish = gTrunc.finishReasonRaw != null;
  const aisdkSafety =
    aSafety.safetyRatingsPresent === true &&
    aSafety.promptFeedbackPresent === true;
  const genaiSafety = gSafety.candidateSafetyRatingsCount !== null;

  const parity =
    bothThrew && genaiRawFinish && aisdkRawFinish && genaiSafety && aisdkSafety;

  return {
    verdict: parity ? 'parity' : 'partial',
    finding:
      `Nonexistent model: @google/genai threw ` +
      `${gMissing.errorName ?? '?'} (HTTP ${gMissing.statusCode ?? 'unknown'}), ` +
      `neutral fields reachable: message=${String(gNeutral?.hasMessage)} ` +
      `status=${String(gNeutral?.hasStatus)} ` +
      `retryable=${String(gNeutral?.hasRetryabilitySignal)} ` +
      `rawBody=${String(gNeutral?.hasRawBody)}. ` +
      `The AI SDK threw ${aMissing.errorName ?? '?'} ` +
      `(HTTP ${aMissing.statusCode ?? 'unknown'}), neutral-relevant fields: ` +
      `message=${String(aNeutral?.hasMessage)} status=` +
      `${String(aNeutral?.hasStatus)} retryable=` +
      `${String(aNeutral?.hasRetryabilitySignal)} rawBody=` +
      `${String(aNeutral?.hasRawBody)} (error-body keys ` +
      `[${(aNeutral?.bodyKeys ?? []).join(',')}]), so ` +
      `geminiApiErrorToProviderApiError is buildable from it ` +
      `(status via statusCode, flags from statusCode/isRetryable, raw via responseBody). ` +
      `Truncation: genai finishReason=${gTrunc.finishReasonRaw ?? 'null'} at ` +
      `${gTrunc.textLength ?? 0} chars; AI SDK normalized ` +
      `${aTrunc.finishReasonNormalized ?? 'null'} and the RAW provider value is ` +
      `${aTrunc.rawInResponseBody != null ? 'reachable in response.body' : 'LOST'} ` +
      `(providerMetadata.google has no per-candidate finishReason field, so ` +
      `rawStopReason needs response.body). ` +
      `Safety: genai candidate safetyRatings=` +
      `${gSafety.candidateSafetyRatingsCount ?? 'null'}; AI SDK ` +
      `safetyRatingsPresent=${String(aSafety.safetyRatingsPresent)}, ` +
      `promptFeedbackPresent=${String(aSafety.promptFeedbackPresent)}.`,
  };
}
