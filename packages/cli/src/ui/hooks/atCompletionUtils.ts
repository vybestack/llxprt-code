/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type { FileDiscoveryService } from '@vybestack/llxprt-code-core';
import {
  escapePath,
  unescapePath,
  SHELL_SPECIAL_CHARS,
} from '@vybestack/llxprt-code-core';
import type { Suggestion } from '../components/SuggestionsDisplay.js';
import type { ParsedAtPath } from './slashCompletionTypes.js';

/**
 * Parses the @ command path to extract directory and prefix info.
 */
export function parseAtPath(
  commandIndex: number,
  currentLine: string,
  completionEnd: number,
): ParsedAtPath {
  const pathStart = commandIndex + 1;
  const partialPath = currentLine.substring(pathStart, completionEnd);
  const lastSlashIndex = partialPath.lastIndexOf('/');
  const baseDirRelative =
    lastSlashIndex === -1 ? '.' : partialPath.substring(0, lastSlashIndex + 1);
  const prefix = unescapePath(
    lastSlashIndex === -1
      ? partialPath
      : partialPath.substring(lastSlashIndex + 1),
  );

  return {
    baseDirRelative,
    prefix,
    partialPath,
    pathStart,
  };
}

/**
 * Checks if an entry should be ignored based on dotfile rules.
 */
function shouldIgnoreDotfile(entryName: string, searchPrefix: string): boolean {
  return !searchPrefix.startsWith('.') && entryName.startsWith('.');
}

/**
 * Checks if entry should be ignored by file discovery service.
 */
function shouldIgnoreByDiscovery(
  entryPathFromRoot: string,
  fileDiscovery: FileDiscoveryService | null,
  filterOptions: {
    respectGitIgnore?: boolean;
    respectLlxprtIgnore?: boolean;
  },
): boolean {
  return (
    fileDiscovery?.shouldIgnoreFile(entryPathFromRoot, filterOptions) === true
  );
}

/**
 * Creates a suggestion from a directory entry.
 */
function createSuggestion(
  entryPathRelative: string,
  isDirectory: boolean,
): Suggestion {
  return {
    label: entryPathRelative + (isDirectory ? '/' : ''),
    value: escapePath(entryPathRelative + (isDirectory ? '/' : '')),
  };
}

/**
 * Recursively finds files matching a prefix.
 */
export async function findFilesRecursively(
  startDir: string,
  searchPrefix: string,
  fileDiscovery: FileDiscoveryService | null,
  filterOptions: {
    respectGitIgnore?: boolean;
    respectLlxprtIgnore?: boolean;
  },
  currentRelativePath = '',
  depth = 0,
  maxDepth = 10,
  maxResults = 50,
): Promise<Suggestion[]> {
  if (depth > maxDepth) {
    return [];
  }

  const lowerSearchPrefix = searchPrefix.toLowerCase();
  let foundSuggestions: Suggestion[] = [];

  try {
    const entries = await fs.readdir(startDir, { withFileTypes: true });

    for (const entry of entries) {
      if (foundSuggestions.length >= maxResults) break;
      const entryPathRelative = path.join(currentRelativePath, entry.name);

      const shouldProcessEntry =
        !shouldIgnoreDotfile(entry.name, searchPrefix) &&
        !shouldIgnoreByDiscovery(
          entryPathRelative,
          fileDiscovery,
          filterOptions,
        );

      if (shouldProcessEntry) {
        foundSuggestions = await collectRecursiveEntrySuggestions({
          foundSuggestions,
          entry,
          entryPathRelative,
          lowerSearchPrefix,
          startDir,
          searchPrefix,
          fileDiscovery,
          filterOptions,
          depth,
          maxDepth,
          maxResults,
        });
      }
    }
  } catch {
    // Ignore errors like permission denied or ENOENT during recursive search
  }

  return foundSuggestions.slice(0, maxResults);
}
interface RecursiveEntryParams {
  foundSuggestions: Suggestion[];
  entry: Dirent;
  entryPathRelative: string;
  lowerSearchPrefix: string;
  startDir: string;
  searchPrefix: string;
  fileDiscovery: FileDiscoveryService | null;
  filterOptions: {
    respectGitIgnore?: boolean;
    respectLlxprtIgnore?: boolean;
  };
  depth: number;
  maxDepth: number;
  maxResults: number;
}

