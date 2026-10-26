/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Footer assertions need a short physical cwd, not a symlink resolved back to the checkout. */
export function withShortUiWorkspace<T>(
  projectRoot: string,
  run: (cwd: string) => T,
): T {
  const temporaryRoot = process.platform === 'win32' ? tmpdir() : '/tmp';
  const directory = mkdtempSync(path.join(temporaryRoot, 'llxprt-code-'));
  try {
    for (const name of ['packages', 'scripts'])
      symlinkSync(
        path.join(projectRoot, name),
        path.join(directory, name),
        'junction',
      );
    return run(realpathSync(directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
