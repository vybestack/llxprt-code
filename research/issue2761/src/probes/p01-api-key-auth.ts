/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P01 — API-key auth.
 *
 * llxprt's `GeminiProvider.createHttpOptions()` stamps a `User-Agent` and
 * merges user custom headers into `httpOptions.headers`. This probe records the
 * carrier form (`x-goog-api-key` header vs `?key=` query param) each
 * adapter actually sends, and now compares header VALUES, not just names: whether
 * the `User-Agent` actually carries the llxprt prefix that
 * `GeminiProvider.createHttpOptions` stamps, and whether the custom header value
 * matches what was sent. Header values are recorded through the proxy's
 * `requestHeaders` and scrubbed by the harness redactor (which removes the API
 * key from them). A deliberately bad key is also recorded on both sides.
 */

import type { LanguageModelV2Prompt } from '@ai-sdk/provider';

import { createAISDK, summarizeContent } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import {
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  observe,
  type Probe,
  type ProbeResult,
} from '../harness.ts';
import { startRecordingProxy } from '../recording.ts';

const CUSTOM_HEADER = 'x-llxprt-probe';

const PROMPT_TEXT = 'Reply with the single word ok.';

const PROMPT: LanguageModelV2Prompt = [
  { role: 'user', content: [{ type: 'text', text: PROMPT_TEXT }] },
];

/** The prefix `GeminiProvider.createHttpOptions` stamps via llxprtUserAgent(). */
const LLXPRT_UA_PREFIX = 'LLxprt-Code';

function headerValue(record: { requestHeaders?: Record<string, string> }, name: string): string | null {
  const headers = record.requestHeaders;
  if (headers === undefined) {
    return null;
  }
  const value = headers[name] ?? headers[name.toLowerCase()];
  return value ?? null;
}

