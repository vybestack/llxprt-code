/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildNormalizedImageRequest,
  resolveOutputPath,
  resolveInputPaths,
  writeImageAtomically,
  ImageOperationError,
  type ImageOperationInput,
  type ImageOperationResult,
  type ImageOperationBackend,
} from './imageOperation.js';
import {
  strictBase64Decode,
  validatePngStructure,
  ImagePersistenceError,
} from './ImageGenerationService.js';

/**
 * Resolves the active image-operation backend, or null when none is available.
 * This is the capability seam all three entry points share.
 */
export type ImageOperationBackendResolver = () => ImageOperationBackend | null;

/**
 * Dependencies for {@link runImageOperation}.
 */
export interface ImageOperationDispatchDeps {
  readonly workspaceRoot: string;
  readonly resolveBackend: ImageOperationBackendResolver;
  readonly signal?: AbortSignal;
}

/**
 * Dispatch generate or edit on the backend based on the operation.
 */
async function dispatchBackend(
  backend: ImageOperationBackend,
  request: {
    readonly operation: 'generate' | 'edit';
    readonly prompt: string;
    readonly inputPaths: readonly string[];
    readonly sessionId?: string;
  },
  signal: AbortSignal,
) {
  const sessionArg =
    request.sessionId !== undefined ? { sessionId: request.sessionId } : {};
  return request.operation === 'generate'
    ? backend.generate({ prompt: request.prompt, ...sessionArg }, signal)
    : backend.edit(
        {
          prompt: request.prompt,
          inputPaths: request.inputPaths,
          ...sessionArg,
        },
        signal,
      );
}

/**
 * Strictly decode and validate the backend result into a Buffer.
 *
 * Reuses the canonical base64 + full PNG structural validation from
 * ImageGenerationService so caller-selected writes are held to the same
 * standard as the legacy generated-images path. Throws
 * {@link ImageOperationError} (stage `response-validation`) on any violation.
 */
function decodeBackendResult(data: string): Buffer {
  try {
    const bytes = strictBase64Decode(data);
    if (bytes.length === 0) {
      throw new ImagePersistenceError('Image result decoded to empty content.');
    }
    validatePngStructure(bytes);
    return bytes;
  } catch (error) {
    if (error instanceof ImageOperationError) throw error;
    throw new ImageOperationError(
      `Image result failed validation: ${error instanceof Error ? error.message : String(error)}`,
      'response-validation',
      { cause: error },
    );
  }
}

/**
 * Validate the backend result's encoding and MIME before write/result.
 *
 * Encoding must be base64 and the declared MIME must be image/png (output MIME
 * consistency after strict PNG structural validation). Throws
 * {@link ImageOperationError} (stage `response-validation`) on any violation.
 */
function validateBackendResultMime(backendResult: {
  readonly encoding: string;
  readonly mimeType: string;
}): void {
  if (backendResult.encoding !== 'base64') {
    throw new ImageOperationError(
      `Only base64-encoded image results are supported (received "${backendResult.encoding}").`,
      'response-validation',
    );
  }
  if (backendResult.mimeType !== 'image/png') {
    throw new ImageOperationError(
      `Only image/png results are supported (received "${backendResult.mimeType}").`,
      'response-validation',
    );
  }
}

/**
 * Run a complete image operation (generate or edit) end-to-end.
 *
 * This is the single shared service entry point that the `generate_image`
 * tool, the `/image` slash command, and the CLI image flags all converge on.
 * It builds and validates the request, resolves the output path, resolves the
 * backend, dispatches, writes atomically, and returns a normalized result.
 */
export async function runImageOperation(
  input: ImageOperationInput,
  deps: ImageOperationDispatchDeps,
): Promise<ImageOperationResult> {
  const signal = input.signal ?? deps.signal ?? new AbortController().signal;
  const request = buildNormalizedImageRequest(input);

  const { absolute, relative } = await resolveOutputPath(
    request.outputPath,
    deps.workspaceRoot,
  );

  // Prevalidate ALL input paths before any billable provider request so a
  // validation failure never reaches the backend. Canonical absolute paths
  // are passed to the backend (the backend owns encoding them as data URLs).
  const resolvedInputPaths = await resolveInputPaths(
    request.inputPaths,
    deps.workspaceRoot,
  );

  const backend = deps.resolveBackend();
  if (backend === null) {
    throw new ImageOperationError(
      'No image-capable backend is registered for the current setup.',
      'capability',
    );
  }

  let backendResult;
  try {
    backendResult = await dispatchBackend(
      backend,
      {
        operation: request.operation,
        prompt: request.prompt,
        inputPaths: resolvedInputPaths,
        ...(request.sessionId !== undefined
          ? { sessionId: request.sessionId }
          : {}),
      },
      signal,
    );
  } catch (error) {
    if (error instanceof ImageOperationError) throw error;
    throw new ImageOperationError(
      `Image ${request.operation} failed: ${error instanceof Error ? error.message : String(error)}`,
      'provider',
      { cause: error },
    );
  }

  validateBackendResultMime(backendResult);

  const bytes = decodeBackendResult(backendResult.data);

  try {
    await writeImageAtomically(bytes, absolute, signal);
  } catch (error) {
    if (error instanceof ImageOperationError) throw error;
    throw new ImageOperationError(
      `Failed to write image artifact: ${error instanceof Error ? error.message : String(error)}`,
      'artifact-write',
      { cause: error },
    );
  }

  return {
    operation: request.operation,
    absoluteOutputPath: absolute,
    relativeOutputPath: relative,
    mimeType: backendResult.mimeType,
    backend: backend.name,
    provider: backend.provider,
    model: backend.model,
    inputPaths: resolvedInputPaths,
    media: {
      mimeType: backendResult.mimeType,
      encoding: 'base64',
      data: backendResult.data,
    },
  };
}
