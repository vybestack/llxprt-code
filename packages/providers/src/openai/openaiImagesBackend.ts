/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  ImageValidationError,
  validateImagePrompt,
} from '@vybestack/llxprt-code-core/services/image/ImageGenerationService.js';
import type {
  ImageBackend,
  ImageBackendResult,
  ImageGenerateRequest,
  ImageEditRequest,
} from '@vybestack/llxprt-code-providers/imageBackend.js';
import type { ResolvedImageProfileBackendConfig } from './codexImageBackendResolver.js';
import { normalizeBaseUrl } from './codexBaseUrl.js';
import { isLocalImageEndpoint } from './imageEndpoint.js';
import { readInputImage, PNG_SIGNATURE_BYTES } from './imageInput.js';
import { MAX_INPUT_IMAGES } from '@vybestack/llxprt-code-core/services/image/imageOperation.js';
import {
  ImageBackendError,
  boundedBody,
  imageResponseError,
  parseImageResponse,
  sanitizeImageErrorMessage,
} from './imageBackendResponse.js';

const logger = new DebugLogger('llxprt:openai:images');

export interface OpenAIImagesBackendDeps {
  readonly config: ResolvedImageProfileBackendConfig;
  readonly getApiKey?: () => Promise<string | undefined>;
  readonly fetchImpl?: typeof fetch;
}

