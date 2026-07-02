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

    it('should not apply git ignore sources when not in a git repo', async () => {
      // No .git directory
      await createTestFile('.gitignore', 'node_modules/');
      const service = new FileDiscoveryService(projectRoot);

      // Without .git, gitIgnoreFilter is null and the dedicated .llxprtignore
      // filter never loads git sources, so node_modules/ is not ignored.
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

      expect(service.filterFiles(files)).toStrictEqual(
        ['src/index.ts', 'README.md'].map((f) => path.join(projectRoot, f)),
      );
    });

    it('should not filter git-ignored files when respectGitIgnore is false', () => {
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

      // With independent filters, disabling respectGitIgnore means Git-native
      // ignore sources, including .gitignore and the hardcoded .git/ rule, are
      // no longer applied. Only .llxprtignore (logs/) is applied.
      expect(filtered).toStrictEqual(
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

      expect(filtered).toStrictEqual(
        ['src/index.ts', 'logs/latest.log'].map((f) =>
          path.join(projectRoot, f),
        ),
      );
    });

    it('should handle empty file list', () => {
      const service = new FileDiscoveryService(projectRoot);

      expect(service.filterFiles([])).toStrictEqual([]);
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
      ).toStrictEqual([fsSync.realpathSync(visiblePath)]);
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
      ).toStrictEqual([
        fsSync.realpathSync(secretPath),
        fsSync.realpathSync(visiblePath),
      ]);
    });

    it('should treat a symlink into an ignored directory consistently between fast path and non-fast path', async () => {
      await createTestFile('.gitignore', 'ignored-target/\n');
      await createTestFile('ignored-target/real.txt', 'data');
      const symlinkPath = path.join(projectRoot, 'link-to-ignored.txt');
      await fs.symlink(
        path.join(projectRoot, 'ignored-target', 'real.txt'),
        symlinkPath,
      );

      const service = new FileDiscoveryService(projectRoot);
      const fastPath = service.filterFiles([symlinkPath], {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });
      const nonFastPath = service.filterFiles([symlinkPath], {
        respectGitIgnore: true,
        respectLlxprtIgnore: false,
      });

      expect(fastPath).toStrictEqual([]);
      expect(nonFastPath).toStrictEqual([]);
      expect(fastPath).toStrictEqual(nonFastPath);
    });

    it('should resolve relative symlink input paths against projectRoot consistently in both branches', async () => {
      await createTestFile('.gitignore', 'ignored-target/\n');
      await createTestFile('ignored-target/real.txt', 'data');
      await fs.symlink(
        path.join(projectRoot, 'ignored-target'),
        path.join(projectRoot, 'linked-target'),
        'dir',
      );
      const relativeSymlinkPath = path.join('linked-target', 'real.txt');

      const service = new FileDiscoveryService(projectRoot);
      const fastPath = service.filterFiles([relativeSymlinkPath], {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });
      const nonFastPath = service.filterFiles([relativeSymlinkPath], {
        respectGitIgnore: true,
        respectLlxprtIgnore: false,
      });

      expect(fastPath).toStrictEqual([]);
      expect(nonFastPath).toStrictEqual([]);
      expect(fastPath).toStrictEqual(nonFastPath);
    });

    it('should keep visible symlink targets consistently between fast path and non-fast path', async () => {
      await createTestFile('visible-target/real.txt', 'data');
      const absoluteSymlinkPath = path.join(projectRoot, 'link-to-visible.txt');
      await fs.symlink(
        path.join(projectRoot, 'visible-target', 'real.txt'),
        absoluteSymlinkPath,
      );
      await fs.symlink(
        path.join(projectRoot, 'visible-target'),
        path.join(projectRoot, 'linked-visible-target'),
        'dir',
      );
      const relativeSymlinkPath = path.join(
        'linked-visible-target',
        'real.txt',
      );
      const files = [absoluteSymlinkPath, relativeSymlinkPath];

      const service = new FileDiscoveryService(projectRoot);
      const fastPath = service.filterFiles(files, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });
      const nonFastPath = service.filterFiles(files, {
        respectGitIgnore: true,
        respectLlxprtIgnore: false,
      });

      expect(fastPath).toStrictEqual(files);
      expect(nonFastPath).toStrictEqual(files);
      expect(fastPath).toStrictEqual(nonFastPath);
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

      expect(report.filteredPaths).toStrictEqual(
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

      expect(report.filteredPaths).toStrictEqual(files);
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

      expect(service.filterFiles(files, undefined)).toStrictEqual([
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
      expect(filtered).toStrictEqual([path.join(projectRoot, 'important.txt')]);
    });

    it('should un-ignore a directory in .llxprtignore that is ignored in .gitignore', async () => {
      await createTestFile('.gitignore', 'logs/');
      await createTestFile('.llxprtignore', '!logs/');

      const service = new FileDiscoveryService(projectRoot);
      const files = ['logs/app.log', 'other/app.log'].map((f) =>
        path.join(projectRoot, f),
      );

      const filtered = service.filterFiles(files);
      expect(filtered).toStrictEqual(files);
    });

    it('should un-ignore a file under a gitignored directory when explicitly negated in .llxprtignore', async () => {
      await createTestFile('.gitignore', 'tmp/');
      await createTestFile('.llxprtignore', '!tmp/example.txt');
      await createTestFile('tmp/example.txt', 'example');
      await createTestFile('tmp/other.txt', 'other');

      const service = new FileDiscoveryService(projectRoot);
      const files = ['tmp/example.txt', 'tmp/other.txt'].map((f) =>
        path.join(projectRoot, f),
      );

      const filtered = service.filterFiles(files);
      expect(
        service.shouldIgnoreFile(path.join(projectRoot, 'tmp/example.txt')),
      ).toBe(false);
      expect(
        service.shouldIgnoreFile(path.join(projectRoot, 'tmp/other.txt')),
      ).toBe(true);
      expect(filtered).toStrictEqual([
        path.join(projectRoot, 'tmp/example.txt'),
      ]);
    });

    it('should honor later .llxprtignore re-ignore after a negation', async () => {
      await createTestFile('.gitignore', 'tmp/');
      await createTestFile(
        '.llxprtignore',
        '!tmp/example.txt\ntmp/example.txt',
      );
      await createTestFile('tmp/example.txt', 'example');

      const service = new FileDiscoveryService(projectRoot);

      expect(
        service.shouldIgnoreFile(path.join(projectRoot, 'tmp/example.txt')),
      ).toBe(true);
      expect(
        service.filterFiles([path.join(projectRoot, 'tmp/example.txt')]),
      ).toStrictEqual([]);
    });

    it('should extend ignore rules in .llxprtignore', async () => {
      await createTestFile('.gitignore', '*.log');
      await createTestFile('.llxprtignore', 'temp/');

      const service = new FileDiscoveryService(projectRoot);
      const files = ['app.log', 'temp/file.txt'].map((f) =>
        path.join(projectRoot, f),
      );

      const filtered = service.filterFiles(files);
      expect(filtered).toStrictEqual([]);
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

      expect(filtered).toStrictEqual([]);
    });

    it('should apply only .llxprtignore when respectGitIgnore is false', async () => {
      await createTestFile('.gitignore', '*.txt');
      await createTestFile('.llxprtignore', 'temp/');

      const service = new FileDiscoveryService(projectRoot);
      const files = ['file.txt', 'important.txt', 'temp/file.js'].map((f) =>
        path.join(projectRoot, f),
      );

      const filtered = service.filterFiles(files, {
        respectGitIgnore: false,
        respectLlxprtIgnore: true,
      });

      expect(filtered).toStrictEqual(
        ['file.txt', 'important.txt'].map((f) => path.join(projectRoot, f)),
      );
    });

    it('gitignored path is NOT llxprtignored when .llxprtignore does not exclude it', async () => {
      await createTestFile('.gitignore', '*.secret');
      await createTestFile('.llxprtignore', 'logs/');

      const service = new FileDiscoveryService(projectRoot);
      const secretPath = path.join(projectRoot, 'my.secret');

      expect(service.shouldGitIgnoreFile(secretPath)).toBe(true);
      expect(service.shouldLlxprtIgnoreFile(secretPath)).toBe(false);
    });

    it('lets .llxprtignore negation override nested .gitignore rules', async () => {
      await createTestFile('.gitignore', 'sub');
      await createTestFile('.llxprtignore', '!sub/');
      await createTestFile('sub/.gitignore', 'nested-secret.txt');
      await createTestFile('sub/nested-secret.txt', 'secret');
      await createTestFile('sub/visible.txt', 'visible');

      // A project-level .llxprtignore negation is an explicit request to expose
      // this subtree to LLxprt tools, so it intentionally overrides nested Git
      // ignore files as part of the combined-precedence contract.
      const service = new FileDiscoveryService(projectRoot);
      const files = ['sub/nested-secret.txt', 'sub/visible.txt'].map((f) =>
        path.join(projectRoot, f),
      );

      expect(service.filterFiles(files)).toStrictEqual(files);
    });

    it('respectGitIgnore true + respectLlxprtIgnore false applies only gitignore', async () => {
      await createTestFile('.gitignore', '*.md');
      await createTestFile('.llxprtignore', 'drafts/');

      const service = new FileDiscoveryService(projectRoot);
      const files = ['readme.md', 'drafts/notes.js'].map((f) =>
        path.join(projectRoot, f),
      );

      const filtered = service.filterFiles(files, {
        respectGitIgnore: true,
        respectLlxprtIgnore: false,
      });

      expect(filtered).toStrictEqual(
        ['drafts/notes.js'].map((f) => path.join(projectRoot, f)),
      );
    });

    it('both flags false keeps all files', async () => {
      await createTestFile('.gitignore', '*.md');
      await createTestFile('.llxprtignore', 'drafts/');

      const service = new FileDiscoveryService(projectRoot);
      const files = ['readme.md', 'drafts/notes.js'].map((f) =>
        path.join(projectRoot, f),
      );

      const filtered = service.filterFiles(files, {
        respectGitIgnore: false,
        respectLlxprtIgnore: false,
      });

      expect(filtered).toStrictEqual(files);
    });
  });

  describe('nested workspace (.llxprtignore basing)', () => {
    let repoRoot: string;
    let workspaceDir: string;

    beforeEach(async () => {
      repoRoot = path.join(testRootDir, 'nested-repo');
      await fs.mkdir(repoRoot, { recursive: true });
      repoRoot = await fs.realpath(repoRoot);
      await fs.mkdir(path.join(repoRoot, '.git'), { recursive: true });
      workspaceDir = path.join(repoRoot, 'workspace');
      await fs.mkdir(workspaceDir, { recursive: true });
    });

    it('applies .llxprtignore patterns relative to workspace root, not repo root', async () => {
      await fs.writeFile(
        path.join(workspaceDir, '.llxprtignore'),
        'local-only.txt\n',
      );
      await fs.writeFile(path.join(workspaceDir, 'keep.ts'), 'keep');
      await fs.writeFile(path.join(workspaceDir, 'local-only.txt'), 'local');

      const service = new FileDiscoveryService(workspaceDir);

      expect(
        service.shouldLlxprtIgnoreFile(
          path.join(workspaceDir, 'local-only.txt'),
        ),
      ).toBe(true);
      expect(
        service.shouldLlxprtIgnoreFile(path.join(workspaceDir, 'keep.ts')),
      ).toBe(false);
    });

    it('combined filter with both flags applies .llxprtignore relative to workspace root', async () => {
      await fs.writeFile(path.join(repoRoot, '.gitignore'), '*.secret\n');
      await fs.writeFile(
        path.join(workspaceDir, '.llxprtignore'),
        'workspace-draft.txt\n',
      );
      await fs.writeFile(path.join(workspaceDir, 'keep.ts'), 'keep');
      await fs.writeFile(path.join(workspaceDir, 'hidden.secret'), 'secret');
      await fs.writeFile(
        path.join(workspaceDir, 'workspace-draft.txt'),
        'draft',
      );

      const service = new FileDiscoveryService(workspaceDir);

      const filtered = service.filterFiles(
        [
          path.join(workspaceDir, 'keep.ts'),
          path.join(workspaceDir, 'hidden.secret'),
          path.join(workspaceDir, 'workspace-draft.txt'),
        ],
        { respectGitIgnore: true, respectLlxprtIgnore: true },
      );

      expect(filtered).toStrictEqual([path.join(workspaceDir, 'keep.ts')]);
    });

    it('.llxprtignore negation un-ignores gitignored file in nested workspace', async () => {
      await fs.writeFile(path.join(repoRoot, '.gitignore'), '*.txt\n');
      // Workspace .llxprtignore un-ignores important.txt
      await fs.writeFile(
        path.join(workspaceDir, '.llxprtignore'),
        '!important.txt\n',
      );
      await fs.writeFile(path.join(workspaceDir, 'normal.txt'), 'normal');
      await fs.writeFile(path.join(workspaceDir, 'important.txt'), 'important');

      const service = new FileDiscoveryService(workspaceDir);

      const filtered = service.filterFiles(
        [
          path.join(workspaceDir, 'normal.txt'),
          path.join(workspaceDir, 'important.txt'),
        ],
        { respectGitIgnore: true, respectLlxprtIgnore: true },
      );

      // important.txt survives because .llxprtignore negation overrides .gitignore
      expect(filtered).toStrictEqual([
        path.join(workspaceDir, 'important.txt'),
      ]);
    });
  });
});
