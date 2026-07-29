/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { GenerateImageTool } from './GenerateImageTool.js';
import { ToolErrorType } from '../../types/tool-error.js';
import type {
  GenerateImageToolParams,
  ImageGenerationBackendLike,
} from './GenerateImageTool.js';

const STUB_SAVED_PATH = '/workspace/generated-images/image-stub.png';

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

interface StubPersistState {
  readonly persistCalls: Array<{
    readonly result: {
      readonly mimeType: string;
      readonly encoding: string;
      readonly data: string;
      readonly caption?: string;
    };
  }>;
}

function makeStubPersist(
  options: {
    returnedPath?: string;
    throwOnPersist?: Error;
  } = {},
): {
  persist: (result: {
    mimeType: string;
    encoding: string;
    data: string;
    caption?: string;
  }) => Promise<string>;
  persistState: StubPersistState;
} {
  const persistState: StubPersistState = { persistCalls: [] };
  const returnedPath = options.returnedPath ?? STUB_SAVED_PATH;
  const persist = async (result: {
    mimeType: string;
    encoding: string;
    data: string;
    caption?: string;
  }): Promise<string> => {
    persistState.persistCalls.push({ result });
    if (options.throwOnPersist) {
      throw options.throwOnPersist;
    }
    return returnedPath;
  };
  return { persist, persistState };
}

/**
 * Compose a GenerateImageTool with a real stub backend and a real stub
 * persistence dependency. Every success-path test MUST go through here so
 * there is no way to construct a tool that can succeed without persistence.
 */
function makeToolWithPersistence(
  backendResult: {
    mimeType: string;
    encoding: 'base64' | 'url';
    data: string;
    caption?: string;
  } = {
    mimeType: 'image/png',
    encoding: 'base64',
    data: 'aGVsbG8=',
    caption: 'a cat',
  },
  options: {
    backendThrows?: Error;
    persistThrows?: Error;
    persistPath?: string;
  } = {},
): {
  tool: GenerateImageTool;
  backendState: StubBackendState;
  persistState: StubPersistState;
} {
  const { backend, state } = makeStubBackend(backendResult, {
    throwOnGenerate: options.backendThrows,
  });
  const { persist, persistState } = makeStubPersist({
    returnedPath: options.persistPath,
    throwOnPersist: options.persistThrows,
  });
  const tool = new GenerateImageTool({
    resolveBackend: () => backend,
    persistImageResult: persist,
  });
  return { tool, backendState: state, persistState };
}

