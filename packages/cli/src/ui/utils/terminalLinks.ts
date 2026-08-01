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
 * Characters in the C0 range (0x00-0x1F) and the C1 range / DEL
 * (0x7F-0x9F) that are forbidden in linkable URLs. Their presence would
 * break the OSC 8 escape sequence or allow terminal-injection attacks.
 * The candidate is untrusted third-party (model) input, so this validation
 * is intentional.
 */
function hasControlCharacter(candidate: string): boolean {
  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

/**
 * Determine whether a candidate string is a safe-to-linkify HTTP(S) URL. The
 * candidate must parse via the WHATWG `URL` constructor, have a protocol of
 * exactly `http:` or `https:`, contain no C0/C1 control characters, and carry
 * no userinfo.
 *
 * Userinfo is rejected because it enables authority confusion: the WHATWG
 * parser reads `https://example.com@evil.com` as user `example.com` on host
 * `evil.com`, so a reader scanning the visible text sees a trusted name while
 * the link navigates elsewhere.
 */
export function isLinkableHttpUrl(candidate: string): boolean {
  if (candidate.length === 0 || hasControlCharacter(candidate)) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return parsed.username === '' && parsed.password === '';
}

/**
 * Create an OSC 8 hyperlink for the given URL. The visible label defaults to
 * the URL itself. Returns `null` when the URL is not a safe, linkable
 * HTTP(S) URL, or when the label contains control characters that would
 * terminate the escape sequence early.
 */
export function createUrlLink(url: string, label?: string): string | null {
  if (!isLinkableHttpUrl(url)) {
    return null;
  }
  if (label !== undefined && hasControlCharacter(label)) {
    return null;
  }
  return createOsc8Link(label ?? url, url);
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
