/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

it('package preload removes every owned scratch root without removing other directories', () => {
  const repository = resolve(fileURLToPath(import.meta.url), '../../..');
  const directory = mkdtempSync(join(tmpdir(), 'scratch-cleanup-probe-'));
  const probe = join(directory, 'cleanup-probe.test.ts');
  const manifest = join(directory, 'roots.txt');
  writeFileSync(
    probe,
    `import { test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScratchRootOwner } from ${JSON.stringify(join(repository, 'packages/core/src/storage/scratch-root.ts'))};
test('allocates independent scratch owners', () => {
  const first = new ScratchRootOwner().getRoot();
  const second = new ScratchRootOwner().getRoot();
  const foreign = join(tmpdir(), 'llxprt-scratch-${process.pid}-Abc123');
  const unrelated = join(tmpdir(), 'llxprt-scratch-' + process.pid + '-not-a-root');
  mkdirSync(foreign);
  mkdirSync(unrelated);
  writeFileSync(join(first, 'payload'), 'first');
  writeFileSync(join(second, 'payload'), 'second');
  writeFileSync(${JSON.stringify(manifest)}, [first, second, foreign, unrelated].join('\\n'));
});
`,
  );
  try {
    const result = spawnSync(process.execPath, ['test', probe], {
      cwd: join(repository, 'packages/core'),
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const roots = readFileSync(manifest, 'utf8').split('\n');
    expect(roots).toHaveLength(4);
    expect(roots.map(existsSync)).toStrictEqual([false, false, true, true]);
  } finally {
    if (existsSync(manifest)) {
      for (const root of readFileSync(manifest, 'utf8').split('\n'))
        rmSync(root, { recursive: true, force: true });
    }
    rmSync(directory, { recursive: true, force: true });
  }
}, 150_000);