/** OpenAI Images transport, with the pinned MLX vocabulary for loopback endpoints. */
export class OpenAIImagesBackend implements ImageBackend {
  readonly name = 'openai-images';
  readonly provider = 'openai-images';
  readonly model: string;
  private readonly local: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: OpenAIImagesBackendDeps) {
    this.model = deps.config.model;
    this.local = isLocalImageEndpoint(deps.config.baseUrl);
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private validateOperation(operation: 'generate' | 'edit'): void {
    if (
      this.local &&
      this.deps.config.operations !== undefined &&
      !this.deps.config.operations.includes(operation)
    ) {
      throw new ImageBackendError(
        'unsupported_operation',
        `Image profile does not support ${operation}.`,
      );
    }
  }

  private overrides(
    request: ImageGenerateRequest,
  ): Pick<ImageGenerateRequest, 'size' | 'quality' | 'background'> {
    const defaults = this.deps.config.overrides;
    const size = request.size ?? defaults.size;
    const quality = request.quality ?? defaults.quality;
    const background = request.background ?? defaults.background;
    return {
      ...(size === undefined ? {} : { size }),
      ...(quality === undefined ? {} : { quality }),
      ...(background === undefined ? {} : { background }),
    };
  }

  async generate(
    request: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageBackendResult> {
    this.validateOperation('generate');
    validateImagePrompt(request.prompt);
    if (request.n !== undefined && request.n !== 1)
      throw new ImageValidationError('Image generation only supports n=1.');
    const overrides = this.overrides(request);
    if (
      this.local &&
      overrides.size !== undefined &&
      !['256x256', '512x512', '1024x1024'].includes(overrides.size)
    ) {
      throw new ImageValidationError(
        'MLX image size must be 256x256, 512x512 or 1024x1024.',
      );
    }
    const localOverrides =
      overrides.size === undefined ? {} : { size: overrides.size };
    const body = {
      model: this.model,
      prompt: request.prompt,
      n: 1,
      ...(!this.local && !this.model.startsWith('gpt-image')
        ? { response_format: 'b64_json' }
        : {}),
      ...(this.local ? localOverrides : overrides),
    };
    return this.post(
      'generations',
      JSON.stringify(body),
      request.prompt,
      signal,
    );
  }

  async edit(
    request: ImageEditRequest,
    signal: AbortSignal,
  ): Promise<ImageBackendResult> {
    this.validateOperation('edit');
    validateImagePrompt(request.prompt);
    const maxInputs =
      this.local && /klein/i.test(this.model) ? 1 : MAX_INPUT_IMAGES;
    if (
      request.inputPaths.length === 0 ||
      request.inputPaths.length > maxInputs
    ) {
      throw new ImageValidationError(
        `Image editing requires at least one and at most ${maxInputs} input images.`,
      );
    }
    signal.throwIfAborted();
    const form = new FormData();
    form.set('model', this.model);
    form.set('prompt', request.prompt);
    const inputs = await Promise.all(request.inputPaths.map(readInputImage));
    for (const { bytes, mimeType } of inputs) {
      if (this.local && mimeType !== 'image/png' && mimeType !== 'image/jpeg') {
        throw new ImageValidationError(
          'MLX edits accept only PNG or JPEG input images.',
        );
      }
      form.append(
        this.local ? 'image' : 'image[]',
        new Blob([new Uint8Array(bytes)], { type: mimeType }),
        `input.${mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length)}`,
      );
    }
    if (!this.local) {
      const overrides = this.overrides(request);
      for (const key of ['size', 'quality', 'background'] as const) {
        const value = overrides[key];
        if (value !== undefined) form.set(key, value);
      }
    }
    return this.post('edits', form, request.prompt, signal);
  }

  private async resolveApiKey(): Promise<string> {
    if (this.deps.getApiKey === undefined) {
      throw new ImageBackendError(
        'validation',
        'Image backend requires an API key resolver.',
      );
    }
    const apiKey = await this.deps.getApiKey();
    if (apiKey === undefined) {
      throw new ImageBackendError(
        'validation',
        'Image profile credential is missing.',
      );
    }
    if (
      apiKey === '' ||
      apiKey.trim() !== apiKey ||
      [...apiKey].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 || code > 0xff;
      })
    ) {
      throw new ImageBackendError(
        'validation',
        'Image profile credential contains invalid characters.',
      );
    }
    return apiKey;
  }

  private async post(
    operation: 'generations' | 'edits',
    body: string | FormData,
    prompt: string,
    signal: AbortSignal,
  ): Promise<ImageBackendResult> {
    const credential =
      this.deps.config.auth.type === 'none'
        ? undefined
        : await this.resolveApiKey();
    const endpoint = `${normalizeBaseUrl(this.deps.config.baseUrl)}/images/${operation}`;
    let response: Response;
    try {
      const headers = new Headers();
      if (typeof body === 'string')
        headers.set('Content-Type', 'application/json');
      if (credential !== undefined)
        headers.set('Authorization', `Bearer ${credential}`);
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body,
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (signal.aborted) signal.throwIfAborted();
      throw new ImageBackendError(
        'server_error',
        sanitizeImageErrorMessage(
          error instanceof Error ? error.message : String(error),
          credential === undefined ? [] : [credential],
        ),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse((await boundedBody(response)).toString('utf8'));
    } catch (error) {
      if (error instanceof ImageBackendError) throw error;
      throw new ImageBackendError(
        'invalid_response',
        'Image endpoint returned an unreadable JSON response.',
        response.status,
      );
    }
    if (!response.ok) {
      const error = imageResponseError(parsed, response.status);
      throw new ImageBackendError(
        error.code,
        sanitizeImageErrorMessage(
          error.message,
          credential === undefined ? [] : [credential],
        ),
        response.status,
      );
    }
    const result = await parseImageResponse(parsed, this.fetchImpl, signal, {
      allowLocalUrls: this.local,
    });
    if (
      this.local &&
      !Buffer.from(result.data, 'base64')
        .subarray(0, PNG_SIGNATURE_BYTES.length)
        .equals(PNG_SIGNATURE_BYTES)
    ) {
      throw new ImageBackendError(
        'invalid_png',
        'MLX image response is not a PNG.',
      );
    }
    logger.debug(
      () =>
        `Image ${operation} (model=${this.model}, quality=${result.quality ?? 'unknown'}, size=${result.size ?? 'unknown'}, usage=${result.usage === undefined ? 'unknown' : JSON.stringify(result.usage)})`,
    );
    return { ...result, caption: prompt };
  }
}
