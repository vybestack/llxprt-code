/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'bun:test';
import type { TextBuffer } from '../ui/components/shared/text-buffer.js';

// RegExp to detect invalid characters: backspace, and ANSI escape codes.
// Build the character class from runtime control-character values so the
// pattern carries the bytes without embedding control characters in source.
const BACKSPACE_CHAR = String.fromCharCode(0x08);
const ESCAPE_CHAR = String.fromCharCode(0x1b);
const invalidCharsRegex = new RegExp(`[${BACKSPACE_CHAR}${ESCAPE_CHAR}]`);

function toHaveOnlyValidCharacters(this: { isNot: boolean }, buffer: unknown) {
  // expect.extend types the received value as `unknown`; callers always invoke
  // this via `expect(textBuffer)`, so narrow back to the concrete type.
  const textBuffer = buffer as TextBuffer;
  const { isNot } = this;
  let pass = true;
  const invalidLines: Array<{ line: number; content: string }> = [];

  for (let i = 0; i < textBuffer.lines.length; i++) {
    const line = textBuffer.lines[i];
    if (line.includes('\n')) {
      pass = false;
      invalidLines.push({ line: i, content: line });
      break; // Fail fast on newlines
    }
    if (invalidCharsRegex.test(line)) {
      pass = false;
      invalidLines.push({ line: i, content: line });
    }
  }

  return {
    pass,
    message: () =>
      `Expected buffer ${isNot === true ? 'not ' : ''}to have only valid characters, but found invalid characters in lines:\n${invalidLines
        .map((l) => `  [${l.line}]: "${l.content}"`)
        .join('\n')}`,
    actual: textBuffer.lines,
    expected: 'Lines with no line breaks, backspaces, or escape codes.',
  };
}

expect.extend({
  toHaveOnlyValidCharacters,
});

// Declare the matcher on Bun's expect. Matchers and AsymmetricMatchers are
// interfaces, so they accept declaration merging.
declare module 'bun:test' {
  interface Matchers<T = unknown> {
    toHaveOnlyValidCharacters(): T;
  }
  interface AsymmetricMatchers {
    toHaveOnlyValidCharacters(): void;
  }
}
