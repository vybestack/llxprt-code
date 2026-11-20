/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '../../../../../tmp/accept-speed');
const worker = join(import.meta.dir, 'realistic-native-send-worker.ts');

async function runWorker(args: readonly string[]): Promise<void> {
  const child = Bun.spawn([process.execPath, worker, ...args], {
    stdout: 'inherit',
    stderr: 'pipe',
  });
  const [stderr, code] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ code, stderr }).toStrictEqual({ code: 0, stderr: '' });
}

export function realisticNativeSendSuite(route: string): void {
  describe(`${route}: 25,000 selected rows and 64 MiB neutral payload`, () => {
    let directory: string;
    let seed: string;
    beforeAll(async () => {
      await mkdir(root, { recursive: true });
      directory = await mkdtemp(join(root, `${route}-`));
      seed = join(directory, 'seed.llxj');
      await runWorker([route, 'seed', seed]);
    }, 180000);
    afterAll(async () => {
      await unlink(seed);
    });
    for (const mode of ['positive', 'control']) {
      it(`${mode}: preserves converter bytes and ${mode === 'positive' ? 'stays below' : 'breaches'} the retained-memory bound`, async () => {
        await runWorker([route, mode, join(directory, `${mode}.json`), seed]);
      }, 180000);
    }
  });
}
