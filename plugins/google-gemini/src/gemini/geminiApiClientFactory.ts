/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
} from '@ai-sdk/provider';
import type { AuthClient } from 'google-auth-library';
import { createPatternPreservingFetch } from './gemini-pattern-fetch.js';
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
import { selectGoogleCredentialClient } from './vertexCredentialSource.js';

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

/**
 * The Vertex adapter reads only the access token from the auth client, so the
 * quota project header the library adds in `getRequestHeaders` never reaches
 * the model request. An explicit header, in any letter case, takes precedence.
 */
function withQuotaProjectHeader(
  quotaProjectId: string | null | undefined,
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!quotaProjectId) {
    return headers;
  }
  const explicit = Object.keys(headers ?? {}).some(
    (name) => name.toLowerCase() === 'x-goog-user-project',
  );
  if (explicit) {
    return headers;
  }
  return { 'x-goog-user-project': quotaProjectId, ...headers };
}

export async function createGeminiApiClient(
  options: GeminiApiClientOptions,
): Promise<GeminiApiClient> {
  if (options.vertexai && (!options.project || !options.location)) {
    throw new Error('Vertex AI requires explicit project and location');
  }
  const baseURL = toAiSdkBaseUrl(options.httpOptions?.baseUrl);
  let selectedCredential: Promise<AuthClient> | undefined;
  const credentialClient = (): Promise<AuthClient> => {
    const { credentialEnvironment } = options;
    if (credentialEnvironment === undefined) {
      throw new Error('Vertex AI requires a Google credential environment');
    }
    selectedCredential ??= selectGoogleCredentialClient({
      fetch: options.fetch,
      credentials: options.credentials,
      environment: credentialEnvironment,
    }).catch((error: unknown) => {
      selectedCredential = undefined;
      throw error;
    });
    return selectedCredential;
  };
  const modelFor = async (
    params: GenerateContentParameters,
    tools: LanguageModelV4CallOptions['tools'],
  ) => {
    const transport = createPatternPreservingFetch(tools, options.fetch);
    if (options.vertexai) {
      const authClient = await credentialClient();
      return createVertex({
        apiKey: '',
        project: options.project,
        location: options.location,
        baseURL: options.httpOptions?.baseUrl,
        headers: withQuotaProjectHeader(
          authClient.quotaProjectId,
          options.httpOptions?.headers,
        ),
        googleAuthOptions: { authClient },
        fetch: transport,
      }).languageModel(params.model);
    }
    return createGoogleGenerativeAI({
      apiKey: options.apiKey ?? '',
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
        const callOptions = toCallOptions(params);
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
        const callOptions = toCallOptions(params);
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
