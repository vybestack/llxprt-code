/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun's test runner ends the process without emitting `process.on('exit')`.
 * Reclaim roots from every owner in this process, including owners created
 * outside test-support factories, without touching another process's roots.
 */
import { afterAll } from 'bun:test';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

afterAll(() => {
  const directory = tmpdir();
  const ownedRoot = new RegExp(
    `^llxprt-scratch-${process.pid}-[A-Za-z0-9]{6}$`,
  );
  for (const name of readdirSync(directory)) {
    if (ownedRoot.test(name))
      rmSync(join(directory, name), { recursive: true, force: true });
  }
});
