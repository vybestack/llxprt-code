/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P06 — request and response thought signatures (Gemini 3).
 *
 * Gemini 3 rejects a replayed model turn whose first `functionCall` part has
 * no `thoughtSignature`. llxprt handles this by hand in
 * `packages/providers/src/gemini/thoughtSignatures.ts`, injecting
 * `SYNTHETIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'` into the
 * first function call of each model turn in the active loop.
 *
 * Three steps per adapter, all through the recording proxy so the evidence is
 * the wire body rather than a claim:
 *
 *   1. Provoke a function call and capture the signature that came back.
 *   2. Replay the turn WITH that signature.
 *   3. Replay the same turn WITHOUT it, and inspect the wire body to see
 *      whether the adapter injected a sentinel of its own.
 *
 * Signature values are recorded as length plus a short prefix. The full blob
 * is model-internal state and there is no reason to persist it.
 */

import type {
  LanguageModelV2FunctionTool,
  LanguageModelV2Prompt,
  LanguageModelV2ToolCallPart,
} from '@ai-sdk/provider';
import { Type, type Content, type Part } from '@google/genai';

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

/** The sentinel llxprt injects today, and the one `@ai-sdk/google` ships. */
const SENTINEL = 'skip_thought_signature_validator';

const USER_TURN = 'What is the temperature in Paris? Use the get_temp tool.';
const TOOL_NAME = 'get_temp';
const TOOL_RESULT = { temperatureCelsius: 21 };

const GENAI_TOOL = {
  functionDeclarations: [
    {
      name: TOOL_NAME,
      description: 'Get the current temperature for a city.',
      parameters: {
        type: Type.OBJECT,
        properties: { city: { type: Type.STRING } },
        required: ['city'],
      },
    },
  ],
};

const AISDK_TOOL: LanguageModelV2FunctionTool = {
  type: 'function',
  name: TOOL_NAME,
  description: 'Get the current temperature for a city.',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
};

interface SignatureEvidence {
  readonly present: boolean;
  readonly length: number;
  readonly prefix: string | null;
  readonly isSentinel: boolean;
}

function describeSignature(value: unknown): SignatureEvidence {
  if (typeof value !== 'string' || value.length === 0) {
    return { present: false, length: 0, prefix: null, isSentinel: false };
  }
  return {
    present: true,
    length: value.length,
    prefix: value.slice(0, 16),
    isSentinel: value === SENTINEL,
  };
}

/** Pulls the signature off every model-role part in a captured request body. */
function wireSignatures(record: WireRecord | undefined): SignatureEvidence[] {
  const body = record?.requestBody as
    | { contents?: Array<{ role?: string; parts?: Array<Record<string, unknown>> }> }
    | undefined;
  const modelTurns = (body?.contents ?? []).filter(
    (turn) => turn.role === 'model',
  );
  return modelTurns.flatMap((turn) =>
    (turn.parts ?? []).map((part) => describeSignature(part.thoughtSignature)),
  );
}

interface ReplayOutcome {
  readonly accepted: boolean;
  readonly httpStatus: number | null;
  readonly providerError: string | null;
  readonly signaturesOnWire: SignatureEvidence[];
}

function replayOutcome(
  record: WireRecord | undefined,
  accepted: boolean,
): ReplayOutcome {
  return {
    accepted,
    httpStatus: record?.status ?? null,
    providerError:
      record !== undefined && record.status >= 400
        ? record.responseBodyPreview.slice(0, 400)
        : null,
    signaturesOnWire: wireSignatures(record),
  };
}

const PAUSE_MS = 3000;
const pause = (): Promise<void> =>
  new Promise((done) => setTimeout(done, PAUSE_MS));

