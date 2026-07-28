/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Backend-neutral image generation service contract.
 *
 * This module defines the request/result/error types, the backend capability
 * interface, and a pure prompt-validation helper. It deliberately contains NO
 * implementation, NO fetch, and NO concrete backend — concrete backends (e.g.
 * the Codex OAuth adapter) live in `@vybestack/llxprt-code-providers` and
 * implement {@link ImageGenerationBackend}.
 */

/**
 * Request to generate one or more images.
 *
 * Mirrors the Codex `gpt-image-2` generate endpoint shape; backend-neutral so
 * future backends (OpenRouter, LM Studio, local models) can reuse it.
 */
export interface ImageGenerateRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly background?: 'auto' | 'transparent' | 'opaque';
  readonly quality?: 'auto' | 'high' | 'medium' | 'low';
  readonly size?: 'auto' | '1024x1024' | '1024x1536' | '1536x1024';
  readonly n?: number;
  readonly sessionId?: string;
}

/**
 * A normalized image-generation result.
 *
 * `encoding` distinguishes inline base64 from a URL reference. The Codex
 * generate endpoint returns `b64_json`, so the first adapter normalizes to
 * `encoding: 'base64'`.
 */
export interface ImageResult {
  readonly mimeType: string;
  readonly encoding: 'base64' | 'url';
  readonly data: string;
  readonly caption?: string;
  readonly revisedPrompt?: string;
}

/**
 * Error thrown by image backends on non-2xx HTTP responses or missing payload.
 *
 * Carries diagnostic context (status, endpoint, truncated body) so callers can
 * surface a useful message without leaking the entire response body.
 */
export class ImageGenerationError extends Error {
  readonly status?: number;
  readonly endpoint?: string;
  readonly bodySnippet?: string;

  constructor(
    message: string,
    options?: {
      readonly status?: number;
      readonly endpoint?: string;
      readonly bodySnippet?: string;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ImageGenerationError';
    if (options?.status !== undefined) {
      this.status = options.status;
    }
    if (options?.endpoint !== undefined) {
      this.endpoint = options.endpoint;
    }
    if (options?.bodySnippet !== undefined) {
      this.bodySnippet = options.bodySnippet;
    }
  }
}

/**
 * Error thrown when an image-generation request fails input validation.
 */
export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

/**
 * A single image-generation backend (e.g. Codex OAuth).
 *
 * Backends own transport details (auth, endpoint, fetch, error mapping) and
 * expose a uniform `generate` capability. The capability interface keeps the
 * service and tool decoupled from any specific provider.
 */
export interface ImageGenerationBackend {
  readonly name: string;
  generate(
    request: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageResult>;
}

/**
 * The application-level image-generation service.
 *
 * A concrete service composes one or more {@link ImageGenerationBackend}s;
 * this interface is the contract consumers depend on.
 */
export interface ImageGenerationService {
  generate(
    request: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageResult>;
}

/**
 * Validate that a prompt is non-empty after trimming whitespace.
 *
 * Throws {@link ImageValidationError} for empty or whitespace-only prompts so
 * that callers can reject invalid input before any network call.
 */
export function validateImagePrompt(prompt: string): void {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new ImageValidationError(
      'Image generation prompt must not be empty or whitespace-only.',
    );
  }
}
