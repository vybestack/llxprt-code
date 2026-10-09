/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';

const root = sourceRootSetup();
const resultSchema = z.object({
  kind: z.string(),
  count: z.number(),
  first: z.object({ blocks: z.array(z.object({ text: z.string() })) }),
  fullCount: z.number(),
  closedError: z.string().optional(),
});

describe('source hook pending ownership', () => {
  it('keeps recovered hook input separate from normalized provider membership', async () => {
    const worker = Bun.spawn(
      [
        process.execPath,
        new URL(
          './__tests__/support/source-hook-pending-worker.ts',
          import.meta.url,
        ).pathname,
        root(),
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const [exit, stdout, stderr] = await Promise.all([
      worker.exited,
      new Response(worker.stdout).text(),
      new Response(worker.stderr).text(),
    ]);
    const evidence = process.env.ISSUE854_COMPRESSION_EVIDENCE;
    if (evidence !== undefined)
      writeFileSync(
        join(evidence, `pending-hook-${process.pid}.log`),
        `${stdout}\n${stderr}`,
      );
    expect({ exit, stderr }).toStrictEqual({ exit: 0, stderr: '' });
    const result = resultSchema.parse(
      JSON.parse(readFileSync(join(root(), 'pending-result.json'), 'utf8')),
    );
    expect(result.kind).toBe('hook-recovered-input');
    expect(result.count).toBe(1);
    expect(result.first.blocks[0].text).toBe('ANSWER THE HISTORY.');
    expect(result.fullCount).toBe(2);
    expect(result.closedError).toBe('Boundary snapshot closed');
  }, 60000);
});
