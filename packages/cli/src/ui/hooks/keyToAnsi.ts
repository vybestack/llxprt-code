/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Key } from '../contexts/KeypressContext.js';

export type { Key };

const KEY_TO_ANSI = new Map<string, string>([
  ['up', '\x1b[A'],
  ['down', '\x1b[B'],
  ['right', '\x1b[C'],
  ['left', '\x1b[D'],
  ['escape', '\x1b'],
  ['tab', '\t'],
  ['backspace', '\x7f'],
  ['delete', '\x1b[3~'],
  ['home', '\x1b[H'],
  ['end', '\x1b[F'],
  ['pageup', '\x1b[5~'],
  ['pagedown', '\x1b[6~'],
  ['return', '\r'],
]);

function ctrlLetterToAnsi(name: string): string | null {
  if (name >= 'a' && name <= 'z') {
    return String.fromCharCode(name.charCodeAt(0) - 'a'.charCodeAt(0) + 1);
  }
  switch (name) {
    case 'c':
      return '\x03';
    default:
      return null;
  }
}

/**
 * Translates a Key object into its corresponding ANSI escape sequence.
 * This is useful for sending control characters to a pseudo-terminal.
 *
 * @param key The Key object to translate.
 * @returns The ANSI escape sequence as a string, or null if no mapping exists.
 */
export function keyToAnsi(key: Key): string | null {
  if (key.ctrl) {
    return ctrlLetterToAnsi(key.name);
  }

  const mapped = KEY_TO_ANSI.get(key.name);
  if (mapped !== undefined) {
    return mapped;
  }

  if (!key.meta && key.sequence) {
    return key.sequence;
  }

  return null;
}
