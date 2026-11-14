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

import type { DumpRequest } from '../utils/dumpContext.js';
import {
  readDumpAttemptContext,
  type DumpAttemptContext,
} from '../utils/dumpAttemptContext.js';
import type { DumpMode } from '../utils/dumpContext.js';
import {
  writeVercelDumpPair,
  type VercelDumpCapture,
} from './vercelDumpCapture.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { resolveReasoningField } from '../utils/reasoningField.js';
import {
  assertProviderStreamByteLimit,
  MAX_PROVIDER_REASONING_CAPTURE_BYTES,
  ProviderStreamProtocolError,
  assertSseLinesWithinLimit,
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
  events: unknown[];
  finishReason?: string;
  dumpCapture?: VercelDumpCapture;
  dumpMode?: DumpMode;
  attemptContext?: DumpAttemptContext;
  providerName?: string;
  status?: number;
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
    events: [],
  };
}
export function configureDumpCapture(
  captureBuffer: CaptureBuffer,
  options: {
    readonly invocation: {
      getEphemeral<T>(key: string): T | undefined;
    };
  },
  metadata: Readonly<Record<string, unknown>>,
): void {
  captureBuffer.dumpMode =
    options.invocation.getEphemeral<DumpMode>('dumpcontext');
  captureBuffer.attemptContext = readDumpAttemptContext(metadata);
}

async function captureVercelRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<DumpRequest> {
  const original = input instanceof Request ? input : undefined;
  const headers = new Headers(init?.headers ?? original?.headers);
  const headerRecord = Object.fromEntries(headers.entries());
  const rawBody =
    init?.body ?? (original ? await original.clone().text() : undefined);
  let body: unknown = rawBody;
  if (typeof rawBody === 'string') {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }
  }
  return {
    url: original?.url ?? String(input),
    method: init?.method ?? original?.method ?? 'GET',
    headers: headerRecord,
    ...(body === undefined ? {} : { body }),
    transport: { type: 'http' },
  };
}

function responseHeadersRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

/**
 * Parses a single SSE `data:` JSON line and extracts reasoning from
 * the configured delta field (default: reasoning_content).
 */
function readDelta(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  if (!('delta' in value)) return undefined;
  const delta = value.delta;
  if (typeof delta !== 'object' || delta === null || Array.isArray(delta))
    return undefined;
  return Object.fromEntries(Object.entries(delta));
}

function captureReasoningFromJson(
  jsonStr: string,
  captureBuffer: CaptureBuffer,
  logger: DebugLogger,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return;
  if (captureBuffer.dumpMode === 'on' || captureBuffer.dumpMode === 'error')
    captureBuffer.events.push(parsed);
  if (!('choices' in parsed) || !Array.isArray(parsed.choices)) return;
  for (const choice of parsed.choices) {
    if (typeof choice !== 'object' || choice === null) continue;
    if ('finish_reason' in choice && typeof choice.finish_reason === 'string')
      captureBuffer.finishReason = choice.finish_reason;
  }
  const delta = readDelta(parsed.choices[0]);
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
function captureSseLine(
  line: string,
  captureBuffer: CaptureBuffer,
  logger: DebugLogger,
): void {
  if (!line.startsWith('data: ')) return;
  const jsonStr = line.slice(6).trim();
  if (jsonStr === '[DONE]') {
    if (captureBuffer.dumpMode === 'on' || captureBuffer.dumpMode === 'error')
      captureBuffer.events.push('[DONE]');
    return;
  }
  captureReasoningFromJson(jsonStr, captureBuffer, logger);
}

function captureSseLines(
  lines: readonly string[],
  captureBuffer: CaptureBuffer,
  logger: DebugLogger,
): void {
  for (const line of lines) captureSseLine(line, captureBuffer, logger);
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

      captureSseLines(lines, captureBuffer, logger);
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
    // Order matters. `finalized` is set first so a consumer waiting on it is
    // released even if a cleanup step throws.
    captureBuffer.finalized = true;
    signal?.removeEventListener('abort', cancelReader);
    // Cancel before releasing the lock. This reader owns one branch of a tee;
    // merely releasing it leaves the branch live, so as the SDK drains the
    // other branch the tee keeps queueing every chunk for this abandoned one.
    // On the byte-limit path that would retain the whole rest of the response,
    // which is the opposite of what the limit is for.
    // Start the cancellation but do not await it. `cancel()` on a tee branch
    // can stay pending while the sibling branch is still open, and the SDK may
    // leave `sdkStream` open after an abort. Awaiting here would keep
    // `parsePromise` pending and hang `vercelStreamHandler`, which awaits it:
    // a leak traded for a deadlock. Releasing the lock is what matters
    // synchronously; the cancellation lands whenever the tee lets it.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
    if (captureBuffer.dumpCapture !== undefined) {
      await writeVercelDumpPair(
        captureBuffer.dumpCapture,
        {
          status: captureBuffer.status ?? 200,
          headers: responseHeadersRecord(
            captureBuffer.headers ?? new Headers(),
          ),
          body: { streaming: true, events: captureBuffer.events },
        },
        captureBuffer.finishReason,
      );
    }
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
  requestFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    captureBuffer.events.length = 0;
    captureBuffer.finishReason = undefined;
    const shouldCaptureDump =
      captureBuffer.dumpMode === 'on' || captureBuffer.dumpMode === 'error';
    const request = shouldCaptureDump
      ? await captureVercelRequest(input, init)
      : undefined;
    const response = await requestFetch(input, init);

    captureBuffer.headers = response.headers;
    captureBuffer.status = response.status;
    if (request !== undefined && captureBuffer.dumpMode !== undefined) {
      captureBuffer.dumpCapture = {
        mode: captureBuffer.dumpMode,
        ...(captureBuffer.attemptContext === undefined
          ? {}
          : { attemptContext: captureBuffer.attemptContext }),
        request,
        providerName: captureBuffer.providerName ?? 'openaivercel',
        responseHeaders: responseHeadersRecord(response.headers),
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream') || !response.body) {
      if (captureBuffer.dumpCapture !== undefined) {
        const bodyText = await response.clone().text();
        let body: unknown = bodyText;
        try {
          body = JSON.parse(bodyText);
          captureReasoningFromJson(bodyText, captureBuffer, logger);
        } catch {
          captureBuffer.events.push(bodyText);
        }
        await writeVercelDumpPair(
          captureBuffer.dumpCapture,
          {
            status: response.status,
            headers: responseHeadersRecord(response.headers),
            body,
          },
          captureBuffer.finishReason,
        );
      }
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
