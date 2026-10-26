/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { NATIVE_SESSION_ROUTES } from './support/realistic-native-send.js';

const root = join(import.meta.dir, '../../../../tmp/r10-retained');

describe('native HTTP sends with 25,000 selected rows and 64 MiB neutral payload', () => {
  for (const route of NATIVE_SESSION_ROUTES) {
    for (const mode of ['positive', 'control']) {
      it(`${route}/${mode}: preserves converter bytes and ${mode === 'positive' ? 'stays below' : 'breaches'} the retained-memory bound`, async () => {
        await mkdir(root, { recursive: true });
        const output = join(
          await mkdtemp(join(root, `${route}-${mode}-`)),
          'measurement.json',
        );
        const child = Bun.spawn(
          [
            process.execPath,
            join(import.meta.dir, 'support/realistic-native-send-worker.ts'),
            route,
            mode,
            output,
          ],
          { stdout: 'inherit', stderr: 'pipe' },
        );
        const [stderr, code] = await Promise.all([
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect({ code, stderr }).toStrictEqual({ code: 0, stderr: '' });
      }, 180000);
    }
  }
});
