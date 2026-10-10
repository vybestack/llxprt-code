/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runMemoryEntrypoint(
  isMain: boolean,
  main: () => void | Promise<void>,
): Promise<void> {
  if (isMain) {
    await main();
  }
}

function normalizeEntrypointPath(
  path: string,
  platform: NodeJS.Platform,
): string | undefined {
  try {
    const realPath = realpathSync.native(resolve(path));
    return platform === 'win32' ? realPath.toLowerCase() : realPath;
  } catch {
    return undefined;
  }
}

export function entryPathsMatch(
  argvPath: string,
  entryUrl: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const argvEntry = normalizeEntrypointPath(argvPath, platform);
  const expectedEntry = normalizeEntrypointPath(
    fileURLToPath(entryUrl),
    platform,
  );
  return argvEntry !== undefined && argvEntry === expectedEntry;
}
