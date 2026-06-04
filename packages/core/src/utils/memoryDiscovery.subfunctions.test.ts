/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadServerHierarchicalMemory,
  loadGlobalMemory,
  loadEnvironmentMemory,
  loadJitSubdirectoryMemory,
  loadCoreMemory,
} from './memoryDiscovery.js';
import {
  setLlxprtMdFilename,
  DEFAULT_CONTEXT_FILENAME,
} from '../tools/memoryTool.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { LLXPRT_DIR } from './paths.js';
import type { GeminiCLIExtension } from '../config/config.js';

vi.mock('os', async (importOriginal) => {
  const actualOs = await importOriginal<typeof os>();
  return {
    ...actualOs,
    homedir: vi.fn(),
  };
});

// Simple extension loader for testing
class SimpleExtensionLoader {
  constructor(private extensions: GeminiCLIExtension[]) {}
  getExtensions() {
    return this.extensions;
  }
}

describe('memoryDiscovery subfunctions', () => {
  const DEFAULT_FOLDER_TRUST = true;
  let testRootDir: string;
  let cwd: string;
  let projectRoot: string;
  let homedir: string;

  async function createEmptyDir(fullPath: string) {
    await fsPromises.mkdir(fullPath, { recursive: true });
    return fullPath;
  }

  async function createTestFile(fullPath: string, fileContents: string) {
    await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
    await fsPromises.writeFile(fullPath, fileContents);
    return path.resolve(testRootDir, fullPath);
  }

  beforeEach(async () => {
    testRootDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'folder-structure-test-'),
    );

    vi.resetAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.VITEST = 'true';

    projectRoot = await createEmptyDir(path.join(testRootDir, 'project'));
    cwd = await createEmptyDir(path.join(projectRoot, 'src'));
    homedir = await createEmptyDir(path.join(testRootDir, 'userhome'));
    vi.mocked(os.homedir).mockReturnValue(homedir);
  });

  afterEach(async () => {
    setLlxprtMdFilename(DEFAULT_CONTEXT_FILENAME);
    await fsPromises.rm(testRootDir, { recursive: true, force: true });
  });

  describe('project-scoped memory discovery (issue #985)', () => {
    it('should discover memory files saved to .llxprt/ subdirectory during upward scan', async () => {
      const projectLlxprtFile = await createTestFile(
        path.join(projectRoot, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
        'Project-scoped memory content',
      );

      const result = await loadServerHierarchicalMemory(
        cwd,
        [],
        false,
        new FileDiscoveryService(projectRoot),
        [],
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.filePaths).toContain(projectLlxprtFile);
      expect(result.memoryContent).toContain('Project-scoped memory content');
    });

    it('should discover memory files in .llxprt/ at multiple directory levels during upward scan', async () => {
      const projectLlxprtFile = await createTestFile(
        path.join(projectRoot, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
        'Project root scoped memory',
      );
      const cwdLlxprtFile = await createTestFile(
        path.join(cwd, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
        'CWD scoped memory',
      );

      const result = await loadServerHierarchicalMemory(
        cwd,
        [],
        false,
        new FileDiscoveryService(projectRoot),
        [],
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.filePaths).toContain(projectLlxprtFile);
      expect(result.filePaths).toContain(cwdLlxprtFile);
      expect(result.memoryContent).toContain('Project root scoped memory');
      expect(result.memoryContent).toContain('CWD scoped memory');
    });

    it('should load both direct LLXPRT.md and .llxprt/LLXPRT.md from the same directory', async () => {
      const directFile = await createTestFile(
        path.join(projectRoot, DEFAULT_CONTEXT_FILENAME),
        'Direct memory content',
      );
      const llxprtDirFile = await createTestFile(
        path.join(projectRoot, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
        'Scoped memory content',
      );

      const result = await loadServerHierarchicalMemory(
        cwd,
        [],
        false,
        new FileDiscoveryService(projectRoot),
        [],
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.filePaths).toContain(directFile);
      expect(result.filePaths).toContain(llxprtDirFile);
      expect(result.memoryContent).toContain('Direct memory content');
      expect(result.memoryContent).toContain('Scoped memory content');
    });

    it('should not duplicate global memory path when scanning .llxprt/ directories', async () => {
      const globalFile = await createTestFile(
        path.join(homedir, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
        'Global memory content',
      );

      const result = await loadServerHierarchicalMemory(
        cwd,
        [],
        false,
        new FileDiscoveryService(projectRoot),
        [],
        DEFAULT_FOLDER_TRUST,
      );

      expect(result.filePaths).toContain(globalFile);
      const occurrences = result.filePaths.filter(
        (p) => p === globalFile,
      ).length;
      expect(occurrences).toBe(1);
    });
  });

  describe('loadGlobalMemory', () => {
    it('should load global memory file if it exists', async () => {
      const globalMemoryFile = await createTestFile(
        path.join(homedir, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
        'Global memory content',
      );

      const result = await loadGlobalMemory();

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(globalMemoryFile);
      expect(result.files[0].content).toBe('Global memory content');
    });

    it('should return empty content if global memory file does not exist', async () => {
      const result = await loadGlobalMemory();

      expect(result.files).toHaveLength(0);
    });
  });

  describe('loadEnvironmentMemory', () => {
    it('should load extension memory', async () => {
      const extFile = await createTestFile(
        path.join(testRootDir, 'ext', 'LLXPRT.md'),
        'Extension content',
      );
      const mockExtensionLoader = new SimpleExtensionLoader([
        {
          isActive: true,
          contextFiles: [extFile],
        } as GeminiCLIExtension,
      ]);

      const result = await loadEnvironmentMemory([], mockExtensionLoader);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(extFile);
      expect(result.files[0].content).toBe('Extension content');
    });

    it('should NOT traverse upward beyond trusted root (even with .git)', async () => {
      const parentDir = await createEmptyDir(path.join(testRootDir, 'parent'));
      const repoDir = await createEmptyDir(path.join(parentDir, 'repo'));
      await createEmptyDir(path.join(repoDir, '.git'));
      const srcDir = await createEmptyDir(path.join(repoDir, 'src'));

      await createTestFile(
        path.join(parentDir, DEFAULT_CONTEXT_FILENAME),
        'Parent content',
      );
      await createTestFile(
        path.join(repoDir, DEFAULT_CONTEXT_FILENAME),
        'Repo content',
      );
      const srcFile = await createTestFile(
        path.join(srcDir, DEFAULT_CONTEXT_FILENAME),
        'Src content',
      );

      const result = await loadEnvironmentMemory(
        [srcDir],
        new SimpleExtensionLoader([]),
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(srcFile);
      expect(result.files[0].content).toBe('Src content');
    });

    it('should NOT traverse upward beyond trusted root (no .git)', async () => {
      const docsDir = await createEmptyDir(path.join(homedir, 'docs'));
      const notesDir = await createEmptyDir(path.join(docsDir, 'notes'));

      await createTestFile(
        path.join(homedir, DEFAULT_CONTEXT_FILENAME),
        'Home content',
      );
      const docsFile = await createTestFile(
        path.join(docsDir, DEFAULT_CONTEXT_FILENAME),
        'Docs content',
      );

      const resultNotes = await loadEnvironmentMemory(
        [notesDir],
        new SimpleExtensionLoader([]),
      );
      expect(resultNotes.files).toHaveLength(0);

      const resultDocs = await loadEnvironmentMemory(
        [docsDir],
        new SimpleExtensionLoader([]),
      );
      expect(resultDocs.files).toHaveLength(1);
      expect(resultDocs.files[0].path).toBe(docsFile);
      expect(resultDocs.files[0].content).toBe('Docs content');
    });

    it('should deduplicate paths when same root is trusted multiple times', async () => {
      const repoDir = await createEmptyDir(path.join(testRootDir, 'repo'));
      await createEmptyDir(path.join(repoDir, '.git'));

      const repoFile = await createTestFile(
        path.join(repoDir, DEFAULT_CONTEXT_FILENAME),
        'Repo content',
      );

      const result = await loadEnvironmentMemory(
        [repoDir, repoDir],
        new SimpleExtensionLoader([]),
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(repoFile);
    });

    it('should keep multiple memory files from the same directory adjacent and in order', async () => {
      setLlxprtMdFilename(['PRIMARY.md', 'SECONDARY.md']);

      const dir = await createEmptyDir(
        path.join(testRootDir, 'multi_file_dir'),
      );
      await createEmptyDir(path.join(dir, '.git'));

      const primaryFile = await createTestFile(
        path.join(dir, 'PRIMARY.md'),
        'Primary content',
      );
      const secondaryFile = await createTestFile(
        path.join(dir, 'SECONDARY.md'),
        'Secondary content',
      );

      const result = await loadEnvironmentMemory(
        [dir],
        new SimpleExtensionLoader([]),
      );

      expect(result.files).toHaveLength(2);
      expect(result.files[0].path).toBe(primaryFile);
      expect(result.files[1].path).toBe(secondaryFile);
      expect(result.files[0].content).toBe('Primary content');
      expect(result.files[1].content).toBe('Secondary content');
    });

    it('should discover .llxprt/ subdirectory memory files during upward scan', async () => {
      const trustedRoot = await createEmptyDir(
        path.join(testRootDir, 'env_root'),
      );

      const llxprtMemoryFile = await createTestFile(
        path.join(trustedRoot, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
        'Env .llxprt memory',
      );

      const result = await loadEnvironmentMemory(
        [trustedRoot],
        new SimpleExtensionLoader([]),
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(llxprtMemoryFile);
      expect(result.files[0].content).toBe('Env .llxprt memory');
    });

    it('should discover both direct and .llxprt/ memory files from the same directory', async () => {
      const trustedRoot = await createEmptyDir(
        path.join(testRootDir, 'env_root'),
      );

      const directFile = await createTestFile(
        path.join(trustedRoot, DEFAULT_CONTEXT_FILENAME),
        'Direct memory',
      );
      const llxprtFile = await createTestFile(
        path.join(trustedRoot, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
        'Llxprt memory',
      );

      const result = await loadEnvironmentMemory(
        [trustedRoot],
        new SimpleExtensionLoader([]),
      );

      expect(result.files).toHaveLength(2);
      expect(result.files.map((f) => f.path).sort()).toStrictEqual(
        [directFile, llxprtFile].sort(),
      );
    });

    it('should not duplicate global memory path when .llxprt/ scan encounters global dir', async () => {
      const globalFile = await createTestFile(
        path.join(homedir, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
        'Global memory',
      );

      const trustedRoot = await createEmptyDir(
        path.join(testRootDir, 'env_root'),
      );

      const result = await loadEnvironmentMemory(
        [trustedRoot],
        new SimpleExtensionLoader([]),
      );

      const globalFileOccurrences = result.files.filter(
        (f) => f.path === globalFile,
      );
      expect(globalFileOccurrences.length).toBe(0);
    });
  });

  describe('loadJitSubdirectoryMemory', () => {
    it('should load JIT memory when target is inside a trusted root', async () => {
      const rootDir = await createEmptyDir(path.join(testRootDir, 'jit_root'));
      const subDir = await createEmptyDir(path.join(rootDir, 'subdir'));
      const targetFile = path.join(subDir, 'target.txt');

      const subDirMemory = await createTestFile(
        path.join(subDir, DEFAULT_CONTEXT_FILENAME),
        'Subdir JIT content',
      );

      const result = await loadJitSubdirectoryMemory(
        targetFile,
        [rootDir],
        new Set(),
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(subDirMemory);
      expect(result.files[0].content).toBe('Subdir JIT content');
    });

    it('should discover .llxprt/ subdirectory memory files during JIT upward scan', async () => {
      const rootDir = await createEmptyDir(path.join(testRootDir, 'jit_root'));
      const subDir = await createEmptyDir(path.join(rootDir, 'subdir'));
      const targetFile = path.join(subDir, 'target.txt');

      const subDirLlxprtMemory = await createTestFile(
        path.join(subDir, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
        'Subdir .llxprt memory',
      );

      const result = await loadJitSubdirectoryMemory(
        targetFile,
        [rootDir],
        new Set(),
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(subDirLlxprtMemory);
      expect(result.files[0].content).toBe('Subdir .llxprt memory');
    });

    it('should skip JIT memory when target is outside trusted roots', async () => {
      const trustedRoot = await createEmptyDir(
        path.join(testRootDir, 'trusted'),
      );
      const untrustedDir = await createEmptyDir(
        path.join(testRootDir, 'untrusted'),
      );
      const targetFile = path.join(untrustedDir, 'target.txt');

      await createTestFile(
        path.join(untrustedDir, DEFAULT_CONTEXT_FILENAME),
        'Untrusted content',
      );

      const result = await loadJitSubdirectoryMemory(
        targetFile,
        [trustedRoot],
        new Set(),
      );

      expect(result.files).toHaveLength(0);
    });

    it('should skip already loaded paths', async () => {
      const rootDir = await createEmptyDir(path.join(testRootDir, 'jit_root'));
      const subDir = await createEmptyDir(path.join(rootDir, 'subdir'));
      const targetFile = path.join(subDir, 'target.txt');

      const rootMemory = await createTestFile(
        path.join(rootDir, DEFAULT_CONTEXT_FILENAME),
        'Root content',
      );
      const subDirMemory = await createTestFile(
        path.join(subDir, DEFAULT_CONTEXT_FILENAME),
        'Subdir content',
      );

      const alreadyLoaded = new Set([rootMemory]);

      const result = await loadJitSubdirectoryMemory(
        targetFile,
        [rootDir],
        alreadyLoaded,
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(subDirMemory);
      expect(result.files[0].content).toBe('Subdir content');
    });

    it('should use the deepest trusted root when multiple nested roots exist', async () => {
      const outerRoot = await createEmptyDir(path.join(testRootDir, 'outer'));
      const innerRoot = await createEmptyDir(path.join(outerRoot, 'inner'));
      const targetFile = path.join(innerRoot, 'target.txt');

      const outerMemory = await createTestFile(
        path.join(outerRoot, DEFAULT_CONTEXT_FILENAME),
        'Outer content',
      );
      const innerMemory = await createTestFile(
        path.join(innerRoot, DEFAULT_CONTEXT_FILENAME),
        'Inner content',
      );

      const result = await loadJitSubdirectoryMemory(
        targetFile,
        [outerRoot, innerRoot],
        new Set(),
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(innerMemory);
      expect(result.files[0].content).toBe('Inner content');
      expect(result.files.find((f) => f.path === outerMemory)).toBeUndefined();
    });

    it('should skip JIT memory when jitContextEnabled is false', async () => {
      const rootDir = await createEmptyDir(path.join(testRootDir, 'jit_root'));
      const subDir = await createEmptyDir(path.join(rootDir, 'subdir'));
      const targetFile = path.join(subDir, 'target.txt');

      await createTestFile(
        path.join(subDir, DEFAULT_CONTEXT_FILENAME),
        'Subdir JIT content',
      );

      const result = await loadJitSubdirectoryMemory(
        targetFile,
        [rootDir],
        new Set(),
        false,
        false,
      );

      expect(result.files).toHaveLength(0);
    });

    it('should load JIT memory when jitContextEnabled is true', async () => {
      const rootDir = await createEmptyDir(path.join(testRootDir, 'jit_root'));
      const subDir = await createEmptyDir(path.join(rootDir, 'subdir'));
      const targetFile = path.join(subDir, 'target.txt');

      const subDirMemory = await createTestFile(
        path.join(subDir, DEFAULT_CONTEXT_FILENAME),
        'Subdir JIT content',
      );

      const result = await loadJitSubdirectoryMemory(
        targetFile,
        [rootDir],
        new Set(),
        false,
        true,
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(subDirMemory);
      expect(result.files[0].content).toBe('Subdir JIT content');
    });

    it('should load JIT memory by default when jitContextEnabled is not specified', async () => {
      const rootDir = await createEmptyDir(path.join(testRootDir, 'jit_root'));
      const subDir = await createEmptyDir(path.join(rootDir, 'subdir'));
      const targetFile = path.join(subDir, 'target.txt');

      const subDirMemory = await createTestFile(
        path.join(subDir, DEFAULT_CONTEXT_FILENAME),
        'Subdir JIT content',
      );

      const result = await loadJitSubdirectoryMemory(
        targetFile,
        [rootDir],
        new Set(),
      );

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(subDirMemory);
      expect(result.files[0].content).toBe('Subdir JIT content');
    });
  });

  describe('loadCoreMemory', () => {
    it('should load global .LLXPRT_SYSTEM file', async () => {
      const globalCoreFile = await createTestFile(
        path.join(homedir, LLXPRT_DIR, '.LLXPRT_SYSTEM'),
        'Global core memory',
      );

      const result = await loadCoreMemory([]);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(globalCoreFile);
      expect(result.files[0].content).toBe('Global core memory');
    });

    it('should load project .LLXPRT_SYSTEM file from trusted roots', async () => {
      const trustedRoot = await createEmptyDir(
        path.join(testRootDir, 'core_root'),
      );

      const projectCoreFile = await createTestFile(
        path.join(trustedRoot, LLXPRT_DIR, '.LLXPRT_SYSTEM'),
        'Project core memory',
      );

      const result = await loadCoreMemory([trustedRoot]);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe(projectCoreFile);
      expect(result.files[0].content).toBe('Project core memory');
    });

    it('should load both global and project .LLXPRT_SYSTEM files', async () => {
      const globalCoreFile = await createTestFile(
        path.join(homedir, LLXPRT_DIR, '.LLXPRT_SYSTEM'),
        'Global core memory',
      );

      const trustedRoot = await createEmptyDir(
        path.join(testRootDir, 'core_root'),
      );

      const projectCoreFile = await createTestFile(
        path.join(trustedRoot, LLXPRT_DIR, '.LLXPRT_SYSTEM'),
        'Project core memory',
      );

      const result = await loadCoreMemory([trustedRoot]);

      expect(result.files).toHaveLength(2);
      expect(result.files.map((f) => f.path)).toStrictEqual([
        projectCoreFile,
        globalCoreFile,
      ]);
    });

    it('should return empty if no .LLXPRT_SYSTEM files exist', async () => {
      const trustedRoot = await createEmptyDir(
        path.join(testRootDir, 'core_root'),
      );

      const result = await loadCoreMemory([trustedRoot]);

      expect(result.files).toHaveLength(0);
    });
  });
});
