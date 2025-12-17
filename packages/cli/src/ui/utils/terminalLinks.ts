/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Helpers for terminal hyperlinks (OSC 8).
 *
 * OSC 8 links can be terminated by either BEL (\x07) or ST (ESC \).
 * Ink's current tokenizer stack only recognizes BEL-terminated links, so we
 * intentionally use BEL for compatibility.
 */

import { ESC } from './input.js';

const BEL = '\x07';

export function createOsc8Link(label: string, url: string): string {
  return `${ESC}]8;;${url}${BEL}${label}${ESC}]8;;${BEL}`;
}
