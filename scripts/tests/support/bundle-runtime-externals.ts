/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Stage installed externals without exposing the repository's tiktoken copy. */
export function stageBundleRuntimeExternals(
  repoRoot: string,
  directory: string,
  externals: readonly string[],
): void {
  const encoder = '@dqbd/tiktoken/encoders/o200k_base.json';
  const encoderDestination = join(directory, 'node_modules', encoder);
  mkdirSync(dirname(encoderDestination), { recursive: true });
  copyFileSync(
    createRequire(join(repoRoot, 'package.json')).resolve(encoder),
    encoderDestination,
  );
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
