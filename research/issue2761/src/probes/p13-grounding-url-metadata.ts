/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P13 - grounding and URL-context metadata.
 *
 * `packages/providers/src/gemini/geminiServerTools.ts` returns the RAW
 * `GenerateContentResponse` from `web_search` / `web_fetch` to llxprt callers
 * today. Anything the AI SDK reshapes is adapter work llxprt would absorb.
 *
 * Two sub-cases per adapter on `ctx.modelGeneral`:
 *   - Google Search grounding (genai config.tools=[{googleSearch:{}}]; AI SDK
 *     tools=[provider.tools.googleSearch({})]).
 *   - URL context (genai config.tools=[{urlContext:{}}]; AI SDK
 *     tools=[provider.tools.urlContext({})]) with one concrete public URL.
 *
 * Per adapter per sub-case: whether groundingMetadata / urlContextMetadata
 * reached the caller and WHERE (genai: on the candidate; AI SDK: under
 * providerMetadata.google), which sub-fields were populated (webSearchQueries,
 * groundingChunks count, groundingSupports count, urlMetadata entries with
 * urlRetrievalStatus), and for the AI SDK whether source content parts appeared too.
 */

import type {
  LanguageModelV2Prompt,
  LanguageModelV2ProviderDefinedTool,
} from '@ai-sdk/provider';
import type { Content } from '@google/genai';

import { createAISDK } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import {
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  type AdapterObservation,
  captureError,
  isTransientError,
  observe,
  type Probe,
  type ProbeContext,
  type ProbeResult,
} from '../harness.ts';

const SEARCH_PROMPT =
  'Who won the most recent F1 world championship? Cite sources.';
const URL_PROMPT =
  'Summarize https://en.wikipedia.org/wiki/Paris in two sentences, name the source.';
const MAX_OUTPUT_TOKENS = 512;
const PAUSE_MS = 3000;

const pause = (): Promise<void> =>
  new Promise((done) => setTimeout(done, PAUSE_MS));

/** Provider-defined tool shapes (provider.tools.googleSearch/urlContext). */
function providerTool(
  id: 'google.google_search' | 'google.url_context',
  name: 'google_search' | 'url_context',
): LanguageModelV2ProviderDefinedTool {
  return { type: 'provider-defined', id, name, args: {} };
}

interface GenaiGroundingSummary {
  readonly reachedCaller: boolean;
  readonly location: string;
  readonly webSearchQueries: string[];
  readonly groundingChunksCount: number;
  readonly groundingSupportsCount: number;
  readonly urlMetadataCount: number;
  readonly urlRetrievalStatuses: string[];
  readonly sourceParts: number;
  readonly finishReason: string | null;
}

type CandidateLike = {
  groundingMetadata?: {
    webSearchQueries?: string[];
    groundingChunks?: unknown[];
    groundingSupports?: unknown[];
  };
  urlContextMetadata?: {
    urlMetadata?: Array<{ urlRetrievalStatus?: string }>;
  };
  finishReason?: string;
};

function summarizeSearch(candidate: CandidateLike | undefined): GenaiGroundingSummary {
  const gm = candidate?.groundingMetadata;
  return {
    reachedCaller: gm !== undefined,
    location: gm !== undefined ? 'candidate.groundingMetadata' : 'none',
    webSearchQueries: gm?.webSearchQueries ?? [],
    groundingChunksCount:
      gm?.groundingChunks === undefined ? 0 : gm.groundingChunks.length,
    groundingSupportsCount:
      gm?.groundingSupports === undefined ? 0 : gm.groundingSupports.length,
    urlMetadataCount: 0,
    urlRetrievalStatuses: [],
    sourceParts: 0,
    finishReason: candidate?.finishReason ?? null,
  };
}

function summarizeUrlContext(
  candidate: CandidateLike | undefined,
): GenaiGroundingSummary {
  const um = candidate?.urlContextMetadata;
  return {
    reachedCaller: um !== undefined,
    location: um !== undefined ? 'candidate.urlContextMetadata' : 'none',
    webSearchQueries: [],
    groundingChunksCount: 0,
    groundingSupportsCount: 0,
    urlMetadataCount: (um?.urlMetadata ?? []).length,
    urlRetrievalStatuses:
      um?.urlMetadata === undefined
        ? []
        : um.urlMetadata.map((m) => m.urlRetrievalStatus ?? ''),
    sourceParts: 0,
    finishReason: candidate?.finishReason ?? null,
  };
}

interface AisdkSearchSummary {
  readonly reachedCaller: boolean;
  readonly location: string;
  readonly webSearchQueries: string[];
  readonly groundingChunksCount: number;
  readonly groundingSupportsCount: number;
  readonly sourcePartsEmitted: Array<{ sourceType: string }>;
  readonly finishReason: string;
}

interface AisdkUrlSummary {
  readonly reachedCaller: boolean;
  readonly location: string;
  readonly urlMetadataCount: number;
  readonly urlRetrievalStatuses: string[];
  readonly finishReason: string;
}

