/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

import { FileSearchFactory, AbortError } from './fileSearch.js';
import {
  DEFAULT_AUTOCOMPLETE_IGNORE_DIRS,
  DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS,
  DEFAULT_AUTOCOMPLETE_MAX_DEPTH,
} from '../../config/constants.js';
import { createTmpDir } from '@vybestack/llxprt-code-test-utils';
import * as crawler from './crawler.js';

describe('FileSearch Directories', () => {
  let tmpDir: string;

  describe('DirectoryFileSearch', () => {
    it('should search for files in the current directory', async () => {
      tmpDir = await createTmpDir({
        'file1.js': '',
        'file2.ts': '',
        'file3.js': '',
      });

      const fileSearch = FileSearchFactory.create({
        projectRoot: tmpDir,
        useGitignore: false,
        useGeminiignore: false,
        ignoreDirs: [],
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: false,
        enableFuzzySearch: true,
      });

      await fileSearch.initialize();
      const results = await fileSearch.search('*.js');
      expect(results).toStrictEqual(['file1.js', 'file3.js']);
    });

    it('should search for files in a subdirectory', async () => {
      tmpDir = await createTmpDir({
        'file1.js': '',
        src: {
          'file2.js': '',
          'file3.ts': '',
        },
      });

      const fileSearch = FileSearchFactory.create({
        projectRoot: tmpDir,
        useGitignore: false,
        useGeminiignore: false,
        ignoreDirs: [],
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: false,
        enableFuzzySearch: true,
      });

      await fileSearch.initialize();
      const results = await fileSearch.search('src/*.js');
      expect(results).toStrictEqual(['src/file2.js']);
    });

    it('should list all files in a directory', async () => {
      tmpDir = await createTmpDir({
        'file1.js': '',
        src: {
          'file2.js': '',
          'file3.ts': '',
        },
      });

      const fileSearch = FileSearchFactory.create({
        projectRoot: tmpDir,
        useGitignore: false,
        useGeminiignore: false,
        ignoreDirs: [],
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: false,
        enableFuzzySearch: true,
      });

      await fileSearch.initialize();
      const results = await fileSearch.search('src/');
      expect(results).toStrictEqual(['src/file2.js', 'src/file3.ts']);
    });

    it('should respect ignore rules', async () => {
      tmpDir = await createTmpDir({
        '.gitignore': '*.js',
        'file1.js': '',
        'file2.ts': '',
      });

      const fileSearch = FileSearchFactory.create({
        projectRoot: tmpDir,
        useGitignore: true,
        useGeminiignore: false,
        ignoreDirs: [],
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: false,
        enableFuzzySearch: true,
      });

      await fileSearch.initialize();
      const results = await fileSearch.search('*');
      expect(results).toStrictEqual(['.gitignore', 'file2.ts']);
    });

    it('should not list files inside an ignored directory when directly requested', async () => {
      tmpDir = await createTmpDir({
        target: {
          debug: {
            'artifact.o': '',
          },
        },
        src: {
          'main.rs': '',
        },
      });

      const fileSearch = FileSearchFactory.create({
        projectRoot: tmpDir,
        useGitignore: false,
        useGeminiignore: false,
        ignoreDirs: ['target/'],
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: false,
        enableFuzzySearch: true,
      });

      await fileSearch.initialize();
      const results = await fileSearch.search('target/');
      expect(results).toStrictEqual([]);
    });

    it('should reject before crawling when non-recursive search is already aborted', async () => {
      tmpDir = await createTmpDir({
        src: {
          'main.rs': '',
        },
      });

      const fileSearch = FileSearchFactory.create({
        projectRoot: tmpDir,
        useGitignore: false,
        useGeminiignore: false,
        ignoreDirs: [],
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: false,
        enableFuzzySearch: true,
      });

      await fileSearch.initialize();
      const crawlSpy = vi.spyOn(crawler, 'crawl');
      const controller = new AbortController();
      controller.abort();

      await expect(
        fileSearch.search('src/', { signal: controller.signal }),
      ).rejects.toThrow(AbortError);
      expect(crawlSpy).not.toHaveBeenCalled();
    });
  });

  describe('Default autocomplete filtering', () => {
    it('should exclude build output directories when ignoreDirs includes DEFAULT_AUTOCOMPLETE_IGNORE_DIRS', async () => {
      tmpDir = await createTmpDir({
        src: { 'main.rs': '' },
        target: { debug: { 'main.o': '' } },
        build: { 'app.o': '' },
        dist: { 'bundle.js': '' },
      });

      const fileSearch = FileSearchFactory.create({
        projectRoot: tmpDir,
        useGitignore: false,
        useGeminiignore: false,
        ignoreDirs: DEFAULT_AUTOCOMPLETE_IGNORE_DIRS,
        ignorePatterns: DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS,
        maxDepth: DEFAULT_AUTOCOMPLETE_MAX_DEPTH,
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: true,
        enableFuzzySearch: true,
      });

      await fileSearch.initialize();
      const results = await fileSearch.search('');

      expect(results).not.toContain('target/');
      expect(results).not.toContain('target/debug/');
      expect(results).not.toContain('build/');
      expect(results).not.toContain('dist/');
      expect(results).toContain('src/');
      expect(results).toContain('src/main.rs');
    });

    it('should exclude binary artifact files when ignorePatterns includes DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS', async () => {
      tmpDir = await createTmpDir({
        src: { 'main.rs': '' },
        'main.o': '',
        'app.dll': '',
        'program.exe': '',
      });

      const fileSearch = FileSearchFactory.create({
        projectRoot: tmpDir,
        useGitignore: false,
        useGeminiignore: false,
        ignoreDirs: DEFAULT_AUTOCOMPLETE_IGNORE_DIRS,
        ignorePatterns: DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS,
        maxDepth: DEFAULT_AUTOCOMPLETE_MAX_DEPTH,
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: true,
        enableFuzzySearch: true,
      });

      await fileSearch.initialize();
      const results = await fileSearch.search('');

      expect(results).not.toContain('main.o');
      expect(results).not.toContain('app.dll');
      expect(results).not.toContain('program.exe');
      expect(results).toContain('src/');
    });

    it('should still apply default excludes when .gitignore is also loaded', async () => {
      tmpDir = await createTmpDir({
        '.gitignore': '*.log',
        src: { 'main.rs': '' },
        target: { debug: { 'main.o': '' } },
        'error.log': '',
      });

      const fileSearch = FileSearchFactory.create({
        projectRoot: tmpDir,
        useGitignore: true,
        useGeminiignore: false,
        ignoreDirs: DEFAULT_AUTOCOMPLETE_IGNORE_DIRS,
        ignorePatterns: DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS,
        maxDepth: DEFAULT_AUTOCOMPLETE_MAX_DEPTH,
        cache: false,
        cacheTtl: 0,
        enableRecursiveFileSearch: true,
        enableFuzzySearch: true,
      });

      await fileSearch.initialize();
      const results = await fileSearch.search('');

      expect(results).not.toContain('target/');
      expect(results).not.toContain('error.log');
      expect(results).toContain('src/');
      expect(results).toContain('.gitignore');
    });
  });
});
