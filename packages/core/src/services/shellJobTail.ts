/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import type {
  ShellJobTailOptions,
  ShellJobTailResult,
} from './shellJobTypes.js';

const DEFAULT_TAIL_LINES = 50;
const DEFAULT_TAIL_MAX_BYTES = 4096;

/**
 * Read the tail of a log file from the end, without loading the whole file
 * into memory. Uses fs.read with a bounded buffer starting from EOF.
 */
export function tailOutput(
  logPath: string,
  id: string,
  options?: Partial<ShellJobTailOptions>,
): ShellJobTailResult {
  const lines = options?.lines ?? DEFAULT_TAIL_LINES;
  const maxBytes = options?.maxBytes ?? DEFAULT_TAIL_MAX_BYTES;

  const stat = statFile(logPath);
  if (stat === null) {
    return { id, output: '', truncated: false };
  }

  const readSize = Math.min(stat.size, maxBytes);
  const buffer = Buffer.alloc(readSize);
  const position = stat.size - readSize;

  const fd = openForRead(logPath);
  try {
    readBackwards(fd, buffer, position);
  } finally {
    fs.closeSync(fd);
  }

  const text = decodeTail(buffer);
  const { trimmed, truncated } = extractLastLines(text, lines, position > 0);
  return { id, output: trimmed, truncated };
}

function statFile(logPath: string): { size: number } | null {
  try {
    return fs.statSync(logPath);
  } catch {
    return null;
  }
}

function openForRead(logPath: string): number {
  return fs.openSync(logPath, 'r');
}

function readBackwards(fd: number, buffer: Buffer, position: number): void {
  if (buffer.length === 0) {
    return;
  }
  fs.readSync(fd, buffer, 0, buffer.length, position);
}

function decodeTail(buffer: Buffer): string {
  return buffer.toString('utf8');
}

function extractLastLines(
  text: string,
  maxLines: number,
  hasEarlierData: boolean,
): { trimmed: string; truncated: boolean } {
  const allLines = text.split('\n');
  // Remove a trailing empty entry from a trailing newline
  if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
    allLines.pop();
  }
  // If we started mid-file, the first line is partial — drop it
  if (hasEarlierData && allLines.length > 1) {
    allLines.shift();
  }

  const start = Math.max(0, allLines.length - maxLines);
  const selected = allLines.slice(start);
  const truncated = start > 0 || hasEarlierData;
  return { trimmed: selected.join('\n'), truncated };
}
