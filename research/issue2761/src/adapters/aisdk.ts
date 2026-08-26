/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `@ai-sdk/google` side of every probe.
 *
 * Probes target the low-level `LanguageModelV2` interface (`doGenerate` /
 * `doStream`) rather than the `ai` package's `generateText` / `streamText`
 * helpers. A provider adapter inside llxprt would sit at exactly that
 * boundary, and probing there also establishes whether the `ai` package would
 * be needed at all.
 */

import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from '@ai-sdk/google';
import type {
  LanguageModelV2,
  LanguageModelV2Content,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider';

import { llxprtUserAgent } from './genai.ts';

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface AISDKClientOptions {
  readonly baseURL?: string;
  readonly headers?: Record<string, string>;
  readonly fetch?: FetchLike;
}

export function createAISDK(
  apiKey: string,
  options: AISDKClientOptions = {},
): GoogleGenerativeAIProvider {
  return createGoogleGenerativeAI({
    apiKey,
    headers: {
      'User-Agent': llxprtUserAgent(),
      ...(options.headers ?? {}),
    },
    ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
    ...(options.fetch !== undefined
      ? { fetch: options.fetch as NonNullable<Parameters<typeof createGoogleGenerativeAI>[0]>['fetch'] }
      : {}),
  });
}

export function languageModel(
  provider: GoogleGenerativeAIProvider,
  modelId: string,
): LanguageModelV2 {
  return provider.languageModel(modelId);
}

/** Collapses `doStream` output into an inspectable list of parts. */
export async function drainStream(
  stream: ReadableStream<LanguageModelV2StreamPart>,
): Promise<LanguageModelV2StreamPart[]> {
  const parts: LanguageModelV2StreamPart[] = [];
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return parts;
}

/** Summarizes `doGenerate` content parts without dumping whole payloads. */
export function summarizeContent(
  content: readonly LanguageModelV2Content[],
): Array<Record<string, unknown>> {
  return content.map((part) => {
    switch (part.type) {
      case 'text':
        return {
          type: 'text',
          length: part.text.length,
          preview: part.text.slice(0, 160),
          providerMetadata: part.providerMetadata,
        };
      case 'reasoning':
        return {
          type: 'reasoning',
          length: part.text.length,
          preview: part.text.slice(0, 160),
          providerMetadata: part.providerMetadata,
        };
      case 'tool-call':
        return {
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
          providerExecuted: part.providerExecuted,
          providerMetadata: part.providerMetadata,
        };
      case 'tool-result':
        return {
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result: part.result,
          providerMetadata: part.providerMetadata,
        };
      case 'file':
        return {
          type: 'file',
          mediaType: part.mediaType,
          dataKind: typeof part.data === 'string' ? 'base64' : 'binary',
        };
      case 'source':
        return { type: 'source', source: part };
      default:
        return { type: (part as { type: string }).type, raw: part };
    }
  });
}

/** Summarizes stream parts, keeping deltas short. */
export function summarizeStreamParts(
  parts: readonly LanguageModelV2StreamPart[],
): Array<Record<string, unknown>> {
  return parts.map((part) => {
    if (part.type === 'text-delta') {
      return { type: part.type, id: part.id, deltaLength: part.delta.length };
    }
    if (part.type === 'reasoning-delta') {
      return {
        type: part.type,
        id: part.id,
        deltaLength: part.delta.length,
        providerMetadata: part.providerMetadata,
      };
    }
    return part as unknown as Record<string, unknown>;
  });
}
