/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveBunTestFiles } from '../bun-test-roots.js';
import testUtils from '../../packages/test-utils/package.json' with { type: 'json' };
import core from '../../packages/core/package.json' with { type: 'json' };
import agents from '../../packages/agents/package.json' with { type: 'json' };

const root = resolve(import.meta.dir, '../..');
const names = [
  'collect-raw-history',
  'collect-rows-for-assertions',
  'curated-history-fixture',
  'history-materialization-test-guard',
  'providerCallOptions',
  'retained-growth',
  'synchronous-history-test-observation',
];

describe('relocated helper package ownership and discovery', () => {
  it('exposes the one live helper location without restoring Core or agent internal exports', () => {
    const exports: Record<
      string,
      { bun: string; import: string; types: string }
    > = testUtils.exports;
    for (const name of names) {
      const entry = exports[`./core/${name}.js`];
      expect(entry).toStrictEqual({
        bun: `./src/core/${name}.ts`,
        import: `./dist/src/core/${name}.js`,
        types: `./dist/src/core/${name}.d.ts`,
      });
      expect(existsSync(join(root, 'packages/test-utils', entry.bun))).toBe(
        true,
      );
      expect(
        existsSync(join(root, `packages/core/src/test-utils/${name}.ts`)),
      ).toBe(false);
    }
    expect(
      Object.keys(core.exports).some((key) => key.startsWith('./test-utils/')),
    ).toBe(false);
    expect(Object.keys(agents.exports)).not.toContain('./internals.js');
  });

  it('discovers relocated helper tests as real suites, not empty helper files', () => {
    const files = resolveBunTestFiles(root, 'test-utils').map(
      (entry) => entry.file,
    );
    for (const name of names.filter((name) => name !== 'collect-raw-history')) {
      expect(files).toContain(
        join(root, `packages/test-utils/src/core/${name}.test.ts`),
      );
      expect(files).not.toContain(
        join(root, `packages/test-utils/src/core/${name}.ts`),
      );
    }
    expect(files).toContain(
      join(root, 'packages/test-utils/src/core/durable-helper-values.test.ts'),
    );
  });
});
