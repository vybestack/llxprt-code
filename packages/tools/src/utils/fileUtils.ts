/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { type ContentPartUnion } from '../types/wire-types.js';
import mime from 'mime-types';
import { ToolErrorType } from '../types/tool-error.js';
import { debugLogger } from './debugLogger.js';
import {
  ImageResizeError,
  resizeImageIfNeeded,
  type ImageResizePolicy,
} from './imageResize.js';

// Constants for text file processing
export const DEFAULT_MAX_LINES_TEXT_FILE = 2000;
const MAX_LINE_LENGTH_TEXT_FILE = 2000;
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// Default values for encoding and separator format
export const DEFAULT_ENCODING: BufferEncoding = 'utf-8';

type UnicodeEncoding = 'utf8' | 'utf16le' | 'utf16be' | 'utf32le' | 'utf32be';

interface BOMInfo {
  encoding: UnicodeEncoding;
  bomLength: number;
}

const BINARY_EXTENSIONS = [
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.wasm',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.ico',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wav',
  '.flac',
  '.ogg',
  '.pdf',
];

/** Checks whether the buffer is a UTF-16LE BOM (and not a UTF-32LE BOM). */
function isUtf16leBOM(buf: Buffer): boolean {
  if (buf[0] !== 0xff || buf[1] !== 0xfe) {
    return false;
  }
  return buf.length < 4 || buf[2] !== 0x00 || buf[3] !== 0x00;
}

/** Detect a Unicode BOM (Byte Order Mark) if present. */
export function detectBOM(buf: Buffer): BOMInfo | null {
  if (buf.length >= 4) {
    if (
      buf[0] === 0xff &&
      buf[1] === 0xfe &&
      buf[2] === 0x00 &&
      buf[3] === 0x00
    ) {
      return { encoding: 'utf32le', bomLength: 4 };
    }
    if (
      buf[0] === 0x00 &&
      buf[1] === 0x00 &&
      buf[2] === 0xfe &&
      buf[3] === 0xff
    ) {
      return { encoding: 'utf32be', bomLength: 4 };
    }
  }
  if (
    buf.length >= 3 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    return { encoding: 'utf8', bomLength: 3 };
  }
  if (buf.length >= 2) {
    if (isUtf16leBOM(buf)) {
      return { encoding: 'utf16le', bomLength: 2 };
    }
    if (buf[0] === 0xfe && buf[1] === 0xff) {
      return { encoding: 'utf16be', bomLength: 2 };
    }
  }
  return null;
}

function decodeUTF16BE(buf: Buffer): string {
  if (buf.length === 0) return '';
  const swapped = Buffer.from(buf);
  swapped.swap16();
  return swapped.toString('utf16le');
}

function decodeUTF32(buf: Buffer, littleEndian: boolean): string {
  if (buf.length < 4) return '';
  const usable = buf.length - (buf.length % 4);
  let out = '';
  for (let i = 0; i < usable; i += 4) {
    const cp = littleEndian
      ? (buf[i] |
          (buf[i + 1] << 8) |
          (buf[i + 2] << 16) |
          (buf[i + 3] << 24)) >>>
        0
      : (buf[i + 3] |
          (buf[i + 2] << 8) |
          (buf[i + 1] << 16) |
          (buf[i] << 24)) >>>
        0;
    if (cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) {
      out += String.fromCodePoint(cp);
    } else {
      out += '\uFFFD';
    }
  }
  return out;
}

export async function readFileWithEncoding(filePath: string): Promise<string> {
  const full = await fs.promises.readFile(filePath);
  if (full.length === 0) return '';

  const bom = detectBOM(full);
  if (!bom) {
    return full.toString('utf8');
  }

  const content = full.subarray(bom.bomLength);
  switch (bom.encoding) {
    case 'utf8':
      return content.toString('utf8');
    case 'utf16le':
      return content.toString('utf16le');
    case 'utf16be':
      return decodeUTF16BE(content);
    case 'utf32le':
      return decodeUTF32(content, true);
    case 'utf32be':
      return decodeUTF32(content, false);
    default:
      return content.toString('utf8');
  }
}

