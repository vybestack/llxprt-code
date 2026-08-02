/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Backend-neutral image operation contract.
 *
 * A normalized request includes prompt, a REQUIRED caller-selected output path,
 * zero-to-five input image paths, and a cancellation signal (carried by the
 * AbortSignal passed to the backend). A normalized result includes operation
 * generate/edit, absolute and workspace-relative output paths, MIME,
 * backend/provider identity, model identity, input paths, and model-visible
 * media metadata.
 *
 * The existing strict PNG/base64 validation in `ImageGenerationService.ts` is
 * reused by {@link writeImageAtomically}; this module adds the caller-selected
 * output-path contract, input-path validation, and the normalized operation
 * surface shared by all three entry points (tool, `/image`, CLI flags).
 */

export type ImageOperation = 'generate' | 'edit';

/**
 * A normalized image-operation request.
 *
 * `operation` is derived from the number of input paths: zero → generate,
 * one-to-five → edit. `outputPath` is the caller-selected, REQUIRED output
 * path (relative to the workspace root or absolute within it). `inputPaths`
 * are existing workspace image files used as edit/reference sources.
 */
export interface ImageOperationRequest {
  readonly operation: ImageOperation;
  readonly prompt: string;
  readonly outputPath: string;
  readonly inputPaths: readonly string[];
  readonly sessionId?: string;
}

/**
 * Raw input used to build a normalized request. `inputPaths` is optional;
 * `operation` is inferred. `signal` is an optional cancellation signal that,
 * when present, overrides the dispatch deps signal so entry points (CLI flags,
 * `/image`, tool) can propagate cancellation from their own context.
 */
export interface ImageOperationInput {
  readonly prompt: string;
  readonly outputPath: string;
  readonly inputPaths?: readonly string[];
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
}

/**
 * Backend result for a single generated/edited image (raw bytes metadata).
 */
export interface ImageBackendResult {
  readonly mimeType: string;
  readonly encoding: 'base64' | 'url';
  readonly data: string;
  readonly caption?: string;
  readonly revisedPrompt?: string;
}

/**
 * A normalized image-operation result.
 *
 * Includes the absolute and workspace-relative output paths, MIME, backend and
 * provider identity, model identity, input paths, and a media block suitable
 * for returning the image to a conversational model.
 */
export interface ImageOperationResult {
  readonly operation: ImageOperation;
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
 * Backend capability contract: a backend implements generate and/or edit.
 */
export interface ImageOperationBackend {
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
 * Error thrown when an image operation fails at a specific stage.
 */
export class ImageOperationError extends Error {
  readonly stage:
    | 'input-validation'
    | 'capability'
    | 'output-resolution'
    | 'provider'
    | 'response-validation'
    | 'artifact-write';
  constructor(
    message: string,
    stage: ImageOperationError['stage'],
    options?: { readonly cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ImageOperationError';
    this.stage = stage;
  }
}

const MAX_INPUT_IMAGES = 5;

const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Build a normalized {@link ImageOperationRequest} from raw input.
 *
 * Derives `operation` from the input-path count, validates the prompt is
 * non-empty, the output path is non-empty with a `.png` extension, and the
 * input count is within the zero-to-five bound.
 */
export function buildNormalizedImageRequest(
  input: ImageOperationInput,
): ImageOperationRequest {
  const prompt = input.prompt.trim();
  if (prompt === '') {
    throw new ImageOperationError(
      'Image prompt must not be empty or whitespace-only.',
      'input-validation',
    );
  }
  const outputPath = input.outputPath.trim();
  if (outputPath === '') {
    throw new ImageOperationError(
      'An explicit output path is required.',
      'input-validation',
    );
  }
  if (path.extname(outputPath).toLowerCase() !== '.png') {
    throw new ImageOperationError(
      `Output path must have a .png extension (received "${outputPath}").`,
      'input-validation',
    );
  }
  const inputPaths = input.inputPaths ?? [];
  if (inputPaths.length > MAX_INPUT_IMAGES) {
    throw new ImageOperationError(
      `At most ${MAX_INPUT_IMAGES} input images are supported (received ${inputPaths.length}).`,
      'input-validation',
    );
  }
  const operation: ImageOperation =
    inputPaths.length === 0 ? 'generate' : 'edit';
  return {
    operation,
    prompt,
    outputPath,
    inputPaths: [...inputPaths],
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  };
}

/**
 * Reject if the output path itself is a symlink that escapes the workspace.
 * Uses realpath to fully canonicalize the symlink (multi-hop chains included),
 * then checks containment against the real workspace root. ENOENT (new file)
 * is expected and allowed.
 */
async function rejectSymlinkEscape(
  candidateAbsolute: string,
  realWorkspaceRoot: string,
): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(candidateAbsolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw new ImageOperationError(
      `Failed to stat output path: ${candidateAbsolute}.`,
      'output-resolution',
      { cause: error },
    );
  }
  if (!stat.isSymbolicLink()) return;

