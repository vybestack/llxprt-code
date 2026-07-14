/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  BUN_NATIVE_TEST_MANIFEST,
  resolveBunNativeTestFiles,
} from '../bun-test-manifest.js';

const repoRoot = resolve(__dirname, '..', '..');

const advertisedWorkspaces = ['a2a-server', 'cli', 'providers'];

describe('Bun native test manifest', () => {
  it('resolves every advertised workspace to verified files', () => {
    for (const workspace of advertisedWorkspaces) {
      const files = resolveBunNativeTestFiles(repoRoot, workspace);
      expect(files.length, workspace).toBeGreaterThan(0);
      expect(
        files.every(({ cwd }) => cwd.endsWith(`/packages/${workspace}`)),
      ).toBe(true);
    }
  });

  it('retains the core CI characterization sample', () => {
    const files = resolveBunNativeTestFiles(repoRoot, 'core');
    expect(files.map(({ file }) => file)).toContain(
      resolve(repoRoot, 'packages/core/src/utils/errors.test.ts'),
    );
  });

  it('keeps known unsupported CLI tests outside the supported set', () => {
    const files = resolveBunNativeTestFiles(repoRoot, 'cli').map(
      ({ file }) => file,
    );
    expect(files.some((file) => file.endsWith('coreToolToggle.test.ts'))).toBe(
      false,
    );
    expect(files.some((file) => file.includes('useToolScheduler'))).toBe(false);
  });

  it('contains only nonempty workspace entries and existing files', () => {
    for (const entry of BUN_NATIVE_TEST_MANIFEST) {
      expect(entry.files.length, entry.workspace).toBeGreaterThan(0);
      expect(resolveBunNativeTestFiles(repoRoot, entry.workspace)).toHaveLength(
        entry.files.length,
      );
    }
  });

  it('returns an empty set for an unknown workspace', () => {
    expect(resolveBunNativeTestFiles(repoRoot, 'unknown')).toEqual([]);
  });
});