/**
 * One sub-case outcome. Google Search grounding has its own free-tier quota,
 * separate from generate-content, so it can fail while URL context succeeds.
 * Isolating the sub-cases keeps one quota rejection from erasing the evidence
 * the other sub-case did produce.
 */
interface SubCase<T> {
  readonly ok: boolean;
  readonly value: T | null;
  readonly error: ReturnType<typeof captureError> | null;
  readonly transient: boolean;
}

async function attempt<T>(body: () => Promise<T>): Promise<SubCase<T>> {
  try {
    return { ok: true, value: await body(), error: null, transient: false };
  } catch (error) {
    const captured = captureError(error);
    return {
      ok: false,
      value: null,
      error: captured,
      transient: isTransientError(captured),
    };
  }
}

export const p13GroundingUrlMetadata: Probe = {
  id: 'P13',
  area: 'Grounding and URL-context metadata',

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const genai = await observe(ADAPTER_GENAI, async () => {
      const client = createGenAI(ctx.apiKey);

      // URL context runs first. Google Search grounding has its own free-tier
      // quota that is simply absent on this key, and letting that call go
      // first burns the per-minute budget the URL-context call needs.
      const urlTurn: Content = { role: 'user', parts: [{ text: URL_PROMPT }] };
      const urlContext = await attempt(async () => {
        const response = await client.models.generateContent({
          model: ctx.modelGeneral,
          contents: [urlTurn],
          config: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            tools: [{ urlContext: {} }],
          },
        });
        return summarizeUrlContext(response.candidates?.[0]);
      });

      await pause();

      const searchTurn: Content = {
        role: 'user',
        parts: [{ text: SEARCH_PROMPT }],
      };
      const search = await attempt(async () => {
        const response = await client.models.generateContent({
          model: ctx.modelGeneral,
          contents: [searchTurn],
          config: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            tools: [{ googleSearch: {} }],
          },
        });
        return summarizeSearch(response.candidates?.[0]);
      });

      return { search, urlContext };
    });

    await pause();

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      const provider = createAISDK(ctx.apiKey);
      const model = provider.languageModel(ctx.modelGeneral);
      const searchPrompt: LanguageModelV2Prompt = [
        { role: 'user', content: [{ type: 'text', text: SEARCH_PROMPT }] },
      ];
      const urlPrompt: LanguageModelV2Prompt = [
        { role: 'user', content: [{ type: 'text', text: URL_PROMPT }] },
      ];

      const urlContext = await attempt(async () => {
        const result = await model.doGenerate({
          prompt: urlPrompt,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          tools: [providerTool('google.url_context', 'url_context')],
          toolChoice: { type: 'auto' },
        });
        const meta = (result.providerMetadata?.google ?? {}) as Record<
          string,
          unknown
        >;
        const um = meta['urlContextMetadata'];
        const rawUm =
          typeof um === 'object' && um !== null
            ? (um as Record<string, unknown>)
            : null;
        const entries = rawUm === null ? null : rawUm['urlMetadata'];
        const summary: AisdkUrlSummary = {
          reachedCaller: rawUm !== null,
          location:
            rawUm !== null
              ? 'providerMetadata.google.urlContextMetadata'
              : 'none',
          urlMetadataCount: Array.isArray(entries)
            ? (entries as unknown[]).length
            : 0,
          urlRetrievalStatuses: Array.isArray(entries)
            ? (entries as Array<{ urlRetrievalStatus?: string }>).map(
                (m) => m.urlRetrievalStatus ?? '',
              )
            : [],
          finishReason: result.finishReason,
        };
        return summary;
      });

      await pause();

      const search = await attempt(async () => {
        const result = await model.doGenerate({
          prompt: searchPrompt,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          tools: [providerTool('google.google_search', 'google_search')],
          toolChoice: { type: 'auto' },
        });
        const meta = (result.providerMetadata?.google ?? {}) as Record<
          string,
          unknown
        >;
        const gm = meta['groundingMetadata'];
        const rawGm =
          typeof gm === 'object' && gm !== null
            ? (gm as Record<string, unknown>)
            : null;
        const summary: AisdkSearchSummary = {
          reachedCaller: rawGm !== null,
          location:
            rawGm !== null
              ? 'providerMetadata.google.groundingMetadata'
              : 'none',
          webSearchQueries:
            rawGm === null
              ? []
              : ((rawGm['webSearchQueries'] as string[] | undefined) ?? []),
          groundingChunksCount:
            rawGm === null || !Array.isArray(rawGm['groundingChunks'])
              ? 0
              : (rawGm['groundingChunks'] as unknown[]).length,
          groundingSupportsCount:
            rawGm === null || !Array.isArray(rawGm['groundingSupports'])
              ? 0
              : (rawGm['groundingSupports'] as unknown[]).length,
          sourcePartsEmitted: (result.content ?? [])
            .filter((part) => part.type === 'source')
            .map((part) => ({
              sourceType: (part as { sourceType?: string }).sourceType ?? '',
            })),
          finishReason: result.finishReason,
        };
        return summary;
      });

      return { search, urlContext };
    });

    return {
      id: 'P13',
      area: 'Grounding and URL-context metadata',
      question:
        'Do both adapters surface groundingMetadata / urlContextMetadata from a ' +
        'server-tool call in a shape llxprt web_search / web_fetch callers can use?',
      models: [ctx.modelGeneral],
      genai,
      aisdk,
      ...judge(genai, aisdk),
    };
  },
};