  let resolvedTarget: string;
  try {
    resolvedTarget = await fs.realpath(candidateAbsolute);
  } catch (error) {
    throw new ImageOperationError(
      `Failed to canonicalize output symlink: ${candidateAbsolute}.`,
      'output-resolution',
      { cause: error },
    );
  }
  const targetRel = path.relative(realWorkspaceRoot, resolvedTarget);
  if (targetRel.startsWith('..') || path.isAbsolute(targetRel)) {
    throw new ImageOperationError(
      'Output path symlink escapes the workspace.',
      'output-resolution',
    );
  }
}

/**
 * Resolve a caller-selected output path against the workspace root.
 *
 * Relative paths resolve against the workspace root. Output is restricted to
 * the active workspace (traversal and symlink escapes are rejected). The `.png`
 * extension is required. Parent directories are created safely. Returns the
 * absolute and workspace-relative paths.
 */
export async function resolveOutputPath(
  outputPath: string,
  workspaceRoot: string,
): Promise<{ readonly absolute: string; readonly relative: string }> {
  if (path.extname(outputPath).toLowerCase() !== '.png') {
    throw new ImageOperationError(
      `Output path must have a .png extension (received "${outputPath}").`,
      'output-resolution',
    );
  }

  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  let realWorkspaceRoot: string;
  try {
    realWorkspaceRoot = await fs.realpath(resolvedWorkspaceRoot);
  } catch (error) {
    throw new ImageOperationError(
      `Failed to resolve workspace root: ${resolvedWorkspaceRoot}.`,
      'output-resolution',
      { cause: error },
    );
  }

  const candidateAbsolute = path.isAbsolute(outputPath)
    ? path.resolve(outputPath)
    : path.resolve(realWorkspaceRoot, outputPath);

  const relative = path.relative(realWorkspaceRoot, candidateAbsolute);
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    relative === ''
  ) {
    throw new ImageOperationError(
      'Output path must be within the active workspace.',
      'output-resolution',
    );
  }

  await rejectSymlinkEscape(candidateAbsolute, realWorkspaceRoot);

  const parentDir = path.dirname(candidateAbsolute);
  try {
    await fs.mkdir(parentDir, { recursive: true });
  } catch (error) {
    throw new ImageOperationError(
      `Failed to create output directory: ${parentDir}.`,
      'output-resolution',
      { cause: error },
    );
  }

  // After directory creation, canonicalize the parent and verify it remains
  // within the canonical workspace. A child directory that is a symlink or
  // junction to outside the workspace would otherwise let the output escape
  // even though the lexical path looked contained.
  let realParentDir: string;
  try {
    realParentDir = await fs.realpath(parentDir);
  } catch (error) {
    throw new ImageOperationError(
      `Failed to canonicalize output directory: ${parentDir}.`,
      'output-resolution',
      { cause: error },
    );
  }
  const parentRel = path.relative(realWorkspaceRoot, realParentDir);
  if (parentRel.startsWith('..') || path.isAbsolute(parentRel)) {
    throw new ImageOperationError(
      'Output directory escapes the workspace (symlink/junction parent escape).',
      'output-resolution',
    );
  }