export const p06ThoughtSignatures: Probe = {
  id: 'P06',
  area: 'Thought signatures (request and response)',

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const genai = await observe(ADAPTER_GENAI, async () => {
      const proxy = await startRecordingProxy();
      try {
        const client = createGenAI(ctx.apiKey, { baseUrl: proxy.origin });
        const userTurn: Content = {
          role: 'user',
          parts: [{ text: USER_TURN }],
        };

        const first = await client.models.generateContent({
          model: ctx.modelGemini3,
          contents: [userTurn],
          config: { tools: [GENAI_TOOL] },
        });
        const parts = first.candidates?.[0]?.content?.parts ?? [];
        const callPart = parts.find((part) => part.functionCall !== undefined);
        if (callPart?.functionCall === undefined) {
          throw new Error(
            'Model did not emit a functionCall; probe cannot test signatures.',
          );
        }
        const call = callPart.functionCall;
        const responseSignature = describeSignature(
          (callPart as Part & { thoughtSignature?: unknown }).thoughtSignature,
        );

        const modelTurn = (signature: string | undefined): Content => ({
          role: 'model',
          parts: [
            {
              functionCall: {
                ...(call.id !== undefined ? { id: call.id } : {}),
                name: call.name ?? TOOL_NAME,
                args: call.args ?? {},
              },
              ...(signature !== undefined
                ? { thoughtSignature: signature }
                : {}),
            } as Part,
          ],
        });
        const toolTurn: Content = {
          role: 'user',
          parts: [
            {
              functionResponse: {
                ...(call.id !== undefined ? { id: call.id } : {}),
                name: call.name ?? TOOL_NAME,
                response: TOOL_RESULT,
              },
            },
          ],
        };

        const replay = async (
          signature: string | undefined,
        ): Promise<{ accepted: boolean; error: unknown }> => {
          try {
            await client.models.generateContent({
              model: ctx.modelGemini3,
              contents: [userTurn, modelTurn(signature), toolTurn],
              config: { tools: [GENAI_TOOL] },
            });
            return { accepted: true, error: null };
          } catch (error) {
            return { accepted: false, error };
          }
        };

        await pause();
        // Only a record that was appended BY this request is evidence for it. If
        // the request never reached the proxy (e.g. it threw before dispatch),
        // `proxy.records.length` did not grow, and using the previous record would
        // attribute an older request's wire body to this sub-case.
        const withBefore = proxy.records.length;
        const withSignature = await replay(
          typeof (callPart as Part & { thoughtSignature?: unknown })
            .thoughtSignature === 'string'
            ? ((callPart as Part & { thoughtSignature?: string })
                .thoughtSignature as string)
            : undefined,
        );
        const withRecord =
          proxy.records.length > withBefore
            ? proxy.records[proxy.records.length - 1]
            : undefined;

        await pause();
        const withoutBefore = proxy.records.length;
        const withoutSignature = await replay(undefined);
        const withoutRecord =
          proxy.records.length > withoutBefore
            ? proxy.records[proxy.records.length - 1]
            : undefined;

        return {
          step1_capture: {
            toolCallId: call.id ?? null,
            toolName: call.name ?? null,
            responseSignature,
          },
          step2_replayWithSignature: {
            ...replayOutcome(withRecord, withSignature.accepted),
            ...(withRecord === undefined
              ? { wireEvidence: 'none (no proxy record grew for this sub-case)' }
              : {}),
            ...(withSignature.error !== null
              ? { thrown: captureError(withSignature.error) }
              : {}),
          },
          step3_replayWithoutSignature: {
            ...replayOutcome(withoutRecord, withoutSignature.accepted),
            ...(withoutRecord === undefined
              ? { wireEvidence: 'none (no proxy record grew for this sub-case)' }
              : {}),
            ...(withoutSignature.error !== null
              ? { thrown: captureError(withoutSignature.error) }
              : {}),
          },
          note:
            'Sent raw, with no llxprt-side signature injection, so step 3 shows ' +
            'what happens when thoughtSignatures.ts is absent.',
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
        const model = provider.languageModel(ctx.modelGemini3);
        const userMessage: LanguageModelV2Prompt[number] = {
          role: 'user',
          content: [{ type: 'text', text: USER_TURN }],
        };

        const first = await model.doGenerate({
          prompt: [userMessage],
          tools: [AISDK_TOOL],
          toolChoice: { type: 'auto' },
        });
        const call = first.content.find((part) => part.type === 'tool-call');
        if (call === undefined) {
          throw new Error(
            'Model did not emit a tool call; probe cannot test signatures.',
          );
        }
        const responseSignature = describeSignature(
          (call.providerMetadata?.google as { thoughtSignature?: unknown })
            ?.thoughtSignature,
        );

        // `doGenerate` hands back `input` as a JSON STRING, but the request
        // side needs a parsed object: the Gemini API rejects a string for
        // `function_call.args` with INVALID_ARGUMENT. Replaying the SDK's own
        // output therefore requires an explicit parse — recorded below as
        // `replayRequiresInputParse`, because it is adapter work llxprt would
        // have to own.
        const replayRequiresInputParse = typeof call.input === 'string';
        let parsedInput: unknown = call.input;
        let inputParseError: string | null = null;
        if (replayRequiresInputParse) {
          try {
            parsedInput = JSON.parse(call.input as string) as unknown;
          } catch (error) {
            // Record it rather than letting the throw abort the adapter run and
            // masquerade as the adapter rejecting the replay.
            parsedInput = {};
            inputParseError = String(error);
          }
        }

        const buildPrompt = (withSignature: boolean): LanguageModelV2Prompt => {
          const toolCallPart: LanguageModelV2ToolCallPart = {
            type: 'tool-call',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: parsedInput,
            ...(withSignature && call.providerMetadata !== undefined
              ? { providerOptions: call.providerMetadata }
              : {}),
          };
          return [
            userMessage,
            { role: 'assistant', content: [toolCallPart] },
            {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: call.toolCallId,
                  toolName: call.toolName,
                  output: { type: 'json', value: TOOL_RESULT },
                },
              ],
            },
          ];
        };

        const replay = async (
          withSignature: boolean,
        ): Promise<{ accepted: boolean; error: unknown }> => {
          try {
            await model.doGenerate({
              prompt: buildPrompt(withSignature),
              tools: [AISDK_TOOL],
              toolChoice: { type: 'auto' },
            });
            return { accepted: true, error: null };
          } catch (error) {
            return { accepted: false, error };
          }
        };

        await pause();
        // Only a record that grew during this sub-case is evidence for it; see
        // the genai side for why the count is captured before the request.
        const withBefore = proxy.records.length;
        const withSignature = await replay(true);
        const withRecord =
          proxy.records.length > withBefore
            ? proxy.records[proxy.records.length - 1]
            : undefined;

        await pause();
        const withoutBefore = proxy.records.length;
        const withoutSignature = await replay(false);
        const withoutRecord =
          proxy.records.length > withoutBefore
            ? proxy.records[proxy.records.length - 1]
            : undefined;

        return {
          step1_capture: {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            responseSignature,
            replayRequiresInputParse,
            inputParseError,
          },
          step2_replayWithSignature: {
            ...replayOutcome(withRecord, withSignature.accepted),
            ...(withRecord === undefined
              ? { wireEvidence: 'none (no proxy record grew for this sub-case)' }
              : {}),
            ...(withSignature.error !== null
              ? { thrown: captureError(withSignature.error) }
              : {}),
          },
          step3_replayWithoutSignature: {
            ...replayOutcome(withoutRecord, withoutSignature.accepted),
            ...(withoutRecord === undefined
              ? { wireEvidence: 'none (no proxy record grew for this sub-case)' }
              : {}),
            ...(withoutSignature.error !== null
              ? { thrown: captureError(withoutSignature.error) }
              : {}),
          },
        };
      } finally {
        await proxy.close();
      }
    });

    return {
      id: 'P06',
      area: 'Thought signatures (request and response)',
      question:
        'On Gemini 3, does each adapter surface the response thought signature, ' +
        'send it back on replay, and cover the missing-signature case that ' +
        'thoughtSignatures.ts handles by hand today?',
      models: [ctx.modelGemini3],
      genai,
      aisdk,
      ...judge(genai.observation, aisdk.observation, genai.ok && aisdk.ok),
    };
  },
};

