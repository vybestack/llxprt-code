/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

it('resolves every declared Bun entry to an existing source file', () => {
  const root = resolve(import.meta.dir, '../../packages/core');
  const manifest = z
    .object({ exports: z.record(z.object({ bun: z.string().optional() })) })
    .parse(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')));
  const missing = Object.entries(manifest.exports).flatMap(([entry, target]) =>
    target.bun !== undefined && !existsSync(resolve(root, target.bun))
      ? [entry]
      : [],
  );
  expect(missing).toEqual([]);
});

it('builds runtime hooks without emitting nested test helpers', () => {
  const files = readdirSync(
    resolve(import.meta.dir, '../../packages/core/dist/src/hooks'),
    { recursive: true, encoding: 'utf8' },
  );
  expect(files).toContain('hookSystem.js');
  expect(files).toContain('hookSystem.d.ts');
  expect(
    files.filter((file) => /(?:^|\/)(?:__tests__|test-utils)\//.test(file)),
  ).toEqual([]);
});

it('packs core runtime hooks without test helpers or fixtures', () => {
  const result = Bun.spawnSync({
    cmd: ['npm', 'pack', '--dry-run', '--json', '--ignore-scripts'],
    cwd: resolve(import.meta.dir, '../../packages/core'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const manifests = z
    .array(z.object({ files: z.array(z.object({ path: z.string() })) }))
    .parse(JSON.parse(result.stdout.toString()));
  const paths = manifests.flatMap((manifest) =>
    manifest.files.map((file) => file.path),
  );
  expect(paths).toContain('src/hooks/hookSystem.ts');
  expect(paths).toContain('dist/src/hooks/hookSystem.js');
  expect(paths).toContain('dist/src/hooks/hookSystem.d.ts');
  expect(
    paths.filter((path) =>
      /(?:^|\/)(?:__tests__|__mocks__|__snapshots__|test-utils)(?:\/|$)|\.(?:test|spec)\./.test(
        path,
      ),
    ),
  ).toEqual([]);
}, 30_000);
