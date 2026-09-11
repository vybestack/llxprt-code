/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  ImageGenerationError,
  ImageValidationError,
  validateImagePrompt,
} from '@vybestack/llxprt-code-core/services/image/ImageGenerationService.js';
import type {
  ImageBackend,
  ImageGenerateRequest,
  ImageEditRequest,
  ImageBackendResult,
} from '@vybestack/llxprt-code-providers/imageBackend.js';
import { readInputImage } from './imageInput.js';
import { parseImageResponse } from './imageBackendResponse.js';
import { validateCodexImageProfileBaseUrl } from './imageEndpoint.js';
import { normalizeBaseUrl } from './codexBaseUrl.js';

const logger = new DebugLogger('llxprt:openai:codex:image');

const MAX_EDIT_INPUTS = 5;

/**
 * Model identifier for the Codex image-generation backend.
 */
export const CODEX_IMAGE_MODEL = 'gpt-image-2' as const;

const DEFAULT_CODEX_IMAGE_ENDPOINT =
  'https://chatgpt.com/backend-api/codex/images/generations';

const DEFAULT_CODEX_IMAGE_EDIT_ENDPOINT =
  'https://chatgpt.com/backend-api/codex/images/edits';

/**
 * Build the Codex image-generation endpoint URL.
 *
 * When a base url containing `/backend-api/codex` is supplied (the standard
 * Codex auth base), the endpoint is derived from it so custom deployments work.
 * Otherwise the canonical chatgpt.com endpoint is used.
 *
 * Exported for direct unit testing.
 */
export function buildCodexImageGenerateEndpoint(baseUrl?: string): string {
  return buildCodexImageEndpoint(baseUrl, 'generations');
}

/**
 * Build the Codex image-edit endpoint URL. Exported for direct unit testing.
 */
export function buildCodexImageEditEndpoint(baseUrl?: string): string {
  return buildCodexImageEndpoint(baseUrl, 'edits');
}

function buildCodexImageEndpoint(
  baseUrl: string | undefined,
  suffix: 'generations' | 'edits',
): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (normalizedBaseUrl.includes('/backend-api/codex')) {
    const backendApiBase = normalizedBaseUrl.replace(
      '/backend-api/codex',
      '/backend-api',
    );
    return `${backendApiBase}/codex/images/${suffix}`;
  }
  return suffix === 'generations'
    ? DEFAULT_CODEX_IMAGE_ENDPOINT
    : DEFAULT_CODEX_IMAGE_EDIT_ENDPOINT;
}

/**
 * A fresh, consistently-paired Codex credential resolved once per operation.
 *
 * Both fields originate from the same OAuth token fetch so a generate/edit
 * operation never mixes token/account pairs.
 */
export interface CodexImageCredential {
  readonly accessToken: string;
  readonly accountId?: string;
}

/**
 * Dependencies required to construct a {@link CodexImageBackend}.
 *
 * Auth is injected via a single `getCredential` callback that returns ONE
 * fresh, consistently-paired `{ accessToken, accountId }` object per operation.
 * This avoids the double-fetch and token/account mismatch that separate
 * accessors caused. `fetchImpl` and `getBaseUrl` are likewise injected so the
 * adapter is decoupled from any specific provider runtime and unit-testable
 * without mocking the adapter itself.
 */
export interface CodexImageBackendDeps {
  readonly getCredential: () => Promise<CodexImageCredential>;
  readonly getBaseUrl?: () => string | undefined;
  readonly model?: string;
  readonly defaults?: Pick<
    ImageGenerateRequest,
    'quality' | 'size' | 'background'
  >;
  readonly fetchImpl?: typeof fetch;
}

const MAX_BODY_SNIPPET_LENGTH = 500;

function truncateForSnippet(text: string): string {
  return text.length > MAX_BODY_SNIPPET_LENGTH
    ? `${text.slice(0, MAX_BODY_SNIPPET_LENGTH)}…`
    : text;
}

