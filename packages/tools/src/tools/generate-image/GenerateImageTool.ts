/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IToolMessageBus } from '../../interfaces/index.js';
import { ToolErrorType } from '../../types/tool-error.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
  type LiveOutputUpdate,
} from '../tools.js';

/**
 * Structural duplicate of the backend-neutral image contract.
 *
 * The tools package is a leaf workspace package with zero workspace deps, so
 * it cannot import the core contract directly. TypeScript's structural typing
 * makes any concrete core-backed backend assignable to this shape.
 */
export interface ImageBackendResult {
  readonly mimeType: string;
  readonly encoding: 'base64' | 'url';
  readonly data: string;
  readonly caption?: string;
  readonly revisedPrompt?: string;
}

export interface ImageGenerationBackendLike {
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  generate(
    request: { readonly prompt: string; readonly sessionId?: string },
    signal: AbortSignal,
  ): Promise<ImageBackendResult>;
  edit(
    request: {
      readonly prompt: string;
      readonly inputPaths: readonly string[];
      readonly sessionId?: string;
    },
    signal: AbortSignal,
  ): Promise<ImageBackendResult>;
}

/**
 * The provider-independent tool surface required by issue #2128.
 *
 * `output_path` is REQUIRED and caller-selected. `input_paths` is optional;
 * zero inputs generates, one-to-five edits. There is no `model` parameter —
 * the backend owns the model identity and callers cannot override it.
 */
export interface GenerateImageToolParams {
  readonly prompt: string;
  readonly output_path: string;
  readonly input_paths?: string[];
}

/**
 * Normalized result produced by the common image-operation runner.
 *
 * The tools package cannot import the core contract, so this is a structural
 * duplicate of `ImageOperationResult` carrying only the fields the tool needs.
 */
export interface ImageOperationRunnerResult {
  readonly operation: 'generate' | 'edit';
  readonly absoluteOutputPath: string;
  readonly relativeOutputPath: string;
  readonly mimeType: string;
  readonly backend: string;
  readonly provider: string;
  readonly model: string;
  readonly inputPaths: readonly string[];
  readonly media: {
    readonly mimeType: string;
    readonly encoding: 'base64';
    readonly data: string;
  };
}

/**
 * A stage-tagged error surfaced by the common runner. Structural duplicate of
 * `ImageOperationError` carrying only the fields the tool maps to error types.
 */
export interface ImageOperationRunnerError extends Error {
  readonly stage:
    | 'input-validation'
    | 'capability'
    | 'output-resolution'
    | 'provider'
    | 'response-validation'
    | 'artifact-write';
}

export interface GenerateImageToolDependencies {
  /**
   * The COMMON image-operation runner that all three entry points (tool,
   * `/image`, CLI flags) converge on. The tool delegates the entire operation
   * — capability resolution, request normalization, output/input path
   * validation, provider dispatch, atomic write, and normalized result — to
   * this single function so behavior never diverges across entry points.
   *
   * The runner is the single authority for capability: when no image-capable
   * backend is registered it throws a stage='capability' error, which the tool
   * maps to TOOL_DISABLED. There is NO separate resolveBackend precheck.
   */
  readonly runImage: (input: {
    readonly prompt: string;
    readonly output_path: string;
    readonly input_paths?: readonly string[];
    readonly signal?: AbortSignal;
  }) => Promise<ImageOperationRunnerResult>;
}

const MAX_INPUT_IMAGES = 5;

function isImageOperationRunnerError(
  error: unknown,
): error is ImageOperationRunnerError {
  return (
    error instanceof Error &&
    typeof (error as ImageOperationRunnerError).stage === 'string'
  );
}

