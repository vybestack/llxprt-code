/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReadFileTool } from '../read-file.js';
import { ReadManyFilesTool } from '../read-many-files.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import fsp from 'fs/promises';
import { Config } from '../../config/config.js';
import { FileDiscoveryService } from '../../services/fileDiscoveryService.js';
import { StandardFileSystemService } from '../../services/fileSystemService.js';
import { createMockWorkspaceContext } from '../../test-utils/mockWorkspaceContext.js';
import { WorkspaceContext } from '../../utils/workspaceContext.js';
import {
  COMMON_IGNORE_PATTERNS,
  DEFAULT_FILE_EXCLUDES,
} from '../../utils/ignorePatterns.js';

describe('file-read-max-lines setting', () => {
  let tempRootDir: string;
  let readFileTool: ReadFileTool;
  let readManyFilesTool: ReadManyFilesTool;
  const abortSignal = new AbortController().signal;

  beforeEach(async () => {
    tempRootDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'file-read-max-lines-test-'),
    );
  });

  afterEach(async () => {
    if (fs.existsSync(tempRootDir)) {
      await fsp.rm(tempRootDir, { recursive: true, force: true });
    }
  });

  describe('ReadFileTool', () => {
    it('uses configured file-read-max-lines when no explicit limit is provided', async () => {
      const testFile = path.join(tempRootDir, 'test.txt');
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
      await fsp.writeFile(testFile, lines.join('\n'));

      const mockConfigInstance = {
        getFileService: () => new FileDiscoveryService(tempRootDir),
        getFileSystemService: () => new StandardFileSystemService(),
        getTargetDir: () => tempRootDir,
        getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
        getConversationLoggingEnabled: () => false,
        getEphemeralSettings: () => ({ 'file-read-max-lines': 50 }),
      } as unknown as Config;

      readFileTool = new ReadFileTool(mockConfigInstance);
      const invocation = readFileTool.build({ absolute_path: testFile });

      if (typeof invocation === 'string') {
        throw new Error(`Unexpected validation error: ${invocation}`);
      }

      const result = await invocation.execute(abortSignal);
      const content = String(result.llmContent);

      expect(content).toContain('Line 1');
      expect(content).toContain('Line 50');
      expect(content).not.toContain('Line 51');
    });

    it('uses default value when file-read-max-lines is not configured', async () => {
      const testFile = path.join(tempRootDir, 'test.txt');
      const lines = Array.from({ length: 2100 }, (_, i) => `Line ${i + 1}`);
      await fsp.writeFile(testFile, lines.join('\n'));

      const mockConfigInstance = {
        getFileService: () => new FileDiscoveryService(tempRootDir),
        getFileSystemService: () => new StandardFileSystemService(),
        getTargetDir: () => tempRootDir,
        getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
        getConversationLoggingEnabled: () => false,
        getEphemeralSettings: () => ({}),
      } as unknown as Config;

      readFileTool = new ReadFileTool(mockConfigInstance);
      const invocation = readFileTool.build({ absolute_path: testFile });

      if (typeof invocation === 'string') {
        throw new Error(`Unexpected validation error: ${invocation}`);
      }

      const result = await invocation.execute(abortSignal);
      const content = String(result.llmContent);

      expect(content).toContain('Line 1');
      expect(content).toContain('Line 2000');
      expect(content).not.toContain('Line 2001');
    });

    it('respects explicit limit parameter over file-read-max-lines setting', async () => {
      const testFile = path.join(tempRootDir, 'test.txt');
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
      await fsp.writeFile(testFile, lines.join('\n'));

      const mockConfigInstance = {
        getFileService: () => new FileDiscoveryService(tempRootDir),
        getFileSystemService: () => new StandardFileSystemService(),
        getTargetDir: () => tempRootDir,
        getWorkspaceContext: () => createMockWorkspaceContext(tempRootDir),
        getConversationLoggingEnabled: () => false,
        getEphemeralSettings: () => ({ 'file-read-max-lines': 50 }),
      } as unknown as Config;

      readFileTool = new ReadFileTool(mockConfigInstance);
      const invocation = readFileTool.build({
        absolute_path: testFile,
        limit: 25,
      });

      if (typeof invocation === 'string') {
        throw new Error(`Unexpected validation error: ${invocation}`);
      }

      const result = await invocation.execute(abortSignal);
      const content = String(result.llmContent);

      expect(content).toContain('Line 1');
      expect(content).toContain('Line 25');
      expect(content).not.toContain('Line 26');
    });
  });

  describe('ReadManyFilesTool', () => {
    it('uses configured file-read-max-lines for each file', async () => {
      const testFile1 = path.join(tempRootDir, 'test1.txt');
      const testFile2 = path.join(tempRootDir, 'test2.txt');
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`);
      await fsp.writeFile(testFile1, lines.join('\n'));
      await fsp.writeFile(testFile2, lines.join('\n'));

      const fileService = new FileDiscoveryService(tempRootDir);
      const mockConfig = {
        getFileService: () => fileService,
        getFileSystemService: () => new StandardFileSystemService(),
        getEphemeralSettings: () => ({ 'file-read-max-lines': 30 }),
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectLlxprtIgnore: true,
        }),
        getTargetDir: () => tempRootDir,
        getWorkspaceDirs: () => [tempRootDir],
        getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
        getFileExclusions: () => ({
          getCoreIgnorePatterns: () => COMMON_IGNORE_PATTERNS,
          getDefaultExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
          getGlobExcludes: () => COMMON_IGNORE_PATTERNS,
          buildExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
          getReadManyFilesExcludes: () => DEFAULT_FILE_EXCLUDES,
        }),
      } as Partial<Config> as Config;

      readManyFilesTool = new ReadManyFilesTool(mockConfig);
      const invocation = readManyFilesTool.build({
        paths: ['*.txt'],
      });

      if (typeof invocation === 'string') {
        throw new Error(`Unexpected validation error: ${invocation}`);
      }

      const result = await invocation.execute(abortSignal);
      const contentParts = Array.isArray(result.llmContent)
        ? result.llmContent
        : [result.llmContent];
      const content = contentParts.map(String).join('');

      expect(content).toContain('Line 1');
      expect(content).toContain('Line 30');
      expect(content).not.toContain('Line 31');
    });

    it('uses default value when file-read-max-lines is not configured', async () => {
      const testFile = path.join(tempRootDir, 'test.txt');
      const lines = Array.from({ length: 2100 }, (_, i) => `Line ${i + 1}`);
      await fsp.writeFile(testFile, lines.join('\n'));

      const fileService = new FileDiscoveryService(tempRootDir);
      const mockConfig = {
        getFileService: () => fileService,
        getFileSystemService: () => new StandardFileSystemService(),
        getEphemeralSettings: () => ({}),
        getFileFilteringOptions: () => ({
          respectGitIgnore: true,
          respectLlxprtIgnore: true,
        }),
        getTargetDir: () => tempRootDir,
        getWorkspaceDirs: () => [tempRootDir],
        getWorkspaceContext: () => new WorkspaceContext(tempRootDir),
        getFileExclusions: () => ({
          getCoreIgnorePatterns: () => COMMON_IGNORE_PATTERNS,
          getDefaultExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
          getGlobExcludes: () => COMMON_IGNORE_PATTERNS,
          buildExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
          getReadManyFilesExcludes: () => DEFAULT_FILE_EXCLUDES,
        }),
      } as Partial<Config> as Config;

      readManyFilesTool = new ReadManyFilesTool(mockConfig);
      const invocation = readManyFilesTool.build({
        paths: ['*.txt'],
      });

      if (typeof invocation === 'string') {
        throw new Error(`Unexpected validation error: ${invocation}`);
      }

      const result = await invocation.execute(abortSignal);
      const contentParts = Array.isArray(result.llmContent)
        ? result.llmContent
        : [result.llmContent];
      const content = contentParts.map(String).join('');

      expect(content).toContain('Line 1');
      expect(content).toContain('Line 2000');
      expect(content).not.toContain('Line 2001');
    });
  });
});