/**
 * Codex OAuth adapter for the backend-neutral image-generation service.
 *
 * Implements {@link ImageBackend} using the same standalone-fetch
 * pattern as `fetchCodexUsage`: a direct `fetch` with `Authorization: Bearer`,
 * `ChatGPT-Account-Id`, `originator: codex_cli_rs`, and an `AbortSignal`

 * passed straight through so cancellation propagates.
 *
 * A single fresh credential object (`{ accessToken, accountId }`) is resolved
 * once per generate()/edit() call via the injected `getCredential` callback, so
 * the access token and account id always originate from the same OAuth token
 * fetch and never diverge.
 */
export class CodexImageBackend implements ImageBackend {
  readonly name = 'codex';
  readonly provider = 'codex';
  readonly model: string;

  private readonly getCredential: () => Promise<CodexImageCredential>;
  private readonly getBaseUrl: () => string | undefined;
  private readonly defaults: Pick<
    ImageGenerateRequest,
    'quality' | 'size' | 'background'
  >;
  private readonly hasImageProfile: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: CodexImageBackendDeps) {
    this.getCredential = deps.getCredential;
    this.getBaseUrl = deps.getBaseUrl ?? (() => undefined);
    this.model = deps.model ?? CODEX_IMAGE_MODEL;
    this.defaults = deps.defaults ?? {};
    this.hasImageProfile = deps.defaults !== undefined;
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private buildHeaders(
    accessToken: string,
    accountId: string | undefined,
    sessionId?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      originator: 'codex_cli_rs',
      'Content-Type': 'application/json',
    };
    if (accountId !== undefined) {
      headers['ChatGPT-Account-ID'] = accountId;
    }
    if (sessionId !== undefined) {
      headers['session_id'] = sessionId;
    }
    return headers;
  }

  private async postAndParse(
    endpoint: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
    signal: AbortSignal,
    operationName: string,
  ): Promise<{
    readonly data: string;
    readonly quality?: string;
    readonly size?: string;
    readonly usage?: Readonly<Record<string, unknown>>;
  }> {
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch (readError) {
        throw new ImageGenerationError(
          `Codex image ${operationName} failed with status ${response.status} ${response.statusText} and the error body could not be read.`,
          {
            status: response.status,
            endpoint,
            cause: readError,
          },
        );
      }
      throw new ImageGenerationError(
        `Codex image ${operationName} failed with status ${response.status} ${response.statusText}`,
        {
          status: response.status,
          endpoint,
          bodySnippet: truncateForSnippet(bodyText),
        },
      );
    }

    let rawBody: string;
    try {
      rawBody = await response.text();
    } catch (readError) {
      throw new ImageGenerationError(
        `Codex image ${operationName} response body could not be read.`,
        {
          status: response.status,
          endpoint,
          cause: readError,
        },
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch (jsonError) {
      throw new ImageGenerationError(
        `Codex image ${operationName} returned a non-JSON response.`,
        {
          status: response.status,
          endpoint,
          bodySnippet: truncateForSnippet(rawBody),
          cause: jsonError,
        },
      );
    }

    return parseImageResponse(parsed, this.fetchImpl, signal);
  }

  private buildEndpoint(suffix: 'generations' | 'edits'): string {
    const baseUrl = this.getBaseUrl();
    if (this.hasImageProfile && baseUrl !== undefined)
      validateCodexImageProfileBaseUrl(baseUrl);
    return suffix === 'generations'
      ? buildCodexImageGenerateEndpoint(baseUrl)
      : buildCodexImageEditEndpoint(baseUrl);
  }

  async generate(
    request: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageBackendResult> {
    validateImagePrompt(request.prompt);

    if (request.n !== undefined && request.n !== 1) {
      throw new ImageValidationError(
        `Codex image generation only supports n=1 (received n=${request.n}).`,
      );
    }

    const endpoint = this.buildEndpoint('generations');
    const credential = await this.getCredential();

    const background =
      request.background ??
      this.defaults.background ??
      (this.hasImageProfile ? undefined : 'auto');
    const quality =
      request.quality ??
      this.defaults.quality ??
      (this.hasImageProfile ? undefined : 'auto');
    const size =
      request.size ??
      this.defaults.size ??
      (this.hasImageProfile ? undefined : 'auto');
    const body = {
      model: this.model,
      prompt: request.prompt,
      ...(background !== undefined ? { background } : {}),
      ...(quality !== undefined ? { quality } : {}),
      ...(size !== undefined ? { size } : {}),
      n: request.n ?? 1,
    };

    const headers = this.buildHeaders(
      credential.accessToken,
      credential.accountId,
      request.sessionId,
    );

    const response = await this.postAndParse(
      endpoint,
      body,
      headers,
      signal,
      'generation',
    );

    logger.debug(
      () =>
        `Generated Codex image via ${endpoint} (model=${body.model}, quality=${response.quality ?? 'unknown'}, size=${response.size ?? 'unknown'}, usage=${JSON.stringify(response.usage ?? {})})`,
    );

    return {
      mimeType: 'image/png',
      encoding: 'base64',
      data: response.data,
      caption: request.prompt,
      ...(response.quality !== undefined ? { quality: response.quality } : {}),
      ...(response.size !== undefined ? { size: response.size } : {}),
      ...(response.usage !== undefined ? { usage: response.usage } : {}),
    };
  }

  /**
   * Edit one-to-five input images using the Codex `/images/edits` endpoint.
   *
   * Input images are read from the local filesystem, validated (PNG signature,
   * no symlinks escaping, no URLs), encoded as data URLs, and sent in the
   * `image` array. A fresh credential object is resolved once per operation.
   */
  async edit(
    request: ImageEditRequest,
    signal: AbortSignal,
  ): Promise<ImageBackendResult> {
    validateImagePrompt(request.prompt);

    if (request.inputPaths.length === 0) {
      throw new ImageValidationError(
        'Image editing requires at least one input image.',
      );
    }
    if (request.inputPaths.length > MAX_EDIT_INPUTS) {
      throw new ImageValidationError(
        `Codex image editing supports at most ${MAX_EDIT_INPUTS} input images (received ${request.inputPaths.length}).`,
      );
    }

    if (signal.aborted) {
      throw new ImageGenerationError('Image edit was aborted.', {
        cause: new Error('Aborted'),
      });
    }
    const dataUrls = await Promise.all(
      request.inputPaths.map(async (inputPath) => {
        const { bytes, mimeType } = await readInputImage(inputPath);
        return `data:${mimeType};base64,${bytes.toString('base64')}`;
      }),
    );

    const endpoint = this.buildEndpoint('edits');
    const credential = await this.getCredential();

    // The Codex `/images/edits` contract requires `images` to be an array of
    // `{ image_url }` objects, NOT an array of bare data-URL strings and not
    // the singular `image` key. Anything else is rejected by the service with
    // `400 missing_required_parameter: images`.
    const background = this.hasImageProfile
      ? (request.background ?? this.defaults.background)
      : 'auto';
    const quality = this.hasImageProfile
      ? (request.quality ?? this.defaults.quality)
      : 'auto';
    const size = this.hasImageProfile
      ? (request.size ?? this.defaults.size)
      : 'auto';
    const body = {
      model: this.model,
      prompt: request.prompt,
      images: dataUrls.map((imageUrl) => ({ image_url: imageUrl })),
      ...(background !== undefined ? { background } : {}),
      ...(quality !== undefined ? { quality } : {}),
      ...(size !== undefined ? { size } : {}),
    };

    const headers = this.buildHeaders(
      credential.accessToken,
      credential.accountId,
      request.sessionId,
    );

    const response = await this.postAndParse(
      endpoint,
      body,
      headers,
      signal,
      'edit',
    );

    logger.debug(
      () =>
        `Edited Codex image via ${endpoint} (model=${body.model}, quality=${response.quality ?? 'unknown'}, size=${response.size ?? 'unknown'}, usage=${JSON.stringify(response.usage ?? {})})`,
    );

    return {
      mimeType: 'image/png',
      encoding: 'base64',
      data: response.data,
      caption: request.prompt,
      ...(response.quality !== undefined ? { quality: response.quality } : {}),
      ...(response.size !== undefined ? { size: response.size } : {}),
      ...(response.usage !== undefined ? { usage: response.usage } : {}),
    };
  }
}

export { ImageGenerationError, ImageValidationError };