function isAbortError(error: unknown): boolean {
  // Walk the `cause` chain so an AbortError wrapped inside an
  // ImageOperationError (stage 'provider') is still classified as a
  // cancellation, not EXECUTION_FAILED. Bounded depth + a visited Set guard
  // against self-referential or cyclic cause chains.
  let current: unknown = error;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 10 && current !== null; depth++) {
    if (visited.has(current)) {
      return false;
    }
    visited.add(current);
    if (!(current instanceof Error)) {
      return false;
    }
    if (current.name === 'AbortError') {
      return true;
    }
    if (
      typeof DOMException === 'function' &&
      current instanceof DOMException &&
      current.name === 'AbortError'
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * `generate_image` tool: model-callable entry point for image generation and
 * editing. Provider-independent surface `{ prompt, output_path, input_paths? }`.
 *
 * Zero inputs → generation; one-to-five inputs → editing. All paths are
 * validated by the common service before any billable provider request. The
 * exact saved path is returned as text alongside the image media. The active
 * conversational provider/model is never changed; no model override is
 * possible.
 *
 * The tool contains NO image business logic: it maps params to the common
 * runner and translates the normalized result/error into a tool result.
 */
export class GenerateImageTool extends BaseDeclarativeTool<
  GenerateImageToolParams,
  ToolResult
> {
  static readonly Name = 'generate_image';

  constructor(private readonly dependencies: GenerateImageToolDependencies) {
    super(
      GenerateImageTool.Name,
      'GenerateImage',
      'Generate or edit an image from a text description. Returns the saved image file path plus the image as media. Requires an explicit .png output path. Zero input_paths generates; one-to-five input_paths edits an existing image.',
      Kind.Other,
      {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description:
              'Text description of the image to generate or the edit to apply.',
          },
          output_path: {
            type: 'string',
            description:
              'Required explicit output path ending in .png, relative to the workspace root or absolute within the workspace.',
          },
          input_paths: {
            type: 'array',
            items: { type: 'string' },
            maxItems: MAX_INPUT_IMAGES,
            description:
              'Optional zero-to-five existing workspace image paths to use as edit/reference sources. Omit for generation.',
          },
        },
        required: ['prompt', 'output_path'],
      },
    );
  }

  /**
   * Reject an empty/whitespace-only prompt at build time so an unusable request
   * never reaches the shared service or a billable provider call.
   */
  protected override validateToolParamValues(
    params: GenerateImageToolParams,
  ): string | null {
    if (params.prompt.trim() === '') {
      return 'prompt must not be empty';
    }
    return null;
  }

  protected createInvocation(
    params: GenerateImageToolParams,
    messageBus?: IToolMessageBus,
  ): ToolInvocation<GenerateImageToolParams, ToolResult> {
    return new GenerateImageToolInvocation(
      this.dependencies,
      params,
      messageBus,
    );
  }
}

class GenerateImageToolInvocation extends BaseToolInvocation<
  GenerateImageToolParams,
  ToolResult
> {
  constructor(
    private readonly dependencies: GenerateImageToolDependencies,
    params: GenerateImageToolParams,
    messageBus?: IToolMessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    const hasInputs =
      this.params.input_paths !== undefined &&
      this.params.input_paths.length > 0;
    if (hasInputs) {
      return `Edit image (${this.params.input_paths.join(', ')}): ${this.params.prompt}`;
    }
    return `Generate image: ${this.params.prompt}`;
  }

  async execute(
    signal: AbortSignal,
    _updateOutput?: (update: LiveOutputUpdate) => void,
  ): Promise<ToolResult> {
    try {
      const result = await this.dependencies.runImage({
        prompt: this.params.prompt,
        output_path: this.params.output_path,
        signal,
        ...(this.params.input_paths !== undefined
          ? { input_paths: this.params.input_paths }
          : {}),
      });
      return this.buildSuccessResult(result);
    } catch (error) {
      return this.mapRunnerError(error);
    }
  }

  private buildSuccessResult(result: ImageOperationRunnerResult): ToolResult {
    const operation = result.operation === 'generate' ? 'Generated' : 'Edited';
    const textPart = `${operation} image.
Saved to: ${result.absoluteOutputPath}`;
    const inlinePart = {
      inlineData: {
        mimeType: result.media.mimeType,
        data: result.media.data,
      },
    };

    return {
      llmContent: [inlinePart, textPart],
      returnDisplay: `${operation} image.
Saved to: ${result.absoluteOutputPath}`,
    };
  }

  private mapRunnerError(error: unknown): ToolResult {
    const message = error instanceof Error ? error.message : String(error);

    if (isAbortError(error)) {
      return {
        llmContent: `Image generation timed out or was cancelled: ${message}`,
        returnDisplay: 'Image generation timed out or was cancelled.',
        error: { message, type: ToolErrorType.TIMEOUT },
      };
    }

    if (isImageOperationRunnerError(error)) {
      if (
        error.stage === 'input-validation' ||
        error.stage === 'output-resolution'
      ) {
        return {
          llmContent: `Image generation failed: ${message}`,
          returnDisplay: 'Image generation failed.',
          error: { message, type: ToolErrorType.INVALID_TOOL_PARAMS },
        };
      }
      if (error.stage === 'capability') {
        return {
          llmContent: `Image generation unavailable: ${message}`,
          returnDisplay: 'Image generation unavailable.',
          error: { message, type: ToolErrorType.TOOL_DISABLED },
        };
      }
      return {
        llmContent: `Image generation failed: ${message}`,
        returnDisplay: 'Image generation failed.',
        error: { message, type: ToolErrorType.EXECUTION_FAILED },
      };
    }

    return {
      llmContent: `Image generation failed: ${message}`,
      returnDisplay: 'Image generation failed.',
      error: { message, type: ToolErrorType.EXECUTION_FAILED },
    };
  }
}

export { MAX_INPUT_IMAGES };
