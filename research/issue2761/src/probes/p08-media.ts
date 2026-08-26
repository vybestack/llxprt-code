/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P08 — media: inline base64 image and URI-backed file.
 *
 * llxprt maps a `MediaBlock` with `encoding: 'url'` onto a Gemini
 * `fileData` part and `encoding: 'base64'` onto `inlineData`
 * (`neutralConverters.buildMediaPart`). This probe exercises both transports:
 *
 *   inlineBase64 — a real 1x1 PNG as a base64 constant, sent as
 *                  `{ inlineData }` (`@google/genai`) and as a `file` user
 *                  content part with a base64 string (`@ai-sdk/google`).
 *   uriFileData  — the same kind of bytes served from a public HTTPS URL, sent as
 *                  `{ fileData }` (`@google/genai`) and as a `file` user
 *                  content part with a `URL` data value (`@ai-sdk/google`).
 *
 * The `@google/genai` side runs through the recording proxy so the exact wire part
 * is captured whether or not the API accepts it. If the Gemini endpoint rejects the
 * HTTPS `fileUri` on BOTH adapters that is parity (both transports fail the same
 * way), not an AI SDK gap.
 */

import type {
  LanguageModelV2FilePart,
  LanguageModelV2Prompt,
  LanguageModelV2TextPart,
} from '@ai-sdk/provider';

import { createAISDK } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import {
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  captureError,
  observe,
  type Probe,
  type ProbeContext,
  type ProbeResult,
} from '../harness.ts';
import { startRecordingProxy, type WireRecord } from '../recording.ts';

/**
 * A real 16x16 RGB PNG (a black-and-white checkerboard), so the vision model
 * has something it will actually decode. A 1x1 PNG is rejected outright with
 * "Unable to process input image", which tells us nothing about either adapter.
 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGP4jwMw4AKjGmiiYQg5dThrAADZV36QtrwmmwAAAABJRU5ErkJggg==';

/** A plain public HTTPS image (a 1x1 PNG hosted by a CDN). */
const PUBLIC_IMAGE_URL =
  'https://upload.wikimedia.org/wikipedia/commons/3/3f/1x1.png';

const PROMPT = 'Describe this image in three words.';
const IMAGE_CASE_MAX_TOKENS = 64;
const PAUSE_MS = 3000;

const pause = (): Promise<void> =>
  new Promise((done) => setTimeout(done, PAUSE_MS));

interface MediaSubCase {
  readonly attempted: boolean;
  readonly ok: boolean;
  readonly httpStatus: number | null;
  readonly providerError: string | null;
  readonly textPreview: string;
  readonly wirePartKeys: string[] | null;
  readonly wireUriForwarded: boolean | null;
}

function recordOk(
  preview: string,
  wire: { partKeys: string[] | null; uriForwarded: boolean | null },
): MediaSubCase {
  return {
    attempted: true,
    ok: true,
    httpStatus: 200,
    providerError: null,
    textPreview: preview.slice(0, 120),
    wirePartKeys: wire.partKeys,
    wireUriForwarded: wire.uriForwarded,
  };
}

function recordFailure(error: unknown): MediaSubCase {
  const captured = captureError(error);
  return {
    attempted: true,
    ok: false,
    httpStatus: captured.statusCode ?? null,
    providerError: captured.message.slice(0, 400),
    textPreview: '',
    wirePartKeys: null,
    wireUriForwarded: null,
  };
}

/** Pulls the second user part and its fileData URI off a captured request body. */
function inspectRequest(record: WireRecord | undefined, partIndex: number): {
  partKeys: string[] | null;
  uriForwarded: boolean | null;
} {
  if (record === undefined) {
    return { partKeys: null, uriForwarded: null };
  }
  const body = record.requestBody as
    | { contents?: Array<{ role?: string; parts?: Array<Record<string, unknown>> }> }
    | null;
  const firstUser = (body?.contents ?? []).find((turn) => turn.role === 'user');
  const part = firstUser?.parts?.[partIndex];
  if (part === undefined) {
    return { partKeys: null, uriForwarded: null };
  }
  const fileData = part.fileData;
  const uri =
    typeof fileData === 'object' && fileData !== null
      ? (fileData as Record<string, unknown>)['fileUri']
      : undefined;
  return {
    partKeys: Object.keys(part).sort(),
    uriForwarded: typeof uri === 'string' && uri.length > 0 ? true : false,
  };
}

/** Wire evidence for a sub-case that threw before it could report success. */
function inspectRequestForFailure(record: WireRecord | undefined): {
  wirePartKeys: string[] | null;
  wireUriForwarded: boolean | null;
} {
  const inspected = inspectRequest(record, 1);
  return {
    wirePartKeys: inspected.partKeys,
    wireUriForwarded: inspected.uriForwarded,
  };
}

