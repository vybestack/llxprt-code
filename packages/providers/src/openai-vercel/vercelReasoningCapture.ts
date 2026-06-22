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
 * Buffer that accumulates reasoning_content chunks captured from the
 * raw SSE stream while Vercel AI SDK processes its own copy.
 */
export interface CaptureBuffer {
  reasoningChunks: string[];
  finalized: boolean;
  headers?: Headers;
  parsePromise?: Promise<void>;
}

export function createCaptureBuffer(): CaptureBuffer {
  return {
    reasoningChunks: [],
    finalized: false,
    headers: undefined,
    parsePromise: undefined,
  };
}

/**
 * Parses a single SSE `data:` JSON line and extracts reasoning_content.
 */
function captureReasoningFromJson(
  jsonStr: string,
  captureBuffer: CaptureBuffer,
  logger: DebugLogger,
): void {
  let parsed: {
    choices?: Array<{ delta?: { reasoning_content?: string } }>;
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
  const reasoningContent = parsed.choices[0]?.delta?.reasoning_content;
  if (reasoningContent && typeof reasoningContent === 'string') {
    captureBuffer.reasoningChunks.push(reasoningContent);
    logger.debug(
      () =>
        `[ReasoningCaptureFetch] Captured reasoning_content chunk: ${reasoningContent.length} chars`,
    );
  }
}

/**
 * Parses an SSE stream reader to extract reasoning_content from chunks.
 * Runs in the background while the SDK processes the other tee'd stream.
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
 * and extracts reasoning_content from SSE chunks.
 *
 * This is necessary because Vercel AI SDK doesn't expose reasoning_content
 * from the OpenAI-compatible API response. Kimi K2 and similar models
 * send reasoning via this field.
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
