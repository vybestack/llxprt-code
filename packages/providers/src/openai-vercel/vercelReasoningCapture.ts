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
import { resolveReasoningField } from '../utils/reasoningField.js';
import {
  assertProviderStreamByteLimit,
  MAX_PROVIDER_REASONING_CAPTURE_BYTES,
  MAX_PROVIDER_SSE_LINE_BYTES,
  ProviderStreamProtocolError,
  exceedsUtf8ByteLimit,
  utf8ByteLength,
} from '../streamLimits.js';

/**
 * Buffer that accumulates reasoning chunks captured from the
 * raw SSE stream while Vercel AI SDK processes its own copy.
 *
 * The delta field name is configurable via captureBuffer.fieldName
 * (default: reasoning_content; auto-fallback to reasoning for Ollama).
 */
export interface CaptureBuffer {
  reasoningChunks: string[];
  reasoningBytes: number;
  finalized: boolean;
  headers?: Headers;
  parsePromise?: Promise<void>;
  /**
   * Failure from the detached parser, captured so the rejection is always
   * observed and can be re-surfaced by whoever awaits `parsePromise`.
   */
  parseError?: Error;
  fieldName?: string;
  actualFieldName?: string;
}

export function createCaptureBuffer(fieldName?: string): CaptureBuffer {
  return {
    reasoningChunks: [],
    reasoningBytes: 0,
    finalized: false,
    headers: undefined,
    parsePromise: undefined,
    parseError: undefined,
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

  const resolved = resolveReasoningField({
    fieldName: captureBuffer.fieldName,
    delta,
  });
  if (resolved !== undefined) {
    const reasoningBytes =
      captureBuffer.reasoningBytes + utf8ByteLength(resolved.value);
    assertProviderStreamByteLimit(
      'captured reasoning',
      reasoningBytes,
      MAX_PROVIDER_REASONING_CAPTURE_BYTES,
    );
    captureBuffer.reasoningBytes = reasoningBytes;
    captureBuffer.reasoningChunks.push(resolved.value);
    captureBuffer.actualFieldName = resolved.actualFieldName;
    logger.debug(
      () =>
        `[ReasoningCaptureFetch] Captured ${resolved.actualFieldName} chunk: ${resolved.value.length} chars`,
    );
  }
}

/**
 * Rejects any SSE line over the byte limit, complete lines included.
 *
 * Bounding only the trailing incomplete remainder is trivially bypassed by
 * appending a newline: the line then arrives complete and would go straight to
 * JSON.parse unmeasured.
 *
 * The cheap length pre-check comes first because the remainder is re-examined
 * on every read, so measuring it exactly each time would be O(n^2) in the
 * no-newline case the limit exists to catch.
 */
function assertSseLinesWithinLimit(
  lines: readonly string[],
  remainder: string,
): void {
  for (const candidate of [...lines, remainder]) {
    if (!exceedsUtf8ByteLimit(candidate, MAX_PROVIDER_SSE_LINE_BYTES)) {
      continue;
    }
    assertProviderStreamByteLimit(
      'SSE line',
      utf8ByteLength(candidate),
      MAX_PROVIDER_SSE_LINE_BYTES,
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
  signal?: AbortSignal,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  const cancelReader = (): void => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', cancelReader, { once: true });

  try {
    let streamDone = signal?.aborted === true;
    if (streamDone) {
      cancelReader();
    }
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done || signal?.aborted === true) {
        streamDone = true;
        continue;
      }

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE chunks (data: {...}\n\n)
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      assertSseLinesWithinLimit(lines, buffer);

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
    if (err instanceof ProviderStreamProtocolError) {
      throw err;
    }
    logger.debug(
      () =>
        `[ReasoningCaptureFetch] Stream parsing error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    signal?.removeEventListener('abort', cancelReader);
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
    // The parser runs detached from the SDK stream and can now reject (the
    // byte limits throw). Nothing guarantees the consumer reaches its `await`:
    // the SDK stream can throw first, the signal can abort, or the generator
    // can simply not be iterated to completion. An unobserved rejection is a
    // process-level crash, so the outcome is captured here and re-surfaced by
    // whoever awaits, rather than left to escape.
    captureBuffer.parsePromise = parseReasoningFromSseStream(
      parserStream.getReader(),
      captureBuffer,
      logger,
      init?.signal ?? undefined,
    ).catch((error: unknown) => {
      captureBuffer.parseError =
        error instanceof Error ? error : new Error(String(error));
      logger.debug(
        () =>
          `[vercel:reasoning] detached parser failed: ${captureBuffer.parseError?.message}`,
      );
    });

    return new Response(sdkStream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
