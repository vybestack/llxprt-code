/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Creates a unique scratch directory under `parent` (default: the gitignored
 * package-local `tmp/`). The parent is created first because it is ignored by
 * git and therefore absent on a fresh checkout such as a CI runner, where
 * `mkdtemp` alone fails with ENOENT.
 */
export async function makeScratchDir(
  prefix: string,
  parent: string = resolve('tmp'),
): Promise<string> {
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, prefix));
}