export function getSpecificMimeType(filePath: string): string | undefined {
  const lookedUpMime = mime.lookup(filePath);
  return typeof lookedUpMime === 'string' ? lookedUpMime : undefined;
}

export async function isBinaryFile(filePath: string): Promise<boolean> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const stats = await fh.stat();
    const fileSize = stats.size;
    if (fileSize === 0) return false;

    const sampleSize = Math.min(4096, fileSize);
    const buf = Buffer.alloc(sampleSize);
    const { bytesRead } = await fh.read(buf, 0, sampleSize, 0);
    if (bytesRead === 0) return false;

    const bom = detectBOM(buf.subarray(0, Math.min(4, bytesRead)));
    if (bom) return false;

    let nonPrintableCount = 0;
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
      if (buf[i] < 9 || (buf[i] > 13 && buf[i] < 32)) {
        nonPrintableCount++;
      }
    }
    return nonPrintableCount / bytesRead > 0.3;
  } catch (error) {
    debugLogger.warn(
      `Failed to check if file is binary: ${filePath}`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  } finally {
    if (fh) {
      try {
        await fh.close();
      } catch (closeError) {
        debugLogger.warn(
          `Failed to close file handle for: ${filePath}`,
          closeError instanceof Error ? closeError.message : String(closeError),
        );
      }
    }
  }
}

// --- Media magic-byte signatures --------------------------------------------
// Before trusting an extension-derived media mime we verify the file's actual
// bytes against known magic-number signatures. This prevents text/source files
// whose extension collides with a media mime (e.g. .fh -> image/x-freehand,
// .ts -> video/mp2t) from being misclassified and sent as base64 media, which
// causes provider 400 errors. Files whose signature does not verify fall
// through to the content sniff; the check reads only the leading bytes and
// costs sub-ms / sub-KB, so no caching is needed.

interface BytePattern {
  readonly offset: number;
  readonly bytes: readonly number[];
}

type MediaSignature = readonly BytePattern[];

const IMAGE_SIGNATURES: readonly MediaSignature[] = [
  [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }],
  [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }],
  [{ offset: 0, bytes: [0x42, 0x4d] }],
  [{ offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }],
  [{ offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }],
  [{ offset: 0, bytes: [0x00, 0x00, 0x01, 0x00] }],
  [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
];

const AUDIO_SIGNATURES: readonly MediaSignature[] = [
  [{ offset: 0, bytes: [0x49, 0x44, 0x33] }],
  [{ offset: 0, bytes: [0xff, 0xfb] }],
  [{ offset: 0, bytes: [0xff, 0xfa] }],
  [{ offset: 0, bytes: [0xff, 0xf3] }],
  [{ offset: 0, bytes: [0xff, 0xf2] }],
  [{ offset: 0, bytes: [0xff, 0xe3] }],
  [{ offset: 0, bytes: [0xff, 0xe2] }],
  [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x41, 0x56, 0x45] },
  ],
  [{ offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43] }],
  [{ offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] }],
  [{ offset: 0, bytes: [0xff, 0xf1] }],
  [{ offset: 0, bytes: [0xff, 0xf9] }],
  [{ offset: 0, bytes: [0xff, 0xf0] }],
  [{ offset: 0, bytes: [0xff, 0xf8] }],
  [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
  [{ offset: 0, bytes: [0x4d, 0x54, 0x68, 0x64] }],
  [
    { offset: 0, bytes: [0x46, 0x4f, 0x52, 0x4d] },
    { offset: 8, bytes: [0x41, 0x49, 0x46, 0x46] },
  ],
];

const VIDEO_SIGNATURES: readonly MediaSignature[] = [
  [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
  [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x41, 0x56, 0x49, 0x20] },
  ],
  [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }],
  [
    { offset: 0, bytes: [0x47] },
    { offset: 188, bytes: [0x47] },
  ],
];