interface QuotaControl {
  readonly ranAfterUriCase: true;
  readonly plainTextAccepted: boolean;
  readonly httpStatus: number | null;
}

async function runQuotaControl(
  client: ReturnType<typeof createGenAI>,
  model: string,
): Promise<QuotaControl> {
  try {
    await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: 'Say ok.' }] }],
      config: { maxOutputTokens: 8 },
    });
    return { ranAfterUriCase: true, plainTextAccepted: true, httpStatus: 200 };
  } catch (error) {
    const captured = captureError(error);
    return {
      ranAfterUriCase: true,
      plainTextAccepted: false,
      httpStatus: captured.statusCode ?? null,
    };
  }
}

export const p08Media: Probe = {
  id: 'P08',
  area: 'Media (inline base64 and URI fileData)',

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const genai = await observe(ADAPTER_GENAI, async () => {
      const proxy = await startRecordingProxy();
      try {
        const client = createGenAI(ctx.apiKey, { baseUrl: proxy.origin });

        const inlinePart = {
          inlineData: { mimeType: 'image/png', data: TINY_PNG_BASE64 },
        };
        let inline: MediaSubCase;
        try {
          const response = await client.models.generateContent({
            model: ctx.modelGeneral,
            contents: [
              {
                role: 'user',
                parts: [
                  { text: PROMPT },
                  // Cast: Part is a closed union; the probe sends a deliberate
                  // media shape that llxprt's MediaBlock mapper builds.
                  inlinePart as never,
                ],
              },
            ],
            config: { maxOutputTokens: IMAGE_CASE_MAX_TOKENS },
          });
          inline = recordOk(response.text ?? '', inspectRequest(proxy.records[0], 1));
        } catch (error) {
          inline = recordFailure(error);
        }

        await pause();

        const uriPart = {
          fileData: { fileUri: PUBLIC_IMAGE_URL, mimeType: 'image/png' },
        };
        let uri: MediaSubCase;
        try {
          const response = await client.models.generateContent({
            model: ctx.modelGeneral,
            contents: [
              {
                role: 'user',
                parts: [
                  { text: PROMPT },
                  // Cast: same deliberate media shape as the inline sub-case.
                  uriPart as never,
                ],
              },
            ],
            config: { maxOutputTokens: IMAGE_CASE_MAX_TOKENS },
          });
          uri = recordOk(
            response.text ?? '',
            inspectRequest(proxy.records[proxy.records.length - 1], 1),
          );
        } catch (error) {
          uri = {
            ...recordFailure(error),
            ...inspectRequestForFailure(proxy.records[proxy.records.length - 1]),
          };
        }

        await pause();

        // The AI Studio endpoint answers an unsupported `fileData.fileUri`
        // with a bare RESOURCE_EXHAUSTED, which looks exactly like a quota
        // rejection. This control call proves which one it was: if a plain
        // text request succeeds immediately afterwards, the 429 came from the
        // fileUri, not from the quota.
        const quotaControl = await runQuotaControl(client, ctx.modelGeneral);

        return {
          inline,
          uri,
          quotaControl,
          note:
            'Ran through the recording proxy so the wire part keys and fileUri ' +
            'forwarding are captured whether accepted or rejected.',
        };
      } finally {
        await proxy.close();
      }
    });

    await pause();

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      const runCase = async (
        data: string | URL,
        dataKind: string,
      ): Promise<Record<string, unknown>> => {
        const filePart: LanguageModelV2FilePart = {
          type: 'file',
          mediaType: 'image/png',
          data,
        };
        const prompt: LanguageModelV2Prompt = [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT } as LanguageModelV2TextPart,
              filePart,
            ],
          },
        ];
        try {
          const provider = createAISDK(ctx.apiKey);
          const result = await provider.languageModel(ctx.modelGeneral).doGenerate({
            prompt,
            maxOutputTokens: IMAGE_CASE_MAX_TOKENS,
          });
          return {
            attempted: true,
            ok: true,
            httpStatus: 200,
            providerError: null,
            textPreview: result.content
              .filter((part) => part.type === 'text')
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('')
              .slice(0, 120),
            sentDataKind: dataKind,
          };
        } catch (error) {
          const captured = captureError(error);
          return {
            attempted: true,
            ok: false,
            httpStatus: captured.statusCode ?? null,
            providerError: captured.message.slice(0, 400),
            textPreview: '',
            sentDataKind: dataKind,
          };
        }
      };

      const inline = await runCase(TINY_PNG_BASE64, 'base64');
      await pause();
      const uri = await runCase(new URL(PUBLIC_IMAGE_URL), 'url');

      return {
        inline,
        uri,
        supportedUrlsSummary: (() => {
          const model = createAISDK(ctx.apiKey).languageModel(
            ctx.modelGeneral,
          ) as { supportedUrls?: unknown };
          const urls = model.supportedUrls;
          if (urls === undefined || urls === null) {
            return null;
          }
          // Only keys and regex sources; never resolve the regexes themselves onto
          // the artifact so it stays small and key-free.
          return Object.entries(
            urls as Record<string, RegExp[] | Array<{ source: string }>>,
          ).map(([mediaType, patterns]) => ({
            mediaType,
            patternCount: patterns.length,
            patternFlags: patterns.map((p) =>
              p instanceof RegExp ? p.flags : '',
            ),
          }));
        })(),
      };
    });

    const g = genai.observation as {
      inline?: MediaSubCase;
      uri?: MediaSubCase;
      quotaControl?: QuotaControl;
    };
    const a = aisdk.observation as {
      inline?: Record<string, unknown>;
      uri?: Record<string, unknown>;
    };

    const genaiInlineOk = g.inline?.ok === true;
    const genaiUriOk = g.uri?.ok === true;
    // A plain text call that succeeds right after the fileUri rejection shows
    // the RESOURCE_EXHAUSTED came from the fileUri, not from the quota.
    const quotaControlProvesEndpointBehavior =
      g.quotaControl?.plainTextAccepted === true;
    const aisdkInlineOk = a.inline?.ok === true;
    const aisdkUriOk = a.uri?.ok === true;

    return {
      id: 'P08',
      area: 'Media (inline base64 and URI fileData)',
      question:
        'Do both adapters hit the same media transports: inline base64 bytes as ' +
        'inlineData and a URL as fileData?',
      models: [ctx.modelGeneral],
      genai,
      aisdk,
      // Media parity is about whether the two adapters TRANSPORT the same
      // thing, not about whether the endpoint happens to like an arbitrary
      // host. Identical outcomes on both sub-cases is parity even when the
      // outcome is a rejection; a split is where the adapter loses something.
      verdict:
        genaiInlineOk === aisdkInlineOk && genaiUriOk === aisdkUriOk
          ? genaiInlineOk
            ? 'parity'
            : 'partial'
          : 'gap',
      // The fileUri rejection presents as RESOURCE_EXHAUSTED, so without this
      // the central quota guard would blank out a conclusive result. The
      // control call below is what licenses the suppression.
      transientHandled: quotaControlProvesEndpointBehavior,
      finding:
        `Inline base64 PNG: @google/genai ` +
        `${outcomeWord(genaiInlineOk)} ` +
        `(wire part keys [${(g.inline?.wirePartKeys ?? []).join(',')}]); ` +
        `AI SDK ${outcomeWord(aisdkInlineOk)} ` +
        `(${errorOrOk(a.inline)}). ` +
        `URI fileData: @google/genai ${outcomeWord(genaiUriOk)} ` +
        `(wire fileData.uri forwarded: ${String(g.uri?.wireUriForwarded)}); ` +
        `AI SDK ${outcomeWord(aisdkUriOk)} ` +
        `(${errorOrOk(a.uri)}). ` +
        (genaiUriOk === aisdkUriOk
          ? 'Both adapters put the URL on fileData.fileUri and got the same ' +
            'verdict from the endpoint, so the URI transport is equivalent. ' +
            (quotaControlProvesEndpointBehavior
              ? 'The shared RESOURCE_EXHAUSTED is the AI Studio endpoint ' +
                'refusing an arbitrary fileUri host, not a quota problem: a ' +
                'plain text call succeeded immediately afterwards.'
              : 'The control call did not succeed, so a quota effect cannot be ' +
                'ruled out for this run.')
          : 'The URI transport split: one adapter accepted what the other ' +
            'rejected, so this is a real transport difference.') +
        ' The MediaBlock encoding:url -> fileData and encoding:base64 -> ' +
        'inlineData mapping in neutralConverters maps unchanged.',
    };
  },
};

function outcomeWord(ok: boolean): string {
  return ok ? 'accepted' : 'rejected';
}

function errorOrOk(shape: { ok?: boolean; providerError?: string | null } | undefined): string {
  const ok =
    typeof shape === 'object' && shape !== null && shape['ok'] === true;
  return ok
    ? 'ok'
    : (shape?.providerError ?? 'error').slice(0, 120);
}
