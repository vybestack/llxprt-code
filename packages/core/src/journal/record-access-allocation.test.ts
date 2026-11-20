/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

describe('record access allocation work', () => {
  for (const size of [128, 1024]) {
    it(`does not allocate row-tree maps for ${size} unused record accesses`, async () => {
      const child = Bun.spawn(
        [
          process.execPath,
          join(
            import.meta.dir,
            '__tests__/support/record-access-allocation-worker.ts',
          ),
          String(size),
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ code, stderr }).toStrictEqual({ code: 0, stderr: '' });
      const report: unknown = JSON.parse(stdout);
      expect(report).toStrictEqual({
        size,
        maps: 0,
        entries: 0,
        offsetSum: (size * (size - 1)) / 2,
      });
    });
  }
});