const PDF_SIGNATURES: readonly MediaSignature[] = [
  [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
];

interface MediaCategory {
  readonly type: 'image' | 'audio' | 'video' | 'pdf';
  readonly signatures: readonly MediaSignature[];
}

function resolveMediaCategory(mimeType: string): MediaCategory | null {
  if (mimeType.startsWith('image/')) {
    return { type: 'image', signatures: IMAGE_SIGNATURES };
  }
  if (mimeType.startsWith('audio/')) {
    return { type: 'audio', signatures: AUDIO_SIGNATURES };
  }
  if (mimeType.startsWith('video/')) {
    return { type: 'video', signatures: VIDEO_SIGNATURES };
  }
  if (mimeType === 'application/pdf') {
    return { type: 'pdf', signatures: PDF_SIGNATURES };
  }
  return null;
}

function headerMatches(
  header: Buffer,
  signatures: readonly MediaSignature[],
): boolean {
  return signatures.some((sig) =>
    sig.every(({ offset, bytes }) => {
      if (offset + bytes.length > header.length) return false;
      return bytes.every((b, i) => header[offset + i] === b);
    }),
  );
}

async function verifyMediaSignature(
  filePath: string,
  signatures: readonly MediaSignature[],
): Promise<boolean> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    const header = buf.subarray(0, bytesRead);
    if (header.length === 0) return false;
    return headerMatches(header, signatures);
  } catch (error) {
    debugLogger.warn(
      `Failed to verify media signature for: ${filePath}`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  } finally {
    if (fh) {
      try {
        await fh.close();
      } catch {
        // ignore close errors
      }
    }
  }
}

export async function detectFileType(
  filePath: string,
): Promise<'text' | 'image' | 'pdf' | 'audio' | 'video' | 'binary' | 'svg'> {
  const ext = path.extname(filePath).toLowerCase();

  if (['.ts', '.mts', '.cts', '.tsx'].includes(ext)) {
    return 'text';
  }
  if (ext === '.svg') {
    return 'svg';
  }

  // mime-db maps the FreeHand family (.fh, .fh4, .fh5, .fh7, .fhc) to
  // image/x-freehand, but these extensions are commonly shader/source text.
  // Exclude them from the image short-circuit below so they fall through to
  // content-based detection (text or binary).
  const freehandExtensions = ['.fh', '.fh4', '.fh5', '.fh7', '.fhc'];

  const lookedUpMimeType = mime.lookup(filePath);
  if (
    typeof lookedUpMimeType === 'string' &&
    lookedUpMimeType !== '' &&
    !freehandExtensions.includes(ext)
  ) {
    const category = resolveMediaCategory(lookedUpMimeType);
    if (category) {
      if (await verifyMediaSignature(filePath, category.signatures)) {
        return category.type;
      }
      // Signature did not verify. If the content is clearly text, reclassify
      // as text to avoid sending source/text as base64 media (provider 400).
      // Binary-but-unrecognized content is classified as binary rather than
      // the media type: an unverified binary blob sent as base64 media would
      // trigger the same provider 400 errors this feature prevents.
      if (!(await isBinaryFile(filePath))) {
        return 'text';
      }
      return 'binary';
    }
  }

  if (BINARY_EXTENSIONS.includes(ext)) {
    return 'binary';
  }

  if (await isBinaryFile(filePath)) {
    return 'binary';
  }
  return 'text';
}

export interface ProcessedFileReadResult {
  llmContent: ContentPartUnion;
  returnDisplay: string;
  error?: string;
  errorType?: ToolErrorType;
  errorKind?: 'image-resize';
  isTruncated?: boolean;
  originalLineCount?: number;
  linesShown?: [number, number];
  /**
   * True when at least one returned line was shortened because it exceeded the
   * maximum line length. Distinct from `isTruncated` (which also covers range
   * narrowing), so consumers like read_line_range can flag genuine per-line
   * truncation without implying the requested range was incomplete.
   */
  linesShortened?: boolean;
}

export function isAssetExplicitlyRequested(
  filePath: string,
  inputPatterns: readonly string[],
): boolean {
  const fileExtension = path.extname(filePath).toLowerCase();
  const fileNameWithoutExtension = path.basename(filePath, fileExtension);
  return inputPatterns.some(
    (pattern) =>
      pattern.toLowerCase().includes(fileExtension) ||
      pattern.includes(fileNameWithoutExtension),
  );
}

