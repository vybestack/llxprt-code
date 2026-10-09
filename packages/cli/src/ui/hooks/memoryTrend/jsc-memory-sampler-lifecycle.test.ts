/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../../../../..');

describe('Bun memory sampler acquisition', () => {
  it('permits Node module loading but rejects actual sampling without a Bun fallback', () => {
    const result = spawnSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `
import assert from 'node:assert/strict';
import { sampleMemoryUsage } from './packages/cli/dist/src/ui/hooks/memoryTrend/jscMemorySampler.js';
let sampled = false;
assert.throws(() => sampleMemoryUsage(() => {
  sampled = true;
  return process.memoryUsage();
}), /LLxprt memory sampling requires Bun/);
assert.equal(sampled, false);
`,
      ],
      {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    if (result.status !== 0) throw new Error(result.stderr);
    expect(result.status).toBe(0);
  });
});
