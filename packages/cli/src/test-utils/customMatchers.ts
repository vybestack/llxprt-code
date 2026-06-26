/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

import { expect } from 'vitest';
import type { TextBuffer } from '../ui/components/shared/text-buffer.js';

// RegExp to detect invalid characters: backspace, and ANSI escape codes.
// Build the character class from runtime control-character values so the
// pattern carries the bytes without embedding control characters in source.
const BACKSPACE_CHAR = String.fromCharCode(0x08);
const ESCAPE_CHAR = String.fromCharCode(0x1b);
const invalidCharsRegex = new RegExp(`[${BACKSPACE_CHAR}${ESCAPE_CHAR}]`);

function toHaveOnlyValidCharacters(
  this: { isNot: boolean },
  buffer: TextBuffer,
) {
  const { isNot } = this;
  let pass = true;
  const invalidLines: Array<{ line: number; content: string }> = [];

  for (let i = 0; i < buffer.lines.length; i++) {
    const line = buffer.lines[i];
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
    actual: buffer.lines,
    expected: 'Lines with no line breaks, backspaces, or escape codes.',
  };
}

expect.extend({
  toHaveOnlyValidCharacters,
});

// Extend Vitest's `expect` interface with the custom matcher's type definition.
declare module 'vitest' {
  interface Assertion<T> {
    toHaveOnlyValidCharacters(): T;
  }
  interface AsymmetricMatchersContaining {
    toHaveOnlyValidCharacters(): void;
  }
}
