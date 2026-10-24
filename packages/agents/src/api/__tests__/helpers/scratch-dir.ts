/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Creates caller-owned scratch state outside source trees. Bun package runners
 * supply a session-isolated TMPDIR, so their teardown also owns these paths.
 * Explicit parents are created first for fresh checkouts and nested fixtures.
 */
export async function makeScratchDir(
  prefix: string,
  parent: string = tmpdir(),
): Promise<string> {
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, prefix));
}
