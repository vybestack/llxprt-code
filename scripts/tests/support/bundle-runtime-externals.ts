/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Stage installed externals without exposing the repository's tiktoken copy. */
export function stageBundleRuntimeExternals(
  repoRoot: string,
  directory: string,
  externals: readonly string[],
): void {
  const packages = externals.filter(
    (name) => !name.startsWith('node:') && name !== '@dqbd/tiktoken',
  );
  for (const name of packages) {
    const source = join(repoRoot, 'node_modules', name);
    // Optional platform addons are absent on platforms that do not use them.
    if (!existsSync(source)) continue;
    const destination = join(directory, 'node_modules', name);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(realpathSync(source), destination, 'junction');
  }
}
