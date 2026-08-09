/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { GenerateImageTool } from './GenerateImageTool.js';
import { ToolErrorType } from '../../types/tool-error.js';
import type {
  GenerateImageToolParams,
  ImageOperationRunnerResult,
  ImageOperationRunnerError,
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

function makeRunnerError(
  message: string,
  stage: ImageOperationRunnerError['stage'],
): ImageOperationRunnerError {
  return Object.assign(new Error(message), {
    name: 'ImageOperationError',
    stage,
  });
}

interface ToolOptions {
  runImageImpl?: (input: {
    readonly prompt: string;
    readonly output_path: string;
    readonly input_paths?: readonly string[];
    readonly signal?: AbortSignal;
  }) => Promise<ImageOperationRunnerResult>;
  runImageError?: Error;
  capturedInput?: { value: GenerateImageToolParams['input_paths'] };
}

function makeTool(options: ToolOptions = {}): {
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
      if (options.runImageError) throw options.runImageError;
      if (options.runImageImpl) return options.runImageImpl(input);
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

describe('GenerateImageTool', () => {
  it('exposes the static name "generate_image"', () => {
    expect(GenerateImageTool.Name).toBe('generate_image');
  });

  it('delegates generate to the common runner and returns media + saved path', async () => {
    const { tool, runImageCalls } = makeTool();

    const result = await tool
      .build({ prompt: 'a cat', output_path: 'cat.png' })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(runImageCalls).toHaveLength(1);
    expect(runImageCalls[0]?.prompt).toBe('a cat');
    expect(runImageCalls[0]?.output_path).toBe('cat.png');

    const parts = result.llmContent as unknown[];
    const inlinePart = parts.find(
      (p): p is { inlineData?: { mimeType?: string; data?: string } } =>
        typeof p === 'object' &&
        p !== null &&
        'inlineData' in p &&
        p.inlineData !== undefined,
    );
    expect(inlinePart?.inlineData?.mimeType).toBe('image/png');

    const textPart = parts.find((p): p is string => typeof p === 'string');
    expect(textPart).toContain('/workspace/cat.png');
  });

  it('delegates edit to the common runner with input_paths', async () => {
    const { tool, runImageCalls } = makeTool();

    const result = await tool
      .build({
        prompt: 'add a mouse',
        output_path: 'out.png',
        input_paths: ['in.png'],
      })
      .execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(runImageCalls).toHaveLength(1);
    expect(runImageCalls[0]?.input_paths).toEqual(['in.png']);
  });

  it('maps a capability runner error to TOOL_DISABLED and calls the runner exactly once', async () => {
    const { tool, runImageCalls } = makeTool({
      runImageError: makeRunnerError('no backend', 'capability'),
    });

    const result = await tool
      .build({ prompt: 'a cat', output_path: 'out.png' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.TOOL_DISABLED);
    // The runner is the single authority — called exactly once, no separate
    // resolveBackend precheck.
    expect(runImageCalls).toHaveLength(1);
  });

  it('forwards the execute AbortSignal to the common runner', async () => {
    const { tool, runImageCalls } = makeTool();
    const controller = new AbortController();

    await tool
      .build({ prompt: 'a cat', output_path: 'out.png' })
      .execute(controller.signal);

    expect(runImageCalls).toHaveLength(1);
    expect(runImageCalls[0]?.signal).toBe(controller.signal);
  });

  it('maps an input-validation runner error to INVALID_TOOL_PARAMS', async () => {
    const { tool } = makeTool({
      runImageError: makeRunnerError('bad output path', 'input-validation'),
    });

    const result = await tool
      .build({ prompt: 'a cat', output_path: 'out.png' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(result.error?.message).toContain('bad output path');
  });

  it('maps a provider runner error to EXECUTION_FAILED', async () => {
    const { tool } = makeTool({
      runImageError: makeRunnerError('provider down', 'provider'),
    });

    const result = await tool
      .build({ prompt: 'a cat', output_path: 'out.png' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
    expect(result.error?.message).toContain('provider down');
  });

  it('maps an artifact-write runner error to EXECUTION_FAILED', async () => {
    const { tool } = makeTool({
      runImageError: makeRunnerError('disk full', 'artifact-write'),
    });

    const result = await tool
      .build({ prompt: 'a cat', output_path: 'out.png' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
    expect(result.error?.message).toContain('disk full');
  });

  it('forwards abort and maps to TIMEOUT', async () => {
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    const { tool } = makeTool({ runImageError: abortError });
    const controller = new AbortController();
    controller.abort();

    const result = await tool
      .build({ prompt: 'a sunset', output_path: 'out.png' })
      .execute(controller.signal);

    expect(result.error?.type).toBe(ToolErrorType.TIMEOUT);
  });

  it('maps a generic Error to EXECUTION_FAILED', async () => {
    const { tool } = makeTool({
      runImageError: new Error('network failure'),
    });

    const result = await tool
      .build({ prompt: 'a sunset', output_path: 'out.png' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
    expect(result.error?.message).toContain('network failure');
  });

  it('does not forward a model field to the runner', async () => {
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

  it('maps a wrapped AbortError (inside ImageOperationError cause chain) to TIMEOUT', async () => {
    // The runner wraps backend AbortErrors in ImageOperationError (stage
    // 'provider') with a cause. The top-level error name is no longer
    // 'AbortError', so isAbortError must walk the cause chain to classify
    // this correctly as a cancellation (TIMEOUT), not EXECUTION_FAILED.
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    const wrapped = makeRunnerError(
      'Image generate failed: The operation was aborted.',
      'provider',
    );
    wrapped.cause = abortError;
    const { tool, runImageCalls } = makeTool({ runImageError: wrapped });

    const result = await tool
      .build({ prompt: 'a sunset', output_path: 'out.png' })
      .execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.TIMEOUT);
    expect(runImageCalls).toHaveLength(1);
  });

  it('getDescription says "Generate image" for generation (no input paths)', () => {
    const { tool } = makeTool();
    const invocation = tool.build({
      prompt: 'a cat',
      output_path: 'out.png',
    });
    expect(invocation.getDescription()).toBe('Generate image: a cat');
  });

  it('getDescription says "Edit image" with input paths for editing', () => {
    const { tool } = makeTool();
    const invocation = tool.build({
      prompt: 'fix the text',
      output_path: 'out.png',
      input_paths: ['original.png', 'reference.png'],
    });
    const desc = invocation.getDescription();
    expect(desc).toMatch(/Edit image/i);
    expect(desc).toContain('original.png');
    expect(desc).toContain('reference.png');
    expect(desc).toContain('fix the text');
  });

  it('rejects an empty prompt at build time and never invokes the runner', () => {
    const { tool, runImageCalls } = makeTool();

    expect(() => tool.build({ prompt: '', output_path: 'out.png' })).toThrow(
      /empty/i,
    );
    expect(runImageCalls).toHaveLength(0);
  });

  it('rejects a whitespace-only prompt at build time and never invokes the runner', () => {
    const { tool, runImageCalls } = makeTool();
    const wsPrompt = [
      ' ',
      String.fromCharCode(9),
      String.fromCharCode(10),
      ' ',
    ].join('');

    expect(() =>
      tool.build({ prompt: wsPrompt, output_path: 'out.png' }),
    ).toThrow(/empty/i);
    expect(runImageCalls).toHaveLength(0);
  });

  it('validateToolParams reports the empty-prompt violation', () => {
    const { tool } = makeTool();

    expect(
      tool.validateToolParams({ prompt: '   ', output_path: 'out.png' }),
    ).toMatch(/empty/i);
    expect(
      tool.validateToolParams({ prompt: 'a cat', output_path: 'out.png' }),
    ).toBeNull();
  });
});
