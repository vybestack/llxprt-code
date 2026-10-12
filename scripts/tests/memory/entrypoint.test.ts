/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { entryPathsMatch } from '../../memory/entrypoint.ts';

describe('memory entrypoint path matching', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it('recognizes a source entry invoked through a symlink', () => {
    root = mkdtempSync(join(tmpdir(), 'memprofile-entrypoint-'));
    const targetDir = join(root, 'target');
    const linkDir = join(root, 'link');
    mkdirSync(targetDir);
    const target = join(targetDir, 'target.ts');
    writeFileSync(target, 'export {};\n');
    symlinkSync(
      targetDir,
      linkDir,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(
      entryPathsMatch(join(linkDir, 'target.ts'), pathToFileURL(target).href),
    ).toBe(true);
  });

  it('normalizes Windows case aliases after resolving the actual files', () => {
    root = mkdtempSync(join(tmpdir(), 'memprofile-entrypoint-case-'));
    const target = join(root, 'MixedCase.ts');
    const alias = join(root, 'mixedcase.ts');
    writeFileSync(target, 'export {};');
    writeFileSync(alias, 'export {};');

    expect(entryPathsMatch(alias, pathToFileURL(target).href, 'win32')).toBe(
      true,
    );
  });

  it('does not match different existing entries', () => {
    root = mkdtempSync(join(tmpdir(), 'memprofile-entrypoint-distinct-'));
    const target = join(root, 'target.ts');
    const other = join(root, 'other.ts');
    writeFileSync(target, 'export {};');
    writeFileSync(other, 'export {};');

    expect(entryPathsMatch(other, pathToFileURL(target).href)).toBe(false);
  });

  it('does not throw or match when an entry path is absent', () => {
    root = mkdtempSync(join(tmpdir(), 'memprofile-entrypoint-missing-'));

    expect(
      entryPathsMatch(
        join(root, 'missing.ts'),
        pathToFileURL(join(root, 'expected.ts')).href,
      ),
    ).toBe(false);
  });
});
