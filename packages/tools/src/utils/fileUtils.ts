/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { type PartUnion } from '@google/genai';
import mime from 'mime-types';
import { ToolErrorType } from '../types/tool-error.js';
import { debugLogger } from './debugLogger.js';

// Constants for text file processing
export const DEFAULT_MAX_LINES_TEXT_FILE = 2000;
const MAX_LINE_LENGTH_TEXT_FILE = 2000;

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

  const lookedUpMimeType = mime.lookup(filePath);
  if (typeof lookedUpMimeType === 'string' && lookedUpMimeType !== '') {
    if (lookedUpMimeType.startsWith('image/')) return 'image';
    if (lookedUpMimeType.startsWith('audio/')) return 'audio';
    if (lookedUpMimeType.startsWith('video/')) return 'video';
    if (lookedUpMimeType === 'application/pdf') return 'pdf';
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
  llmContent: PartUnion;
  returnDisplay: string;
  error?: string;
  errorType?: ToolErrorType;
  isTruncated?: boolean;
  originalLineCount?: number;
  linesShown?: [number, number];
}

export function countLines(lines: string[]): number {
  return lines.length > 0 && lines[lines.length - 1] === ''
    ? lines.length - 1
    : lines.length;
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
  const fileSizeInMB = stats.size / (1024 * 1024);
  if (fileSizeInMB > 20) {
    return {
      llmContent: 'File size exceeds the 20MB limit.',
      returnDisplay: 'File size exceeds the 20MB limit.',
      error: `File size exceeds the 20MB limit: ${filePath} (${fileSizeInMB.toFixed(2)}MB)`,
      errorType: ToolErrorType.FILE_TOO_LARGE,
    };
  }
  return null;
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
  };
}

async function processMediaFile(
  filePath: string,
  relativePathForDisplay: string,
  fileType: 'image' | 'pdf' | 'audio' | 'video',
): Promise<ProcessedFileReadResult> {
  const contentBuffer = await fs.promises.readFile(filePath);
  const base64Data = contentBuffer.toString('base64');
  const mimeTypeRaw = mime.lookup(filePath);
  const mimeType =
    typeof mimeTypeRaw === 'string' && mimeTypeRaw !== ''
      ? mimeTypeRaw
      : 'application/octet-stream';

  return {
    llmContent: {
      inlineData: {
        data: base64Data,
        mimeType,
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
      return processMediaFile(filePath, relativePathForDisplay, fileType);
    default:
      return processTextFile(filePath, relativePathForDisplay, offset, limit);
  }
}

export async function processSingleFileContent(
  filePath: string,
  rootDirectory: string,
  offset?: number,
  limit?: number,
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
    };
  }
}
