/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import {
  HASH_CHUNK_BYTES,
  boundedReadChanged,
  type PinnedPackageFile,
} from './session-media-package-validation.js';

export interface BoundedLineLimits {
  readonly maxBytes: number;
  readonly maxLineBytes: number;
  readonly label: string;
}

const NEWLINE = 0x0a;

class LineAssembler {
  private parts: Buffer[] = [];
  private lineBytes = 0;
  private pendingBlankLines = 0;
  private lineNumber = 0;

  constructor(
    private readonly limits: BoundedLineLimits,
    private readonly onLine: (
      line: string,
      lineNumber: number,
    ) => Promise<void>,
  ) {}

  async push(chunk: Buffer): Promise<void> {
    let start = 0;
    while (start < chunk.byteLength) {
      const newline = chunk.indexOf(NEWLINE, start);
      const end = newline === -1 ? chunk.byteLength : newline;
      this.append(chunk.subarray(start, end));
      if (newline === -1) return;
      await this.finishLine();
      start = newline + 1;
    }
  }

  /** Emits a final unterminated line; trailing blank lines are dropped. */
  async finish(): Promise<number> {
    if (this.lineBytes > 0) await this.finishLine();
    return this.lineNumber;
  }

  private append(part: Buffer): void {
    this.lineBytes += part.byteLength;
    if (this.lineBytes > this.limits.maxLineBytes) {
      throw new Error(`${this.limits.label} line exceeds finite byte limit`);
    }
    if (part.byteLength > 0) this.parts.push(Buffer.from(part));
  }

  private async finishLine(): Promise<void> {
    const text = Buffer.concat(this.parts, this.lineBytes).toString('utf8');
    this.parts = [];
    this.lineBytes = 0;
    if (text.trim().length === 0) {
      this.pendingBlankLines += 1;
      return;
    }
    for (; this.pendingBlankLines > 0; this.pendingBlankLines -= 1) {
      this.lineNumber += 1;
      await this.onLine('', this.lineNumber);
    }
    this.lineNumber += 1;
    await this.onLine(text, this.lineNumber);
  }
}

async function readLines(
  path: string,
  limits: BoundedLineLimits,
  onLine: (line: string, lineNumber: number) => Promise<void>,
  expected: Pick<PinnedPackageFile, 'byteLength' | 'sha256'> | undefined,
): Promise<{ lineCount: number; pinned: PinnedPackageFile }> {
  const handle = await open(path, 'r');
  const hash = createHash('sha256');
  const assembler = new LineAssembler(limits, onLine);
  let total = 0;
  let result: { lineCount: number; pinned: PinnedPackageFile } | undefined;
  let failure: unknown;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limits.maxBytes) {
      throw new Error(`${limits.label} exceeds finite byte limit`);
    }
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    for (;;) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.byteLength,
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > limits.maxBytes) {
        throw new Error(`${limits.label} exceeds finite byte limit`);
      }
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      await assembler.push(chunk);
    }
    const [after, current] = await Promise.all([handle.stat(), stat(path)]);
    if (boundedReadChanged(before, after, current, total)) {
      throw new Error(`${limits.label} changed during bounded read`);
    }
    const lineCount = await assembler.finish();
    const sha256 = hash.digest('hex');
    if (
      expected !== undefined &&
      (expected.byteLength !== total || expected.sha256 !== sha256)
    ) {
      throw new Error(`${limits.label} changed after validation`);
    }
    result = { lineCount, pinned: { path, byteLength: total, sha256 } };
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (closeError) {
    failure =
      failure === undefined
        ? closeError
        : new AggregateError(
            [failure, closeError],
            `${limits.label} read and file close failed`,
          );
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) throw new Error(`${limits.label} read failed`);
  return result;
}

/**
 * Streams a file line by line under finite total and per-line byte limits,
 * rejecting a file that changed while it was being read.
 */
export function streamBoundedLines(
  path: string,
  limits: BoundedLineLimits,
  onLine: (line: string, lineNumber: number) => Promise<void>,
): Promise<{ lineCount: number; pinned: PinnedPackageFile }> {
  return readLines(path, limits, onLine, undefined);
}

/** As streamBoundedLines, additionally requiring the pinned size and digest. */
export function streamPinnedLines(
  pinned: PinnedPackageFile,
  limits: BoundedLineLimits,
  onLine: (line: string, lineNumber: number) => Promise<void>,
): Promise<{ lineCount: number; pinned: PinnedPackageFile }> {
  return readLines(pinned.path, limits, onLine, pinned);
}
