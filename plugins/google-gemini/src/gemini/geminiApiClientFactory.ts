/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { GoogleAuth } from 'google-auth-library';
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider';
import { StreamTruncatedError } from '@vybestack/llxprt-code-providers/streamProtocolErrors.js';
import { createPatternPreservingFetch } from './gemini-pattern-fetch.js';
import { createStreamedGeminiFetch } from './streamed-request.js';
import {
  toCallOptions,
  normaliseContents,
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
/**
 * Adapt an llxprt base URL to what `@ai-sdk/google` expects.
 *
 * llxprt carries the bare origin (`https://generativelanguage.googleapis.com`)
 * because `@google/genai` appended the API version itself. The AI SDK does not:
 * its default is `<origin>/v1beta` and it joins the model path straight onto
 * whatever it is given, so passing the bare origin produces
 * `<origin>/models/...` and a 404.
 */
function toAiSdkBaseUrl(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) {
    return undefined;
  }
  let trimmed = baseUrl;
  while (trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }
  const lastSegment = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  const alreadyVersioned = lastSegment.startsWith('v1');
  return alreadyVersioned ? trimmed : `${trimmed}/v1beta`;
}

export async function createGeminiApiClient(
  options: GeminiApiClientOptions,
): Promise<GeminiApiClient> {
  if (options.vertexai && (!options.project || !options.location))
    throw new Error('Vertex AI requires explicit project and location');
  const baseURL = toAiSdkBaseUrl(options.httpOptions?.baseUrl);
  const googleAuth = options.vertexai
    ? new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        ...options.googleAuthOptions,
      })
    : undefined;
  const modelFor = async (
    params: GenerateContentParameters,
    tools: LanguageModelV4CallOptions['tools'],
  ): Promise<LanguageModelV4> => {
    const transport = createPatternPreservingFetch(
      tools,
      undefined,
      createStreamedGeminiFetch(
        options.requestContents ??
          async function* () {
            yield* normaliseContents(params.contents);
          },
        params.model,
        typeof params['systemInstruction'] === 'string'
          ? params['systemInstruction']
          : undefined,
        options.onRequestBytes,
        options.requestMetadata,
      ),
    );
    if (googleAuth !== undefined) {
      const authClient = await googleAuth.getClient();
      const headers = { ...options.httpOptions?.headers };
      if (
        authClient.quotaProjectId &&
        !Object.keys(headers).some(
          (name) => name.toLowerCase() === 'x-goog-user-project',
        )
      )
        headers['x-goog-user-project'] = authClient.quotaProjectId;
      return createVertex({
        apiKey: '',
        project: options.project,
        location: options.location,
        baseURL: options.httpOptions?.baseUrl,
        headers,
        googleAuthOptions: { authClient },
        fetch: transport,
      }).languageModel(params.model);
    }
    return createGoogleGenerativeAI({
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      ...(baseURL !== undefined ? { baseURL } : {}),
      ...(options.httpOptions?.headers !== undefined
        ? { headers: options.httpOptions.headers }
        : {}),
      fetch: transport,
    }).languageModel(params.model);
  };

  return {
    models: {
      async generateContent(
        params: GenerateContentParameters,
      ): Promise<GenerateContentResponse> {
        const callOptions = toCallOptions({ ...params, contents: [] });
        const model = await modelFor(params, callOptions.tools);
        const result = await model.doGenerate(callOptions);
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
        const callOptions = toCallOptions({ ...params, contents: [] });
        const model = await modelFor(params, callOptions.tools);
        const { stream } = await model.doStream(callOptions);
        return streamToGeminiChunks(stream);
      },
    },
  };
}

/**
 * Reprojects the AI SDK part stream into Gemini response chunks.
 *
 * Text, reasoning, and tool arguments retain their SDK arrival boundaries.
 * Only active tool names are kept here; the SDK owns argument assembly.
 */
async function* streamToGeminiChunks(
  stream: ReadableStream<LanguageModelV4StreamPart>,
): AsyncIterable<GenerateContentResponse> {
  const reader = stream.getReader();
  const activeTools = new Map<string, string>();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        if (activeTools.size > 0)
          throw new StreamTruncatedError(
            'Gemini ended without a completed tool call',
          );
        return;
      }
      const chunk = streamPartToChunk(value, activeTools);
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
  part: LanguageModelV4StreamPart,
  activeTools: Map<string, string>,
): GenerateContentResponse | undefined {
  switch (part.type) {
    case 'text-delta':
      return textDeltaChunk(part.delta, false);
    case 'reasoning-delta':
      return textDeltaChunk(part.delta, true);
    case 'tool-input-start':
      activeTools.set(part.id, part.toolName);
      return undefined;
    case 'tool-input-delta': {
      const name = activeTools.get(part.id);
      if (name === undefined) throw new Error('Gemini tool delta has no start');
      return {
        toolArgumentDelta: {
          sourceId: part.id,
          id: part.id,
          name,
          arguments: part.delta,
        },
      };
    }
    case 'tool-call': {
      const started = activeTools.delete(part.toolCallId);
      const parts = toParts([part]);
      const chunk = chunkFromParts(parts);
      if (started)
        chunk.toolArgumentDelta = {
          sourceId: part.toolCallId,
          id: part.toolCallId,
          name: part.toolName,
          arguments: '',
          complete: true,
          replacementArguments: JSON.stringify(
            parts[0]?.functionCall?.args ?? {},
          ),
        };
      return chunk;
    }
    case 'error':
      throw part.error;
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
