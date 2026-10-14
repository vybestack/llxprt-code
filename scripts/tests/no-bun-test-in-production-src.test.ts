/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const BUN_TEST_SPECIFIER = /['"]bun:test['"]/;

/**
 * Files that are test code by name or location: tests, `__tests__` trees,
 * explicitly named test helpers, the test-utils package and integration-test
 * trees. Everything else under `packages/<name>/src` is production source and must
 * not load the test runner.
 */
const TEST_SUPPORT =
  /(?:^|\/)__tests__\/|(?:^|\/)integration-tests\/|^packages\/test-utils\/|\.(?:test|spec)\.[^/]*$|\.bun\.tsx?$|[.-]test[.-]helpers?\.tsx?$/;

function productionFilesImportingBunTest(): string[] {
  const offenders: string[] = [];
  const glob = new Glob('packages/*/src/**/*.{ts,tsx}');
  for (const file of glob.scanSync({ cwd: root, absolute: true })) {
    const path = relative(root, file).split('\\').join('/');
    if (TEST_SUPPORT.test(path)) continue;
    if (BUN_TEST_SPECIFIER.test(readFileSync(file, 'utf8')))
      offenders.push(path);
  }
  return offenders.sort();
}

describe('production source does not import the test runner', () => {
  it('has no non-test file under packages/*/src importing bun:test', () => {
    expect(productionFilesImportingBunTest()).toStrictEqual([]);
  });

  it('recognises test support files by name and location', () => {
    for (const path of [
      'packages/core/src/recording/__tests__/support/p05dTestKit.ts',
      'packages/core/src/storage/SessionPersistenceService.test-helpers.ts',
      'packages/core/src/recording/resumeSession.test.helpers.ts',
      'packages/core/src/hooks/hookRunner-test-helpers.ts',
      'packages/providers/src/runtime/responses-source-write.test-helper.ts',
      'packages/cli/src/ui/hooks/useWelcomeOnboarding.bun.tsx',
      'packages/test-utils/src/wait-for.ts',
    ])
      expect(TEST_SUPPORT.test(path), path).toBe(true);
    for (const path of [
      'packages/core/src/recording/p05dTestKit.ts',
      'packages/core/src/services/history/scalar-test-evidence.ts',
      'packages/agents/src/core/chatSessionFactoryConfigFixture.ts',
    ])
      expect(TEST_SUPPORT.test(path), path).toBe(false);
  });
});
