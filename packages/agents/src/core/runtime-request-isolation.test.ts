/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { isTelemetrySdkInitialized } from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { sourceRootSetup } from './prompt-envelope-source-test-helpers.js';
import {
  runtimeRelease,
  runtimeWriteFailure,
} from './runtime-request-lifecycle-test-helpers.js';

const root = sourceRootSetup();
describe('actual runtime fixture isolation', () => {
  it.each(['write-release', 'release-write'] as const)(
    'preserves real exporter failure and strict release in order %s',
    async (order) => {
      const initial = isTelemetrySdkInitialized();
      const operations =
        order === 'write-release'
          ? [runtimeWriteFailure, runtimeRelease]
          : [runtimeRelease, runtimeWriteFailure];
      await operations[0](root());
      const between = isTelemetrySdkInitialized();
      await operations[1](root());
      expect({
        initial,
        between,
        final: isTelemetrySdkInitialized(),
      }).toStrictEqual({
        initial: false,
        between: false,
        final: false,
      });
    },
    60000,
  );
});
