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
 *      class name if it threw, and ms from abort to termination.
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
import { startRecordingProxy } from '../recording.ts';

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
  msAbortToEnd: number;
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

        // 2. Mid-stream.
        const streamController = new AbortController();
        const stream = await client.models.generateContentStream({
          model: ctx.modelGeneral,
          contents: [{ role: 'user', parts: [{ text: STREAM_PROMPT }] }],
          config: {
            maxOutputTokens: 512,
            abortSignal: streamController.signal,
          },
        });
        let chunksSeen = 0;
        const startedAt = Date.now();
        let terminatedAt = 0;
        const mid: MidStreamEvidence = {
          chunksSeen: 0,
          endedCleanly: false,
          threw: false,
          name: '',
          message: '',
          msAbortToEnd: 0,
        };
        try {
          for await (const _chunk of stream) {
            chunksSeen += 1;
            if (chunksSeen === 1) {
              streamController.abort();
            }
          }
          terminatedAt = Date.now();
          mid.chunksSeen = chunksSeen;
          mid.endedCleanly = true;
        } catch (error) {
          terminatedAt = Date.now();
          mid.chunksSeen = chunksSeen;
          mid.threw = true;
          mid.name = captureError(error).name;
          mid.message = captureError(error).message.slice(0, 200);
        }
        mid.msAbortToEnd = terminatedAt - startedAt;

        return {
          preDispatch: pre,
          midStream: mid,
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

        // 2. Mid-stream.
        const streamController = new AbortController();
        const result = await model.doStream({
          prompt: [
            { role: 'user', content: [{ type: 'text', text: STREAM_PROMPT }] },
          ] as LanguageModelV2Prompt,
          maxOutputTokens: 512,
          abortSignal: streamController.signal,
        });
        const reader = result.stream.getReader();
        let chunksSeen = 0;
        const startedAt = Date.now();
        let terminatedAt = 0;
        const mid: MidStreamEvidence = {
          chunksSeen: 0,
          endedCleanly: false,
          threw: false,
          name: '',
          message: '',
          msAbortToEnd: 0,
        };
        try {
          for (;;) {
            const { done } = await reader.read();
            if (done) {
              break;
            }
            chunksSeen += 1;
            if (chunksSeen === 1) {
              streamController.abort();
            }
          }
          terminatedAt = Date.now();
          mid.chunksSeen = chunksSeen;
          mid.endedCleanly = true;
        } catch (error) {
          terminatedAt = Date.now();
          mid.chunksSeen = chunksSeen;
          mid.threw = true;
          mid.name = captureError(error).name;
          mid.message = captureError(error).message.slice(0, 200);
        }
        mid.msAbortToEnd = terminatedAt - startedAt;

        return {
          preDispatch: pre,
          midStream: mid,
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
        'stream is aborted mid-flight does iteration terminate promptly with a clear error?',
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
  const bothMidThrew =
    gMid.threw === true && aMid.threw === true;

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
      `The AI SDK short-circuits an already-aborted signal on its own (fetch ` +
      `level), so llxprt's throwIfAborted guard would be redundant on that path; ` +
      `@google/genai only registers an abort listener and lets the call through, ` +
      `which is exactly why that guard exists today.`,
  };
};