async function collectRecursiveEntrySuggestions({
  foundSuggestions,
  entry,
  entryPathRelative,
  lowerSearchPrefix,
  startDir,
  searchPrefix,
  fileDiscovery,
  filterOptions,
  depth,
  maxDepth,
  maxResults,
}: RecursiveEntryParams): Promise<Suggestion[]> {
  const nextSuggestions = [...foundSuggestions];
  if (entry.name.toLowerCase().startsWith(lowerSearchPrefix) === true) {
    nextSuggestions.push(
      createSuggestion(entryPathRelative, entry.isDirectory()),
    );
  }
  if (!shouldRecurseIntoEntry(entry, nextSuggestions.length, maxResults)) {
    return nextSuggestions;
  }
  return nextSuggestions.concat(
    await findFilesRecursively(
      path.join(startDir, entry.name),
      searchPrefix,
      fileDiscovery,
      filterOptions,
      entryPathRelative,
      depth + 1,
      maxDepth,
      maxResults - nextSuggestions.length,
    ),
  );
}

function shouldRecurseIntoEntry(
  entry: Dirent,
  resultCount: number,
  maxResults: number,
): boolean {
  return (
    entry.isDirectory() === true &&
    entry.name !== 'node_modules' &&
    !entry.name.startsWith('.') &&
    resultCount < maxResults
  );
}

/**
 * Finds files using glob pattern.
 */
export async function findFilesWithGlob(
  searchPrefix: string,
  fileDiscoveryService: FileDiscoveryService,
  filterOptions: {
    respectGitIgnore?: boolean;
    respectLlxprtIgnore?: boolean;
  },
  searchDir: string,
  cwd: string,
  maxResults = 50,
): Promise<Suggestion[]> {
  const globPattern = `**/${searchPrefix}*`;
  const files = await glob(globPattern, {
    cwd: searchDir,
    dot: searchPrefix.startsWith('.'),
    nocase: true,
  });

  const suggestions: Suggestion[] = files
    .filter(
      (file) =>
        fileDiscoveryService.shouldIgnoreFile(file, filterOptions) !== true,
    )
    .map((file: string) => {
      const absolutePath = path.resolve(searchDir, file);
      const label = path.relative(cwd, absolutePath);
      return {
        label,
        value: escapePath(label),
      };
    })
    .slice(0, maxResults);

  return suggestions;
}

/**
 * Filters directory entries by prefix.
 */
export function filterEntriesByPrefix(
  entries: Dirent[],
  prefix: string,
): Dirent[] {
  const lowerPrefix = prefix.toLowerCase();
  return entries.filter((entry) => {
    if (shouldIgnoreDotfile(entry.name, prefix)) {
      return false;
    }
    return entry.name.toLowerCase().startsWith(lowerPrefix) === true;
  });
}

/**
 * Maps directory entries to suggestions.
 */
export function mapEntriesToSuggestions(
  entries: Dirent[],
  baseDirAbsolute: string,
  dir: string,
  cwd: string,
): Suggestion[] {
  return entries.map((entry) => {
    const absolutePath = path.resolve(baseDirAbsolute, entry.name);
    const label = cwd === dir ? entry.name : path.relative(cwd, absolutePath);
    const suggestionLabel = entry.isDirectory() === true ? label + '/' : label;
    return {
      label: suggestionLabel,
      value: escapePath(suggestionLabel),
    };
  });
}

/**
 * Normalizes path separators in suggestions.
 */
export function normalizePathSeparators(
  suggestions: Suggestion[],
): Suggestion[] {
  const specialCharsLookahead = `(?![${SHELL_SPECIAL_CHARS.source.slice(1, -1)}])`;
  const pathSeparatorRegex = new RegExp(`\\\\${specialCharsLookahead}`, 'g');

  return suggestions.map((suggestion) => ({
    ...suggestion,
    label: suggestion.label.replace(pathSeparatorRegex, '/'),
    value: suggestion.value.replace(pathSeparatorRegex, '/'),
  }));
}

/**
 * Calculates the depth of a path.
 */
function getPathDepth(label: string): number {
  const matches = label.match(/\//g);
  return matches !== null ? matches.length : 0;
}

/**
 * Compares two suggestions for sorting.
 */
function compareSuggestions(a: Suggestion, b: Suggestion): number {
  const depthA = getPathDepth(a.label);
  const depthB = getPathDepth(b.label);

  if (depthA !== depthB) {
    return depthA - depthB;
  }

  const aIsDir = a.label.endsWith('/');
  const bIsDir = b.label.endsWith('/');
  if (aIsDir && !bIsDir) return -1;
  if (!aIsDir && bIsDir) return 1;

  const filenameA = a.label.substring(
    0,
    a.label.length - path.extname(a.label).length,
  );
  const filenameB = b.label.substring(
    0,
    b.label.length - path.extname(b.label).length,
  );

  return filenameA.localeCompare(filenameB) !== 0
    ? filenameA.localeCompare(filenameB)
    : a.label.localeCompare(b.label);
}

/**
 * Sorts suggestions by depth, then directories first, then alphabetically.
 */
export function sortSuggestions(suggestions: Suggestion[]): Suggestion[] {
  return suggestions.sort(compareSuggestions);
}
