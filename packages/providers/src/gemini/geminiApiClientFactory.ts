/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModelV4Content } from '@ai-sdk/provider';
import {
  toCallOptions,
  toFinishReason,
  toGenerateContentResponse,
  toParts,
  toUsageMetadata,
} from './geminiAiSdkConverters.js';
import type {
  GeminiApiClient,
  GeminiApiClientOptions,
  GenerateContentParameters,
  GenerateContentResponse,
  Part,
} from './geminiWireTypes.js';

/**
 * Builds the Gemini client on top of `@ai-sdk/google`.
 *
 * The AI SDK owns transport: HTTP, auth headers, base URL resolution, SSE
 * framing and retries. Only shape translation is done here, in
 * geminiAiSdkConverters.ts, because this provider builds and reads the Gemini
 * generateContent wire format directly.
 */
export async function createGeminiApiClient(
  options: GeminiApiClientOptions,
): Promise<GeminiApiClient> {
  const baseURL = options.httpOptions?.baseUrl;
  const provider = createGoogleGenerativeAI({
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    ...(baseURL !== undefined ? { baseURL } : {}),
    ...(options.httpOptions?.headers !== undefined
      ? { headers: options.httpOptions.headers }
      : {}),
  });

  const modelFor = (params: GenerateContentParameters) =>
    provider.languageModel(params.model);

  return {
    models: {
      async generateContent(
        params: GenerateContentParameters,
      ): Promise<GenerateContentResponse> {
        const model = modelFor(params);
        const result = await model.doGenerate(toCallOptions(params));
        return toGenerateContentResponse({
          content: result.content,
          finishReason: result.finishReason,
          usage: result.usage,
          providerMetadata: result.providerMetadata as
            | Record<string, unknown>
            | undefined,
          response: result.response,
        });
      },

      async generateContentStream(
        params: GenerateContentParameters,
      ): Promise<AsyncIterable<GenerateContentResponse>> {
        const model = modelFor(params);
        const { stream } = await model.doStream(toCallOptions(params));
        return streamToGeminiChunks(stream);
      },
    },
  };
}

/**
 * Reprojects the AI SDK part stream into Gemini response chunks.
 *
 * Text and reasoning arrive as incremental deltas keyed by id, while tool
 * calls arrive whole. Each delta becomes its own chunk so callers still see
 * incremental output; usage and finish reason arrive on the terminal part and
 * are emitted as a final chunk.
 */
async function* streamToGeminiChunks(
  stream: ReadableStream<unknown>,
): AsyncIterable<GenerateContentResponse> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      const chunk = streamPartToChunk(value);
      if (chunk !== undefined) {
        yield chunk;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Maps one AI SDK stream part to a Gemini chunk, or nothing if it carries none. */
function streamPartToChunk(
  value: unknown,
): GenerateContentResponse | undefined {
  const part = value as { type?: string } & Record<string, unknown>;
  switch (part.type) {
    case 'text-delta':
      return textDeltaChunk(part['delta'], false);
    case 'reasoning-delta':
      return textDeltaChunk(part['delta'], true);
    case 'tool-call':
      return chunkFromParts(
        toParts([part as unknown as LanguageModelV4Content]),
      );
    case 'finish':
      return finishChunk(part);
    default:
      return undefined;
  }
}

function textDeltaChunk(
  delta: unknown,
  thought: boolean,
): GenerateContentResponse | undefined {
  if (typeof delta !== 'string' || delta === '') {
    return undefined;
  }
  return chunkFromParts([
    thought ? { text: delta, thought: true } : { text: delta },
  ]);
}

function finishChunk(part: Record<string, unknown>): GenerateContentResponse {
  const usage = toUsageMetadata(
    part['usage'] as Parameters<typeof toUsageMetadata>[0],
  );
  const finishReason = toFinishReason(
    part['finishReason'] as Parameters<typeof toFinishReason>[0],
  );
  return {
    candidates: [
      {
        content: { role: 'model', parts: [] },
        ...(finishReason !== undefined ? { finishReason } : {}),
      },
    ],
    ...(usage !== undefined ? { usageMetadata: usage } : {}),
  };
}

function chunkFromParts(parts: Part[]): GenerateContentResponse {
  return { candidates: [{ content: { role: 'model', parts } }] };
}
