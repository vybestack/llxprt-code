/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';
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

const MAX_EDIT_INPUTS = 5;

const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;

const PNG_SIGNATURE_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const JPEG_SIGNATURE_BYTES_PREFIX = Buffer.from([0xff, 0xd8, 0xff]);

const WEBP_SIGNATURE_BYTES = Buffer.from([
  0x52,
  0x49,
  0x46,
  0x46, // "RIFF"
]);

const WEBP_FOURCC_BYTES = Buffer.from([0x57, 0x45, 0x42, 0x50]); // "WEBP"

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
  readonly accountId: string;
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
 * A single fresh credential object (`{ accessToken, accountId }`) is resolved
 * once per generate()/edit() call via the injected `getCredential` callback, so
 * the access token and account id always originate from the same OAuth token
 * fetch and never diverge.
 */
export class CodexImageBackend implements ImageGenerationBackend {
  readonly name = 'codex';
  readonly provider = 'codex';
  readonly model = CODEX_IMAGE_MODEL;

  private readonly getCredential: () => Promise<CodexImageCredential>;
  private readonly getBaseUrl: () => string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: CodexImageBackendDeps) {
    this.getCredential = deps.getCredential;
    this.getBaseUrl = deps.getBaseUrl ?? (() => undefined);
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private buildHeaders(
    accessToken: string,
    accountId: string,
    sessionId?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'ChatGPT-Account-ID': accountId,
      originator: 'codex_cli_rs',
      'Content-Type': 'application/json',
    };
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
  ): Promise<string> {
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
    let parsed: CodexImageGenerateResponse;
    try {
      parsed = JSON.parse(rawBody) as CodexImageGenerateResponse;
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

    const b64 = parsed.data?.[0]?.b64_json;
    if (typeof b64 !== 'string' || b64 === '') {
      throw new ImageGenerationError(
        `Codex image ${operationName} returned no image data.`,
        { status: response.status, endpoint },
      );
    }
    return b64;
  }

  async generate(
    request: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageResult> {
    validateImagePrompt(request.prompt);

    if (request.n !== undefined && request.n !== 1) {
      throw new ImageValidationError(
        `Codex image generation only supports n=1 (received n=${request.n}).`,
      );
    }

    const credential = await this.getCredential();
    const endpoint = buildCodexImageGenerateEndpoint(this.getBaseUrl());

    const body = {
      model: CODEX_IMAGE_MODEL,
      prompt: request.prompt,
      background: request.background ?? 'auto',
      quality: request.quality ?? 'auto',
      size: request.size ?? 'auto',
      n: request.n ?? 1,
    };

    const headers = this.buildHeaders(
      credential.accessToken,
      credential.accountId,
      request.sessionId,
    );

    const b64 = await this.postAndParse(
      endpoint,
      body,
      headers,
      signal,
      'generation',
    );

    logger.debug(
      () => `Generated Codex image via ${endpoint} (model=${body.model})`,
    );

    return {
      mimeType: 'image/png',
      encoding: 'base64',
      data: b64,
      caption: request.prompt,
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
    request: {
      readonly prompt: string;
      readonly inputPaths: readonly string[];
      readonly sessionId?: string;
    },
    signal: AbortSignal,
  ): Promise<ImageResult> {
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
      request.inputPaths.map(readAndEncodeInputImage),
    );

    const credential = await this.getCredential();
    const endpoint = buildCodexImageEditEndpoint(this.getBaseUrl());

    // The Codex `/images/edits` contract requires `images` to be an array of
    // `{ image_url }` objects, NOT an array of bare data-URL strings and not
    // the singular `image` key. Anything else is rejected by the service with
    // `400 missing_required_parameter: images`.
    const body = {
      model: CODEX_IMAGE_MODEL,
      prompt: request.prompt,
      images: dataUrls.map((imageUrl) => ({ image_url: imageUrl })),
      background: 'auto',
      quality: 'auto',
      size: 'auto',
    };

    const headers = this.buildHeaders(
      credential.accessToken,
      credential.accountId,
      request.sessionId,
    );

    const b64 = await this.postAndParse(
      endpoint,
      body,
      headers,
      signal,
      'edit',
    );

    logger.debug(() => `Edited Codex image via ${endpoint}`);

    return {
      mimeType: 'image/png',
      encoding: 'base64',
      data: b64,
      caption: request.prompt,
    };
  }
}

/**
 * Read an input image from the filesystem, validate it (no URLs, no escaping
 * symlinks, valid image signature, bounded size), and encode it as a data URL.
 *
 * Never logs the image bytes or data URL.
 */
async function readAndEncodeInputImage(inputPath: string): Promise<string> {
  // Reject URLs — only local file inputs are supported initially.
  if (/^https?:\/\//i.test(inputPath) || /^file:\/\//i.test(inputPath)) {
    throw new ImageValidationError(
      `Remote URL input images are not supported: ${inputPath}. Use a local workspace file.`,
    );
  }

  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');

  // Reject symlinks before reading.
  try {
    const stat = await fs.lstat(inputPath);
    if (stat.isSymbolicLink()) {
      throw new ImageValidationError(
        `Input image is a symbolic link and cannot be used safely: ${inputPath}.`,
      );
    }
    if (!stat.isFile()) {
      throw new ImageValidationError(
        `Input image is not a regular file: ${inputPath}.`,
      );
    }
    if (stat.size > MAX_INPUT_IMAGE_BYTES) {
      throw new ImageValidationError(
        `Input image exceeds the maximum size: ${inputPath}.`,
      );
    }
  } catch (error) {
    if (error instanceof ImageValidationError) {
      throw error;
    }
    throw new ImageValidationError(
      `Input image could not be accessed: ${inputPath}.`,
    );
  }

  const bytes = await fs.readFile(inputPath);

  // Validate the image signature by extension and magic bytes.
  const ext = path.extname(inputPath).toLowerCase();
  const mimeType = detectImageMimeType(ext, bytes);
  if (mimeType === null) {
    throw new ImageValidationError(
      `Input image has an unsupported or unrecognized format: ${inputPath}.`,
    );
  }

  const base64 = bytes.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

function detectImageMimeType(ext: string, bytes: Buffer): string | null {
  if (ext === '.png') {
    if (
      bytes.length >= PNG_SIGNATURE_BYTES.length &&
      bytes.subarray(0, PNG_SIGNATURE_BYTES.length).equals(PNG_SIGNATURE_BYTES)
    ) {
      return 'image/png';
    }
    return null;
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    if (
      bytes.length >= 3 &&
      bytes.subarray(0, 3).equals(JPEG_SIGNATURE_BYTES_PREFIX)
    ) {
      return 'image/jpeg';
    }
    return null;
  }
  if (ext === '.webp') {
    // Verify BOTH the RIFF container prefix AND the WEBP fourCC at byte
    // offset 8, so a RIFF file that is NOT WebP (e.g. WAV/AVI renamed .webp)
    // is rejected instead of being misclassified as image/webp.
    if (
      bytes.length >= WEBP_SIGNATURE_BYTES.length &&
      bytes
        .subarray(0, WEBP_SIGNATURE_BYTES.length)
        .equals(WEBP_SIGNATURE_BYTES)
    ) {
      const fourccStart = WEBP_SIGNATURE_BYTES.length + 4; // skip RIFF(4) + size(4)
      if (
        bytes.length >= fourccStart + WEBP_FOURCC_BYTES.length &&
        bytes
          .subarray(fourccStart, fourccStart + WEBP_FOURCC_BYTES.length)
          .equals(WEBP_FOURCC_BYTES)
      ) {
        return 'image/webp';
      }
    }
    return null;
  }
  return null;
}

export { ImageGenerationError, ImageValidationError };
