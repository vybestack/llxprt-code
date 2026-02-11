/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { expandTildePath } from './paths.js';

const MAX_SUGGESTIONS = 50;

export interface ShellPathSuggestion {
  readonly label: string;
  readonly value: string;
  readonly isDirectory: boolean;
}

export interface PathTokenExtractionResult {
  readonly token: string;
  readonly tokenStart: number;
  readonly tokenEnd: number;
  readonly isPathLike: boolean;
}

export function extractPathToken(
  line: string,
  cursorCol: number,
): PathTokenExtractionResult {
  let wordStart = 0;
  for (let i = cursorCol - 1; i >= 0; i--) {
    const char = line[i];
    if (char === ' ') {
      let backslashCount = 0;
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) {
        backslashCount++;
      }
      if (backslashCount % 2 === 0) {
        wordStart = i + 1;
        break;
      }
    }
  }

  const token = line.substring(wordStart, cursorCol);

  const isPathLike =
    token.startsWith('~/') ||
    token === '~' ||
    token.startsWith('./') ||
    token.startsWith('../') ||
    token.startsWith('/') ||
    token.includes('/');

  return { token, tokenStart: wordStart, tokenEnd: cursorCol, isPathLike };
}

export async function getPathSuggestions(
  partialPath: string,
  cwd: string,
): Promise<readonly ShellPathSuggestion[]> {
  if (partialPath.length === 0) return [];

  try {
    const expandedPath = expandTildePath(partialPath);

    let dirPath: string;
    let prefix: string;

    if (expandedPath.endsWith('/')) {
      dirPath = expandedPath;
      prefix = '';
    } else {
      dirPath = path.dirname(expandedPath);
      prefix = path.basename(expandedPath);
    }

    if (!path.isAbsolute(dirPath)) {
      dirPath = path.resolve(cwd, dirPath);
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    const lowerPrefix = prefix.toLowerCase();
    const showDotFiles = prefix.startsWith('.');

    const filtered = entries.filter((entry) => {
      if (entry.name === '.' || entry.name === '..') return false;
      if (!showDotFiles && entry.name.startsWith('.')) return false;
      return entry.name.toLowerCase().startsWith(lowerPrefix);
    });

    filtered.sort((a, b) => {
      const aIsDir = a.isDirectory() || a.isSymbolicLink();
      const bIsDir = b.isDirectory() || b.isSymbolicLink();
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.name.localeCompare(b.name);
    });

    const limited = filtered.slice(0, MAX_SUGGESTIONS);

    return limited.map((entry) => {
      const isDir = entry.isDirectory() || entry.isSymbolicLink();
      const suffix = isDir ? '/' : '';

      let basePath: string;
      if (partialPath.startsWith('~/') || partialPath === '~') {
        const homeDir = expandTildePath('~');
        const fullEntryPath = path.join(dirPath, entry.name);
        basePath = '~' + fullEntryPath.slice(homeDir.length);
      } else if (partialPath.endsWith('/')) {
        basePath = partialPath + entry.name;
      } else {
        const dirOfPartial = partialPath.substring(
          0,
          partialPath.lastIndexOf('/') + 1,
        );
        basePath = dirOfPartial + entry.name;
      }

      const value = basePath + suffix;

      return {
        label: entry.name + suffix,
        value,
        isDirectory: isDir,
      };
    });
  } catch {
    return [];
  }
}