interface StepShape {
  readonly step1_capture?: { responseSignature?: SignatureEvidence };
  readonly step2_replayWithSignature?: ReplayOutcome;
  readonly step3_replayWithoutSignature?: ReplayOutcome;
}

function judge(
  genaiObs: Record<string, unknown>,
  aisdkObs: Record<string, unknown>,
  bothRan: boolean,
): Pick<ProbeResult, 'verdict' | 'finding'> {
  if (!bothRan) {
    return {
      verdict: 'gap',
      finding:
        'At least one adapter run did not complete; see the recorded error.',
    };
  }
  const g = genaiObs as StepShape;
  const a = aisdkObs as StepShape;
  const aisdkSurfaces = a.step1_capture?.responseSignature?.present === true;
  const aisdkReplayOk = a.step2_replayWithSignature?.accepted === true;
  const aisdkInjectedSentinel =
    a.step3_replayWithoutSignature?.signaturesOnWire.some(
      (sig) => sig.isSentinel,
    ) === true;
  const genaiRawUnsignedAccepted =
    g.step3_replayWithoutSignature?.accepted === true;

  const verdict: Verdict =
    aisdkSurfaces && aisdkReplayOk && aisdkInjectedSentinel
      ? 'parity'
      : aisdkSurfaces && aisdkReplayOk
        ? 'partial'
        : 'gap';

  return {
    verdict,
    finding:
      `@ai-sdk/google surfaced the response signature (${describePresence(a)}) ` +
      `and the signed replay was ${a.step2_replayWithSignature?.accepted ? 'accepted' : 'rejected'}. ` +
      `On the unsigned replay it ${aisdkInjectedSentinel ? 'injected the same ' + SENTINEL + ' sentinel llxprt injects' : 'sent no sentinel'}, ` +
      `result ${a.step3_replayWithoutSignature?.accepted ? 'accepted' : `rejected (HTTP ${a.step3_replayWithoutSignature?.httpStatus ?? 'unknown'})`}. ` +
      `Raw @google/genai with no injection: signed replay ` +
      `${g.step2_replayWithSignature?.accepted ? 'accepted' : 'rejected'}, unsigned replay ` +
      `${genaiRawUnsignedAccepted ? 'accepted' : `rejected (HTTP ${g.step3_replayWithoutSignature?.httpStatus ?? 'unknown'})`}. ` +
      (aisdkInjectedSentinel
        ? 'The AI SDK ships the same workaround thoughtSignatures.ts implements, so that module would become redundant.'
        : 'llxprt would keep owning the missing-signature workaround.'),
  };
}

type Verdict = ProbeResult['verdict'];

function describePresence(shape: StepShape): string {
  const sig = shape.step1_capture?.responseSignature;
  return sig?.present === true ? `length ${sig.length}` : 'absent';
}
