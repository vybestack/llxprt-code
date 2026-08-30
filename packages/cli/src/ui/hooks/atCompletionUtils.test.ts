/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import { escapePath, unescapePath } from '@vybestack/llxprt-code-core';
import type { FileSystemStructure } from '@vybestack/llxprt-code-test-utils';
import { cleanupTmpDir, createTmpDir } from '@vybestack/llxprt-code-test-utils';
import type { Suggestion } from '../components/SuggestionsDisplay.js';
import {
  filterEntriesByPrefix,
  findFilesRecursively,
} from './atCompletionUtils.js';

function names(entries: readonly Dirent[]): string[] {
  return entries.map((entry) => entry.name).sort();
}

function labels(suggestions: readonly Suggestion[]): string[] {
  return suggestions.map((suggestion) => suggestion.label).sort();
}

function requireSuggestion(
  suggestions: readonly Suggestion[],
  label: string,
): Suggestion {
  const suggestion = suggestions.find((candidate) => candidate.label === label);
  if (suggestion === undefined) {
    throw new Error(`Expected suggestion for ${label}`);
  }
  return suggestion;
}

describe('atCompletionUtils', () => {
  let testRootDir: string;

  beforeEach(async () => {
    const structure: FileSystemStructure = {
      '.env': '',
      '.hidden': '',
      'visible.txt': '',
      'hidden-ish.txt': '',
      'MixedCase.TXT': '',
      "single'quote.txt": '',
      'double"quote.txt': '',
      'café.txt': '',
      'emoji-😀.txt': '',
      nested: {
        '.nested-env': '',
        'nested-visible.txt': '',
      },
    };
    testRootDir = await createTmpDir(structure);
  });

  afterEach(async () => {
    await cleanupTmpDir(testRootDir);
  });

  describe('filterEntriesByPrefix', () => {
    it('excludes dotfiles for an empty prefix while retaining visible entries', async () => {
      const entries = await fs.readdir(testRootDir, { withFileTypes: true });

      const filteredNames = names(filterEntriesByPrefix(entries, ''));

      expect(
        filteredNames.filter((name) => name.startsWith('.')),
      ).toStrictEqual([]);
      expect(filteredNames).toEqual(
        expect.arrayContaining(['hidden-ish.txt', 'visible.txt']),
      );
    });

    it('excludes dotfiles when the non-dot prefix matches a visible filename', async () => {
      const entries = await fs.readdir(testRootDir, { withFileTypes: true });

      const filteredNames = names(filterEntriesByPrefix(entries, 'h'));

      expect(filteredNames).toStrictEqual(['hidden-ish.txt']);
    });

    it('includes only matching dotfiles when the prefix starts with a dot', async () => {
      const entries = await fs.readdir(testRootDir, { withFileTypes: true });

      const dotfileNames = names(filterEntriesByPrefix(entries, '.'));
      const envNames = names(filterEntriesByPrefix(entries, '.e'));

      expect(dotfileNames).toStrictEqual(['.env', '.hidden']);
      expect(envNames).toStrictEqual(['.env']);
    });

    it('matches prefixes case-insensitively', async () => {
      const entries = await fs.readdir(testRootDir, { withFileTypes: true });

      const filteredNames = names(filterEntriesByPrefix(entries, 'mIxEdCaSe'));

      expect(filteredNames).toStrictEqual(['MixedCase.TXT']);
    });
  });

  describe('findFilesRecursively', () => {
    it('excludes nested dotfiles when the search prefix does not start with a dot', async () => {
      const suggestions = await findFilesRecursively(testRootDir, '', null, {});
      const suggestionLabels = labels(suggestions);

      expect(
        suggestionLabels.filter((label) =>
          label.split('/').some((segment) => segment.startsWith('.')),
        ),
      ).toStrictEqual([]);
      expect(suggestionLabels).toEqual(
        expect.arrayContaining([
          'hidden-ish.txt',
          'nested/',
          'nested/nested-visible.txt',
          'visible.txt',
        ]),
      );
    });

    it('includes matching dotfiles through nested visible directories for a dot prefix', async () => {
      const dotSuggestions = await findFilesRecursively(
        testRootDir,
        '.',
        null,
        {},
      );
      const envSuggestions = await findFilesRecursively(
        testRootDir,
        '.e',
        null,
        {},
      );

      expect(labels(dotSuggestions)).toStrictEqual([
        '.env',
        '.hidden',
        'nested/.nested-env',
      ]);
      expect(labels(envSuggestions)).toStrictEqual(['.env']);
    });

    it('surfaces single-quoted and double-quoted filenames with escaped values', async () => {
      const singleQuoteLabel = "single'quote.txt";
      const doubleQuoteLabel = 'double"quote.txt';
      const singleQuoteSuggestions = await findFilesRecursively(
        testRootDir,
        'single',
        null,
        {},
      );
      const doubleQuoteSuggestions = await findFilesRecursively(
        testRootDir,
        'double',
        null,
        {},
      );

      const singleQuoteSuggestion = requireSuggestion(
        singleQuoteSuggestions,
        singleQuoteLabel,
      );
      const doubleQuoteSuggestion = requireSuggestion(
        doubleQuoteSuggestions,
        doubleQuoteLabel,
      );

      expect(singleQuoteSuggestion.value).toBe(escapePath(singleQuoteLabel));
      expect(singleQuoteSuggestion.value).not.toBe(singleQuoteSuggestion.label);
      expect(unescapePath(singleQuoteSuggestion.value)).toBe(singleQuoteLabel);
      expect(doubleQuoteSuggestion.value).toBe(escapePath(doubleQuoteLabel));
      expect(doubleQuoteSuggestion.value).not.toBe(doubleQuoteSuggestion.label);
      expect(unescapePath(doubleQuoteSuggestion.value)).toBe(doubleQuoteLabel);
    });

    it('surfaces unicode filenames without changing labels or round-tripped values', async () => {
      const unicodeLabels = ['café.txt', 'emoji-😀.txt'];
      const suggestions = await findFilesRecursively(testRootDir, '', null, {});

      for (const label of unicodeLabels) {
        const suggestion = requireSuggestion(suggestions, label);
        expect(suggestion.label).toBe(label);
        expect(suggestion.value).toBe(escapePath(label));
        expect(unescapePath(suggestion.value)).toBe(label);
      }
    });
  });
});
