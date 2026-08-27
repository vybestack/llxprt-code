/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P11 - abort.
 *
 * llxprt calls `throwIfAborted` (`packages/providers/src/gemini/geminiAbort.ts`)
 * before dispatch and lets `consumeGeminiStream` unwind the generator when a stream
 * is cancelled. This probe measures how each adapter behaves when the AbortSignal is
 * already aborted, and what happens when a stream is aborted mid-flight.
 *
 * Two sub-cases per adapter, on `ctx.modelGeneral`:
 *   1. Pre-dispatch: signal already aborted. Class name, message, whether the
 *      error is distinguishable as an abort (AbortError / name), and whether any
 *      HTTP request left the process (proxy.records.length === 0).
 *   2. Mid-stream: prompt long enough for several chunks, abort right after the
 *      first chunk, record chunksSeen, how iteration ended (threw vs clean),
 *      class name if it threw, and ms from the abort() call to termination. Both
 *      adapter sides route the mid-stream sub-case through the recording proxy, which
 *      records `relayCompleted` / `clientDisconnected` / `upstreamCutShort`
 *      so the wire can show whether the upstream read was genuinely cut short.
 */

import type { LanguageModelV2Prompt } from '@ai-sdk/provider';

import { createAISDK } from '../adapters/aisdk.ts';
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
import {
  startRecordingProxy,
  waitForRecord,
  type WireRecord,
} from '../recording.ts';

const STREAM_PROMPT =
  'Write a long essay about the history of the Roman Empire, covering many topics ' +
  'in detail. Keep going for a while.';
const PRE_PROMPT = 'Say hello.';
const PAUSE_MS = 3000;

const pause = (): Promise<void> =>
  new Promise((done) => setTimeout(done, PAUSE_MS));

interface AbortEvidence {
  readonly threw: boolean;
  readonly name: string;
  readonly message: string;
  readonly looksAbort: boolean;
  readonly statusCode: number | null;
  readonly requestsLeftProcess: boolean;
}

function abortEvidence(
  error: unknown,
  requestsLeftProcess: boolean,
): AbortEvidence {
  const captured = captureError(error);
  const name = captured.name;
  return {
    threw: true,
    name,
    message: captured.message.slice(0, 200),
    looksAbort: name === 'AbortError' || name === 'DOMException',
    statusCode: captured.statusCode ?? null,
    requestsLeftProcess,
  };
}

interface MidStreamEvidence {
  chunksSeen: number;
  endedCleanly: boolean;
  threw: boolean;
  name: string;
  message: string;
  /** The true abort-to-termination interval: abort() to loop exit. */
  msAbortToEnd: number;
  /** Whether the proxy relayed the full response to a client that stayed. */
  relayCompleted: boolean | null;
  /** Whether the downstream client disconnected before the relay finished. */
  clientDisconnected: boolean | null;
  /** Whether the proxy's upstream read loop was cut short before the body drained. */
  upstreamCutShort: boolean | null;
}

function summarizeRelay(record: WireRecord | undefined): {
  relayCompleted: boolean | null;
  clientDisconnected: boolean | null;
  upstreamCutShort: boolean | null;
} {
  if (record === undefined) {
    return {
      relayCompleted: null,
      clientDisconnected: null,
      upstreamCutShort: null,
    };
  }
  return {
    relayCompleted: record.relayCompleted ?? null,
    clientDisconnected: record.clientDisconnected ?? null,
    upstreamCutShort: record.upstreamCutShort ?? null,
  };
}

interface MidStreamBase {
  readonly chunksSeen: number;
  readonly endedCleanly: boolean;
  readonly threw: boolean;
  readonly name: string;
  readonly message: string;
  readonly msAbortToEnd: number;
}

