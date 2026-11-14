/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { discoverTestFiles } from '../../packages/agents/run-bun-tests.ts';

const AGENTS_ROOT = resolve(import.meta.dir, '../../packages/agents');
const COMPRESSION_ROOT = join(AGENTS_ROOT, 'src/compression');

describe('agents compression test discovery', () => {
  it('keeps the high-density fixture importable without scheduling it as a suite', () => {
    const discovered = discoverTestFiles(AGENTS_ROOT);
    const helper = join(
      COMPRESSION_ROOT,
      '__tests__/high-density-compress-helpers.ts',
    );

    expect(existsSync(helper)).toBe(true);
    expect(existsSync(helper.replace('-helpers.ts', '-helpers.test.ts'))).toBe(
      false,
    );
    expect(discovered).not.toContain(helper);
    expect(discovered).toContain(
      join(COMPRESSION_ROOT, '__tests__/high-density-compress.test.ts'),
    );
  });

  it('includes every compression test and spec file', () => {
    const expected = [
      ...new Glob('**/*.{test,spec}.{ts,tsx}').scanSync({
        cwd: COMPRESSION_ROOT,
        absolute: true,
      }),
    ].sort();
    const discovered = discoverTestFiles(AGENTS_ROOT).filter((file) =>
      file.startsWith(`${COMPRESSION_ROOT}${sep}`),
    );

    expect(expected.length).toBeGreaterThan(0);
    expect(discovered).toEqual(expected);
  });
});
