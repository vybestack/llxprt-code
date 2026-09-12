/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isLocalImageEndpoint } from './imageEndpoint.js';

import {
  ImageGenerationError,
  validatePngStructure,
} from '@vybestack/llxprt-code-core/services/image/ImageGenerationService.js';
import type { ImageBackendResult } from '@vybestack/llxprt-code-providers/imageBackend.js';

export type ImageBackendErrorCode =
  | 'unsupported_operation'
  | 'validation'
  | 'model_not_found'
  | 'server_error'
  | 'timeout'
  | 'materialization'
  | 'invalid_image'
  | 'invalid_png'
  | 'invalid_response';

export class ImageBackendError extends ImageGenerationError {
  constructor(
    readonly code: ImageBackendErrorCode,
    message: string,
    status?: number,
    options?: ErrorOptions,
  ) {
    super(sanitizeImageErrorMessage(message), {
      ...options,
      ...(status === undefined ? {} : { status }),
    });
    this.name = 'ImageBackendError';
  }
}

/** Redact credentials in external diagnostics while retaining useful context. */
export function sanitizeImageErrorMessage(
  message: string,
  secrets: readonly string[] = [],
): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (secret !== '') sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  return sanitized
    .replace(/https?:\/\/[^\s"'<>]+/gi, (value) =>
      value.replace(/\?[^\s]*/, '?[REDACTED]'),
    )
    .replace(/\bBearer\s+[^\s,;"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-z0-9_.*-]+/gi, '[REDACTED]')
    .replace(
      /(API[ -]?key(?: provided)?\s*[:=]\s*["']?)[^\s,;"'<>]+/gi,
      '$1[REDACTED]',
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse the three deployed MLX error envelopes without exposing raw inputs. */
export function imageResponseError(
  body: unknown,
  status: number,
): ImageBackendError {
  const envelope = isRecord(body) ? body : {};
  if (Array.isArray(envelope.detail)) {
    const details = envelope.detail.filter(isRecord).map((item) => {
      const location = Array.isArray(item.loc)
        ? item.loc
            .filter(
              (part: unknown) =>
                typeof part === 'string' || typeof part === 'number',
            )
            .join('.')
        : 'request';
      const message = typeof item.msg === 'string' ? item.msg : 'Invalid field';
      return `${location}: ${message}`;
    });
    return new ImageBackendError(
      'validation',
      `Image endpoint rejected the request fields (validation failed). ${details.join('; ')}`.trim(),
      status,
    );
  }
  const wrapped = isRecord(envelope.detail) ? envelope.detail : envelope;
  const error = isRecord(wrapped.error) ? wrapped.error : {};
  if (error.type === 'model_not_found') {
    return new ImageBackendError(
      'model_not_found',
      typeof error.message === 'string' && error.message.trim() !== ''
        ? error.message
        : 'Image model was not found on the configured endpoint.',
      status,
    );
  }
  if (status === 500 && error.message === '') {
    return new ImageBackendError(
      'timeout',
      'Image server timed out before returning an image.',
      status,
    );
  }
  return new ImageBackendError(
    'server_error',
    typeof error.message === 'string' && error.message.trim() !== ''
      ? error.message
      : `Image endpoint failed with HTTP ${status}.`,
    status,
  );
}

const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

/** Read an image response body without exceeding the transport byte limit. */
export async function boundedBody(response: Response): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel();
    throw new ImageBackendError(
      'materialization',
      'Image download exceeds the size limit.',
    );
  }
  if (response.body === null)
    throw new ImageBackendError(
      'materialization',
      'Image download returned no bytes.',
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      length += chunk.value.byteLength;
      if (length > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new ImageBackendError(
          'materialization',
          'Image download exceeds the size limit.',
        );
      }
      chunks.push(chunk.value);
      chunk = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

function isRestrictedHost(url: URL): boolean {
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (
    isLocalImageEndpoint(`https://${url.host}`) ||
    host === 'metadata.google.internal' ||
    host.endsWith('.internal')
  )
    return true;
  if (host.includes(':')) {
    if (host.startsWith('::ffff:')) {
      const parts = host.slice(7).split(':');
      const high = Number.parseInt(parts[0], 16);
      const low = Number.parseInt(parts[1], 16);
      return isRestrictedHost(
        new URL(`https://${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`),
      );
    }
    return (
      host === '::' || host === '::1' || /^(fc|fd|fe[89ab]|ff)/i.test(host)
    );
  }
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(Number.isNaN)) return false;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Download without credentials or redirects; never include signed URLs in errors. */
async function materializeUrl(
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  allowLocalUrls: boolean,
): Promise<string> {
  try {
    const parsed = new URL(url);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      (!allowLocalUrls &&
        (parsed.protocol !== 'https:' || isRestrictedHost(parsed)))
    ) {
      throw new ImageBackendError(
        'materialization',
        'Image download URL must use HTTP(S) without embedded credentials.',
      );
    }
    const response = await fetchImpl(parsed, {
      method: 'GET',
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      redirect: 'error',
      credentials: 'omit',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ImageBackendError(
        'materialization',
        'Image download failed.',
        response.status,
      );
    }
    const bytes = await boundedBody(response);
    try {
      validatePngStructure(bytes);
    } catch (cause) {
      throw new ImageBackendError(
        'invalid_png',
        'Downloaded image is not a structurally valid PNG.',
        undefined,
        { cause },
      );
    }
    return bytes.toString('base64');
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    if (error instanceof ImageBackendError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ImageBackendError('timeout', 'Image download timed out.');
    }
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ImageBackendError(
      'materialization',
      'Image download failed.',
      undefined,
      { cause: error },
    );
  }
}

/** Normalize sparse endpoint metadata and materialize URL results as PNG base64. */
export async function parseImageResponse(
  body: unknown,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  options: { readonly allowLocalUrls?: boolean } = {},
): Promise<Omit<ImageBackendResult, 'caption'>> {
  const parsed = isRecord(body) ? body : {};
  const first: unknown = Array.isArray(parsed.data)
    ? parsed.data[0]
    : undefined;
  if (!isRecord(first))
    throw new ImageBackendError(
      'invalid_response',
      'Image endpoint returned no image data.',
    );
  let data: string;
  let mimeType = 'image/png';
  if (typeof first.b64_json === 'string' && first.b64_json !== '') {
    data = first.b64_json;
    const bytes = Buffer.from(data, 'base64');
    if (
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data) ||
      bytes.toString('base64').replace(/=+$/, '') !== data.replace(/=+$/, '')
    ) {
      throw new ImageBackendError(
        options.allowLocalUrls ? 'invalid_png' : 'invalid_image',
        'Image endpoint returned invalid base64 image data.',
      );
    }
    if (bytes.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])))
      mimeType = 'image/png';
    else if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
      mimeType = 'image/jpeg';
    else if (
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP'
    )
      mimeType = 'image/webp';
    else
      throw new ImageBackendError(
        options.allowLocalUrls ? 'invalid_png' : 'invalid_image',
        'Image endpoint returned an unrecognized image format.',
      );
  } else if (typeof first.url === 'string' && first.url !== '') {
    data = await materializeUrl(
      first.url,
      fetchImpl,
      signal,
      options.allowLocalUrls ?? false,
    );
  } else {
    throw new ImageBackendError(
      'invalid_response',
      'Image endpoint returned no image data.',
    );
  }
  return {
    mimeType,
    encoding: 'base64',
    data,
    ...(typeof parsed.quality === 'string' ? { quality: parsed.quality } : {}),
    ...(typeof parsed.size === 'string' ? { size: parsed.size } : {}),
    ...(isRecord(parsed.usage) ? { usage: parsed.usage } : {}),
    ...(typeof first.revised_prompt === 'string'
      ? { revisedPrompt: first.revised_prompt }
      : {}),
  };
}
