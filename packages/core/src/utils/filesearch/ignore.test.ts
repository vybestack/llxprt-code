/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Ignore, loadIgnoreRules } from './ignore.js';
import { createTmpDir, cleanupTmpDir } from '@vybestack/llxprt-code-test-utils';

describe('Ignore', () => {
  describe('getDirectoryFilter', () => {
    it('should ignore directories matching directory patterns', () => {
      const ig = new Ignore().add(['foo/', 'bar/']);
      const dirFilter = ig.getDirectoryFilter();
      expect(dirFilter('foo/')).toBe(true);
      expect(dirFilter('bar/')).toBe(true);
      expect(dirFilter('baz/')).toBe(false);
    });

    it('should not ignore directories with file patterns', () => {
      const ig = new Ignore().add(['foo.js', '*.log']);
      const dirFilter = ig.getDirectoryFilter();
      expect(dirFilter('foo.js')).toBe(false);
      expect(dirFilter('foo.log')).toBe(false);
    });
  });

  describe('getFileFilter', () => {
    it('should not ignore files with directory patterns', () => {
      const ig = new Ignore().add(['foo/', 'bar/']);
      const fileFilter = ig.getFileFilter();
      expect(fileFilter('foo')).toBe(false);
      expect(fileFilter('foo/file.txt')).toBe(false);
    });

    it('should ignore files matching file patterns', () => {
      const ig = new Ignore().add(['*.log', 'foo.js']);
      const fileFilter = ig.getFileFilter();
      expect(fileFilter('foo.log')).toBe(true);
      expect(fileFilter('foo.js')).toBe(true);
      expect(fileFilter('bar.txt')).toBe(false);
    });
  });

  it('should accumulate patterns across multiple add() calls', () => {
    const ig = new Ignore().add('foo.js');
    ig.add('bar.js');
    const fileFilter = ig.getFileFilter();
    expect(fileFilter('foo.js')).toBe(true);
    expect(fileFilter('bar.js')).toBe(true);
    expect(fileFilter('baz.js')).toBe(false);
  });

  it('should return a stable and consistent fingerprint', () => {
    const ig1 = new Ignore().add(['foo', '!bar']);
    const ig2 = new Ignore().add('foo\n!bar');

    // Fingerprints should be identical for the same rules.
    expect(ig1.getFingerprint()).toBe(ig2.getFingerprint());

    // Adding a new rule should change the fingerprint.
    ig2.add('baz');
    expect(ig1.getFingerprint()).not.toBe(ig2.getFingerprint());
  });
});

