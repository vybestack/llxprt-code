/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { createLocalReviewRunner } from '../pr-review-local.ts';

it('retains failed transport evidence and exact inference configuration without exposing server text in the error', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'local-review-evidence-'));
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('Untrusted grammar failure', { status: 400 }),
  });
  try {
    const run = createLocalReviewRunner({
      endpoint: `http://127.0.0.1:${server.port}`,
      evidenceDir: dir,
      model: 'qwen3.5:4b',
    });
    await expect(
      run('Describe the changed code', { type: 'object' }),
    ).rejects.toThrow('Local inference HTTP 400');
    const evidence = z
      .object({
        httpStatus: z.number(),
        request: z.object({
          model: z.string(),
          think: z.boolean(),
          format: z.object({ type: z.string() }),
          options: z.object({ num_ctx: z.number() }),
        }),
        result: z.string(),
      })
      .parse(
        JSON.parse(await readFile(path.join(dir, 'inference-1.json'), 'utf8')),
      );
    expect(evidence.httpStatus).toBe(400);
    expect(evidence.request.model).toBe('qwen3.5:4b');
    expect(evidence.request.think).toBe(false);
    expect(evidence.request.format.type).toBe('object');
    expect(evidence.request.options.num_ctx).toBe(32768);
    expect(evidence.result).toContain('grammar failure');
  } finally {
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
});

it('rejects unbounded alignment explanations while retaining the complete check contract', async () => {
  const { parsePreMergeChecks } = await import('../pr-review-local.ts');
  const checks = {
    title: { ok: true, note: 'Clear title' },
    description: { ok: true, note: 'Complete template' },
    linked_issues: { ok: false, note: 'x'.repeat(1001) },
    out_of_scope: { note: 'None' },
  };
  expect(() => parsePreMergeChecks(JSON.stringify(checks))).toThrow();
});
