/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared NODE_OPTIONS preparation for scripts that spawn Bun children in DEV
 * mode (scripts/start.ts and scripts/memory/launcher.ts).
 *
 * Extracted from start.ts so the launcher reuses the exact same behavior
 * without importing an executing module.
 */

import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Removes any existing --localstorage-file flags (with or without values)
 * from a NODE_OPTIONS string.
 *
 * This faithfully reproduces the original regex semantics:
 *   /\s*--localstorage-file(?:(?:\s*=\s*|\s+)(?!-)\S+)?/g
 * (leading whitespace, optional value via '=' or a whitespace separator, and
 * a value is only consumed when it does not start with '-'). A manual scanner
 * avoids the catastrophic-backtracking risk of the regex while covering the
 * same inputs, including whitespace around '=' and tab separators.
 */
export function removeLocalStorageFlags(nodeOptions: string): string {
  function skipWhitespace(options: string, i: number): number {
    while (i < options.length && /\s/.test(options[i])) {
      i += 1;
    }
    return i;
  }
  function skipNonWhitespace(options: string, i: number): number {
    while (i < options.length && !/\s/.test(options[i])) {
      i += 1;
    }
    return i;
  }
  // Given the index right after a flag token, return the index after any value
  // that should be consumed, or the unchanged flagEnd when no value is taken.
  function indexOfValueEnd(options: string, flagEnd: number): number {
    const peek = skipWhitespace(options, flagEnd);
    const hadSeparator = peek > flagEnd;
    if (peek >= options.length) {
      return flagEnd;
    }
    if (options[peek] === '=') {
      const valueStart = skipWhitespace(options, peek + 1);
      if (valueStart >= options.length || options[valueStart] === '-') {
        return flagEnd;
      }
      return skipNonWhitespace(options, valueStart);
    }
    if (hadSeparator && options[peek] !== '-') {
      return skipNonWhitespace(options, peek);
    }
    return flagEnd;
  }
  function removeLocalStorageFlag(options: string): string {
    const token = '--localstorage-file';
    let result = '';
    let cursor = 0;
    let searchFrom = options.indexOf(token);
    while (searchFrom !== -1) {
      // Consume leading whitespace immediately before the flag (the original
      // regex's leading \s*) so removing the flag does not leave a double space.
      let start = searchFrom;
      while (start > cursor && /\s/.test(options[start - 1])) {
        start -= 1;
      }
      result += options.slice(cursor, start);
      cursor = indexOfValueEnd(options, searchFrom + token.length);
      searchFrom = options.indexOf(token, cursor);
    }
    result += options.slice(cursor);
    return result;
  }
  return removeLocalStorageFlag(nodeOptions).replace(/\s+/g, ' ').trim();
}

/**
 * Prepares DEV-mode NODE_OPTIONS: strips every inherited --localstorage-file
 * variant (flag with value, `=`-attached value, bare flag, surrounding
 * whitespace), then appends exactly one launcher-owned value. This prevents
 * warnings from react-devtools-core when it tries to access localStorage, and
 * keeps the child's local storage stable regardless of what the parent
 * environment carried.
 */
export function prepareDevNodeOptions(
  nodeOptions: string | undefined,
  localStorageFile: string,
): string {
  const sanitized = removeLocalStorageFlags(nodeOptions ?? '');
  const localStorageFlag = `--localstorage-file=${localStorageFile}`;
  return sanitized ? `${sanitized} ${localStorageFlag}` : localStorageFlag;
}

/** The DEV-mode local storage file used by scripts/start.ts. */
export function devLocalStorageFile(): string {
  return join(tmpdir(), 'llxprt-dev-localstorage');
}