function judge(
  genai: AdapterObservation,
  aisdk: AdapterObservation,
): Pick<ProbeResult, 'verdict' | 'finding' | 'transientHandled'> {
  if (!genai.ok || !aisdk.ok) {
    return {
      verdict: 'gap',
      finding:
        `One adapter run did not complete (genai ok=${genai.ok}, ai-sdk ok=` +
        `${aisdk.ok}); see the recorded error. No grounding conclusion drawn.`,
    };
  }

  const gSearch = genai.observation.search as SubCase<GenaiGroundingSummary>;
  const gUrl = genai.observation.urlContext as SubCase<GenaiGroundingSummary>;
  const aSearch = aisdk.observation.search as SubCase<AisdkSearchSummary>;
  const aUrl = aisdk.observation.urlContext as SubCase<AisdkUrlSummary>;

  const searchInconclusive = gSearch.transient || aSearch.transient;
  const urlInconclusive = gUrl.transient || aUrl.transient;

  const genaiSearchReached = gSearch.value?.reachedCaller === true;
  const aisdkSearchReached =
    aSearch.value?.reachedCaller === true ||
    (aSearch.value?.sourcePartsEmitted.length ?? 0) > 0;
  const genaiUrlReached = gUrl.value?.reachedCaller === true;
  const aisdkUrlReached = aUrl.value?.reachedCaller === true;

  const searchParity = !searchInconclusive && genaiSearchReached && aisdkSearchReached;
  const urlParity = !urlInconclusive && genaiUrlReached && aisdkUrlReached;

  // Both dimensions must be conclusive and equivalent before this can be
  // called parity. A quota rejection is not evidence either way.
  const verdict: ProbeResult['verdict'] =
    searchParity && urlParity
      ? 'parity'
      : searchInconclusive || urlInconclusive
        ? 'partial'
        : 'gap';

  const searchText = searchInconclusive
    ? `Google Search grounding was NOT exercised: the key has no Search-grounding ` +
      `quota (genai transient=${gSearch.transient}, ai-sdk transient=${aSearch.transient}), ` +
      `so this dimension is unproven.`
    : `Google Search: @google/genai surfaced candidate.groundingMetadata ` +
      `(${String(genaiSearchReached)}) with ` +
      `${gSearch.value?.webSearchQueries.length ?? 0} webSearchQueries, ` +
      `${gSearch.value?.groundingChunksCount ?? 0} groundingChunks, ` +
      `${gSearch.value?.groundingSupportsCount ?? 0} groundingSupports; the AI SDK ` +
      `surfaced ${aisdkSearchReached ? 'providerMetadata.google.groundingMetadata' : 'nothing'} ` +
      `with ${aSearch.value?.webSearchQueries.length ?? 0} webSearchQueries, ` +
      `${aSearch.value?.groundingChunksCount ?? 0} groundingChunks, ` +
      `${aSearch.value?.groundingSupportsCount ?? 0} groundingSupports and ` +
      `${aSearch.value?.sourcePartsEmitted.length ?? 0} source content part(s).`;

  const urlText = urlInconclusive
    ? `URL context was not exercised conclusively (genai transient=${gUrl.transient}, ` +
      `ai-sdk transient=${aUrl.transient}).`
    : `URL context: @google/genai surfaced candidate.urlContextMetadata ` +
      `(${String(genaiUrlReached)}) with ${gUrl.value?.urlMetadataCount ?? 0} entries ` +
      `(statuses: ${(gUrl.value?.urlRetrievalStatuses ?? []).join(',')}); the AI SDK ` +
      `surfaced providerMetadata.google.urlContextMetadata (${String(aisdkUrlReached)}) ` +
      `with ${aUrl.value?.urlMetadataCount ?? 0} entries ` +
      `(statuses: ${(aUrl.value?.urlRetrievalStatuses ?? []).join(',')}).`;

  return {
    verdict,
    transientHandled: true,
    finding:
      `${searchText} ${urlText} geminiServerTools returns the RAW ` +
      `GenerateContentResponse to web_search and web_fetch callers today. On the ` +
      `AI SDK path that raw response is not what the caller gets: grounding data ` +
      `is repackaged under providerMetadata.google and web chunks also become ` +
      `source content parts, so an adapter would have to rebuild the response ` +
      `shape those callers consume.`,
  };
}
