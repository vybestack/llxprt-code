/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { escapePath, expandTildePath, unescapePath } from './paths.js';

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

async function resolveIsDirectory(
  dirPath: string,
  entry: {
    name: string;
    isDirectory: () => boolean;
    isSymbolicLink: () => boolean;
  },
): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    try {
      const stat = await fs.stat(path.join(dirPath, entry.name));
      return stat.isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}

export async function getPathSuggestions(
  partialPath: string,
  cwd: string,
): Promise<readonly ShellPathSuggestion[]> {
  if (partialPath.length === 0) return [];

  try {
    const unescapedPartial = unescapePath(partialPath);

    const normalizedPath = unescapedPartial === '~' ? '~/' : unescapedPartial;
    const expandedPath = expandTildePath(normalizedPath);

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

    const withDirInfo = await Promise.all(
      filtered.map(async (entry) => ({
        entry,
        isDir: await resolveIsDirectory(dirPath, entry),
      })),
    );

    withDirInfo.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.entry.name.localeCompare(b.entry.name);
    });

    const limited = withDirInfo.slice(0, MAX_SUGGESTIONS);

    const escapedNormalizedPath = partialPath === '~' ? '~/' : partialPath;

    return limited.map(({ entry, isDir }) => {
      const suffix = isDir ? '/' : '';
      const escapedName = escapePath(entry.name);

      let basePath: string;
      if (partialPath.startsWith('~/') || partialPath === '~') {
        const homeDir = expandTildePath('~');
        const fullEntryPath = path.join(dirPath, entry.name);
        const relativeFromHome = fullEntryPath.slice(homeDir.length);
        const segments = relativeFromHome.split('/').filter(Boolean);
        basePath = '~/' + segments.map((s) => escapePath(s)).join('/');
      } else if (escapedNormalizedPath.endsWith('/')) {
        basePath = escapedNormalizedPath + escapedName;
      } else {
        const dirOfPartial = partialPath.substring(
          0,
          partialPath.lastIndexOf('/') + 1,
        );
        basePath = dirOfPartial + escapedName;
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