describe('GenerateImageTool', () => {
  it('exposes the static name "generate_image"', () => {
    expect(GenerateImageTool.Name).toBe('generate_image');
  });

  it('does not expose a "model" property in its JSON schema (callers cannot override the backend model)', () => {
    // The schema is constructed eagerly in the constructor; introspecting it
    // proves the model-override attack surface is removed at the contract
    // boundary, not just at the forwarding site.
    const { tool } = makeToolWithPersistence();
    const schema = tool.schema.parametersJsonSchema as {
      properties?: Record<string, unknown>;
    };
    expect(schema.properties).toBeDefined();
    expect(schema.properties).not.toHaveProperty('model');
  });

  describe('A6 — valid prompt yields an image content part plus a text hint', () => {
    it('returns llmContent with an inlineData image/png base64 part and a text part', async () => {
      const { tool, backendState } = makeToolWithPersistence({
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'aGVsbG8=',
        caption: 'a cat',
      });

      const result = await tool
        .build({ prompt: 'a cat wearing a tiny hat' })
        .execute(new AbortController().signal);

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

      expect(backendState.generateCalls).toHaveLength(1);
      expect(backendState.generateCalls[0]?.request.prompt).toBe(
        'a cat wearing a tiny hat',
      );
    });

    it('passes the backend result to the persistence dependency and includes the returned path in the text hint and display', async () => {
      const savedPath = '/workspace/generated-images/cat-1234.png';
      const { tool, persistState } = makeToolWithPersistence(
        {
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'aGVsbG8=',
          caption: 'a cat',
        },
        { persistPath: savedPath },
      );

      const result = await tool
        .build({ prompt: 'a cat wearing a tiny hat' })
        .execute(new AbortController().signal);

      expect(persistState.persistCalls).toHaveLength(1);
      const persisted = persistState.persistCalls[0].result;
      expect(persisted.mimeType).toBe('image/png');
      expect(persisted.encoding).toBe('base64');
      expect(persisted.data).toBe('aGVsbG8=');
      expect(persisted.caption).toBe('a cat');

      const parts = result.llmContent as unknown[];
      const textPart = parts.find((p): p is string => typeof p === 'string');
      expect(textPart).toBeDefined();
      expect(textPart).toContain(savedPath);
      expect(result.returnDisplay).toContain(savedPath);
    });

    it('preserves the inline image part for model context alongside the persisted path hint', async () => {
      const { tool } = makeToolWithPersistence({
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'aGVsbG8=',
        caption: 'a cat',
      });

      const result = await tool
        .build({ prompt: 'a cat' })
        .execute(new AbortController().signal);

      const parts = result.llmContent as unknown[];
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
    });

    it('never forwards a "model" field to the backend even when one is present in the raw params', async () => {
      // Even though `model` is removed from GenerateImageToolParams, a model
      // could attempt to pass it. The tool must not forward it. We cast here
      // only to simulate an adversarial caller bypassing the typed contract.
      const { tool, backendState } = makeToolWithPersistence();
      const adversarialParams = {
        prompt: 'a cat',
        model: 'gpt-evil-override',
      } as unknown as GenerateImageToolParams;

      await tool.build(adversarialParams).execute(new AbortController().signal);

      expect(backendState.generateCalls).toHaveLength(1);
      const forwarded = backendState.generateCalls[0]?.request as Record<
        string,
        unknown
      >;
      expect(forwarded['model']).toBeUndefined();
    });
  });

  describe('persistence failure surfaces as tool execution failure', () => {
    it('maps a persistence error to EXECUTION_FAILED and never claims success', async () => {
      const { tool, persistState } = makeToolWithPersistence(
        {
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'aGVsbG8=',
        },
        { persistThrows: new Error('disk full') },
      );

      const result = await tool
        .build({ prompt: 'a cat' })
        .execute(new AbortController().signal);

      expect(persistState.persistCalls).toHaveLength(1);
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.error?.message).toContain('disk full');
      expect(typeof result.llmContent).toBe('string');
      expect(result.llmContent).toContain('failed to save');
      expect(result.returnDisplay).not.toContain('Saved to:');
    });
  });

  describe('A8 — no backend resolved', () => {
    it('returns a TOOL_DISABLED error and never calls the backend or persistence', async () => {
      // Persistence is a required dependency, but the no-backend path must
      // short-circuit before either the backend or persistence is touched.
      let persistCalled = false;
      const tool = new GenerateImageTool({
        resolveBackend: () => null,
        persistImageResult: async () => {
          persistCalled = true;
          return '/unused.png';
        },
      });

      const result = await tool
        .build({ prompt: 'a dog' })
        .execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.TOOL_DISABLED);
      expect(persistCalled).toBe(false);
    });
  });

  describe('abort propagation', () => {
    it('forwards the abort signal to the backend and maps abort to TIMEOUT', async () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      const { tool, backendState, persistState } = makeToolWithPersistence(
        {
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'aGVsbG8=',
        },
        { backendThrows: abortError },
      );
      const controller = new AbortController();
      controller.abort();

      const result = await tool
        .build({ prompt: 'a sunset' })
        .execute(controller.signal);

      expect(backendState.generateCalls).toHaveLength(1);
      expect(backendState.generateCalls[0]?.signalAborted).toBe(true);
      expect(persistState.persistCalls).toHaveLength(0);
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.TIMEOUT);
    });
  });

  describe('n > 1 rejection', () => {
    it('rejects n > 1 with INVALID_TOOL_PARAMS before calling the backend', async () => {
      const { tool, backendState, persistState } = makeToolWithPersistence();

      const result = await tool
        .build({ prompt: 'a sunset', n: 3 })
        .execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(backendState.generateCalls).toHaveLength(0);
      expect(persistState.persistCalls).toHaveLength(0);
    });
  });

  describe('generic backend error mapping', () => {
    it('maps a generic backend Error to EXECUTION_FAILED', async () => {
      const { tool, persistState } = makeToolWithPersistence(
        {
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'aGVsbG8=',
        },
        { backendThrows: new Error('network failure') },
      );

      const result = await tool
        .build({ prompt: 'a sunset' })
        .execute(new AbortController().signal);

      expect(persistState.persistCalls).toHaveLength(0);
      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
      expect(result.error?.message).toContain('network failure');
    });
  });
});
