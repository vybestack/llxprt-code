/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  runtimeRelease,
  runtimeWriteFailure,
} from './runtime-request-lifecycle-test-helpers.js';

const root = sourceRootSetup();
describe('actual runtime fixture isolation', () => {
  it.each(['write-release', 'release-write'] as const)(
    'preserves real exporter failure and strict release in order %s',
    async (order) => {
      const operations =
        order === 'write-release'
          ? [runtimeWriteFailure, runtimeRelease]
          : [runtimeRelease, runtimeWriteFailure];
      await expect(operations[0](root())).resolves.toBeUndefined();
      await expect(operations[1](root())).resolves.toBeUndefined();
    },
    60000,
  );
});
