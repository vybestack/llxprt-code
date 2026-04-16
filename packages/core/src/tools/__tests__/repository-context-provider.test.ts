/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RepositoryContextProvider } from '../ast-edit/repository-context-provider.js';
import { spawnSync } from 'child_process';
import * as path from 'path';

vi.mock('child_process');
vi.mock('fs', () => ({
  promises: {
    access: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('RepositoryContextProvider', () => {
  let provider: RepositoryContextProvider;

  beforeEach(() => {
    provider = new RepositoryContextProvider();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('collectRepositoryContext', () => {
    it('should return null when not in a git repo', async () => {
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: '',
        pid: 0,
        output: [],
        signal: null,
      });

      const result = await provider.collectRepositoryContext('/test');
      expect(result).toBeNull();
    });

    it('should return RepositoryContext with fields', async () => {
      vi.mocked(spawnSync).mockImplementation((cmd, args) => {
        const argsStr = args?.join(' ') || '';
        if (argsStr.includes('remote get-url')) {
          return {
            status: 0,
            stdout: 'https://github.com/test/repo.git',
            stderr: '',
            pid: 0,
            output: [],
            signal: null,
          };
        }
        if (argsStr.includes('rev-parse HEAD')) {
          return {
            status: 0,
            stdout: 'abc123def456',
            stderr: '',
            pid: 0,
            output: [],
            signal: null,
          };
        }
        if (argsStr.includes('branch --show-current')) {
          return {
            status: 0,
            stdout: 'main',
            stderr: '',
            pid: 0,
            output: [],
            signal: null,
          };
        }
        return {
          status: 1,
          stdout: '',
          stderr: '',
          pid: 0,
          output: [],
          signal: null,
        };
      });

      const result = await provider.collectRepositoryContext('/test');
      expect(result).toStrictEqual({
        gitUrl: 'https://github.com/test/repo.git',
        commitSha: 'abc123def456',
        branch: 'main',
        rootPath: '/test',
      });
    });
  });

  describe('getWorkingSetFiles', () => {
    it('should return absolute paths from getWorkingSetFiles', async () => {
      vi.mocked(spawnSync).mockImplementation((cmd, args) => {
        const argsStr = args?.join(' ') || '';
        if (argsStr.includes('diff --name-only -z')) {
          return {
            status: 0,
            stdout: 'file1.txt\0file2.ts\0',
            stderr: '',
            pid: 0,
            output: [],
            signal: null,
          };
        }
        return {
          status: 0,
          stdout: '',
          stderr: '',
          pid: 0,
          output: [],
          signal: null,
        };
      });

      const result = await provider.getWorkingSetFiles('/test/workspace');
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((f) => path.isAbsolute(f))).toBe(true);
    });
  });
});
