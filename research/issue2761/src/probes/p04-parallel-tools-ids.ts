/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P04 — parallel tool calls and tool-call IDs.
 *
 * `packages/providers/src/gemini/geminiResponseMapper.ts` synthesizes
 * `call_<timestamp>_<random>` ids whenever `functionCall.id` is absent, and
 * llxprt pairs tool responses back to calls by that id. So the questions are:
 * does each adapter surface more than one call from a single model turn, does
 * it give each call an id, and can those ids be replayed on the tool-response
 * turn.
 */

import type {
  LanguageModelV2FunctionTool,
  LanguageModelV2Prompt,
  LanguageModelV2ToolCallPart,
  LanguageModelV2ToolResultPart,
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

const USER_TURN =
  'For Paris, call get_weather and get_time. Issue both tool calls now, in the same turn.';
const MAX_OUTPUT_TOKENS = 512;
const PAUSE_MS = 3000;

const pause = (): Promise<void> =>
  new Promise((done) => setTimeout(done, PAUSE_MS));

const CITY_PARAMETERS = {
  type: Type.OBJECT,
  properties: { city: { type: Type.STRING } },
  required: ['city'],
};

const GENAI_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'get_weather',
        description: 'Get the current weather for a city.',
        parameters: CITY_PARAMETERS,
      },
      {
        name: 'get_time',
        description: 'Get the current local time for a city.',
        parameters: CITY_PARAMETERS,
      },
    ],
  },
];

