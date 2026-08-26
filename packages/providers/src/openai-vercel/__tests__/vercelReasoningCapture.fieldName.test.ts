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
 *
 * @issue #2488 — Configurable reasoning field name for Ollama (delta.reasoning)
 */

import { describe, it, expect } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  createCaptureBuffer,
  createReasoningCaptureFetch,
  parseReasoningFromSseStream,
} from '../vercelReasoningCapture.js';
import {
  MAX_PROVIDER_REASONING_CAPTURE_BYTES,
  MAX_PROVIDER_SSE_LINE_BYTES,
  ProviderStreamProtocolError,
} from '../../streamLimits.js';

const logger = new DebugLogger('llxprt:test:reasoning-capture');

function createSseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.join('\n\n') + '\n\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      controller.close();
    },
  });
}

describe('parseReasoningFromSseStream — configurable field name (#2488)', () => {
  it('captures reasoning_content with default fieldName', async () => {
    const captureBuffer = createCaptureBuffer();
    const sseData = [
      'data: {"choices":[{"delta":{"reasoning_content":"hello world"}}]}',
    ];
    const stream = createSseStream(sseData);

    await parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    expect(captureBuffer.reasoningChunks).toStrictEqual(['hello world']);
  });

  it('auto-fallbacks to reasoning field with default fieldName (Ollama)', async () => {
    const captureBuffer = createCaptureBuffer();
    const sseData = [
      'data: {"choices":[{"delta":{"reasoning":"ollama thinking"}}]}',
    ];
    const stream = createSseStream(sseData);

    await parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    expect(captureBuffer.reasoningChunks).toStrictEqual(['ollama thinking']);
    expect(captureBuffer.actualFieldName).toBe('reasoning');
  });

  it('records actualFieldName as reasoning_content for standard field', async () => {
    const captureBuffer = createCaptureBuffer();
    const sseData = [
      'data: {"choices":[{"delta":{"reasoning_content":"standard"}}]}',
    ];
    const stream = createSseStream(sseData);

    await parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    expect(captureBuffer.actualFieldName).toBe('reasoning_content');
  });

  it('captures reasoning only when fieldName is explicitly "reasoning"', async () => {
    const captureBuffer = createCaptureBuffer('reasoning');
    const sseData = [
      'data: {"choices":[{"delta":{"reasoning":"explicit field"}}]}',
    ];
    const stream = createSseStream(sseData);

    await parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    expect(captureBuffer.reasoningChunks).toStrictEqual(['explicit field']);
  });

  it('does NOT capture reasoning_content when fieldName is explicitly "reasoning"', async () => {
    const captureBuffer = createCaptureBuffer('reasoning');
    const sseData = [
      'data: {"choices":[{"delta":{"reasoning_content":"should be ignored"}}]}',
    ];
    const stream = createSseStream(sseData);

    await parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    expect(captureBuffer.reasoningChunks).toStrictEqual([]);
  });

  it('does NOT auto-fallback when fieldName is explicitly "reasoning_content"', async () => {
    const captureBuffer = createCaptureBuffer('reasoning_content');
    const sseData = [
      'data: {"choices":[{"delta":{"reasoning":"should be ignored"}}]}',
    ];
    const stream = createSseStream(sseData);

    await parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    expect(captureBuffer.reasoningChunks).toStrictEqual([]);
  });

  it('falls back to delta.reasoning when reasoning_content is an empty string (unified policy, #2524)', async () => {
    const captureBuffer = createCaptureBuffer();
    const sseData = [
      'data: {"choices":[{"delta":{"reasoning_content":"","reasoning":"fallback reasoning"}}]}',
    ];
    const stream = createSseStream(sseData);

    await parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    expect(captureBuffer.reasoningChunks).toStrictEqual(['fallback reasoning']);
    expect(captureBuffer.actualFieldName).toBe('reasoning');
  });

  it('falls back to delta.reasoning when reasoning_content is a non-string object (unified policy, #2524)', async () => {
    const captureBuffer = createCaptureBuffer();
    const sseData = [
      'data: {"choices":[{"delta":{"reasoning_content":{"malformed":true},"reasoning":"fallback reasoning"}}]}',
    ];
    const stream = createSseStream(sseData);

    await parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    expect(captureBuffer.reasoningChunks).toStrictEqual(['fallback reasoning']);
    expect(captureBuffer.actualFieldName).toBe('reasoning');
  });

  it('treats empty-string field name as unset (uses default field, #2524)', async () => {
    const captureBuffer = createCaptureBuffer('');
    const sseData = [
      'data: {"choices":[{"delta":{"reasoning_content":"standard reasoning"}}]}',
    ];
    const stream = createSseStream(sseData);

    await parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    expect(captureBuffer.reasoningChunks).toStrictEqual(['standard reasoning']);
    expect(captureBuffer.actualFieldName).toBe('reasoning_content');
  });

  it('preserves whitespace-only reasoning_content as usable (no fallback, #721/#2524)', async () => {
    const whitespace = '  \n\t  ';
    const captureBuffer = createCaptureBuffer();
    const sseData = [
      'data: ' +
        JSON.stringify({
          choices: [
            { delta: { reasoning_content: whitespace, reasoning: 'fallback' } },
          ],
        }),
    ];
    const stream = createSseStream(sseData);

    await parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    expect(captureBuffer.reasoningChunks).toStrictEqual([whitespace]);
    expect(captureBuffer.actualFieldName).toBe('reasoning_content');
  });

  it('rejects an oversized incomplete SSE line with a typed protocol error', async () => {
    const captureBuffer = createCaptureBuffer();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('x'.repeat(MAX_PROVIDER_SSE_LINE_BYTES + 1)),
        );
        controller.close();
      },
    });

    const result = parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    await expect(result).rejects.toBeInstanceOf(ProviderStreamProtocolError);
    await expect(result).rejects.toThrow(
      `SSE line exceeded ${MAX_PROVIDER_SSE_LINE_BYTES}-byte limit`,
    );
  });

  it('rejects an oversized COMPLETE SSE line, not just an incomplete one', async () => {
    // Bounding only the trailing incomplete remainder is bypassed by appending
    // a newline: the line then arrives complete and would go straight to
    // JSON.parse unmeasured. The only difference from the test above is the
    // terminating newline, and it must still be rejected.
    const captureBuffer = createCaptureBuffer();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${'x'.repeat(MAX_PROVIDER_SSE_LINE_BYTES + 1)}\n`,
          ),
        );
        controller.close();
      },
    });

    const result = parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    await expect(result).rejects.toBeInstanceOf(ProviderStreamProtocolError);
  });

  it('rejects retained reasoning that exceeds its byte limit', async () => {
    const captureBuffer = createCaptureBuffer();
    const fragment = 'x'.repeat(1024 * 1024);
    const chunkCount =
      Math.floor(MAX_PROVIDER_REASONING_CAPTURE_BYTES / fragment.length) + 1;
    const stream = createSseStream(
      Array.from(
        { length: chunkCount },
        () =>
          'data: ' +
          JSON.stringify({
            choices: [{ delta: { reasoning_content: fragment } }],
          }),
      ),
    );

    const result = parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    await expect(result).rejects.toBeInstanceOf(ProviderStreamProtocolError);
    await expect(result).rejects.toThrow(
      `captured reasoning exceeded ${MAX_PROVIDER_REASONING_CAPTURE_BYTES}-byte limit`,
    );
  });

  it('preserves large legitimate reasoning byte-for-byte', async () => {
    const captureBuffer = createCaptureBuffer();
    const reasoning = 'ø'.repeat(512 * 1024);
    const stream = createSseStream([
      'data: ' +
        JSON.stringify({
          choices: [{ delta: { reasoning_content: reasoning } }],
        }),
    ]);

    await parseReasoningFromSseStream(
      stream.getReader(),
      captureBuffer,
      logger,
    );

    expect(captureBuffer.reasoningChunks.join('')).toBe(reasoning);
  });

  it('stops the detached parser when the request signal aborts', async () => {
    const originalFetch = globalThis.fetch;
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"reasoning_content":"started"}}]}\n',
            ),
          );
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    globalThis.fetch = async (): Promise<Response> => response;
    const captureBuffer = createCaptureBuffer();
    const captureFetch = createReasoningCaptureFetch(captureBuffer, logger);
    const controller = new AbortController();

    let interceptedResponse: Response | undefined;
    try {
      interceptedResponse = await captureFetch('https://example.test/stream', {
        signal: controller.signal,
      });
      controller.abort();
      const parsePromise = captureBuffer.parsePromise;
      expect(parsePromise).toBeDefined();
      const outcome = await Promise.race([
        parsePromise?.then(() => 'stopped' as const),
        new Promise<'still-reading'>((resolve) => {
          setTimeout(() => resolve('still-reading'), 50);
        }),
      ]);

      expect(outcome).toBe('stopped');
    } finally {
      await interceptedResponse?.body?.cancel();
      globalThis.fetch = originalFetch;
    }
  });
});
