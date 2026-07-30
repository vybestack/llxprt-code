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

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ESC } from './input.js';

const BEL = '\x07';

const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,10}$/;

const LINK_CACHE_MAX = 500;
const linkCache = new Map<string, string | null>();

export function createOsc8Link(label: string, url: string): string {
  return `${ESC}]8;;${url}${BEL}${label}${ESC}]8;;${BEL}`;
}

/**
 * Heuristic check: does the candidate look like a plausible file path? It must
 * contain a path separator, or start with a `.`/`..` relative marker, or have a
 * file extension. This avoids touching plain words like "hello".
 */
function looksLikeFilePath(candidate: string): boolean {
  if (candidate.includes('/') || candidate.includes('\\')) {
    return true;
  }
  if (candidate.startsWith('..') || candidate.startsWith('.')) {
    return true;
  }
  return FILE_EXTENSION_PATTERN.test(candidate);
}

/**
 * Convert an absolute filesystem path into a `file://` URI using Node's
 * built-in `pathToFileURL`, which correctly handles Windows drive letters
 * and special characters/spaces.
 */
function toFileUri(absolutePath: string): string {
  try {
    return pathToFileURL(absolutePath).href;
  } catch {
    return absolutePath;
  }
}

/**
 * Attempts to resolve a candidate string as a file path and returns an
 * OSC 8 link if the path exists on disk. Returns null otherwise.
 *
 * - Absolute paths are checked directly.
 * - Relative paths are resolved against each workspace directory until
 *   one resolves to an existing file.
 *
 * Results are memoized in a bounded LRU-style cache to avoid repeated
 * synchronous filesystem probes during incremental rendering.
 */
export function createFilePathLink(
  candidate: string,
  workspaceDirectories: readonly string[],
): string | null {
  if (!looksLikeFilePath(candidate)) {
    return null;
  }

  const cacheKey = `${candidate}::${workspaceDirectories.join(',')}`;
  if (linkCache.has(cacheKey)) {
    return linkCache.get(cacheKey) ?? null;
  }

  let result: string | null = null;

  if (path.isAbsolute(candidate)) {
    if (fs.existsSync(candidate)) {
      result = createOsc8Link(candidate, toFileUri(candidate));
    }
  } else {
    for (const dir of workspaceDirectories) {
      const resolved = path.resolve(dir, candidate);
      if (fs.existsSync(resolved)) {
        result = createOsc8Link(candidate, toFileUri(resolved));
        break;
      }
    }
  }

  if (linkCache.size >= LINK_CACHE_MAX) {
    const firstKey = linkCache.keys().next().value;
    if (firstKey !== undefined) {
      linkCache.delete(firstKey);
    }
  }
  linkCache.set(cacheKey, result);

  return result;
}
