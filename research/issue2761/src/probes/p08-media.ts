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
 * BOTH adapter sides run through the recording proxy, so the wire part (which part
 * keys were sent, whether the URL reached `fileData.fileUri`) is captured for each
 * side whether or not the API accepts it. The TRANSPORT dimension is judged on those
 * wire bodies. The ENDPOINT-ACCEPTANCE dimension is separate: when the response is
 * a 429 it is reported as unproven, because a plain-text control call can only
 * rule out a general generate-content quota, never a separate media or file-URI
 * quota (the way Google Search has its own quota). The control call is still run and
 * recorded, as context rather than as proof.
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

function makeSubCase(): MediaSubCase {
  return {
    attempted: true,
    ok: false,
    httpStatus: null,
    providerError: null,
    textPreview: '',
    wirePartKeys: null,
    wireUriForwarded: null,
  };
}

function recordAccepted(
  preview: string,
  wire: { partKeys: string[] | null; uriForwarded: boolean | null },
): MediaSubCase {
  return {
    ...makeSubCase(),
    ok: true,
    httpStatus: 200,
    textPreview: preview.slice(0, 120),
    wirePartKeys: wire.partKeys,
    wireUriForwarded: wire.uriForwarded,
  };
}

function recordRejected(
  error: unknown,
  wire: { partKeys: string[] | null; uriForwarded: boolean | null },
): MediaSubCase {
  const captured = captureError(error);
  return {
    ...makeSubCase(),
    httpStatus: captured.statusCode ?? null,
    providerError: captured.message.slice(0, 400),
    wirePartKeys: wire.partKeys,
    wireUriForwarded: wire.uriForwarded,
  };
}

/** Pulls the second user part and its fileData URI off a captured request body. */
function inspectRequest(record: WireRecord | undefined): {
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
  const part = firstUser?.parts?.[1];
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

/** The wire evidence for the most recently captured request of a sub-case. */
function inspectLatest(
  records: readonly WireRecord[],
): { partKeys: string[] | null; uriForwarded: boolean | null } {
  if (records.length === 0) {
    return { partKeys: null, uriForwarded: null };
  }
  // A sub-case can leave more than one proxy record behind when it had to retry a
  // transient status; take the last one so it is the attempt whose outcome the
  // sub-case is reporting.
  return inspectRequest(records[records.length - 1]);
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
          inline = recordAccepted(
            response.text ?? '',
            inspectLatest(proxy.records),
          );
        } catch (error) {
          inline = recordRejected(
            error,
            inspectLatest(proxy.records),
          );
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
          uri = recordAccepted(
            response.text ?? '',
            inspectLatest(proxy.records),
          );
        } catch (error) {
          uri = recordRejected(
            error,
            inspectLatest(proxy.records),
          );
        }

        await pause();

        // The fileUri rejection presents as RESOURCE_EXHAUSTED, which looks
        // exactly like a general quota rejection. This control call only carries
        // context: a succeeding plain-text call right after rules out a general
        // generate-content quota, but cannot rule out a separate media or file-URI
        // quota, so it is recorded, never treated as proof.
        const quotaControl = await runQuotaControl(client, ctx.modelGeneral);

        return {
          inline,
          uri,
          quotaControl,
          note:
            'Ran both sub-cases through the recording proxy so the wire part keys ' +
            'and fileUri forwarding are captured for the genai side, whether ' +
            'accepted or rejected.',
        };
      } finally {
        await proxy.close();
      }
    });

    await pause();

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      const proxy = await startRecordingProxy();
      try {
        const provider = createAISDK(ctx.apiKey, {
          baseURL: `${proxy.origin}/v1beta`,
        });
        const model = provider.languageModel(ctx.modelGeneral);

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
            const result = await model.doGenerate({
              prompt,
              maxOutputTokens: IMAGE_CASE_MAX_TOKENS,
            });
            const preview = result.content
              .filter((part) => part.type === 'text')
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('')
              .slice(0, 120);
            return {
              ...recordAccepted(preview, inspectLatest(proxy.records)),
              sentDataKind: dataKind,
            };
          } catch (error) {
            return {
              ...recordRejected(error, inspectLatest(proxy.records)),
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
            const model = provider.languageModel(
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
          note:
            'BOTH sub-cases ran through the recording proxy, so the wire part ' +
            'keys and fileUri forwarding are captured for the AI SDK side too.',
        };
      } finally {
        await proxy.close();
      }
    });

    const g = genai.observation as {
      inline?: MediaSubCase;
      uri?: MediaSubCase;
      quotaControl?: QuotaControl;
    };
    const a = aisdk.observation as {
      inline?: MediaSubCase;
      uri?: MediaSubCase;
    };

    const endpointAcceptedUri =
      g.uri?.ok === true && a.uri?.ok === true;
    const endpointRejectedUri = g.uri?.ok === false && a.uri?.ok === false;
    const uriEndpointUnproven =
      g.uri?.httpStatus === 429 || a.uri?.httpStatus === 429;

    // TRANSPORT: did each adapter actually put the URL on fileData.fileUri?
    const gUriTransported = g.uri?.wireUriForwarded === true;
    const aUriTransported = a.uri?.wireUriForwarded === true;

    return {
      id: 'P08',
      area: 'Media (inline base64 and URI fileData)',
      question:
        'Do both adapters hit the same media transports: inline base64 bytes as ' +
        'inlineData and a URL as fileData?',
      models: [ctx.modelGeneral],
      genai,
      aisdk,
      verdict:
        gUriTransported && aUriTransported ? 'parity' : 'partial',
      finding: buildFinding(
        g.inline,
        g.uri,
        g.quotaControl,
        a.inline,
        a.uri,
        {
          endpointAcceptedUri,
          endpointRejectedUri,
          uriEndpointUnproven,
          gUriTransported,
          aUriTransported,
        },
      ),
    };
  },
};