export const p01ApiKeyAuth: Probe = {
  id: 'P01',
  area: 'API-key auth',
  run: async (ctx): Promise<ProbeResult> => {
    const genai = await observe(ADAPTER_GENAI, async () => {
      const proxy = await startRecordingProxy();
      try {
        const client = createGenAI(ctx.apiKey, {
          baseUrl: proxy.origin,
          headers: { [CUSTOM_HEADER]: 'p01' },
        });
        const response = await client.models.generateContent({
          model: ctx.modelGeneral,
          contents: [{ role: 'user', parts: [{ text: PROMPT_TEXT }] }],
          config: { maxOutputTokens: 8 },
        });
        const record = proxy.records[0];
        if (record === undefined) {
          throw new Error('no proxy record captured');
        }
        const ua = headerValue(record, 'user-agent');
        const custom = headerValue(record, CUSTOM_HEADER);
        return {
          method: record.method,
          url: record.url,
          status: record.status,
          authCarrier: record.authCarrier,
          requestHeaderNames: record.requestHeaderNames,
          requestHeaders: record.requestHeaders,
          customHeaderOnWire: record.requestHeaderNames.includes(CUSTOM_HEADER),
          userAgentOnWire: record.requestHeaderNames.includes('user-agent'),
          userAgentCarriesLlxprtPrefix:
            ua !== null && ua.startsWith(LLXPRT_UA_PREFIX),
          userAgentValue: ua,
          customHeaderValueMatches: custom === 'p01',
          customHeaderValue: custom,
          responseText: (response.text ?? '').slice(0, 80),
        };
      } finally {
        await proxy.close();
      }
    });

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      const proxy = await startRecordingProxy();
      try {
        const provider = createAISDK(ctx.apiKey, {
          baseURL: `${proxy.origin}/v1beta`,
          headers: { [CUSTOM_HEADER]: 'p01' },
        });
        const result = await provider
          .languageModel(ctx.modelGeneral)
          .doGenerate({ prompt: PROMPT, maxOutputTokens: 8 });
        const record = proxy.records[0];
        if (record === undefined) {
          throw new Error('no proxy record captured');
        }
        const ua = headerValue(record, 'user-agent');
        const custom = headerValue(record, CUSTOM_HEADER);
        return {
          method: record.method,
          url: record.url,
          status: record.status,
          authCarrier: record.authCarrier,
          requestHeaderNames: record.requestHeaderNames,
          requestHeaders: record.requestHeaders,
          customHeaderOnWire: record.requestHeaderNames.includes(CUSTOM_HEADER),
          userAgentOnWire: record.requestHeaderNames.includes('user-agent'),
          userAgentCarriesLlxprtPrefix:
            ua !== null && ua.startsWith(LLXPRT_UA_PREFIX),
          userAgentValue: ua,
          customHeaderValueMatches: custom === 'p01',
          customHeaderValue: custom,
          content: summarizeContent(result.content),
          requestBodySent: result.request?.body ?? null,
        };
      } finally {
        await proxy.close();
      }
    });

    const genaiBadKey = await observe(ADAPTER_GENAI, async () => {
      const client = createGenAI('not-a-real-key');
      try {
        const response = await client.models.generateContent({
          model: ctx.modelGeneral,
          contents: [{ role: 'user', parts: [{ text: PROMPT_TEXT }] }],
          config: { maxOutputTokens: 8 },
        });
        return { called: true, text: (response.text ?? '').slice(0, 80) };
      } catch (error) {
        const candidate = error as { name?: unknown; message?: unknown; status?: unknown };
        return {
          errorName: candidate.name ?? null,
          message: candidate.message ?? String(error),
          status: candidate.status ?? null,
        };
      }
    });

    const aisdkBadKey = await observe(ADAPTER_AISDK, async () => {
      const provider = createAISDK('not-a-real-key');
      try {
        const result = await provider
          .languageModel(ctx.modelGeneral)
          .doGenerate({ prompt: PROMPT, maxOutputTokens: 8 });
        return { called: true, content: summarizeContent(result.content) };
      } catch (error) {
        const candidate = error as {
          name?: unknown;
          message?: unknown;
          statusCode?: unknown;
          responseBody?: unknown;
          data?: unknown;
        };
        return {
          errorName: candidate.name ?? null,
          message: candidate.message ?? String(error),
          statusCode:
            typeof candidate.statusCode === 'number'
              ? candidate.statusCode
              : candidate.statusCode ?? null,
          hasData: candidate.data !== undefined,
          hasResponseBody: candidate.responseBody !== undefined,
        };
      }
    });

    const genaiOk = genai.ok;
    const aisdkOk = aisdk.ok;
    // The bad-key sub-cases catch their own failure and fold it into the
    // observation, so rejection is proven by an `errorName` being present
    // (and `called` being absent), not by a top-level thrown error.
    // A DNS failure, a 429 or a 5xx is not evidence that the key was checked.
    // Only an auth-shaped status, or a provider payload that names an API-key
    // problem, counts as a rejection; a transient status is inconclusive.
    const AUTH_STATUSES = new Set([400, 401, 403]);
    const badKeyOutcome = (result: {
      observation: Record<string, unknown>;
    }): 'rejected' | 'accepted' | 'inconclusive' => {
      const observation = result.observation;
      if (observation.called === true) {
        return 'accepted';
      }
      const status =
        typeof observation.status === 'number'
          ? observation.status
          : typeof observation.statusCode === 'number'
            ? observation.statusCode
            : null;
      if (status !== null && AUTH_STATUSES.has(status)) {
        return 'rejected';
      }
      const message =
        typeof observation.message === 'string' ? observation.message : '';
      if (/API_KEY_INVALID|API key not valid/i.test(message)) {
        return 'rejected';
      }
      return 'inconclusive';
    };
    const rejectedBadKey = (result: {
      observation: Record<string, unknown>;
    }): boolean => badKeyOutcome(result) === 'rejected';
    const genaiBadRejected = rejectedBadKey(genaiBadKey);
    const aisdkBadRejected = rejectedBadKey(aisdkBadKey);

    const genaiResult = {
      adapter: ADAPTER_GENAI,
      ok: genaiOk,
      observation: {
        ...genai.observation,
        badKey: genaiBadKey.error ?? genaiBadKey.observation,
      },
      ...(genai.error !== undefined ? { error: genai.error } : {}),
    };
    const aisdkResult = {
      adapter: ADAPTER_AISDK,
      ok: aisdkOk,
      observation: {
        ...aisdk.observation,
        badKey: aisdkBadKey.error ?? aisdkBadKey.observation,
      },
      ...(aisdk.error !== undefined ? { error: aisdk.error } : {}),
    };

    const carriersMatch =
      genai.observation.authCarrier === aisdk.observation.authCarrier;
    const headersPreserved =
      genai.observation.customHeaderOnWire === true &&
      genai.observation.userAgentOnWire === true &&
      aisdk.observation.customHeaderOnWire === true &&
      aisdk.observation.userAgentOnWire === true;
    const valuesPreserved =
      genai.observation.userAgentCarriesLlxprtPrefix === true &&
      genai.observation.customHeaderValueMatches === true &&
      aisdk.observation.userAgentCarriesLlxprtPrefix === true &&
      aisdk.observation.customHeaderValueMatches === true;

    return {
      id: 'P01',
      area: 'API-key auth',
      question:
        'Does each adapter carry the API key, the llxprt User-Agent and user ' +
        'custom headers onto the wire the same way, and reject a bad key comparably?',
      models: [ctx.modelGeneral],
      genai: genaiResult,
      aisdk: aisdkResult,
      verdict:
        genaiOk && aisdkOk && genaiBadRejected && aisdkBadRejected
          ? carriersMatch && headersPreserved && valuesPreserved
            ? 'parity'
            : 'partial'
          : 'gap',
      finding:
        `Auth carrier on the wire: genai used ${String(genai.observation.authCarrier)}, ` +
        `the AI SDK used ${String(aisdk.observation.authCarrier)}` +
        (carriersMatch ? ' (same form). ' : ' (different forms). ') +
        `Custom header reached the wire: genai=${genai.observation.customHeaderOnWire === true}, ` +
        `ai-sdk=${aisdk.observation.customHeaderOnWire === true}; ` +
        `its VALUE matched what was sent (expected "p01"): ` +
        `genai=${genai.observation.customHeaderValueMatches === true}, ` +
        `ai-sdk=${aisdk.observation.customHeaderValueMatches === true}. ` +
        `llxprt User-Agent survived: genai=${genai.observation.userAgentOnWire === true}, ` +
        `ai-sdk=${aisdk.observation.userAgentOnWire === true}; ` +
        `the value carries the ${LLXPRT_UA_PREFIX} prefix: ` +
        `genai=${genai.observation.userAgentCarriesLlxprtPrefix === true}, ` +
        `ai-sdk=${aisdk.observation.userAgentCarriesLlxprtPrefix === true} ` +
        `(sent UA: genai "${String(genai.observation.userAgentValue)}", ai-sdk ` +
        `"${String(aisdk.observation.userAgentValue)}"). ` +
        `A deliberately invalid key produced genai=${badKeyOutcome(genaiBadKey)} and ` +
        `ai-sdk=${badKeyOutcome(aisdkBadKey)} (rejection requires an auth-shaped ` +
        `status or an API_KEY_INVALID payload; a transient status is inconclusive). ` +
        (headersPreserved && valuesPreserved
          ? 'The header stamping and custom-header merge in ' +
            'GeminiProvider.createHttpOptions carries over unchanged, values included.'
          : 'At least one adapter dropped or rewrote a header llxprt stamps today ' +
            'in GeminiProvider.createHttpOptions, which an adapter would have to restore.'),
    };
  },
};