export async function shouldResizeExplicitImage(
  filePath: string,
  inputPatterns: readonly string[],
  hasResizePolicy: boolean,
): Promise<boolean> {
  return (
    hasResizePolicy &&
    isAssetExplicitlyRequested(filePath, inputPatterns) &&
    (await detectFileType(filePath)) === 'image'
  );
}

export function getReturnedByteLength(result: ProcessedFileReadResult): number {
  if (typeof result.llmContent === 'string') {
    return Buffer.byteLength(result.llmContent);
  }
  const data = result.llmContent.inlineData?.data;
  return data === undefined ? 0 : Buffer.byteLength(data, 'base64');
}
export function createImageResizeToolResult(
  message: string,
  type: ToolErrorType | undefined,
  totalTokens: number,
): {
  done: true;
  totalTokens: number;
  error: {
    llmContent: string;
    returnDisplay: string;
    error: { message: string; type: ToolErrorType | undefined };
  };
} {
  return {
    done: true,
    totalTokens,
    error: {
      llmContent: message,
      returnDisplay: `## Image Resize Error\n\n${message}`,
      error: { message, type },
    },
  };
}

export function getImageResizeToolResult(
  result: ProcessedFileReadResult,
  totalTokens: number,
): ReturnType<typeof createImageResizeToolResult> | undefined {
  return result.errorKind === 'image-resize' && result.error !== undefined
    ? createImageResizeToolResult(result.error, result.errorType, totalTokens)
    : undefined;
}

export function getProcessedFileErrorReason(
  result: ProcessedFileReadResult,
): string | undefined {
  return result.error === undefined ? undefined : `Read error: ${result.error}`;
}

function returnedImageExceedsLimit(
  result: ProcessedFileReadResult,
  shouldResize: boolean,
  outputLimit: number,
): boolean {
  return shouldResize && getReturnedByteLength(result) > outputLimit;
}

export function getReturnedImageLimitReason(
  result: ProcessedFileReadResult,
  shouldResize: boolean,
  outputLimit: number,
): string | undefined {
  return returnedImageExceedsLimit(result, shouldResize, outputLimit)
    ? `returned file size exceeds limit (${Math.round(outputLimit / 1024)}KB)`
    : undefined;
}

export function getProcessedFileSkipReason(
  result: ProcessedFileReadResult,
  shouldResize: boolean,
  outputLimit: number,
): string | undefined {
  return (
    getProcessedFileErrorReason(result) ??
    getReturnedImageLimitReason(result, shouldResize, outputLimit)
  );
}

export function countLines(lines: string[]): number {
  return lines.length > 0 && lines[lines.length - 1] === ''
    ? lines.length - 1
    : lines.length;
}
export function getImageSourceSizeLimit(
  shouldResize: boolean,
  outputLimit: number,
): number {
  return shouldResize ? MAX_FILE_SIZE_BYTES : outputLimit;
}

/**
 * Shared pre-read file-size validation contract. Carries the existing
 * FILE_TOO_LARGE message/type so every consumer (the read-content path and the
 * pre-read stat gate) shares ONE threshold/message definition.
 */
export interface FileSizeGateError {
  readonly message: string;
  readonly type: ToolErrorType.FILE_TOO_LARGE;
}

/**
 * The single file-size validation primitive. Returns a structured
 * {@link FileSizeGateError} when `sizeBytes` exceeds the 20 MiB limit, or
 * `null` when it is within the limit. Both the existing
 * {@link processSingleFileContent} size gate and the pre-read stat helper
 * delegate to this so the threshold and message cannot drift apart.
 */
export function validateFileSizeBytes(
  filePath: string,
  sizeBytes: number,
): FileSizeGateError | null {
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    const sizeInMB = sizeBytes / (1024 * 1024);
    return {
      message: `File size exceeds the 20MB limit: ${filePath} (${sizeInMB.toFixed(2)}MB)`,
      type: ToolErrorType.FILE_TOO_LARGE,
    };
  }
  return null;
}

/**
 * Pre-read file-size gate shared by read and modification tools.
 *
 * Stats the target; if it exists and exceeds {@link MAX_FILE_SIZE_BYTES},
 * returns a {@link FileSizeGateError} via the shared primitive. Returns `null`
 * when the file does not exist (so new-file creation paths are unaffected) or
 * is within the limit.
 *
 * This is the single reuse point for the pre-read size policy — every public
 * target-read path calls this before materializing content.
 */
