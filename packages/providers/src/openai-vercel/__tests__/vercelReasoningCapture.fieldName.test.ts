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

import { describe, it, expect } from 'vitest';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  createCaptureBuffer,
  parseReasoningFromSseStream,
} from '../vercelReasoningCapture.js';

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
});
