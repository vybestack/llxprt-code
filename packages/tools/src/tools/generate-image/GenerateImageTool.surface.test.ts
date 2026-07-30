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
  ImageOperationRunnerResult,
} from './GenerateImageTool.js';

const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function makeRunnerResult(
  overrides: Partial<ImageOperationRunnerResult> = {},
): ImageOperationRunnerResult {
  return {
    operation: 'generate',
    absoluteOutputPath: '/workspace/cat.png',
    relativeOutputPath: 'cat.png',
    mimeType: 'image/png',
    backend: 'stub',
    provider: 'stub',
    model: 'stub-model',
    inputPaths: [],
    media: {
      mimeType: 'image/png',
      encoding: 'base64',
      data: VALID_PNG_BASE64,
    },
    ...overrides,
  };
}

function makeTool(overrides?: {
  runImageImpl?: (input: {
    readonly prompt: string;
    readonly output_path: string;
    readonly input_paths?: readonly string[];
    readonly signal?: AbortSignal;
  }) => Promise<ImageOperationRunnerResult>;
  runImageError?: Error;
}): {
  tool: GenerateImageTool;
  runImageCalls: Array<{
    prompt: string;
    output_path: string;
    input_paths?: readonly string[];
    signal?: AbortSignal;
  }>;
} {
  const runImageCalls: Array<{
    prompt: string;
    output_path: string;
    input_paths?: readonly string[];
    signal?: AbortSignal;
  }> = [];
  const tool = new GenerateImageTool({
    runImage: async (input) => {
      runImageCalls.push(input);
      if (overrides?.runImageError) throw overrides.runImageError;
      if (overrides?.runImageImpl) return overrides.runImageImpl(input);
      return makeRunnerResult({
        absoluteOutputPath: `/workspace/${input.output_path}`,
        relativeOutputPath: input.output_path,
        operation:
          input.input_paths && input.input_paths.length > 0
            ? 'edit'
            : 'generate',
        inputPaths: input.input_paths ? [...input.input_paths] : [],
      });
    },
  });
  return { tool, runImageCalls };
}

describe('GenerateImageTool surface {prompt, output_path, input_paths?}', () => {
  it('exposes the exact parameter schema: prompt, output_path, input_paths', () => {
    const { tool } = makeTool();
    const schema = tool.schema.parametersJsonSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      'input_paths',
      'output_path',
      'prompt',
    ]);
    expect(schema.required?.sort()).toEqual(['output_path', 'prompt']);
  });

  it('does NOT expose a model parameter', () => {
    const { tool } = makeTool();
    const schema = tool.schema.parametersJsonSchema as {
      properties?: Record<string, unknown>;
    };
    expect(schema.properties).not.toHaveProperty('model');
  });

  it('dispatches generate when no input_paths', async () => {
    const { tool, runImageCalls } = makeTool();
    const result = await tool
      .build({
        prompt: 'a cat',
        output_path: 'cat.png',
      })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(runImageCalls).toHaveLength(1);
    expect(runImageCalls[0]?.input_paths).toBeUndefined();
  });

  it('dispatches edit when input_paths provided', async () => {
    const { tool, runImageCalls } = makeTool();
    const result = await tool
      .build({
        prompt: 'add a mouse',
        output_path: 'out.png',
        input_paths: ['input.png'],
      })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(runImageCalls[0]?.input_paths).toEqual(['input.png']);
  });

  it('rejects more than five input_paths at build() time', () => {
    const { tool } = makeTool();
    expect(() =>
      tool.build({
        prompt: 'a cat',
        output_path: 'out.png',
        input_paths: ['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png'],
      }),
    ).toThrow(/5 items/);
  });

  it('maps a capability error from the runner to TOOL_DISABLED', async () => {
    const capabilityError = new Error('no backend') as Error & {
      stage: string;
    };
    capabilityError.stage = 'capability';
    capabilityError.name = 'ImageOperationError';
    const { tool, runImageCalls } = makeTool({
      runImageError: capabilityError,
    });
    const result = await tool
      .build({ prompt: 'a cat', output_path: 'out.png' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.TOOL_DISABLED);
    // Runner is the single authority — called exactly once.
    expect(runImageCalls).toHaveLength(1);
  });

  it('returns the exact saved path text and image media', async () => {
    const { tool } = makeTool();
    const result = await tool
      .build({
        prompt: 'a cat',
        output_path: 'sub/cat.png',
      })
      .execute(new AbortController().signal);

    const parts = result.llmContent as unknown[];
    const textPart = parts.find((p): p is string => typeof p === 'string');
    expect(textPart).toContain('/workspace/sub/cat.png');
    const inlinePart = parts.find(
      (p): p is { inlineData?: { mimeType?: string } } =>
        typeof p === 'object' &&
        p !== null &&
        'inlineData' in p &&
        p.inlineData !== undefined,
    );
    expect(inlinePart?.inlineData?.mimeType).toBe('image/png');
  });

  it('never forwards a model field to the runner', async () => {
    const { tool, runImageCalls } = makeTool();
    await tool
      .build({
        prompt: 'a cat',
        output_path: 'out.png',
        model: 'evil',
      } as unknown as GenerateImageToolParams)
      .execute(new AbortController().signal);

    expect(runImageCalls[0]).toBeDefined();
    expect(
      (runImageCalls[0] as Record<string, unknown>)['model'],
    ).toBeUndefined();
  });
});