export async function statFileSizeGate(
  filePath: string,
): Promise<FileSizeGateError | null> {
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch {
    // Missing/unstatable file: let the caller's read path handle ENOENT etc.
    return null;
  }
  // FILE_TOO_LARGE applies only to regular files; non-regular targets
  // (directories, devices, sockets) fall through to their established
  // directory/error handling rather than being misclassified as oversized.
  if (!stats.isFile()) {
    return null;
  }
  return validateFileSizeBytes(filePath, stats.size);
}

function validateFileAccess(filePath: string): ProcessedFileReadResult | null {
  if (!fs.existsSync(filePath)) {
    return {
      llmContent:
        'Could not read file because no file was found at the specified path.',
      returnDisplay: 'File not found.',
      error: `File not found: ${filePath}`,
      errorType: ToolErrorType.FILE_NOT_FOUND,
    };
  }
  return null;
}

function validateNotDirectory(
  filePath: string,
  stats: fs.Stats,
): ProcessedFileReadResult | null {
  if (stats.isDirectory()) {
    return {
      llmContent:
        'Could not read file because the provided path is a directory, not a file.',
      returnDisplay: 'Path is a directory.',
      error: `Path is a directory, not a file: ${filePath}`,
      errorType: ToolErrorType.TARGET_IS_DIRECTORY,
    };
  }
  return null;
}

function validateFileSize(
  filePath: string,
  stats: fs.Stats,
): ProcessedFileReadResult | null {
  const gate = validateFileSizeBytes(filePath, stats.size);
  if (gate === null) {
    return null;
  }
  return {
    llmContent: 'File size exceeds the 20MB limit.',
    returnDisplay: 'File size exceeds the 20MB limit.',
    error: gate.message,
    errorType: gate.type,
  };
}

function processBinaryFile(
  relativePathForDisplay: string,
): ProcessedFileReadResult {
  return {
    llmContent: `Cannot display content of binary file: ${relativePathForDisplay}`,
    returnDisplay: `Skipped binary file: ${relativePathForDisplay}`,
  };
}

async function processSvgFile(
  filePath: string,
  relativePathForDisplay: string,
  stats: fs.Stats,
): Promise<ProcessedFileReadResult> {
  const svgMaxSizeBytes = 1 * 1024 * 1024;
  if (stats.size > svgMaxSizeBytes) {
    return {
      llmContent: `Cannot display content of SVG file larger than 1MB: ${relativePathForDisplay}`,
      returnDisplay: `Skipped large SVG file (>1MB): ${relativePathForDisplay}`,
    };
  }
  const content = await readFileWithEncoding(filePath);
  return {
    llmContent: content,
    returnDisplay: `Read SVG as text: ${relativePathForDisplay}`,
  };
}

async function processTextFile(
  filePath: string,
  relativePathForDisplay: string,
  offset: number | undefined,
  limit: number | undefined,
): Promise<ProcessedFileReadResult> {
  const content = await readFileWithEncoding(filePath);
  const lines = content.split('\n');
  const originalLineCount = countLines(lines);

  const startLine = offset !== undefined && !Number.isNaN(offset) ? offset : 0;
  const effectiveLimit = limit ?? DEFAULT_MAX_LINES_TEXT_FILE;
  const endLine = Math.min(startLine + effectiveLimit, originalLineCount);
  const actualStartLine = Math.min(startLine, originalLineCount);
  const selectedLines = lines.slice(actualStartLine, endLine);

  const formattedLines = selectedLines.map((line) =>
    line.length > MAX_LINE_LENGTH_TEXT_FILE
      ? line.substring(0, MAX_LINE_LENGTH_TEXT_FILE) + '... [truncated]'
      : line,
  );
  const linesWereTruncatedInLength = selectedLines.some(
    (line) => line.length > MAX_LINE_LENGTH_TEXT_FILE,
  );

  const contentRangeTruncated = startLine > 0 || endLine < originalLineCount;
  const isTruncated = contentRangeTruncated || linesWereTruncatedInLength;
  const llmContent = formattedLines.join('\n');

  let returnDisplay = '';
  if (contentRangeTruncated) {
    returnDisplay = `Read lines ${
      actualStartLine + 1
    }-${endLine} of ${originalLineCount} from ${relativePathForDisplay}`;
    if (linesWereTruncatedInLength) {
      returnDisplay += ' (some lines were shortened)';
    }
  } else if (linesWereTruncatedInLength) {
    returnDisplay = `Read all ${originalLineCount} lines from ${relativePathForDisplay} (some lines were shortened)`;
  }

  return {
    llmContent,
    returnDisplay,
    isTruncated,
    originalLineCount,
    linesShown: [actualStartLine + 1, endLine],
    linesShortened: linesWereTruncatedInLength,
  };
}

