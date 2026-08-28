/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { entryPathsMatch } from './entrypoint.ts';

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
    const target = join(root, 'target.ts');
    const link = join(root, 'link.ts');
    writeFileSync(target, 'export {};\n');
    symlinkSync(target, link, 'file');

    expect(entryPathsMatch(link, pathToFileURL(target).href)).toBe(true);
  });
});