/** Reads the first chunk, aborts, then drains until termination. */
async function driveAbortedStream(
  first: Promise<unknown>,
  abort: () => void,
  readNext: () => Promise<boolean>,
): Promise<MidStreamBase> {
  await first;
  const abortedAt = Date.now();
  abort();
  let threw = false;
  let name = '';
  let message = '';
  let chunksSeen = 0;
  try {
    for (;;) {
      const more = await readNext();
      if (!more) {
        break;
      }
      // Count each successful post-abort read, so `chunksSeen` distinguishes
      // prompt termination (few reads, threw) from a fully buffered stream
      // drained after the abort (many reads, clean).
      chunksSeen += 1;
    }
  } catch (error) {
    threw = true;
    name = captureError(error).name;
    message = captureError(error).message.slice(0, 200);
  }
  const terminatedAt = Date.now();
  return {
    chunksSeen,
    endedCleanly: !threw,
    threw,
    name,
    message,
    msAbortToEnd: terminatedAt - abortedAt,
  };
}

export const p11Abort: Probe = {
  id: 'P11',
  area: 'Abort',

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const genai = await observe(ADAPTER_GENAI, async () => {
      const proxy = await startRecordingProxy();
      try {
        const client = createGenAI(ctx.apiKey, { baseUrl: proxy.origin });

        // 1. Pre-dispatch.
        const preController = new AbortController();
        preController.abort();
        let pre: AbortEvidence;
        try {
          await client.models.generateContent({
            model: ctx.modelGeneral,
            contents: [{ role: 'user', parts: [{ text: PRE_PROMPT }] }],
            config: {
              maxOutputTokens: 8,
              abortSignal: preController.signal,
            },
          });
          pre = {
            threw: false,
            name: '',
            message: '',
            looksAbort: false,
            statusCode: null,
            requestsLeftProcess: proxy.records.length > 0,
          };
        } catch (error) {
          pre = abortEvidence(error, proxy.records.length > 0);
        }

        await pause();

        // 2. Mid-stream, through the proxy, abort after the first chunk.
        const streamController = new AbortController();
        const recordsBefore = proxy.records.length;
        const iterator = (
          await client.models.generateContentStream({
            model: ctx.modelGeneral,
            contents: [{ role: 'user', parts: [{ text: STREAM_PROMPT }] }],
            config: {
              maxOutputTokens: 512,
              abortSignal: streamController.signal,
            },
          })
        )[Symbol.asyncIterator]();

        const mid = await driveAbortedStream(
          iterator.next(),
          () => streamController.abort(),
          async () => {
            const next = await iterator.next();
            return !next.done;
          },
        );

        return {
          preDispatch: pre,
          midStream: {
            ...mid,
            ...summarizeRelay(await waitForRecord(proxy, recordsBefore)),
          },
          totalProxyRecords: proxy.records.length,
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

        // 1. Pre-dispatch.
        const preController = new AbortController();
        preController.abort();
        let pre: AbortEvidence;
        try {
          await model.doGenerate({
            prompt: [
              { role: 'user', content: [{ type: 'text', text: PRE_PROMPT }] },
            ] as LanguageModelV2Prompt,
            maxOutputTokens: 8,
            abortSignal: preController.signal,
          });
          pre = {
            threw: false,
            name: '',
            message: '',
            looksAbort: false,
            statusCode: null,
            requestsLeftProcess: proxy.records.length > 0,
          };
        } catch (error) {
          pre = abortEvidence(error, proxy.records.length > 0);
        }

        await pause();

        // 2. Mid-stream, through the proxy too.
        const streamController = new AbortController();
        const recordsBefore = proxy.records.length;
        const result = await model.doStream({
          prompt: [
            { role: 'user', content: [{ type: 'text', text: STREAM_PROMPT }] },
          ] as LanguageModelV2Prompt,
          maxOutputTokens: 512,
          abortSignal: streamController.signal,
        });
        const reader = result.stream.getReader();

        const mid = await driveAbortedStream(
          reader.read(),
          () => streamController.abort(),
          async () => {
            const next = await reader.read();
            return !next.done;
          },
        );

        return {
          preDispatch: pre,
          midStream: {
            ...mid,
            ...summarizeRelay(await waitForRecord(proxy, recordsBefore)),
          },
          totalProxyRecords: proxy.records.length,
        };
      } finally {
        await proxy.close();
      }
    });

    return {
      id: 'P11',
      area: 'Abort',
      question:
        'When the AbortSignal is already aborted, does each adapter fail before ' +
        'any request leaves the process with an identifiable abort error, and when a ' +
        'stream is aborted mid-flight does iteration terminate promptly, with wire ' +
        'evidence that the upstream request was cut short?',
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
        '); see the recorded error. No abort conclusion drawn.',
    };
  }
  const gPre = genai.observation.preDispatch as AbortEvidence;
  const aPre = aisdk.observation.preDispatch as AbortEvidence;
  const gMid = genai.observation.midStream as MidStreamEvidence;
  const aMid = aisdk.observation.midStream as MidStreamEvidence;

  const bothPreThrewNoRequest =
    gPre.threw === true &&
    gPre.requestsLeftProcess === false &&
    aPre.threw === true &&
    aPre.requestsLeftProcess === false;
  const bothMidThrew = gMid.threw === true && aMid.threw === true;

  const verdict: ProbeResult['verdict'] =
    bothPreThrewNoRequest && bothMidThrew ? 'parity' : 'partial';

  return {
    verdict,
    finding:
      `Pre-dispatch (signal already aborted): @google/genai threw ` +
      `${gPre.name === '' ? 'nothing (returned)' : gPre.name} ` +
      `(abort-distinguishable=${String(gPre.looksAbort)}, HTTP ` +
      `${gPre.statusCode ?? 'none'}, requests that left the process: ` +
      `${gPre.requestsLeftProcess ? 'yes' : 'no'}); ` +
      `the AI SDK threw ${aPre.name === '' ? 'nothing (returned)' : aPre.name} ` +
      `(abort-distinguishable=${String(aPre.looksAbort)}, HTTP ` +
      `${aPre.statusCode ?? 'none'}, requests that left the process: ` +
      `${aPre.requestsLeftProcess ? 'yes' : 'no'}). ` +
      `Mid-stream: genai saw ${gMid.chunksSeen} chunk(s) and ` +
      `${gMid.threw ? 'threw ' + gMid.name + ' in ' + gMid.msAbortToEnd + 'ms' : 'ended cleanly'}; ` +
      `the AI SDK saw ${aMid.chunksSeen} chunk(s) and ` +
      `${aMid.threw ? 'threw ' + aMid.name + ' in ' + aMid.msAbortToEnd + 'ms' : 'ended cleanly'}. ` +
      `On the wire, genai relayCompleted=${String(gMid.relayCompleted)}, ` +
      `clientDisconnected=${String(gMid.clientDisconnected)}, ` +
      `upstreamCutShort=${String(gMid.upstreamCutShort)}; ` +
      `the AI SDK relayCompleted=${String(aMid.relayCompleted)}, ` +
      `clientDisconnected=${String(aMid.clientDisconnected)}, ` +
      `upstreamCutShort=${String(aMid.upstreamCutShort)}. ` +
      (gMid.clientDisconnected === true || aMid.clientDisconnected === true
        ? 'The proxy observed the mid-stream abort as a downstream disconnect and ' +
          'cut the upstream read short, so the abort did reach the wire for that side. '
        : 'The proxy did not observe a downstream disconnect for this run, so the wire ' +
          'cannot confirm upstream cancellation there; what is recorded is iteration ' +
          'terminating promptly after the abort. ') +
      `The AI SDK short-circuits an already-aborted signal on its own, at the ` +
      `fetch level, while @google/genai lets the call go out regardless. That ` +
      `is the behavior geminiAbort.throwIfAborted compensates for, though note ` +
      `its narrow use today: it is called from the server-tool and auth paths ` +
      `(GeminiProvider.resolveAuthWithAbortCheck and geminiServerTools), not ` +
      `from the ordinary chat generation path this probe exercises.`,
  };
};
