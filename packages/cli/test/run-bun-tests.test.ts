/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The CLI Bun runner must execute EVERY unit test file in the workspace: the
 * migration explicitly rejects a manifest or allow-list, because a filtered run
 * hides failures instead of reporting them. These tests pin the discovery
 * contract so a future change cannot quietly drop files from the run.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverTestFiles, isUnitTestFile } from '../run-bun-tests.js';

describe('isUnitTestFile', () => {
  it('selects every test and spec extension the workspace uses', () => {
    expect(isUnitTestFile('config.test.ts')).toBe(true);
    expect(isUnitTestFile('App.test.tsx')).toBe(true);
    expect(isUnitTestFile('useThing.spec.ts')).toBe(true);
    expect(isUnitTestFile('Dialog.spec.tsx')).toBe(true);
  });

  it('rejects integration tests, which test:integration owns', () => {
    expect(isUnitTestFile('security.integration.test.ts')).toBe(false);
    expect(isUnitTestFile('wiring.integration.spec.tsx')).toBe(false);
  });

  it('rejects files that are not tests', () => {
    expect(isUnitTestFile('config.ts')).toBe(false);
    expect(isUnitTestFile('types.d.ts')).toBe(false);
    expect(isUnitTestFile('test-helpers.ts')).toBe(false);
    expect(isUnitTestFile('README.md')).toBe(false);
  });
});

describe('discoverTestFiles', () => {
  it('walks every test root and skips build and dependency directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-runner-discovery-'));
    try {
      const write = (relativePath: string): void => {
        const absolute = join(root, relativePath);
        mkdirSync(join(absolute, '..'), { recursive: true });
        writeFileSync(absolute, '');
      };

      write('src/a.test.ts');
      write('src/nested/deep/b.spec.tsx');
      write('test/c.test.tsx');
      write('test-bun/d.test.ts');
      write('test-utils/e.spec.ts');
      write('src/f.integration.test.ts');
      write('src/g.ts');
      write('src/node_modules/h.test.ts');
      write('src/dist/i.test.ts');
      write('src/coverage/j.test.ts');
      write('src/.hidden/k.test.ts');
      write('docs/l.test.ts');

      expect(discoverTestFiles(root)).toEqual([
        'src/a.test.ts',
        'src/nested/deep/b.spec.tsx',
        'test-bun/d.test.ts',
        'test-utils/e.spec.ts',
        'test/c.test.tsx',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns paths relative to the workspace root', () => {
    const root = mkdtempSync(join(tmpdir(), 'cli-runner-relative-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'only.test.ts'), '');

      for (const file of discoverTestFiles(root)) {
        expect(file.startsWith('/')).toBe(false);
        expect(file).toBe('src/only.test.ts');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
