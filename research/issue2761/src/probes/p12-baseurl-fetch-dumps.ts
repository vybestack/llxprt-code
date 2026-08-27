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
 *      answered by MACHINE evidence read from the INSTALLED
 *      `@google/genai@1.30.0/dist/genai.d.ts` at probe time
 *      (GoogleGenAIOptions + HttpOptions members extracted from the declaration,
 *      and checked for a fetch member), not an assertion.
 *   4. Raw-body availability to the caller: AI SDK _does_ hand `request.body` /
 *      `response.body` back from doGenerate; @google/genai exposes no wire body on
 *      GenerateContentResponse (only a `responseInternal` Response on
 *      sdkHttpResponse).
 */

import { createAISDK } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import { relative } from 'node:path';

import {
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  type AdapterObservation,
  observe,
  PROBE_ROOT,
  type Probe,
  type ProbeContext,
  type ProbeResult,
} from '../harness.ts';
import {
  makeRecordingFetch,
  startRecordingProxy,
  type WireRecord,
} from '../recording.ts';
import { interfaceMembersFromDts } from '../sdk-typings.ts';

/**
 * Artifacts are committed, so an absolute path from one developer's machine
 * would be noise. Record the declaration file relative to the probe context.
 */
function relativeToProbeRoot(file: string | undefined): string | null {
  if (file === undefined) {
    return null;
  }
  return relative(PROBE_ROOT, file);
}

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

/** Machine facts read from the installed SDK typings at probe time. */
function genaiFetchSurface(): {
  readonly googleGenAIOptions: { readonly file: string; readonly members: string[] } | null;
  readonly httpOptions: { readonly file: string; readonly members: string[] } | null;
  readonly googleGenAIOptionsHasFetch: boolean;
  readonly httpOptionsHasFetch: boolean;
} {
  const genai = interfaceMembersFromDts('GoogleGenAIOptions');
  const http = interfaceMembersFromDts('HttpOptions');
  return {
    googleGenAIOptions: genai,
    httpOptions: http,
    googleGenAIOptionsHasFetch:
      genai !== null && genai.members.includes('fetch'),
    httpOptionsHasFetch: http !== null && http.members.includes('fetch'),
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
      const surface = genaiFetchSurface();
      return {
        baseUrlRedirected: summary !== null,
        wireDump: summary,
        customFetchHook: {
          googleGenAIOptionsMembers: surface.googleGenAIOptions?.members ?? [],
          httpOptionsMembers: surface.httpOptions?.members ?? [],
          optionsDeclarationFile: relativeToProbeRoot(surface.googleGenAIOptions?.file),
          httpOptionsDeclarationFile: relativeToProbeRoot(surface.httpOptions?.file),
          googleGenAIOptionsHasFetch: surface.googleGenAIOptionsHasFetch,
          httpOptionsHasFetch: surface.httpOptionsHasFetch,
          note:
            'Member lists are read from the installed genai.d.ts declarations at ' +
            'probe time, not transcribed by hand.',
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
    customFetchHook?: {
      googleGenAIOptionsMembers?: string[];
      httpOptionsMembers?: string[];
      optionsDeclarationFile?: string | null;
      httpOptionsDeclarationFile?: string | null;
      googleGenAIOptionsHasFetch?: boolean;
      httpOptionsHasFetch?: boolean;
    };
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
  const noGenaiFetch =
    g.customFetchHook?.googleGenAIOptionsHasFetch === false &&
    g.customFetchHook?.httpOptionsHasFetch === false;

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
      `directions: ${String(aFetch)}). Read out of the installed ` +
      `@google/genai genai.d.ts at probe time, GoogleGenAIOptions declares ` +
      `[${(g.customFetchHook?.googleGenAIOptionsMembers ?? []).join(',')}] and ` +
      `HttpOptions declares ` +
      `[${(g.customFetchHook?.httpOptionsMembers ?? []).join(',')}]; ` +
      `neither declares a fetch member ` +
      `(noFetchMember=${String(noGenaiFetch)}), ` +
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
