/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { GenerateImageTool } from './GenerateImageTool.js';
import { ToolErrorType } from '../../types/tool-error.js';
import type {
  GenerateImageToolParams,
  ImageGenerationBackendLike,
} from './GenerateImageTool.js';

/**
 * A real stub backend implementing the structural ImageGenerationBackendLike
 * contract. This is infrastructure — the tool itself is never mocked.
 */
interface StubBackendState {
  readonly generateCalls: Array<{
    readonly request: GenerateImageToolParams;
    readonly signalAborted: boolean;
  }>;
}

function makeStubBackend(
  result: {
    mimeType: string;
    encoding: 'base64' | 'url';
    data: string;
    caption?: string;
  },
  options: { throwOnGenerate?: Error } = {},
): { backend: ImageGenerationBackendLike; state: StubBackendState } {
  const state: StubBackendState = { generateCalls: [] };
  const backend: ImageGenerationBackendLike = {
    name: 'stub-image-backend',
    async generate(request, signal) {
      state.generateCalls.push({
        request,
        signalAborted: signal.aborted,
      });
      if (options.throwOnGenerate) {
        throw options.throwOnGenerate;
      }
      return result;
    },
  };
  return { backend, state };
}

describe('GenerateImageTool', () => {
  it('exposes the static name "generate_image"', () => {
    expect(GenerateImageTool.Name).toBe('generate_image');
  });

  describe('A6 — valid prompt yields an image content part plus a text hint', () => {
    it('returns llmContent with an inlineData image/png base64 part and a text part', async () => {
      const { backend, state } = makeStubBackend({
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'aGVsbG8=',
        caption: 'a cat',
      });
      const tool = new GenerateImageTool({ resolveBackend: () => backend });

      const invocation = tool.build({
        prompt: 'a cat wearing a tiny hat',
      });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(Array.isArray(result.llmContent)).toBe(true);
      const parts = result.llmContent as unknown[];
      expect(parts.length).toBeGreaterThanOrEqual(2);

      const inlinePart = parts.find(
        (p): p is { inlineData?: { mimeType?: string; data?: string } } =>
          typeof p === 'object' &&
          p !== null &&
          'inlineData' in p &&
          p.inlineData !== undefined,
      );
      expect(inlinePart).toBeDefined();
      expect(inlinePart?.inlineData?.mimeType).toBe('image/png');
      expect(inlinePart?.inlineData?.data).toBe('aGVsbG8=');

      const textPart = parts.find((p): p is string => typeof p === 'string');
      expect(textPart).toBeDefined();
      expect(textPart).toMatch(/image/i);

      expect(state.generateCalls).toHaveLength(1);
      expect(state.generateCalls[0]?.request.prompt).toBe(
        'a cat wearing a tiny hat',
      );
    });
  });

  describe('A8 — no backend resolved', () => {
    it('returns a TOOL_DISABLED error and never calls the backend', async () => {
      const { backend, state } = makeStubBackend({
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'aGVsbG8=',
      });
      // The resolver returns null even though a backend exists, proving the
      // tool short-circuits before any generate call.
      const tool = new GenerateImageTool({
        resolveBackend: () => null,
      });

      const invocation = tool.build({ prompt: 'a dog' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.TOOL_DISABLED);
      expect(state.generateCalls).toHaveLength(0);
      void backend;
    });
  });

  describe('abort propagation', () => {
    it('forwards the abort signal to the backend and maps abort to TIMEOUT', async () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      const { backend, state } = makeStubBackend(
        {
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'aGVsbG8=',
        },
        { throwOnGenerate: abortError },
      );
      const tool = new GenerateImageTool({ resolveBackend: () => backend });
      const controller = new AbortController();
      controller.abort();

      const result = await tool
        .build({ prompt: 'a sunset' })
        .execute(controller.signal);

      expect(state.generateCalls).toHaveLength(1);
      expect(state.generateCalls[0]?.signalAborted).toBe(true);
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.TIMEOUT);
    });
  });

  describe('n > 1 rejection', () => {
    it('rejects n > 1 with INVALID_TOOL_PARAMS before calling the backend', async () => {
      const { backend, state } = makeStubBackend({
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'aGVsbG8=',
      });
      const tool = new GenerateImageTool({ resolveBackend: () => backend });

      const result = await tool
        .build({ prompt: 'a sunset', n: 3 })
        .execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(state.generateCalls).toHaveLength(0);
    });
  });

  describe('generic backend error mapping', () => {
    it('maps a generic backend Error to EXECUTION_FAILED', async () => {
      const { backend } = makeStubBackend(
        {
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'aGVsbG8=',
        },
        { throwOnGenerate: new Error('network failure') },
      );
      const tool = new GenerateImageTool({ resolveBackend: () => backend });

      const result = await tool
        .build({ prompt: 'a sunset' })
        .execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.error?.message).toContain('network failure');
    });
  });
});