describe('loadIgnoreRules', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await cleanupTmpDir(tmpDir);
    }
  });

  it('should load rules from .gitignore', async () => {
    tmpDir = await createTmpDir({
      '.gitignore': '*.log',
    });
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: true,
      useExtensionIgnore: false,
      ignoreDirs: [],
    });
    const fileFilter = ignore.getFileFilter();
    expect(fileFilter('test.log')).toBe(true);
    expect(fileFilter('test.txt')).toBe(false);
  });

  it('should load rules from .geminiignore', async () => {
    tmpDir = await createTmpDir({
      '.geminiignore': '*.log',
    });
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: false,
      useExtensionIgnore: true,
      ignoreDirs: [],
    });
    const fileFilter = ignore.getFileFilter();
    expect(fileFilter('test.log')).toBe(true);
    expect(fileFilter('test.txt')).toBe(false);
  });

  it('should load rules from .llxprtignore', async () => {
    tmpDir = await createTmpDir({
      '.llxprtignore': '*.secret',
    });
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: false,
      useExtensionIgnore: true,
      ignoreDirs: [],
    });
    const fileFilter = ignore.getFileFilter();
    expect(fileFilter('token.secret')).toBe(true);
    expect(fileFilter('token.txt')).toBe(false);
  });

  it('should combine rules from .gitignore and .geminiignore', async () => {
    tmpDir = await createTmpDir({
      '.gitignore': '*.log',
      '.geminiignore': '*.txt',
    });
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: true,
      useExtensionIgnore: true,
      ignoreDirs: [],
    });
    const fileFilter = ignore.getFileFilter();
    expect(fileFilter('test.log')).toBe(true);
    expect(fileFilter('test.txt')).toBe(true);
    expect(fileFilter('test.md')).toBe(false);
  });

  it('should add ignoreDirs', async () => {
    tmpDir = await createTmpDir({});
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: false,
      useExtensionIgnore: false,
      ignoreDirs: ['logs/'],
    });
    const dirFilter = ignore.getDirectoryFilter();
    expect(dirFilter('logs/')).toBe(true);
    expect(dirFilter('src/')).toBe(false);
  });

  it('should handle missing ignore files gracefully', async () => {
    tmpDir = await createTmpDir({});
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: true,
      useExtensionIgnore: true,
      ignoreDirs: [],
    });
    const fileFilter = ignore.getFileFilter();
    expect(fileFilter('anyfile.txt')).toBe(false);
  });

  it('should always add .git to the ignore list', async () => {
    tmpDir = await createTmpDir({});
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: false,
      useExtensionIgnore: false,
      ignoreDirs: [],
    });
    const dirFilter = ignore.getDirectoryFilter();
    expect(dirFilter('.git/')).toBe(true);
  });

  it('should apply ignorePatterns to filter binary and build artifact files', async () => {
    tmpDir = await createTmpDir({});
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: false,
      useExtensionIgnore: false,
      ignoreDirs: [],
      ignorePatterns: ['*.o', '*.so', '*.dll', '*.exe', '*.pyc'],
    });
    const fileFilter = ignore.getFileFilter();
    expect(fileFilter('main.o')).toBe(true);
    expect(fileFilter('libfoo.so')).toBe(true);
    expect(fileFilter('bar.dll')).toBe(true);
    expect(fileFilter('app.exe')).toBe(true);
    expect(fileFilter('module.pyc')).toBe(true);
    expect(fileFilter('main.rs')).toBe(false);
  });

  it('should apply ignorePatterns with directory patterns like *.dSYM/', async () => {
    tmpDir = await createTmpDir({});
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: false,
      useExtensionIgnore: false,
      ignoreDirs: [],
      ignorePatterns: ['*.dSYM/'],
    });
    const dirFilter = ignore.getDirectoryFilter();
    expect(dirFilter('MyApp.dSYM/')).toBe(true);
    expect(dirFilter('src/')).toBe(false);
  });

  it('should combine ignorePatterns with .gitignore and ignoreDirs', async () => {
    tmpDir = await createTmpDir({
      '.gitignore': '*.log',
    });
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: true,
      useExtensionIgnore: false,
      ignoreDirs: ['build/'],
      ignorePatterns: ['*.o', '*.class'],
    });
    const fileFilter = ignore.getFileFilter();
    expect(fileFilter('test.log')).toBe(true);
    expect(fileFilter('main.o')).toBe(true);
    expect(fileFilter('MyClass.class')).toBe(true);
    expect(fileFilter('main.rs')).toBe(false);
    const dirFilter = ignore.getDirectoryFilter();
    expect(dirFilter('build/')).toBe(true);
    expect(dirFilter('.git/')).toBe(true);
  });

  it('should allow .gitignore negations to override ignorePatterns', async () => {
    tmpDir = await createTmpDir({
      '.gitignore': '!keep.o',
    });
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: true,
      useExtensionIgnore: false,
      ignoreDirs: [],
      ignorePatterns: ['*.o'],
    });
    const fileFilter = ignore.getFileFilter();
    expect(fileFilter('main.o')).toBe(true);
    expect(fileFilter('keep.o')).toBe(false);
  });

  it('should apply ignoreDirs to nested build output directories', async () => {
    tmpDir = await createTmpDir({});
    const ignore = loadIgnoreRules({
      projectRoot: tmpDir,
      useGitignore: false,
      useExtensionIgnore: false,
      ignoreDirs: ['target/', 'cmake-build-*/', '*.egg-info/'],
      ignorePatterns: [],
    });
    const dirFilter = ignore.getDirectoryFilter();
    expect(dirFilter('src/crate/target/')).toBe(true);
    expect(dirFilter('native/cmake-build-debug/')).toBe(true);
    expect(dirFilter('package/pkg.egg-info/')).toBe(true);
    expect(dirFilter('src/crate/src/')).toBe(false);
  });
});
