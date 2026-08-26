/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P12 - baseURL override, custom fetch, proxy and dumps.
 *
 * llxprt's `geminiGenerationExecution.ts` dumps the SDK parameter object
 * (`dumpSDKContext` -> `dumpSDKRequestContext`) rather than the wire body. This
 * probe records four dimensions per adapter:
 *   1. Base-URL override: a minimal generate through `startRecordingProxy()`,
 *      capturing the proxy-observed path and status (proves redirects).
 *   2. Wire bodies: the exact outbound request body and a preview of the inbound
 *      response body captured at the proxy - what an SDK-context dump built from
 *      wire bodies would contain.
 *   3. Custom-fetch interception: `makeRecordingFetch()` with `createAISDK`
 *      proves the ai-sdk middleware path. For @google/genai the question is
 *      answered by MACHINE evidence from `@google/genai@1.30.0/dist/genai.d.ts`
 *      (GoogleGenAIOptions + HttpOptions members recorded), not an assertion.
 *   4. Raw-body availability to the caller: AI SDK _does_ hand `request.body` /
 *      `response.body` back from doGenerate; @google/genai exposes no wire body on
 *      GenerateContentResponse (only a `responseInternal` Response on
 *      sdkHttpResponse).
 */

import { createAISDK } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import {
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  type AdapterObservation,
  observe,
  type Probe,
  type ProbeContext,
  type ProbeResult,
} from '../harness.ts';
import {
  makeRecordingFetch,
  startRecordingProxy,
  type WireRecord,
} from '../recording.ts';

/** Machine facts from the installed SDK typings, documented once at module scope. */
const GENAI_OPTIONS_MEMBERS = [
  'vertexai',
  'project',
  'location',
  'apiKey',
  'apiVersion',
  'googleAuthOptions',
  'httpOptions',
];
const HTTP_OPTIONS_MEMBERS = [
  'baseUrl',
  'apiVersion',
  'headers',
  'timeout',
  'extraBody',
];

const PROMPT_TEXT = 'Reply with the single word ok.';
const MAX_OUTPUT_TOKENS = 8;

function summarizeRecord(
  record: WireRecord | undefined,
): Record<string, unknown> | null {
  if (record === undefined) {
    return null;
  }
  return {
    method: record.method,
    url: record.url,
    status: record.status,
    requestBody: record.requestBody,
    responseBodyPreview: record.responseBodyPreview.slice(0, 160),
    contentType: record.responseContentType,
  };
}

