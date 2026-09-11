/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { readInputImage } from './imageInput.js';
import {
  ImageBackendError,
  imageResponseError,
  parseImageResponse,
} from './imageBackendResponse.js';

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
      response_format: 'b64_json',
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
    validateImagePrompt(request.prompt);
    const maxInputs = this.local && /klein/i.test(this.model) ? 1 : 5;
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
    for (const inputPath of request.inputPaths) {
      const { bytes, mimeType } = await readInputImage(inputPath);
      if (this.local && mimeType !== 'image/png' && mimeType !== 'image/jpeg') {
        throw new ImageValidationError(
          'MLX edits accept only PNG or JPEG input images.',
        );
      }
      form.append(
        this.local ? 'image' : 'image[]',
        new Blob([bytes], { type: mimeType }),
        mimeType === 'image/jpeg' ? 'input.jpg' : 'input.png',
      );
    }
    if (!this.local) {
      for (const [key, value] of Object.entries(this.overrides(request)))
        form.set(key, value);
    }
    return this.post('edits', form, request.prompt, signal);
  }

  private async post(
    operation: 'generations' | 'edits',
    body: string | FormData,
    prompt: string,
    signal: AbortSignal,
  ): Promise<ImageBackendResult> {
    const headers = new Headers();
    if (typeof body === 'string')
      headers.set('Content-Type', 'application/json');
    if (this.deps.config.auth.type !== 'none') {
      if (this.deps.getApiKey === undefined)
        throw new ImageBackendError(
          'validation',
          'Image backend requires an API key resolver.',
        );
      const apiKey = await this.deps.getApiKey();
      if (apiKey === undefined)
        throw new ImageBackendError(
          'validation',
          'Image profile credential is missing.',
        );
      headers.set('Authorization', `Bearer ${apiKey}`);
    }
    const endpoint = `${normalizeBaseUrl(this.deps.config.baseUrl)}/images/${operation}`;
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body,
      signal,
      redirect: 'error',
    });
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new ImageBackendError(
        'invalid_response',
        'Image endpoint returned an unreadable JSON response.',
        response.status,
      );
    }
    if (!response.ok) throw imageResponseError(parsed, response.status);
    return {
      ...(await parseImageResponse(parsed, this.fetchImpl, signal)),
      caption: prompt,
    };
  }
}