async function processMediaFile(
  filePath: string,
  relativePathForDisplay: string,
  fileType: 'image' | 'pdf' | 'audio' | 'video',
  imageResizePolicy: ImageResizePolicy | undefined,
): Promise<ProcessedFileReadResult> {
  const contentBuffer = await fs.promises.readFile(filePath);
  const mimeTypeRaw = mime.lookup(filePath);
  const mimeType =
    typeof mimeTypeRaw === 'string' && mimeTypeRaw !== ''
      ? mimeTypeRaw
      : 'application/octet-stream';
  const displayName = path.basename(relativePathForDisplay);
  const outputBuffer =
    fileType === 'image'
      ? await resizeImageIfNeeded(
          contentBuffer,
          mimeType,
          displayName,
          imageResizePolicy,
        )
      : contentBuffer;

  return {
    llmContent: {
      inlineData: {
        data: outputBuffer.toString('base64'),
        mimeType,
        displayName,
      },
    },
    returnDisplay: `Read ${fileType} file: ${relativePathForDisplay}`,
  };
}

async function processFileByType(
  filePath: string,
  relativePathForDisplay: string,
  fileType: Awaited<ReturnType<typeof detectFileType>>,
  stats: fs.Stats,
  offset: number | undefined,
  limit: number | undefined,
  imageResizePolicy: ImageResizePolicy | undefined,
): Promise<ProcessedFileReadResult> {
  switch (fileType) {
    case 'binary':
      return processBinaryFile(relativePathForDisplay);
    case 'svg':
      return processSvgFile(filePath, relativePathForDisplay, stats);
    case 'text':
      return processTextFile(filePath, relativePathForDisplay, offset, limit);
    case 'image':
    case 'pdf':
    case 'audio':
    case 'video':
      return processMediaFile(
        filePath,
        relativePathForDisplay,
        fileType,
        imageResizePolicy,
      );
    default:
      return processTextFile(filePath, relativePathForDisplay, offset, limit);
  }
}

export async function processSingleFileContent(
  filePath: string,
  rootDirectory: string,
  offset?: number,
  limit?: number,
  imageResizePolicy?: ImageResizePolicy,
): Promise<ProcessedFileReadResult> {
  try {
    const accessError = validateFileAccess(filePath);
    if (accessError) return accessError;

    const stats = await fs.promises.stat(filePath);
    const dirError = validateNotDirectory(filePath, stats);
    if (dirError) return dirError;

    const sizeError = validateFileSize(filePath, stats);
    if (sizeError) return sizeError;

    const fileType = await detectFileType(filePath);
    const relativePathForDisplay = path
      .relative(rootDirectory, filePath)
      .replace(/\\/g, '/');

    return await processFileByType(
      filePath,
      relativePathForDisplay,
      fileType,
      stats,
      offset,
      limit,
      imageResizePolicy,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const displayPath = path
      .relative(rootDirectory, filePath)
      .replace(/\\/g, '/');
    return {
      llmContent: `Error reading file ${displayPath}: ${errorMessage}`,
      returnDisplay: `Error reading file ${displayPath}: ${errorMessage}`,
      error: `Error reading file ${filePath}: ${errorMessage}`,
      errorType: ToolErrorType.READ_CONTENT_FAILURE,
      errorKind: error instanceof ImageResizeError ? 'image-resize' : undefined,
    };
  }
}