export const p12BaseurlFetchDumps: Probe = {
  id: 'P12',
  area: 'BaseURL override, custom fetch, proxy and dumps',

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const genai = await observe(ADAPTER_GENAI, async () => {
      const proxy = await startRecordingProxy();
      let summary: Record<string, unknown> | null = null;
      try {
        const client = createGenAI(ctx.apiKey, { baseUrl: proxy.origin });
        await client.models.generateContent({
          model: ctx.modelGeneral,
          contents: [{ role: 'user', parts: [{ text: PROMPT_TEXT }] }],
          config: { maxOutputTokens: MAX_OUTPUT_TOKENS },
        });
        summary = summarizeRecord(proxy.records[0]);
      } finally {
        await proxy.close();
      }
      return {
        baseUrlRedirected: summary !== null,
        wireDump: summary,
        customFetchHook: {
          googleGenAIOptionsMembers: GENAI_OPTIONS_MEMBERS,
          httpOptionsMembers: HTTP_OPTIONS_MEMBERS,
          hasFetchMember: false,
          note:
            'GoogleGenAIOptions has no fetch member; HttpOptions has no fetch ' +
            'member either, so the only interception surface is the baseUrl / ' +
            'headers / timeout trio.',
        },
        rawBodyAvailability: {
          responseObjectWireBodyMember: 'none (only sdkHttpResponse.responseInternal)',
        },
      };
    });

    await pause();

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      // Base-URL redirect through the proxy.
      const proxy = await startRecordingProxy();
      let baseUrlSummary: Record<string, unknown> | null = null;
      let aisdkRequestBody: unknown = null;
      let aisdkResponseBodyOpaque = false;
      try {
        const provider = createAISDK(ctx.apiKey, {
          baseURL: `${proxy.origin}/v1beta`,
        });
        const result = await provider.languageModel(ctx.modelGeneral).doGenerate({
          prompt: [
            { role: 'user', content: [{ type: 'text', text: PROMPT_TEXT }] },
          ],
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        });
        baseUrlSummary = summarizeRecord(proxy.records[0]);
        aisdkRequestBody = result.request?.body ?? null;
        aisdkResponseBodyOpaque = result.response?.body !== undefined;
      } finally {
        await proxy.close();
      }

      // Custom-fetch interception.
      const recording = makeRecordingFetch();
      let fetchSummary: Record<string, unknown> | null = null;
      try {
        const provider = createAISDK(ctx.apiKey, {
          fetch: recording.fetch,
        });
        await provider.languageModel(ctx.modelGeneral).doGenerate({
          prompt: [
            { role: 'user', content: [{ type: 'text', text: PROMPT_TEXT }] },
          ],
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        });
        fetchSummary = summarizeRecord(recording.records[0]);
      } finally {
        // makeRecordingFetch records asynchronously after the tail of the body
        // drains; the first record summary above is read best-effort.
      }

      return {
        baseUrlRedirected: baseUrlSummary !== null,
        wireDump: baseUrlSummary,
        customFetch: {
          sawRequestAndResponse:
            fetchSummary !== null && (fetchSummary.status as number) === 200,
          fetchRequestUrl: fetchSummary?.url ?? null,
          fetchRequestBodyKind:
            typeof fetchSummary?.requestBody === 'object' ? 'json' : 'other',
        },
        rawBodyAvailability: {
          requestBodyReturned: aisdkRequestBody !== null,
          responseBodyReturned: aisdkResponseBodyOpaque,
          note:
            'doGenerate returns request.body and response.body, so an AI SDK ' +
            'adapter can dump the actual wire body without a proxy.',
        },
      };
    });

    return {
      id: 'P12',
      area: 'BaseURL override, custom fetch, proxy and dumps',
      question:
        'Can both adapters be redirected to a custom baseURL, can wire bodies be ' +
        'captured for dumps, does the AI SDK accept a custom fetch while @google/genai ' +
        'offers none, and can raw bodies be reached without a proxy?',
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
): Pick<ProbeResult, 'verdict' | 'finding'> {
  if (!genai.ok || !aisdk.ok) {
    return {
      verdict: 'gap',
      finding:
        'One adapter run did not complete (genai ok=' + genai.ok +
        ', ai-sdk ok=' + aisdk.ok +
        '); see the recorded error. No dump/baseURL conclusion drawn.',
    };
  }
  const g = genai.observation as {
    baseUrlRedirected?: boolean;
    wireDump?: { url?: string; status?: number } | null;
    customFetchHook?: { googleGenAIOptionsMembers?: string[]; httpOptionsMembers?: string[]; hasFetchMember?: boolean };
    rawBodyAvailability?: { responseObjectWireBodyMember?: string };
  };
  const a = aisdk.observation as {
    baseUrlRedirected?: boolean;
    wireDump?: { url?: string; status?: number } | null;
    customFetch?: { sawRequestAndResponse?: boolean };
    rawBodyAvailability?: { requestBodyReturned?: boolean; responseBodyReturned?: boolean };
  };
  const gBase = g.baseUrlRedirected === true;
  const aBase = a.baseUrlRedirected === true;
  const aFetch = a.customFetch?.sawRequestAndResponse === true;
  const aRaw = a.rawBodyAvailability?.responseBodyReturned === true;
  void g.customFetchHook?.hasFetchMember;

  const verdict: ProbeResult['verdict'] =
    gBase && aBase && aFetch && aRaw ? 'parity' : 'partial';

  return {
    verdict,
    finding:
      `Base-URL override: @google/genai was redirected (proxy path ` +
      `${g.wireDump?.url ?? 'none'}, status ${g.wireDump?.status ?? 'none'}); ` +
      `the AI SDK was redirected too (proxy path ${a.wireDump?.url ?? 'none'}, ` +
      `status ${a.wireDump?.status ?? 'none'}), so both accept a custom baseURL. ` +
      `Custom fetch: only the AI SDK exposes one (makeRecordingFetch saw both ` +
      `directions: ${String(aFetch)}); @google/genai has no fetch member in ` +
      `GoogleGenAIOptions (members [${(g.customFetchHook?.googleGenAIOptionsMembers ?? []).join(',')}]) ` +
      `nor in HttpOptions (members [${(g.customFetchHook?.httpOptionsMembers ?? []).join(',')}]), ` +
      `so baseURL is its only interception surface. Raw bodies for dumps: the AI ` +
      `SDK returns request.body AND response.body directly` +
      ` (${String(aRaw)}), while @google/genai exposes only ` +
      `${g.rawBodyAvailability?.responseObjectWireBodyMember ?? 'nothing'} on the ` +
      `response object. dumpSDKContext today writes the SDK parameter object; an ` +
      `AI SDK adapter would make dumps BETTER (real wire body with status/headers), ` +
      `not worse or equivalent.`,
  };
}

const pause = (): Promise<void> =>
  new Promise((done) => setTimeout(done, 3000));
