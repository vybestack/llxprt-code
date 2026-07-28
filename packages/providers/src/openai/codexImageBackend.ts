/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  ImageGenerationError,
  ImageValidationError,
  validateImagePrompt,
  type ImageGenerateRequest,
  type ImageGenerationBackend,
  type ImageResult,
} from '@vybestack/llxprt-code-core/services/image/ImageGenerationService.js';
import { normalizeBaseUrl } from './codexBaseUrl.js';

const logger = new DebugLogger('llxprt:openai:codex:image');

/**
 * Model identifier for the Codex image-generation backend.
 */
export const CODEX_IMAGE_MODEL = 'gpt-image-2' as const;

const DEFAULT_CODEX_IMAGE_ENDPOINT =
  'https://chatgpt.com/backend-api/codex/images/generations';

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
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (normalizedBaseUrl.includes('/backend-api/codex')) {
    const backendApiBase = normalizedBaseUrl.replace(
      '/backend-api/codex',
      '/backend-api',
    );
    return `${backendApiBase}/codex/images/generations`;
  }
  return DEFAULT_CODEX_IMAGE_ENDPOINT;
}

/**
 * Dependencies required to construct a {@link CodexImageBackend}.
 *
 * Auth token/account accessors are injected (rather than imported) so the
 * adapter is decoupled from any specific provider runtime and unit-testable
 * without mocking the adapter itself. `fetchImpl` and `getBaseUrl` are
 * likewise injected for the same reason.
 */
export interface CodexImageBackendDeps {
  readonly getAccessToken: () => Promise<string>;
  readonly getAccountId: () => Promise<string>;
  readonly getBaseUrl?: () => string | undefined;
  readonly fetchImpl?: typeof fetch;
}

interface CodexImageGenerateResponse {
  readonly data?: ReadonlyArray<{ readonly b64_json?: string }>;
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
 * Implements {@link ImageGenerationBackend} using the same standalone-fetch
 * pattern as `fetchCodexUsage`: a direct `fetch` with `Authorization: Bearer`,
 * `ChatGPT-Account-Id`, `originator: codex_cli_rs`, and an `AbortSignal`
 * passed straight through so cancellation propagates.
 *
 * Generate only — edit mode is a deferred follow-up slice.
 */
export class CodexImageBackend implements ImageGenerationBackend {
  readonly name = 'codex';

  private readonly getAccessToken: () => Promise<string>;
  private readonly getAccountId: () => Promise<string>;
  private readonly getBaseUrl: () => string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: CodexImageBackendDeps) {
    this.getAccessToken = deps.getAccessToken;
    this.getAccountId = deps.getAccountId;
    this.getBaseUrl = deps.getBaseUrl ?? (() => undefined);
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  async generate(
    request: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageResult> {
    // A4: validate before any network call.
    validateImagePrompt(request.prompt);

    const accessToken = await this.getAccessToken();
    const accountId = await this.getAccountId();
    const endpoint = buildCodexImageGenerateEndpoint(this.getBaseUrl());

    const body = {
      model: request.model ?? CODEX_IMAGE_MODEL,
      prompt: request.prompt,
      background: request.background ?? 'auto',
      quality: request.quality ?? 'auto',
      size: request.size ?? 'auto',
      n: request.n ?? 1,
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'ChatGPT-Account-ID': accountId,
      originator: 'codex_cli_rs',
      'Content-Type': 'application/json',
    };
    if (request.sessionId !== undefined) {
      headers['session_id'] = request.sessionId;
    }

    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      // A5: surface status, endpoint, and a truncated body snippet.
      const bodyText = await response.text().catch(() => '');
      throw new ImageGenerationError(
        `Codex image generation failed with status ${response.status} ${response.statusText}`,
        {
          status: response.status,
          endpoint,
          bodySnippet: truncateForSnippet(bodyText),
        },
      );
    }

    let parsed: CodexImageGenerateResponse;
    try {
      parsed = (await response.json()) as CodexImageGenerateResponse;
    } catch (jsonError) {
      const bodyText = await response.text().catch(() => '');
      throw new ImageGenerationError(
        'Codex image generation returned a non-JSON response.',
        {
          status: response.status,
          endpoint,
          bodySnippet: truncateForSnippet(bodyText),
          cause: jsonError,
        },
      );
    }

    const b64 = parsed.data?.[0]?.b64_json;
    if (typeof b64 !== 'string' || b64 === '') {
      throw new ImageGenerationError(
        'Codex image generation returned no image data.',
        { status: response.status, endpoint },
      );
    }

    const result: ImageResult = {
      mimeType: 'image/png',
      encoding: 'base64',
      data: b64,
      caption: request.prompt,
    };

    logger.debug(
      () => `Generated Codex image via ${endpoint} (model=${body.model})`,
    );

    return result;
  }
}

export { ImageGenerationError, ImageValidationError };
