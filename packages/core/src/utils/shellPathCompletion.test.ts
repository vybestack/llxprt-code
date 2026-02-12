/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  createTmpDir,
  cleanupTmpDir,
  FileSystemStructure,
} from '@vybestack/llxprt-code-test-utils';
import { extractPathToken, getPathSuggestions } from './shellPathCompletion.js';

describe('extractPathToken', () => {
  it('should extract a tilde-slash path token', () => {
    const result = extractPathToken('ls ~/Docu', 9);
    expect(result).toEqual({
      token: '~/Docu',
      tokenStart: 3,
      tokenEnd: 9,
      isPathLike: true,
    });
  });

  it('should extract bare tilde as path-like', () => {
    const result = extractPathToken('cd ~', 4);
    expect(result).toEqual({
      token: '~',
      tokenStart: 3,
      tokenEnd: 4,
      isPathLike: true,
    });
  });

  it('should extract a relative path token with ./', () => {
    const result = extractPathToken('cat ./file.txt', 14);
    expect(result).toEqual({
      token: './file.txt',
      tokenStart: 4,
      tokenEnd: 14,
      isPathLike: true,
    });
  });

  it('should extract a relative path token with ../', () => {
    const result = extractPathToken('cat ../parent', 13);
    expect(result).toEqual({
      token: '../parent',
      tokenStart: 4,
      tokenEnd: 13,
      isPathLike: true,
    });
  });

  it('should extract an absolute path token', () => {
    const result = extractPathToken('cat /usr/local/bi', 17);
    expect(result).toEqual({
      token: '/usr/local/bi',
      tokenStart: 4,
      tokenEnd: 17,
      isPathLike: true,
    });
  });

  it('should extract a token containing / as path-like', () => {
    const result = extractPathToken('cat src/utils', 13);
    expect(result).toEqual({
      token: 'src/utils',
      tokenStart: 4,
      tokenEnd: 13,
      isPathLike: true,
    });
  });

  it('should identify non-path tokens as not path-like', () => {
    const result = extractPathToken('echo hello', 10);
    expect(result).toEqual({
      token: 'hello',
      tokenStart: 5,
      tokenEnd: 10,
      isPathLike: false,
    });
  });

  it('should handle escaped spaces in path tokens', () => {
    const result = extractPathToken('cat my\\ file.txt', 16);
    expect(result).toEqual({
      token: 'my\\ file.txt',
      tokenStart: 4,
      tokenEnd: 16,
      isPathLike: false,
    });
  });

  it('should extract path token when cursor is mid-line', () => {
    const result = extractPathToken('ls ~/Dir suffix', 8);
    expect(result).toEqual({
      token: '~/Dir',
      tokenStart: 3,
      tokenEnd: 8,
      isPathLike: true,
    });
  });

  it('should return empty token for empty input', () => {
    const result = extractPathToken('', 0);
    expect(result).toEqual({
      token: '',
      tokenStart: 0,
      tokenEnd: 0,
      isPathLike: false,
    });
  });

  it('should handle cursor at start of line', () => {
    const result = extractPathToken('hello', 0);
    expect(result).toEqual({
      token: '',
      tokenStart: 0,
      tokenEnd: 0,
      isPathLike: false,
    });
  });

  it('should handle multiple spaces between tokens', () => {
    const result = extractPathToken('ls   ~/foo', 10);
    expect(result).toEqual({
      token: '~/foo',
      tokenStart: 5,
      tokenEnd: 10,
      isPathLike: true,
    });
  });
});

