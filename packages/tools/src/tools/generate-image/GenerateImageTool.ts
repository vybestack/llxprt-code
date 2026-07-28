/**
 * @license
 * Copyright 2025 Vybestack LLC
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
 * Structural duplicate of the {@link ImageGenerationBackend} contract from
 * `@vybestack/llxprt-code-core/services/image`.
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

export interface ImageBackendGenerateRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly background?: 'auto' | 'transparent' | 'opaque';
  readonly quality?: 'auto' | 'high' | 'medium' | 'low';
  readonly size?: 'auto' | '1024x1024' | '1024x1536' | '1536x1024';
  readonly n?: number;
  readonly sessionId?: string;
}

export interface ImageGenerationBackendLike {
  readonly name: string;
  generate(
    request: ImageBackendGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageBackendResult>;
}

export interface GenerateImageToolParams {
  readonly prompt: string;
  readonly model?: string;
  readonly background?: 'auto' | 'transparent' | 'opaque';
  readonly quality?: 'auto' | 'high' | 'medium' | 'low';
  readonly size?: 'auto' | '1024x1024' | '1024x1536' | '1536x1024';
  readonly n?: number;
  readonly sessionId?: string;
}

export interface GenerateImageToolDependencies {
  /**
   * Resolves the active image-generation backend, or null when no
   * image-capable backend is registered (e.g. non-Codex active provider).
   */
  readonly resolveBackend: () => ImageGenerationBackendLike | null;
}

/**
 * `generate_image` tool: model-callable entry point for image generation.
 *
 * Resolves a backend via an injected dependency. When no backend is available,
 * it returns a graceful {@link ToolErrorType.TOOL_DISABLED} result without any
 * network call (A8). The backend owns validation, transport, and error
 * mapping; the tool maps backend errors onto {@link ToolResult} error types.
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
      'Generate an image from a text description. Returns the generated image as base64-encoded data plus a caption the model can reference.',
      Kind.Other,
      {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Text description of the image to generate',
          },
          background: {
            type: 'string',
            enum: ['auto', 'transparent', 'opaque'],
            description:
              "Background mode (default: 'auto') — 'transparent' forces transparency where supported",
          },
          quality: {
            type: 'string',
            enum: ['auto', 'high', 'medium', 'low'],
            description: "Image quality (default: 'auto')",
          },
          size: {
            type: 'string',
            enum: ['auto', '1024x1024', '1024x1536', '1536x1024'],
            description: "Image dimensions (default: 'auto')",
          },
          model: {
            type: 'string',
            description:
              'Model to use (defaults to gpt-image-2 for the Codex backend)',
          },
          n: {
            type: 'integer',
            minimum: 1,
            description: 'Number of images to generate (default: 1)',
          },
          sessionId: {
            type: 'string',
            description: 'Optional session identifier passed to the backend',
          },
        },
        required: ['prompt'],
      },
    );
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

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'AbortError') {
    return true;
  }
  return (
    typeof DOMException === 'function' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  );
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
    return `Generate image: ${this.params.prompt}`;
  }

  async execute(
    signal: AbortSignal,
    _updateOutput?: (update: LiveOutputUpdate) => void,
  ): Promise<ToolResult> {
    // A8: when no backend resolves, report unavailable without any network call.
    const backend = this.dependencies.resolveBackend();
    if (backend === null) {
      return {
        llmContent:
          'Image generation is unavailable: no image-capable backend is registered for the current setup.',
        returnDisplay: 'Image generation unavailable.',
        error: {
          message:
            'Image generation is unavailable for the current setup (no Codex-capable backend registered).',
          type: ToolErrorType.TOOL_DISABLED,
        },
      };
    }

    // The backend contract returns a single image; reject n > 1 to avoid
    // silently discarding additional generated images.
    if (this.params.n !== undefined && this.params.n > 1) {
      return {
        llmContent:
          'Image generation failed: generating multiple images (n > 1) is not yet supported.',
        returnDisplay: 'Image generation failed.',
        error: {
          message:
            'Generating multiple images (n > 1) is not supported. Use n=1 or omit the parameter.',
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    try {
      const result = await backend.generate(
        {
          prompt: this.params.prompt,
          model: this.params.model,
          background: this.params.background,
          quality: this.params.quality,
          size: this.params.size,
          n: this.params.n,
          sessionId: this.params.sessionId,
        },
        signal,
      );

      // A6: return an inline-data image part plus a textual reference hint.
      const caption = result.caption ?? this.params.prompt;
      const inlinePart = {
        inlineData: {
          mimeType: result.mimeType,
          data: result.data,
        },
      };
      const textPart = `Image generated. Caption: ${caption}`;

      return {
        llmContent: [inlinePart, textPart],
        returnDisplay: `Generated image: ${caption}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isAbortError(error) || signal.aborted) {
        return {
          llmContent: `Image generation timed out or was cancelled: ${message}`,
          returnDisplay: 'Image generation timed out or was cancelled.',
          error: { message, type: ToolErrorType.TIMEOUT },
        };
      }

      // Validation errors map to INVALID_TOOL_PARAMS so the model can correct.
      const isValidationError =
        error instanceof Error && error.name === 'ImageValidationError';
      return {
        llmContent: `Image generation failed: ${message}`,
        returnDisplay: `Image generation failed.`,
        error: {
          message,
          type: isValidationError
            ? ToolErrorType.INVALID_TOOL_PARAMS
            : ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}