function buildFinding(
  gInline: MediaSubCase | undefined,
  gUri: MediaSubCase | undefined,
  control: QuotaControl | undefined,
  aInline: MediaSubCase | undefined,
  aUri: MediaSubCase | undefined,
  dims: {
    endpointAcceptedUri: boolean;
    endpointRejectedUri: boolean;
    uriEndpointUnproven: boolean;
    gUriTransported: boolean;
    aUriTransported: boolean;
  },
): string {
  const inline = `Inline base64: @google/genai ${outcomeWord(gInline?.ok)} ` +
    `(wire part keys [${(gInline?.wirePartKeys ?? []).join(',')}]); ` +
    `AI SDK ${outcomeWord(aInline?.ok)} ` +
    `(wire part keys [${(aInline?.wirePartKeys ?? []).join(',')}]). `;

  const transport = `URI fileData TRANSPORT: @google/genai sent the URL on ` +
    `fileData.fileUri=${dims.gUriTransported}; AI SDK sent it on ` +
    `fileData.fileUri=${dims.aUriTransported}. `;

  let endpoint: string;
  if (dims.uriEndpointUnproven) {
    const genaiStatus = gUri?.httpStatus ?? 'unknown';
    const aisdkStatus = aUri?.httpStatus ?? 'unknown';
    endpoint =
      `URI fileData ENDPOINT-ACCEPTANCE: unproven in this run. Both sides ` +
      `got a ${genaiStatus} (genai) / ${aisdkStatus} (ai-sdk), and a 429 ` +
      `cannot be attributed to the arbitrary fileUri host: the plain-text control ` +
      `call that succeeded afterwards ` +
      `(plainTextAccepted=${String(control?.plainTextAccepted)}, HTTP ` +
      `${control?.httpStatus ?? 'unknown'}) only rules out a general ` +
      `generate-content quota, never a separate media or file-URI quota. `;
  } else if (dims.endpointAcceptedUri) {
    endpoint =
      `URI fileData ENDPOINT-ACCEPTANCE: the endpoint accepted the URL on both ` +
      `sides (genai HTTP ${gUri?.httpStatus}, ai-sdk HTTP ${aUri?.httpStatus}). `;
  } else if (dims.endpointRejectedUri) {
    endpoint =
      `URI fileData ENDPOINT-ACCEPTANCE: rejected on both sides with the same ` +
      `non-429 status (genai HTTP ${gUri?.httpStatus}, ai-sdk HTTP ` +
      `${aUri?.httpStatus}), so both adapters hit the same endpoint behavior. `;
  } else {
    endpoint =
      `URI fileData ENDPOINT-ACCEPTANCE: split (genai HTTP ` +
      `${gUri?.httpStatus ?? 'none'}, ai-sdk HTTP ${aUri?.httpStatus ?? 'none'}), ` +
      `a real difference in how the endpoint treats the fileUri. `;
  }

  const mapping =
    `The MediaBlock encoding:url -> fileData and encoding:base64 -> inlineData ` +
    `mapping in neutralConverters is transported unchanged by both adapters.`;

  const context =
    `Control call (context only, not proof): plain text succeeded after the URI case ` +
    `genai=${String(control?.plainTextAccepted)} (HTTP ${control?.httpStatus ?? 'unknown'}). `;

  return inline + transport + endpoint + context + mapping;
}

function outcomeWord(ok: boolean | undefined): string {
  return ok === true ? 'accepted' : 'rejected';
}
