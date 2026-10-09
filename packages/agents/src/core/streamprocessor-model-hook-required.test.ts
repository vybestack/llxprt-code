/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { sourceRootSetup } from './prompt-envelope-source-test-helpers.js';
import { modelHookWorker } from './streamprocessor-model-hook-fixture.js';
const root = sourceRootSetup();
if (process.env.ISSUE854_MODEL_FULL === '1') {
  describe('remaining full model-hook contracts', () => {
    it.each(['model', 'settings', 'tools'] as const)(
      'supports exact %s mutations rather than ignoring them',
      async (mode) => {
        const source = await modelHookWorker(root(), mode);
        expect(source.error).toBeUndefined();
        expect(source.bodies).toHaveLength(1);
      },
      120000,
    );
    it('matches deliberately empty array replacement and its complete estimate', async () => {
      const source = await modelHookWorker(join(root(), 'source'), 'empty');
      const array = await modelHookWorker(
        join(root(), 'array'),
        'empty',
        false,
      );
      expect(source.error).toBeUndefined();
      expect(array.error).toBeUndefined();
      expect(source.bodies).toStrictEqual(array.bodies);
      expect(source.estimate).toStrictEqual(array.estimate);
    }, 120000);
  });
}