describe('getPathSuggestions', () => {
  let testRootDir: string;

  beforeEach(async () => {
    const structure: FileSystemStructure = {
      subdir: {
        'nested.txt': '',
      },
      anotherDir: {},
      'file1.txt': '',
      'file2.txt': '',
      'File3.TXT': '',
      '.hidden': '',
      '.hiddenDir': {},
    };
    testRootDir = await createTmpDir(structure);
  });

  afterEach(async () => {
    if (testRootDir) {
      await cleanupTmpDir(testRootDir);
    }
  });

  it('should return matching files and directories', async () => {
    const results = await getPathSuggestions('./file', testRootDir);
    const labels = results.map((r) => r.label);
    expect(labels).toContain('file1.txt');
    expect(labels).toContain('file2.txt');
    expect(labels).toContain('File3.TXT');
    expect(labels.length).toBe(3);
  });

  it('should append trailing slash for directories', async () => {
    const results = await getPathSuggestions('./sub', testRootDir);
    expect(results).toEqual([
      { label: 'subdir/', value: './subdir/', isDirectory: true },
    ]);
  });

  it('should not append trailing slash for files', async () => {
    const results = await getPathSuggestions('./file1', testRootDir);
    expect(results).toEqual([
      { label: 'file1.txt', value: './file1.txt', isDirectory: false },
    ]);
  });

  it('should use case-insensitive matching', async () => {
    const results = await getPathSuggestions('./FILE', testRootDir);
    expect(results.map((r) => r.label)).toContain('file1.txt');
    expect(results.map((r) => r.label)).toContain('file2.txt');
    expect(results.map((r) => r.label)).toContain('File3.TXT');
  });

  it('should hide dotfiles by default', async () => {
    const results = await getPathSuggestions('./', testRootDir);
    const labels = results.map((r) => r.label);
    expect(labels).not.toContain('.hidden');
    expect(labels).not.toContain('.hiddenDir/');
  });

  it('should show dotfiles when prefix starts with dot', async () => {
    const results = await getPathSuggestions('./.hi', testRootDir);
    const labels = results.map((r) => r.label);
    expect(labels).toContain('.hidden');
    expect(labels).toContain('.hiddenDir/');
  });

  it('should filter out . and .. entries', async () => {
    const results = await getPathSuggestions('./', testRootDir);
    const labels = results.map((r) => r.label);
    expect(labels).not.toContain('.');
    expect(labels).not.toContain('..');
  });

  it('should return empty array for non-existent directory', async () => {
    const results = await getPathSuggestions(
      './nonexistent/path/',
      testRootDir,
    );
    expect(results).toEqual([]);
  });

  it('should handle tilde expansion', async () => {
    const homeDir = os.homedir();
    const results = await getPathSuggestions('~/', homeDir);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.value.startsWith('~/')).toBe(true);
    }
  });

  it('should handle absolute paths', async () => {
    const results = await getPathSuggestions(
      testRootDir + '/file',
      testRootDir,
    );
    const labels = results.map((r) => r.label);
    expect(labels).toContain('file1.txt');
    expect(labels).toContain('file2.txt');
    expect(labels).toContain('File3.TXT');
    expect(labels.length).toBe(3);
  });

  it('should handle relative paths with cwd', async () => {
    const results = await getPathSuggestions('subdir/', testRootDir);
    expect(results).toEqual([
      {
        label: 'nested.txt',
        value: 'subdir/nested.txt',
        isDirectory: false,
      },
    ]);
  });

  it('should limit results to 50', async () => {
    const manyFiles: FileSystemStructure = {};
    for (let i = 0; i < 60; i++) {
      manyFiles[`file${String(i).padStart(3, '0')}.txt`] = '';
    }
    const bigDir = await createTmpDir(manyFiles);
    try {
      const results = await getPathSuggestions('./', bigDir);
      expect(results.length).toBeLessThanOrEqual(50);
    } finally {
      await cleanupTmpDir(bigDir);
    }
  });

  it('should handle bare tilde (list home directory contents)', async () => {
    const results = await getPathSuggestions('~/', os.homedir());
    expect(results.length).toBeGreaterThan(0);
  });

  it('should preserve tilde prefix in suggestion values', async () => {
    const results = await getPathSuggestions('~/', os.homedir());
    for (const r of results) {
      expect(r.value.startsWith('~/')).toBe(true);
    }
  });

  it('should sort directories before files', async () => {
    const results = await getPathSuggestions('./', testRootDir);
    const firstDirIdx = results.findIndex((r) => r.isDirectory);
    const firstFileIdx = results.findIndex((r) => !r.isDirectory);
    if (firstDirIdx !== -1 && firstFileIdx !== -1) {
      expect(firstDirIdx).toBeLessThan(firstFileIdx);
    }
  });

  it('should return empty array for empty partial path', async () => {
    const results = await getPathSuggestions('', testRootDir);
    expect(results).toEqual([]);
  });

  it('should handle listing a directory with trailing slash', async () => {
    const results = await getPathSuggestions('./subdir/', testRootDir);
    expect(results).toEqual([
      {
        label: 'nested.txt',
        value: './subdir/nested.txt',
        isDirectory: false,
      },
    ]);
  });

  it('should handle permission errors gracefully', async () => {
    const restrictedDir = path.join(testRootDir, 'restricted');
    await fs.mkdir(restrictedDir);
    await fs.writeFile(path.join(restrictedDir, 'secret.txt'), '');
    await fs.chmod(restrictedDir, 0o000);
    try {
      const results = await getPathSuggestions('./restricted/', testRootDir);
      expect(results).toEqual([]);
    } finally {
      await fs.chmod(restrictedDir, 0o755);
    }
  });
});
