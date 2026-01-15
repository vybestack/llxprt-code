/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalMode, PolicyDecision } from './types.js';
import type { Dirent } from 'node:fs';
import nodePath from 'node:path';

describe('policy-toml-loader', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('node:fs/promises');
  });

  describe('loadPoliciesFromToml', () => {
    it('should load and parse a simple policy file', async () => {
      const actualFs =
        await vi.importActual<typeof import('node:fs/promises')>(
          'node:fs/promises',
        );

      const mockReaddir = vi.fn(
        async (
          path: string,
          _options?: { withFileTypes: boolean },
        ): Promise<Dirent[]> => {
          if (nodePath.normalize(path) === nodePath.normalize('/policies')) {
            return [
              {
                name: 'test.toml',
                isFile: () => true,
                isDirectory: () => false,
              } as Dirent,
            ];
          }
          return [];
        },
      );

      const mockReadFile = vi.fn(async (path: string): Promise<string> => {
        if (
          nodePath.normalize(path) ===
          nodePath.normalize(nodePath.join('/policies', 'test.toml'))
        ) {
          return `
[[rule]]
toolName = "glob"
decision = "allow"
priority = 100
`;
        }
        throw new Error('File not found');
      });

      vi.doMock('node:fs/promises', () => ({
        ...actualFs,
        default: { ...actualFs, readFile: mockReadFile, readdir: mockReaddir },
        readFile: mockReadFile,
        readdir: mockReaddir,
      }));

      const { loadPoliciesFromToml: load } = await import('./toml-loader.js');

      const getPolicyTier = (_dir: string) => 1;
      const result = await load(
        ApprovalMode.DEFAULT,
        ['/policies'],
        getPolicyTier,
      );

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]).toEqual({
        toolName: 'glob',
        decision: PolicyDecision.ALLOW,
        priority: 1.1, // tier 1 + 100/1000
      });
      expect(result.errors).toHaveLength(0);
    });

    it('should skip non-existent directories without error', async () => {
      const actualFs =
        await vi.importActual<typeof import('node:fs/promises')>(
          'node:fs/promises',
        );

      const mockReaddir = vi.fn(async (_path: string): Promise<Dirent[]> => {
        const error = new Error('ENOENT: no such file or directory') as Error &
          { code: string };
        error.code = 'ENOENT';
        throw error;
      });

      vi.doMock('node:fs/promises', () => ({
        ...actualFs,
        default: { ...actualFs, readdir: mockReaddir },
        readdir: mockReaddir,
      }));

      const { loadPoliciesFromToml: load } = await import('./toml-loader.js');

      const getPolicyTier = (_dir: string) => 1;
      const result = await load(
        ApprovalMode.DEFAULT,
        ['/non-existent'],
        getPolicyTier,
      );

      expect(result.rules).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});
