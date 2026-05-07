/* eslint-disable no-console */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadServerHierarchicalMemory } from './memoryDiscovery.js';
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

describe('memoryDiscovery', () => {
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
    // Set environment variables to indicate test environment
    process.env.NODE_ENV = 'test';
    process.env.VITEST = 'true';

    projectRoot = await createEmptyDir(path.join(testRootDir, 'project'));
    cwd = await createEmptyDir(path.join(projectRoot, 'src'));
    homedir = await createEmptyDir(path.join(testRootDir, 'userhome'));
    vi.mocked(os.homedir).mockReturnValue(homedir);
  });

  afterEach(async () => {
    // Some tests set this to a different value.
    setLlxprtMdFilename(DEFAULT_CONTEXT_FILENAME);
    // Clean up the temporary directory to prevent resource leaks.
    await fsPromises.rm(testRootDir, { recursive: true, force: true });
  });

  describe('when untrusted', () => {
    it('does not load context files from untrusted workspaces', async () => {
      await createTestFile(
        path.join(projectRoot, DEFAULT_CONTEXT_FILENAME),
        'Project root memory',
      );
      await createTestFile(
        path.join(cwd, DEFAULT_CONTEXT_FILENAME),
        'Src directory memory',
      );
      const result = await loadServerHierarchicalMemory(
        cwd,
        [],
        false,
        new FileDiscoveryService(projectRoot),
        [],
        false, // untrusted
      );

      expect(result).toStrictEqual({
        memoryContent: '',
        fileCount: 0,
        filePaths: [],
      });
    });

    it('loads context from outside the untrusted workspace', async () => {
      await createTestFile(
        path.join(projectRoot, DEFAULT_CONTEXT_FILENAME),
        'Project root memory', // Untrusted
      );
      await createTestFile(
        path.join(cwd, DEFAULT_CONTEXT_FILENAME),
        'Src directory memory', // Untrusted
      );

      const filepath = path.join(homedir, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME);
      await createTestFile(filepath, 'default context content'); // In user home dir (outside untrusted space).
      const { fileCount, memoryContent, filePaths } =
        await loadServerHierarchicalMemory(
          cwd,
          [],
          false,
          new FileDiscoveryService(projectRoot),
          [],
          false, // untrusted
        );

      expect(fileCount).toStrictEqual(1);
      expect(memoryContent).toContain(path.relative(cwd, filepath).toString());
      expect(filePaths).toStrictEqual([filepath]);
    });
  });

  it('should return empty memory and count if no context files are found', async () => {
    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
    );

    expect(result).toStrictEqual({
      memoryContent: '',
      fileCount: 0,
      filePaths: [],
    });
  });

  it('should load only the global context file if present and others are not (default filename)', async () => {
    const defaultContextFile = await createTestFile(
      path.join(homedir, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
      'default context content',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
    );

    expect(result).toStrictEqual({
      memoryContent: `--- Context from: ${path.relative(cwd, defaultContextFile)} ---
default context content
--- End of Context from: ${path.relative(cwd, defaultContextFile)} ---`,
      fileCount: 1,
      filePaths: [defaultContextFile],
    });
  });

  it('should load only the global custom context file if present and filename is changed', async () => {
    const customFilename = 'CUSTOM_AGENTS.md';
    setLlxprtMdFilename(customFilename);

    const customContextFile = await createTestFile(
      path.join(homedir, LLXPRT_DIR, customFilename),
      'custom context content',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
    );

    expect(result).toStrictEqual({
      memoryContent: `--- Context from: ${path.relative(cwd, customContextFile)} ---
custom context content
--- End of Context from: ${path.relative(cwd, customContextFile)} ---`,
      fileCount: 1,
      filePaths: [customContextFile],
    });
  });

  it('should load context files by upward traversal with custom filename', async () => {
    const customFilename = 'PROJECT_CONTEXT.md';
    setLlxprtMdFilename(customFilename);

    const projectContextFile = await createTestFile(
      path.join(projectRoot, customFilename),
      'project context content',
    );
    const cwdContextFile = await createTestFile(
      path.join(cwd, customFilename),
      'cwd context content',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
    );

    expect(result).toStrictEqual({
      memoryContent: `--- Context from: ${path.relative(cwd, projectContextFile)} ---
project context content
--- End of Context from: ${path.relative(cwd, projectContextFile)} ---

--- Context from: ${path.relative(cwd, cwdContextFile)} ---
cwd context content
--- End of Context from: ${path.relative(cwd, cwdContextFile)} ---`,
      fileCount: 2,
      filePaths: [projectContextFile, cwdContextFile],
    });
  });

  it('should load context files by downward traversal with custom filename', async () => {
    const customFilename = 'LOCAL_CONTEXT.md';
    setLlxprtMdFilename(customFilename);

    const subdirCustomFile = await createTestFile(
      path.join(cwd, 'subdir', customFilename),
      'Subdir custom memory',
    );
    const cwdCustomFile = await createTestFile(
      path.join(cwd, customFilename),
      'CWD custom memory',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
    );

    expect(result).toStrictEqual({
      memoryContent: `--- Context from: ${customFilename} ---
CWD custom memory
--- End of Context from: ${customFilename} ---

--- Context from: ${path.join('subdir', customFilename)} ---
Subdir custom memory
--- End of Context from: ${path.join('subdir', customFilename)} ---`,
      fileCount: 2,
      filePaths: [cwdCustomFile, subdirCustomFile],
    });
  });

  it('should load ORIGINAL_GEMINI_MD_FILENAME files by upward traversal from CWD to project root', async () => {
    const projectRootGeminiFile = await createTestFile(
      path.join(projectRoot, DEFAULT_CONTEXT_FILENAME),
      'Project root memory',
    );
    const srcGeminiFile = await createTestFile(
      path.join(cwd, DEFAULT_CONTEXT_FILENAME),
      'Src directory memory',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
    );

    expect(result).toStrictEqual({
      memoryContent: `--- Context from: ${path.relative(cwd, projectRootGeminiFile)} ---
Project root memory
--- End of Context from: ${path.relative(cwd, projectRootGeminiFile)} ---

--- Context from: ${path.relative(cwd, srcGeminiFile)} ---
Src directory memory
--- End of Context from: ${path.relative(cwd, srcGeminiFile)} ---`,
      fileCount: 2,
      filePaths: [projectRootGeminiFile, srcGeminiFile],
    });
  });

  it('should load ORIGINAL_GEMINI_MD_FILENAME files by downward traversal from CWD', async () => {
    const subDirGeminiFile = await createTestFile(
      path.join(cwd, 'subdir', DEFAULT_CONTEXT_FILENAME),
      'Subdir memory',
    );
    const cwdGeminiFile = await createTestFile(
      path.join(cwd, DEFAULT_CONTEXT_FILENAME),
      'CWD memory',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
    );

    expect(result).toStrictEqual({
      memoryContent: `--- Context from: ${DEFAULT_CONTEXT_FILENAME} ---
CWD memory
--- End of Context from: ${DEFAULT_CONTEXT_FILENAME} ---

--- Context from: ${path.join('subdir', DEFAULT_CONTEXT_FILENAME)} ---
Subdir memory
--- End of Context from: ${path.join('subdir', DEFAULT_CONTEXT_FILENAME)} ---`,
      fileCount: 2,
      filePaths: [cwdGeminiFile, subDirGeminiFile],
    });
  });

  it('should load and correctly order global, upward, and downward ORIGINAL_GEMINI_MD_FILENAME files', async () => {
    const defaultContextFile = await createTestFile(
      path.join(homedir, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
      'default context content',
    );
    const rootGeminiFile = await createTestFile(
      path.join(testRootDir, DEFAULT_CONTEXT_FILENAME),
      'Project parent memory',
    );
    const projectRootGeminiFile = await createTestFile(
      path.join(projectRoot, DEFAULT_CONTEXT_FILENAME),
      'Project root memory',
    );
    const cwdGeminiFile = await createTestFile(
      path.join(cwd, DEFAULT_CONTEXT_FILENAME),
      'CWD memory',
    );
    const subDirGeminiFile = await createTestFile(
      path.join(cwd, 'sub', DEFAULT_CONTEXT_FILENAME),
      'Subdir memory',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
    );

    expect(result).toStrictEqual({
      memoryContent: `--- Context from: ${path.relative(cwd, defaultContextFile)} ---
default context content
--- End of Context from: ${path.relative(cwd, defaultContextFile)} ---

--- Context from: ${path.relative(cwd, rootGeminiFile)} ---
Project parent memory
--- End of Context from: ${path.relative(cwd, rootGeminiFile)} ---

--- Context from: ${path.relative(cwd, projectRootGeminiFile)} ---
Project root memory
--- End of Context from: ${path.relative(cwd, projectRootGeminiFile)} ---

--- Context from: ${path.relative(cwd, cwdGeminiFile)} ---
CWD memory
--- End of Context from: ${path.relative(cwd, cwdGeminiFile)} ---

--- Context from: ${path.relative(cwd, subDirGeminiFile)} ---
Subdir memory
--- End of Context from: ${path.relative(cwd, subDirGeminiFile)} ---`,
      fileCount: 5,
      filePaths: [
        defaultContextFile,
        rootGeminiFile,
        projectRootGeminiFile,
        cwdGeminiFile,
        subDirGeminiFile,
      ],
    });
  });

  it('should ignore specified directories during downward scan', async () => {
    await createEmptyDir(path.join(projectRoot, '.git'));
    await createTestFile(path.join(projectRoot, '.gitignore'), 'node_modules');

    await createTestFile(
      path.join(cwd, 'node_modules', DEFAULT_CONTEXT_FILENAME),
      'Ignored memory',
    );
    const regularSubDirGeminiFile = await createTestFile(
      path.join(cwd, 'my_code', DEFAULT_CONTEXT_FILENAME),
      'My code memory',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
      'tree',
      {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      },
      200, // maxDirs parameter
    );

    expect(result).toStrictEqual({
      memoryContent: `--- Context from: ${path.relative(cwd, regularSubDirGeminiFile)} ---
My code memory
--- End of Context from: ${path.relative(cwd, regularSubDirGeminiFile)} ---`,
      fileCount: 1,
      filePaths: [regularSubDirGeminiFile],
    });
  });

  it(
    'should respect the maxDirs parameter during downward scan',
    { timeout: 15000 },
    async () => {
      const _consoleDebugSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});

      for (let i = 0; i < 60; i++) {
        await createEmptyDir(path.join(cwd, `deep_dir_${i}`));
      }

      // Pass the custom limit directly to the function
      await loadServerHierarchicalMemory(
        cwd,
        [],
        true,
        new FileDiscoveryService(projectRoot),
        [],
        DEFAULT_FOLDER_TRUST,
        'tree', // importFormat
        {
          respectGitIgnore: true,
          respectLlxprtIgnore: true,
        },
        50, // maxDirs
      );

      // Debug logging removed - no need to check for it

      vi.mocked(console.debug).mockRestore();

      const result = await loadServerHierarchicalMemory(
        cwd,
        [],
        false,
        new FileDiscoveryService(projectRoot),
        [],
        DEFAULT_FOLDER_TRUST,
      );

      expect(result).toStrictEqual({
        memoryContent: '',
        fileCount: 0,
        filePaths: [],
      });
    },
  );

  it('should respect the maxDepth parameter during downward scan', async () => {
    // Create files at multiple depths from CWD
    const cwdFile = await createTestFile(
      path.join(cwd, DEFAULT_CONTEXT_FILENAME),
      'CWD memory',
    );
    const level1File = await createTestFile(
      path.join(cwd, 'level1', DEFAULT_CONTEXT_FILENAME),
      'Level 1 memory',
    );
    await createTestFile(
      path.join(cwd, 'level1', 'level2', DEFAULT_CONTEXT_FILENAME),
      'Level 2 memory',
    );
    await createTestFile(
      path.join(cwd, 'level1', 'level2', 'level3', DEFAULT_CONTEXT_FILENAME),
      'Level 3 memory',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
      'tree',
      undefined,
      200,
      1, // maxDepth = 1, only CWD (depth 0) and level1 (depth 1)
    );

    // Should find cwdFile (depth 0) and level1File (depth 1) from downward scan
    // Should NOT find level2 or level3 files
    expect(result.filePaths).toContain(cwdFile);
    expect(result.filePaths).toContain(level1File);
    expect(result.memoryContent).toContain('CWD memory');
    expect(result.memoryContent).toContain('Level 1 memory');
    expect(result.memoryContent).not.toContain('Level 2 memory');
    expect(result.memoryContent).not.toContain('Level 3 memory');
  });

  it('should not affect upward traversal when maxDepth is 0', async () => {
    // Create global file
    const globalFile = await createTestFile(
      path.join(homedir, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
      'Global memory',
    );
    // Create project root file (found via upward traversal)
    const projectRootFile = await createTestFile(
      path.join(projectRoot, DEFAULT_CONTEXT_FILENAME),
      'Project root memory',
    );
    // Create CWD file (found via both upward and downward)
    const cwdFile = await createTestFile(
      path.join(cwd, DEFAULT_CONTEXT_FILENAME),
      'CWD memory',
    );
    // Create subdirectory file (found only via downward traversal)
    await createTestFile(
      path.join(cwd, 'subdir', DEFAULT_CONTEXT_FILENAME),
      'Subdir memory',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
      'tree',
      undefined,
      200,
      0, // maxDepth = 0, downward scan only finds CWD level
    );

    // Global and upward-found files should still be present
    expect(result.filePaths).toContain(globalFile);
    expect(result.filePaths).toContain(projectRootFile);
    expect(result.filePaths).toContain(cwdFile);
    expect(result.memoryContent).toContain('Global memory');
    expect(result.memoryContent).toContain('Project root memory');
    expect(result.memoryContent).toContain('CWD memory');
    // Subdirectory file should NOT be present (maxDepth=0 prevents downward beyond CWD)
    expect(result.memoryContent).not.toContain('Subdir memory');
  });

  it('should not affect .llxprt/LLXPRT.md files during upward traversal when maxDepth is 0', async () => {
    // Create .llxprt/LLXPRT.md at project root (found via upward scan)
    const projectLlxprtFile = await createTestFile(
      path.join(projectRoot, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
      'Project scoped memory',
    );
    // Create .llxprt/LLXPRT.md at CWD (found via upward scan)
    const cwdLlxprtFile = await createTestFile(
      path.join(cwd, LLXPRT_DIR, DEFAULT_CONTEXT_FILENAME),
      'CWD scoped memory',
    );
    // Create a subdirectory file (found only via downward traversal)
    await createTestFile(
      path.join(cwd, 'deep', DEFAULT_CONTEXT_FILENAME),
      'Deep memory',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
      'tree',
      undefined,
      200,
      0, // maxDepth = 0
    );

    // .llxprt/LLXPRT.md files from upward scan should still be present
    expect(result.filePaths).toContain(projectLlxprtFile);
    expect(result.filePaths).toContain(cwdLlxprtFile);
    expect(result.memoryContent).toContain('Project scoped memory');
    expect(result.memoryContent).toContain('CWD scoped memory');
    // Downward-only file should NOT be present
    expect(result.memoryContent).not.toContain('Deep memory');
  });

  it('should load extension context file paths', async () => {
    const extensionFilePath = await createTestFile(
      path.join(testRootDir, 'extensions/ext1/LLXPRT.md'),
      'Extension memory content',
    );

    // Create extension object with contextFiles array (refactored signature)
    const extension: GeminiCLIExtension = {
      name: 'ext1',
      path: path.join(testRootDir, 'extensions/ext1'),
      version: '1.0.0',
      isActive: true,
      contextFiles: [extensionFilePath],
    };

    const result = await loadServerHierarchicalMemory(
      cwd,
      [],
      false,
      new FileDiscoveryService(projectRoot),
      [extension],
      DEFAULT_FOLDER_TRUST,
    );

    expect(result).toStrictEqual({
      memoryContent: `--- Context from: ${path.relative(cwd, extensionFilePath)} ---
Extension memory content
--- End of Context from: ${path.relative(cwd, extensionFilePath)} ---`,
      fileCount: 1,
      filePaths: [extensionFilePath],
    });
  });

  it('should load memory from included directories', async () => {
    const includedDir = await createEmptyDir(
      path.join(testRootDir, 'included'),
    );
    const includedFile = await createTestFile(
      path.join(includedDir, DEFAULT_CONTEXT_FILENAME),
      'included directory memory',
    );

    const result = await loadServerHierarchicalMemory(
      cwd,
      [includedDir],
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
    );

    expect(result).toStrictEqual({
      memoryContent: `--- Context from: ${path.relative(cwd, includedFile)} ---
included directory memory
--- End of Context from: ${path.relative(cwd, includedFile)} ---`,
      fileCount: 1,
      filePaths: [includedFile],
    });
  });

  it('should handle multiple directories and files in parallel correctly', async () => {
    // Create multiple test directories with GEMINI.md files
    const numDirs = 5;
    const createdFiles: string[] = [];

    for (let i = 0; i < numDirs; i++) {
      const dirPath = await createEmptyDir(
        path.join(testRootDir, `project-${i}`),
      );
      const filePath = await createTestFile(
        path.join(dirPath, DEFAULT_CONTEXT_FILENAME),
        `Content from project ${i}`,
      );
      createdFiles.push(filePath);
    }

    // Load memory from all directories
    const result = await loadServerHierarchicalMemory(
      cwd,
      createdFiles.map((f) => path.dirname(f)),
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
    );

    // Should have loaded all files
    expect(result.fileCount).toBe(numDirs);
    expect(result.filePaths.length).toBe(numDirs);
    expect(result.filePaths.sort()).toStrictEqual(createdFiles.sort());

    // Content should include all project contents
    for (let i = 0; i < numDirs; i++) {
      expect(result.memoryContent).toContain(`Content from project ${i}`);
    }
  });

  it('should preserve order and prevent duplicates when processing multiple directories', async () => {
    // Create overlapping directory structure
    const parentDir = await createEmptyDir(path.join(testRootDir, 'parent'));
    const childDir = await createEmptyDir(path.join(parentDir, 'child'));

    const parentFile = await createTestFile(
      path.join(parentDir, DEFAULT_CONTEXT_FILENAME),
      'Parent content',
    );
    const childFile = await createTestFile(
      path.join(childDir, DEFAULT_CONTEXT_FILENAME),
      'Child content',
    );

    // Include both parent and child directories
    const result = await loadServerHierarchicalMemory(
      parentDir,
      [childDir, parentDir], // Deliberately include duplicates
      false,
      new FileDiscoveryService(projectRoot),
      [],
      DEFAULT_FOLDER_TRUST,
    );

    // Should have both files without duplicates
    expect(result.fileCount).toBe(2);
    expect(result.memoryContent).toContain('Parent content');
    expect(result.memoryContent).toContain('Child content');
    expect(result.filePaths.sort()).toStrictEqual(
      [parentFile, childFile].sort(),
    );

    // Check that files are not duplicated
    const parentOccurrences =
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: match() returns null | string[], we need [] for .length when no match
      (result.memoryContent.match(/Parent content/g) || []).length;
    const childOccurrences =
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: match() returns null | string[], we need [] for .length when no match
      (result.memoryContent.match(/Child content/g) || []).length;
    expect(parentOccurrences).toBe(1);
    expect(childOccurrences).toBe(1);
  });
});
