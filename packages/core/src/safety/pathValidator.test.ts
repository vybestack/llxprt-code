/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { validatePathWithinWorkspace } from './pathValidator.js';

describe('validatePathWithinWorkspace', () => {
  let tempDir: string;
  let cwd: string;
  let otherDir: string;
  let workspaceContext: WorkspaceContext;

  beforeEach(() => {
    tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'path-validator-test-')),
    );
    cwd = path.join(tempDir, 'project');
    otherDir = path.join(tempDir, 'other-project');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(otherDir, { recursive: true });
    workspaceContext = new WorkspaceContext(cwd, [otherDir]);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('valid paths', () => {
    it('should return null for a path within the primary workspace directory', () => {
      const validPath = path.join(cwd, 'src', 'file.ts');
      expect(
        validatePathWithinWorkspace(workspaceContext, validPath),
      ).toBeNull();
    });

    it('should return null for a path within an additional workspace directory', () => {
      const validPath = path.join(otherDir, 'lib', 'module.js');
      expect(
        validatePathWithinWorkspace(workspaceContext, validPath),
      ).toBeNull();
    });

    it('should return null for a non-existent path within workspace', () => {
      const nonExistentPath = path.join(cwd, 'does-not-exist.txt');
      expect(
        validatePathWithinWorkspace(workspaceContext, nonExistentPath),
      ).toBeNull();
    });

    it('should return null for deeply nested path within workspace', () => {
      const deepPath = path.join(cwd, 'a', 'b', 'c', 'd', 'file.txt');
      expect(
        validatePathWithinWorkspace(workspaceContext, deepPath),
      ).toBeNull();
    });
  });

  describe('invalid paths', () => {
    it('should return the standardized error message for a path outside workspace', () => {
      const outsidePath = path.join(tempDir, 'outside', 'file.txt');
      const result = validatePathWithinWorkspace(workspaceContext, outsidePath);
      expect(result).not.toBeNull();
      expect(result).toContain(
        'File path must be within one of the workspace directories:',
      );
      expect(result).toContain(cwd);
      expect(result).toContain(otherDir);
    });

    it('should include workspace directories in the error message', () => {
      const outsidePath = path.join(tempDir, 'somewhere-else', 'file.txt');
      const result = validatePathWithinWorkspace(workspaceContext, outsidePath);
      const directories = workspaceContext.getDirectories();
      expect(result).toBe(
        `File path must be within one of the workspace directories: ${directories.join(', ')}`,
      );
    });

    it('should reject parent directory traversal outside workspace', () => {
      const parentPath = path.dirname(cwd);
      const result = validatePathWithinWorkspace(workspaceContext, parentPath);
      expect(result).not.toBeNull();
    });

    it('should reject root path', () => {
      const rootPath = path.parse(tempDir).root;
      const result = validatePathWithinWorkspace(workspaceContext, rootPath);
      expect(result).not.toBeNull();
    });
  });

  describe('custom pathTypeLabel', () => {
    it('should use custom label "Path" in error message', () => {
      const outsidePath = path.join(tempDir, 'outside', 'file.txt');
      const result = validatePathWithinWorkspace(
        workspaceContext,
        outsidePath,
        'Path',
      );
      expect(result).toContain(
        'Path must be within one of the workspace directories:',
      );
    });

    it('should use custom label "Directory" in error message', () => {
      const outsidePath = path.join(tempDir, 'outside', 'dir');
      const result = validatePathWithinWorkspace(
        workspaceContext,
        outsidePath,
        'Directory',
      );
      expect(result).toContain(
        'Directory must be within one of the workspace directories:',
      );
    });

    it('should use custom label "Search path" in error message', () => {
      const outsidePath = path.join(tempDir, 'outside', 'dir');
      const result = validatePathWithinWorkspace(
        workspaceContext,
        outsidePath,
        'Search path',
      );
      expect(result).toContain(
        'Search path must be within one of the workspace directories:',
      );
    });

    it('should return null with custom label when path is valid', () => {
      const validPath = path.join(cwd, 'src', 'file.ts');
      expect(
        validatePathWithinWorkspace(workspaceContext, validPath, 'Path'),
      ).toBeNull();
    });

    it('should use default "File path" label when no label is specified', () => {
      const outsidePath = path.join(tempDir, 'outside', 'file.txt');
      const result = validatePathWithinWorkspace(workspaceContext, outsidePath);
      expect(result).toContain(
        'File path must be within one of the workspace directories:',
      );
    });
  });

  describe('edge cases', () => {
    it('should handle path with .. components that resolves inside workspace', () => {
      const pathWithDotDot = path.join(cwd, 'src', '..', 'lib', 'file.ts');
      // This resolves to cwd/lib/file.ts which is within workspace
      expect(
        validatePathWithinWorkspace(workspaceContext, pathWithDotDot),
      ).toBeNull();
    });

    it('should reject path with .. that escapes workspace', () => {
      const escapingPath = path.join(cwd, '..', '..', 'etc', 'passwd');
      const result = validatePathWithinWorkspace(
        workspaceContext,
        escapingPath,
      );
      expect(result).not.toBeNull();
    });
  });
});
