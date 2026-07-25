/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Load .lycheeignore patterns from the repo root. Each non-empty,
 * non-comment line is a pattern that, when an external URL contains it,
 * suppresses the link check for that URL.
 */
export function loadLycheeignore(root: string): readonly string[] {
  const path = resolve(join(root, '.lycheeignore'));
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * Returns true if the given external URL is ignored by .lycheeignore.
 */
export function isIgnored(url: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => url.includes(p));
}