  return { absolute: candidateAbsolute, relative };
}

/**
 * Write validated PNG bytes to the target path atomically without clobbering.
 *
 * True atomic publication: bytes are written to an exclusive same-directory
 * temp file, fully flushed via fsync and closed BEFORE the target ever exists.
 * The final target is then published with `fs.link(temp, target)`, which is an
 * atomic no-clobber primitive (fails with EEXIST if the target already exists
 * or appears concurrently) — NOT stat-then-rename. The temp file is unlinked
 * after publication. On any failure (write error, publish EEXIST, abort) the
 * temp file is always removed, so a crash or cancellation never leaves a
 * partial file at the final path.
 *
 * Overwrite is NOT supported: an existing target is rejected. Callers that
 * need replacement must remove the existing file first.
 */
export async function writeImageAtomically(
  bytes: Buffer,
  targetPath: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw new ImageOperationError(
      'Image write was cancelled before it started.',
      'artifact-write',
    );
  }

  const targetDir = path.dirname(targetPath);
  const targetBase = path.basename(targetPath);
  // Same-directory temp so link() is an atomic rename-class operation on the
  // same filesystem. The unique suffix avoids temp collisions.
  const tempPath = path.join(
    targetDir,
    `.${targetBase}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  let published = false;
  const cleanupTemp = async (): Promise<void> => {
    // Swallow cleanup rejections so a temp-removal failure can never mask
    // the original write/publish error that surfaces from the try block.
    await fs.rm(tempPath, { force: true }).catch(() => {});
  };

  const onAbort = () => {
    // No cleanup here: deleting the temp file during publishTempToTarget
    // (fs.link) would cause a spurious ENOENT. The finally block guarantees
    // cleanup on all paths.
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    await writeBytesToTemp(bytes, tempPath, targetPath);
    await publishTempToTarget(tempPath, targetPath);
    published = true;
    await cleanupTemp();
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (!published) {
      await cleanupTemp();
    }
  }
}

/**
 * Write + fsync + close the temp file completely (exclusive O_EXCL). The final
 * target does not exist yet at this point.
 */
async function writeBytesToTemp(
  bytes: Buffer,
  tempPath: string,
  targetPath: string,
): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tempPath, 'wx');
  } catch (error) {
    throw new ImageOperationError(
      `Failed to create temp output file: ${tempPath}.`,
      'artifact-write',
      { cause: error },
    );
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    throw new ImageOperationError(
      `Failed to write image bytes: ${targetPath}.`,
      'artifact-write',
      { cause: error },
    );
  }
  await handle.close();
}

/**
 * Atomically publish the temp file to the target via hard-link (no-clobber).
 * link() fails with EEXIST if the target exists; it does NOT overwrite.
 */
async function publishTempToTarget(
  tempPath: string,
  targetPath: string,
): Promise<void> {
  try {
    await fs.link(tempPath, targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      throw new ImageOperationError(
        `Output file already exists (will not overwrite): ${targetPath}.`,
        'artifact-write',
        { cause: error },
      );
    }
    throw new ImageOperationError(
      `Failed to publish output file: ${targetPath}.`,
      'artifact-write',
      { cause: error },
    );
  }
}

export { MAX_INPUT_IMAGES };

/**
 * Validate and resolve input image paths against the workspace root before any
 * billable provider request. Each path must:
 *   - not be a URL (http/https/file),
 *   - resolve to a canonical location within the workspace (no traversal or
 *     symlink escape),
 *   - be a regular non-symlink file,
 *   - have a `.png` extension and a valid PNG signature,
 *   - be within the bounded max size.
 *
 * Returns the canonical absolute paths in input order. Throws
 * {@link ImageOperationError} (stage `input-validation`) on any violation.
 */
export async function resolveInputPaths(
  inputPaths: readonly string[],
  workspaceRoot: string,
): Promise<readonly string[]> {
  if (inputPaths.length === 0) {
    return [];
  }

  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  let realWorkspaceRoot: string;
  try {
    realWorkspaceRoot = await fs.realpath(resolvedWorkspaceRoot);
  } catch (error) {
    throw new ImageOperationError(
      `Failed to resolve workspace root: ${resolvedWorkspaceRoot}.`,
      'input-validation',
      { cause: error },
    );
  }

  const resolved: string[] = [];
  for (const rawInputPath of inputPaths) {
    resolved.push(
      await resolveSingleInputPath(rawInputPath, realWorkspaceRoot),
    );
  }
  return resolved;
}

async function resolveSingleInputPath(
  rawInputPath: string,
  realWorkspaceRoot: string,
): Promise<string> {
  const inputPath = rawInputPath.trim();
  if (inputPath === '') {
    throw new ImageOperationError(
      'Input image path must not be empty.',
      'input-validation',
    );
  }
  if (/^https?:\/\//i.test(inputPath) || /^file:\/\//i.test(inputPath)) {
    throw new ImageOperationError(
      `Remote URL input images are not supported: ${inputPath}. Use a local workspace file.`,
      'input-validation',
    );
  }

  const candidateAbsolute = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(realWorkspaceRoot, inputPath);

  const relative = path.relative(realWorkspaceRoot, candidateAbsolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ImageOperationError(
      `Input image path must be within the active workspace: ${inputPath}.`,
      'input-validation',
    );
  }

  await validateInputFileStat(candidateAbsolute, inputPath);

  // Canonicalize the resolved file and verify canonical containment. A
  // symlinked parent directory could otherwise resolve to an outside regular
  // file even though the lexical path and the final lstat looked contained.
  let realCandidate: string;
  try {
    realCandidate = await fs.realpath(candidateAbsolute);
  } catch (error) {
    throw new ImageOperationError(
      `Input image could not be canonicalized: ${inputPath}.`,
      'input-validation',
      { cause: error },
    );
  }
  const realRel = path.relative(realWorkspaceRoot, realCandidate);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
    throw new ImageOperationError(
      `Input image path escapes the workspace: ${inputPath}.`,
      'input-validation',
    );
  }

  await validateInputPngSignature(candidateAbsolute, inputPath);

  return candidateAbsolute;
}

async function validateInputFileStat(
  candidateAbsolute: string,
  inputPath: string,
): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(candidateAbsolute);
  } catch (error) {
    throw new ImageOperationError(
      `Input image could not be accessed: ${inputPath}.`,
      'input-validation',
      { cause: error },
    );
  }
  if (stat.isSymbolicLink()) {
    throw new ImageOperationError(
      `Input image is a symbolic link and cannot be used safely: ${inputPath}.`,
      'input-validation',
    );
  }
  if (!stat.isFile()) {
    throw new ImageOperationError(
      `Input image is not a regular file: ${inputPath}.`,
      'input-validation',
    );
  }
  if (stat.size > MAX_INPUT_IMAGE_BYTES) {
    throw new ImageOperationError(
      `Input image exceeds the maximum size: ${inputPath}.`,
      'input-validation',
    );
  }
  if (path.extname(inputPath).toLowerCase() !== '.png') {
    throw new ImageOperationError(
      `Input image must have a .png extension: ${inputPath}.`,
      'input-validation',
    );
  }
}

async function validateInputPngSignature(
  candidateAbsolute: string,
  inputPath: string,
): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(candidateAbsolute);
  } catch (error) {
    throw new ImageOperationError(
      `Input image could not be read: ${inputPath}.`,
      'input-validation',
      { cause: error },
    );
  }
  if (
    bytes.length < PNG_SIGNATURE.length ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new ImageOperationError(
      `Input image has an invalid or unrecognized PNG signature: ${inputPath}.`,
      'input-validation',
    );
  }
}
