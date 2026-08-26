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
 * adapter actually sends, whether the custom header and User-Agent reach the
 * wire, and what a deliberately bad key produces on each side.
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
        return {
          method: record.method,
          url: record.url,
          status: record.status,
          authCarrier: record.authCarrier,
          requestHeaderNames: record.requestHeaderNames,
          customHeaderOnWire: record.requestHeaderNames.includes(CUSTOM_HEADER),
          userAgentOnWire: record.requestHeaderNames.includes('user-agent'),
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
        return {
          method: record.method,
          url: record.url,
          status: record.status,
          authCarrier: record.authCarrier,
          requestHeaderNames: record.requestHeaderNames,
          customHeaderOnWire: record.requestHeaderNames.includes(CUSTOM_HEADER),
          userAgentOnWire: record.requestHeaderNames.includes('user-agent'),
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
    const rejectedBadKey = (result: {
      error?: unknown;
      observation: Record<string, unknown>;
    }): boolean =>
      result.error !== undefined || result.observation.errorName != null;
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
          ? carriersMatch && headersPreserved
            ? 'parity'
            : 'partial'
          : 'gap',
      finding:
        `Auth carrier on the wire: genai used ${String(genai.observation.authCarrier)}, ` +
        `the AI SDK used ${String(aisdk.observation.authCarrier)}` +
        (carriersMatch ? ' (same form). ' : ' (different forms). ') +
        `Custom header reached the wire: genai=${genai.observation.customHeaderOnWire === true}, ` +
        `ai-sdk=${aisdk.observation.customHeaderOnWire === true}; ` +
        `llxprt User-Agent survived: genai=${genai.observation.userAgentOnWire === true}, ` +
        `ai-sdk=${aisdk.observation.userAgentOnWire === true}. ` +
        `A deliberately invalid key was rejected by genai=${genaiBadRejected} and ` +
        `ai-sdk=${aisdkBadRejected}. ` +
        (headersPreserved
          ? 'The header stamping and custom-header merge in ' +
            'GeminiProvider.createHttpOptions carries over unchanged.'
          : 'At least one adapter dropped a header llxprt stamps today in ' +
            'GeminiProvider.createHttpOptions, which an adapter would have to restore.'),
    };
  },
};
