/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileDiscoveryService } from './fileDiscoveryService.js';

describe('FileDiscoveryService', () => {
  let testRootDir: string;
  let projectRoot: string;

  async function createTestFile(filePath: string, content = '') {
    const fullPath = path.join(projectRoot, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    return fullPath;
  }

  beforeEach(async () => {
    testRootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'file-discovery-test-'),
    );
    projectRoot = path.join(testRootDir, 'project');
    await fs.mkdir(projectRoot, { recursive: true });
    projectRoot = await fs.realpath(projectRoot);
  });

  afterEach(async () => {
    await fs.rm(testRootDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('should initialize git ignore parser by default in a git repo', async () => {
      await fs.mkdir(path.join(projectRoot, '.git'));
      await createTestFile('.gitignore', 'node_modules/');

      const service = new FileDiscoveryService(projectRoot);
      // Let's check the effect of the parser instead of mocking it.
      expect(service.shouldIgnoreFile('node_modules/foo.js')).toBe(true);
      expect(service.shouldIgnoreFile('src/foo.js')).toBe(false);
    });

    it('should not load git repo patterns when not in a git repo', async () => {
      // No .git directory
      await createTestFile('.gitignore', 'node_modules/');
      const service = new FileDiscoveryService(projectRoot);

      // .gitignore is not loaded in non-git repos
      expect(service.shouldIgnoreFile('node_modules/foo.js')).toBe(false);
    });

    it('should load .llxprtignore patterns even when not in a git repo', async () => {
      await createTestFile('.llxprtignore', 'secrets.txt');
      const service = new FileDiscoveryService(projectRoot);

      expect(service.shouldLlxprtIgnoreFile('secrets.txt')).toBe(true);
      expect(service.shouldLlxprtIgnoreFile('src/index.js')).toBe(false);
    });
  });

  describe('filterFiles', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(projectRoot, '.git'));
      await createTestFile('.gitignore', 'node_modules/\n.git/\ndist');
      await createTestFile('.llxprtignore', 'logs/');
    });

    it('should filter out git-ignored and llxprt-ignored files by default', () => {
      const files = [
        'src/index.ts',
        'node_modules/package/index.js',
        'README.md',
        '.git/config',
        'dist/bundle.js',
        'logs/latest.log',
      ].map((f) => path.join(projectRoot, f));

      const service = new FileDiscoveryService(projectRoot);

      expect(service.filterFiles(files)).toEqual(
        ['src/index.ts', 'README.md'].map((f) => path.join(projectRoot, f)),
      );
    });

    it('should not filter files when respectGitIgnore is false', () => {
      const files = [
        'src/index.ts',
        'node_modules/package/index.js',
        '.git/config',
        'logs/latest.log',
      ].map((f) => path.join(projectRoot, f));

      const service = new FileDiscoveryService(projectRoot);

      const filtered = service.filterFiles(files, {
        respectGitIgnore: false,
        respectLlxprtIgnore: true, // still respect this one
      });

      expect(filtered).toEqual(
        ['src/index.ts', 'node_modules/package/index.js', '.git/config'].map(
          (f) => path.join(projectRoot, f),
        ),
      );
    });

    it('should not filter files when respectLlxprtIgnore is false', () => {
      const files = [
        'src/index.ts',
        'node_modules/package/index.js',
        'logs/latest.log',
      ].map((f) => path.join(projectRoot, f));

      const service = new FileDiscoveryService(projectRoot);

      const filtered = service.filterFiles(files, {
        respectGitIgnore: true,
        respectLlxprtIgnore: false,
      });

      expect(filtered).toEqual(
        ['src/index.ts', 'logs/latest.log'].map((f) =>
          path.join(projectRoot, f),
        ),
      );
    });

    it('should handle empty file list', () => {
      const service = new FileDiscoveryService(projectRoot);

      expect(service.filterFiles([])).toEqual([]);
    });

    it('should respect gitignore located at repository root when initialized from nested workspace', async () => {
      const repoRoot = path.join(testRootDir, 'nested-repo');
      await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true });
      await fs.mkdir(repoRoot, { recursive: true });
      const canonicalRepoRoot = await fs.realpath(repoRoot);
      const workspaceDir = path.join(canonicalRepoRoot, 'workspace');
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.writeFile(
        path.join(canonicalRepoRoot, '.gitignore'),
        'secret.txt\n',
      );

      const service = new FileDiscoveryService(workspaceDir);
      const secretPath = path.join(workspaceDir, 'secret.txt');
      const visiblePath = path.join(workspaceDir, 'visible.txt');
      await fs.writeFile(secretPath, 'top secret');
      await fs.writeFile(visiblePath, 'hello');

      expect(
        service.filterFiles([secretPath, visiblePath], {
          respectGitIgnore: true,
          respectLlxprtIgnore: true,
        }),
      ).toEqual([fsSync.realpathSync(visiblePath)]);
    });

    it('should bypass gitignore when caller opts out even in nested workspace', async () => {
      const repoRoot = path.join(testRootDir, 'nested-repo');
      await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true });
      await fs.mkdir(repoRoot, { recursive: true });
      const canonicalRepoRoot = await fs.realpath(repoRoot);
      const workspaceDir = path.join(canonicalRepoRoot, 'workspace');
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.writeFile(
        path.join(canonicalRepoRoot, '.gitignore'),
        'secret.txt\n',
      );

      const service = new FileDiscoveryService(workspaceDir);
      const secretPath = path.join(workspaceDir, 'secret.txt');
      const visiblePath = path.join(workspaceDir, 'visible.txt');
      await fs.writeFile(secretPath, 'top secret');
      await fs.writeFile(visiblePath, 'hello');

      expect(
        service.filterFiles([secretPath, visiblePath], {
          respectGitIgnore: false,
          respectLlxprtIgnore: true,
        }),
      ).toEqual([
        fsSync.realpathSync(secretPath),
        fsSync.realpathSync(visiblePath),
      ]);
    });
  });

  describe('filterFilesWithReport', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(projectRoot, '.git'));
      await createTestFile('.gitignore', 'node_modules/');
      await createTestFile('.llxprtignore', '*.log');
    });

    it('should return filtered paths and correct ignored count', () => {
      const files = [
        'src/index.ts',
        'node_modules/package/index.js',
        'debug.log',
        'README.md',
      ].map((f) => path.join(projectRoot, f));

      const service = new FileDiscoveryService(projectRoot);
      const report = service.filterFilesWithReport(files);

      expect(report.filteredPaths).toEqual(
        ['src/index.ts', 'README.md'].map((f) => path.join(projectRoot, f)),
      );
      expect(report.ignoredCount).toBe(2);
    });

    it('should handle no ignored files', () => {
      const files = ['src/index.ts', 'README.md'].map((f) =>
        path.join(projectRoot, f),
      );

      const service = new FileDiscoveryService(projectRoot);
      const report = service.filterFilesWithReport(files);

      expect(report.filteredPaths).toEqual(files);
      expect(report.ignoredCount).toBe(0);
    });
  });

  describe('shouldGitIgnoreFile & shouldLlxprtIgnoreFile', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(projectRoot, '.git'));
      await createTestFile('.gitignore', 'node_modules/');
      await createTestFile('.llxprtignore', '*.log');
    });

    it('should return true for git-ignored files', () => {
      const service = new FileDiscoveryService(projectRoot);

      const ignoredPath = path.join(
        projectRoot,
        'node_modules/package/index.js',
      );
      expect(service.shouldGitIgnoreFile(ignoredPath)).toBe(true);
    });

    it('should return false for non-git-ignored files', () => {
      const service = new FileDiscoveryService(projectRoot);

      expect(
        service.shouldIgnoreFile(path.join(projectRoot, 'src/index.ts')),
      ).toBe(false);
    });

    it('should return true for llxprt-ignored files', () => {
      const service = new FileDiscoveryService(projectRoot);

      const ignoredLogPath = path.join(projectRoot, 'debug.log');
      expect(service.shouldLlxprtIgnoreFile(ignoredLogPath)).toBe(true);
    });

    it('should return false for non-llxprt-ignored files', () => {
      const service = new FileDiscoveryService(projectRoot);

      expect(
        service.shouldLlxprtIgnoreFile(path.join(projectRoot, 'src/index.ts')),
      ).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle relative project root paths', async () => {
      await fs.mkdir(path.join(projectRoot, '.git'));
      await createTestFile('.gitignore', 'ignored.txt');
      const relativeRoot = path.relative(process.cwd(), projectRoot);
      const service = new FileDiscoveryService(relativeRoot);

      expect(
        service.shouldIgnoreFile(path.join(projectRoot, 'ignored.txt')),
      ).toBe(true);
      expect(
        service.shouldIgnoreFile(path.join(projectRoot, 'not-ignored.txt')),
      ).toBe(false);
    });

    it('should handle filterFiles with undefined options', async () => {
      await fs.mkdir(path.join(projectRoot, '.git'));
      await createTestFile('.gitignore', 'ignored.txt');
      const service = new FileDiscoveryService(projectRoot);

      const files = ['src/index.ts', 'ignored.txt'].map((f) =>
        path.join(projectRoot, f),
      );

      expect(service.filterFiles(files, undefined)).toEqual([
        path.join(projectRoot, 'src/index.ts'),
      ]);
    });
  });
  describe('precedence (.llxprtignore over .gitignore)', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(projectRoot, '.git'));
    });

    it('should un-ignore a file in .llxprtignore that is ignored in .gitignore', async () => {
      await createTestFile('.gitignore', '*.txt');
      await createTestFile('.llxprtignore', '!important.txt');

      const service = new FileDiscoveryService(projectRoot);
      const files = ['file.txt', 'important.txt'].map((f) =>
        path.join(projectRoot, f),
      );

      const filtered = service.filterFiles(files);
      expect(filtered).toEqual([path.join(projectRoot, 'important.txt')]);
    });

    it('should un-ignore a directory in .llxprtignore that is ignored in .gitignore', async () => {
      await createTestFile('.gitignore', 'logs/');
      await createTestFile('.llxprtignore', '!logs/');

      const service = new FileDiscoveryService(projectRoot);
      const files = ['logs/app.log', 'other/app.log'].map((f) =>
        path.join(projectRoot, f),
      );

      const filtered = service.filterFiles(files);
      expect(filtered).toEqual(files);
    });

    it('should extend ignore rules in .llxprtignore', async () => {
      await createTestFile('.gitignore', '*.log');
      await createTestFile('.llxprtignore', 'temp/');

      const service = new FileDiscoveryService(projectRoot);
      const files = ['app.log', 'temp/file.txt'].map((f) =>
        path.join(projectRoot, f),
      );

      const filtered = service.filterFiles(files);
      expect(filtered).toEqual([]);
    });

    it('should use .gitignore rules if respectLlxprtIgnore is false', async () => {
      await createTestFile('.gitignore', '*.txt');
      await createTestFile('.llxprtignore', '!important.txt');

      const service = new FileDiscoveryService(projectRoot);
      const files = ['file.txt', 'important.txt'].map((f) =>
        path.join(projectRoot, f),
      );

      const filtered = service.filterFiles(files, {
        respectGitIgnore: true,
        respectLlxprtIgnore: false,
      });

      expect(filtered).toEqual([]);
    });

    it('should use .llxprtignore rules if respectGitIgnore is false', async () => {
      await createTestFile('.gitignore', '*.txt');
      await createTestFile('.llxprtignore', '!important.txt\ntemp/');

      const service = new FileDiscoveryService(projectRoot);
      const files = ['file.txt', 'important.txt', 'temp/file.js'].map((f) =>
        path.join(projectRoot, f),
      );

      const filtered = service.filterFiles(files, {
        respectGitIgnore: false,
        respectLlxprtIgnore: true,
      });

      // .gitignore is ignored, so *.txt is not applied.
      // .llxprtignore un-ignores important.txt (which wasn't ignored anyway)
      // and ignores temp/
      expect(filtered).toEqual(
        ['file.txt', 'important.txt'].map((f) => path.join(projectRoot, f)),
      );
    });
  });
});
