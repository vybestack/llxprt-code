/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

/**
 * Buffer that accumulates reasoning chunks captured from the
 * raw SSE stream while Vercel AI SDK processes its own copy.
 *
 * The delta field name is configurable via captureBuffer.fieldName
 * (default: reasoning_content; auto-fallback to reasoning for Ollama).
 */
export interface CaptureBuffer {
  reasoningChunks: string[];
  finalized: boolean;
  headers?: Headers;
  parsePromise?: Promise<void>;
  fieldName?: string;
  actualFieldName?: string;
}

export function createCaptureBuffer(fieldName?: string): CaptureBuffer {
  return {
    reasoningChunks: [],
    finalized: false,
    headers: undefined,
    parsePromise: undefined,
    fieldName,
  };
}

/**
 * Parses a single SSE `data:` JSON line and extracts reasoning from
 * the configured delta field (default: reasoning_content).
 */
function captureReasoningFromJson(
  jsonStr: string,
  captureBuffer: CaptureBuffer,
  logger: DebugLogger,
): void {
  let parsed: {
    choices?: Array<{ delta?: Record<string, unknown> }>;
  };
  try {
    parsed = JSON.parse(jsonStr) as typeof parsed;
  } catch {
    // Ignore JSON parse errors (malformed chunks)
    return;
  }

  if (parsed.choices === undefined || parsed.choices.length === 0) {
    return;
  }
  const delta = parsed.choices[0]?.delta;
  if (delta === undefined) return;

  const fieldName = captureBuffer.fieldName ?? 'reasoning_content';
  let actualFieldName = fieldName;
  let reasoningContent: unknown = delta[fieldName];

  // Auto-fallback: when fieldName was not explicitly set (undefined), also
  // check 'reasoning' for Ollama compatibility (issue #2488)
  if (
    (reasoningContent === undefined || reasoningContent === null) &&
    captureBuffer.fieldName === undefined
  ) {
    reasoningContent = delta['reasoning'];
    actualFieldName = 'reasoning';
  }

  if (typeof reasoningContent === 'string' && reasoningContent !== '') {
    captureBuffer.reasoningChunks.push(reasoningContent);
    captureBuffer.actualFieldName = actualFieldName;
    logger.debug(
      () =>
        `[ReasoningCaptureFetch] Captured ${actualFieldName} chunk: ${reasoningContent.length} chars`,
    );
  }
}

/**
 * Parses an SSE stream reader to extract reasoning from chunks using the
 * configured field name. Runs in the background while the SDK processes
 * the other tee'd stream.
 */
export async function parseReasoningFromSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  captureBuffer: CaptureBuffer,
  logger: DebugLogger,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    let streamDone = false;
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) {
        captureBuffer.finalized = true;
        streamDone = true;
        continue;
      }

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE chunks (data: {...}\n\n)
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      const dataLines = lines.filter(
        (line) =>
          line.startsWith('data: ') && line.slice(6).trim() !== '[DONE]',
      );
      for (const line of dataLines) {
        const jsonStr = line.slice(6).trim();
        captureReasoningFromJson(jsonStr, captureBuffer, logger);
      }
    }
  } catch (err) {
    logger.debug(
      () =>
        `[ReasoningCaptureFetch] Stream parsing error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    reader.releaseLock();
    captureBuffer.finalized = true;
  }
}

/**
 * Creates a custom fetch function that intercepts streaming responses
 * and extracts reasoning from SSE chunks using the configured field name.
 *
 * This is necessary because Vercel AI SDK doesn't expose reasoning
 * from the OpenAI-compatible API response. Models like Kimi K2 send
 * reasoning via the reasoning_content field; Ollama uses reasoning.
 */
export function createReasoningCaptureFetch(
  captureBuffer: CaptureBuffer,
  logger: DebugLogger,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);

    captureBuffer.headers = response.headers;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream') || !response.body) {
      return response;
    }

    const [parserStream, sdkStream] = response.body.tee();
    captureBuffer.parsePromise = parseReasoningFromSseStream(
      parserStream.getReader(),
      captureBuffer,
      logger,
    );

    return new Response(sdkStream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
