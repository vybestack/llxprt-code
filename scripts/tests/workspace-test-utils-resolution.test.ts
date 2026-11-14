/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../..');
const specifier =
  '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';

describe('workspace test-utils source resolution', () => {
  for (const importer of [
    'packages/core/src/services/history/chronology-rollback-test-helpers.ts',
    'packages/agents/src/core/deferred-transform-values.test.ts',
  ]) {
    it(`resolves current test-utils source from ${importer}`, () => {
      expect(Bun.resolveSync(specifier, resolve(repoRoot, importer))).toBe(
        resolve(
          repoRoot,
          'packages/test-utils/src/core/collect-rows-for-assertions.ts',
        ),
      );
    });
  }

  it('loads a Core helper that imports test-utils across the workspace boundary', async () => {
    const { expectedRange } = await import(
      '../../packages/core/src/services/history/chronology-rollback-test-helpers.js'
    );
    expect(expectedRange(2)).toEqual({
      firstSeq: 1,
      lastSeq: 2,
      totalEntries: 2,
      removedInterior: [],
      approximate: false,
    });
  });
});