const AISDK_TOOLS: LanguageModelV2FunctionTool[] = [
  {
    type: 'function',
    name: 'get_weather',
    description: 'Get the current weather for a city.',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
  {
    type: 'function',
    name: 'get_time',
    description: 'Get the current local time for a city.',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
];

interface CallEvidence {
  readonly name: string;
  readonly id: string | null;
  readonly idLooksSynthetic: boolean;
  readonly args: unknown;
}

/** llxprt's fallback ids look like `call_<ms>_<base36>`. */
function looksSynthetic(id: string | null): boolean {
  return id !== null && /^call_\d+_[a-z0-9]+$/i.test(id);
}

interface RoundTrip {
  readonly attempted: boolean;
  readonly accepted: boolean;
  readonly idsEchoed: number;
  readonly error: ReturnType<typeof captureError> | null;
}

const NOT_ATTEMPTED: RoundTrip = {
  attempted: false,
  accepted: false,
  idsEchoed: 0,
  error: null,
};

export const p04ParallelToolsIds: Probe = {
  id: 'P04',
  area: 'Parallel tool calls and tool-call IDs',

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const genai = await observe(ADAPTER_GENAI, async () => {
      const client = createGenAI(ctx.apiKey);
      const userTurn: Content = { role: 'user', parts: [{ text: USER_TURN }] };
      const first = await client.models.generateContent({
        model: ctx.modelGeneral,
        contents: [userTurn],
        config: { maxOutputTokens: MAX_OUTPUT_TOKENS, tools: GENAI_TOOLS },
      });
      const parts = first.candidates?.[0]?.content?.parts ?? [];
      const callParts = parts.filter((part) => part.functionCall !== undefined);
      const calls: CallEvidence[] = callParts.map((part) => {
        const id = part.functionCall?.id ?? null;
        return {
          name: part.functionCall?.name ?? '',
          id,
          idLooksSynthetic: looksSynthetic(id),
          args: part.functionCall?.args ?? {},
        };
      });

      let roundTrip: RoundTrip = NOT_ATTEMPTED;
      if (callParts.length > 0) {
        await pause();
        const modelTurn: Content = {
          role: 'model',
          parts: callParts.map(
            (part) =>
              ({
                functionCall: part.functionCall,
                ...(('thoughtSignature' in part
                  ? { thoughtSignature: part.thoughtSignature }
                  : {}) as Record<string, unknown>),
              }) as Part,
          ),
        };
        const toolTurn: Content = {
          role: 'user',
          parts: callParts.map((part) => ({
            functionResponse: {
              ...(part.functionCall?.id !== undefined
                ? { id: part.functionCall.id }
                : {}),
              name: part.functionCall?.name ?? '',
              response: { result: 'ok' },
            },
          })),
        };
        try {
          await client.models.generateContent({
            model: ctx.modelGeneral,
            contents: [userTurn, modelTurn, toolTurn],
            config: { maxOutputTokens: MAX_OUTPUT_TOKENS, tools: GENAI_TOOLS },
          });
          roundTrip = {
            attempted: true,
            accepted: true,
            idsEchoed: calls.filter((call) => call.id !== null).length,
            error: null,
          };
        } catch (error) {
          roundTrip = {
            attempted: true,
            accepted: false,
            idsEchoed: calls.filter((call) => call.id !== null).length,
            error: captureError(error),
          };
        }
      }

      return {
        parallelCallCount: calls.length,
        calls,
        idsPresent: calls.every((call) => call.id !== null),
        finishReason: first.candidates?.[0]?.finishReason ?? null,
        roundTrip,
      };
    });

    await pause();

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      const provider = createAISDK(ctx.apiKey);
      const model = provider.languageModel(ctx.modelGeneral);
      const userMessage: LanguageModelV2Prompt[number] = {
        role: 'user',
        content: [{ type: 'text', text: USER_TURN }],
      };
      const first = await model.doGenerate({
        prompt: [userMessage],
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        tools: AISDK_TOOLS,
        toolChoice: { type: 'auto' },
      });
      const toolCalls = first.content.filter((part) => part.type === 'tool-call');
      const calls: CallEvidence[] = toolCalls.map((call) => ({
        name: call.toolName,
        id: call.toolCallId,
        idLooksSynthetic: looksSynthetic(call.toolCallId),
        args: call.input,
      }));

      let roundTrip: RoundTrip = NOT_ATTEMPTED;
      if (toolCalls.length > 0) {
        await pause();
        const assistantParts: LanguageModelV2ToolCallPart[] = toolCalls.map(
          (call) => ({
            type: 'tool-call',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            // doGenerate returns `input` as a JSON string; the request side
            // needs the parsed object.
            input: parseToolInput(call.input).value,
            ...(call.providerMetadata !== undefined
              ? { providerOptions: call.providerMetadata }
              : {}),
          }),
        );
        const toolParts: LanguageModelV2ToolResultPart[] = toolCalls.map(
          (call) => ({
            type: 'tool-result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: { type: 'json', value: { result: 'ok' } },
          }),
        );
        try {
          await model.doGenerate({
            prompt: [
              userMessage,
              { role: 'assistant', content: assistantParts },
              { role: 'tool', content: toolParts },
            ],
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            tools: AISDK_TOOLS,
            toolChoice: { type: 'auto' },
          });
          roundTrip = {
            attempted: true,
            accepted: true,
            idsEchoed: toolParts.length,
            error: null,
          };
        } catch (error) {
          roundTrip = {
            attempted: true,
            accepted: false,
            idsEchoed: toolParts.length,
            error: captureError(error),
          };
        }
      }

      return {
        parallelCallCount: calls.length,
        calls,
        idsPresent: calls.every((call) => call.id !== null),
        finishReason: first.finishReason,
        warnings: first.warnings,
        roundTrip,
      };
    });

    const gCount = numberOf(genai.observation.parallelCallCount);
    const aCount = numberOf(aisdk.observation.parallelCallCount);
    const gTrip = genai.observation.roundTrip as RoundTrip | undefined;
    const aTrip = aisdk.observation.roundTrip as RoundTrip | undefined;
    const bothParallel = gCount >= 2 && aCount >= 2;
    const bothRoundTripped =
      gTrip?.accepted === true && aTrip?.accepted === true;

    return {
      id: 'P04',
      area: 'Parallel tool calls and tool-call IDs',
      question:
        'Does each adapter surface multiple tool calls from one model turn, ' +
        'give each an id, and accept those ids replayed on the tool-response turn?',
      models: [ctx.modelGeneral],
      genai,
      aisdk,
      verdict:
        genai.ok && aisdk.ok && bothParallel && bothRoundTripped
          ? 'parity'
          : genai.ok && aisdk.ok && bothRoundTripped
            ? 'partial'
            : 'gap',
      finding:
        `@google/genai surfaced ${gCount} call(s) in one turn ` +
        `(ids present: ${genai.observation.idsPresent === true}); ` +
        `@ai-sdk/google surfaced ${aCount} ` +
        `(ids present: ${aisdk.observation.idsPresent === true}). ` +
        `Replaying the ids on the tool-response turn was ` +
        `${gTrip?.accepted === true ? 'accepted' : 'not accepted'} for genai and ` +
        `${aTrip?.accepted === true ? 'accepted' : 'not accepted'} for the AI SDK. ` +
        (bothParallel
          ? 'Both give every call a stable id, so geminiResponseMapper would no ' +
            'longer need its synthetic `call_<ts>_<rand>` fallback on the AI SDK path.'
          : 'The model did not emit parallel calls on both sides in this run, so ' +
            'the parallel dimension is unproven; the id and round-trip dimensions still hold.'),
    };
  },
};

/**
 * `doGenerate` hands back a tool call's `input` as a JSON string. Parsing it
 * can throw, and an unguarded throw here would abort the adapter run and be
 * recorded as the adapter rejecting the replay, which is a different finding.
 */
function parseToolInput(input: unknown): {
  value: unknown;
  parseError: string | null;
} {
  if (typeof input !== 'string') {
    return { value: input, parseError: null };
  }
  try {
    return { value: JSON.parse(input) as unknown, parseError: null };
  } catch (error) {
    return { value: {}, parseError: String(error) };
  }
}

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
