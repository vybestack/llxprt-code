/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
export function withBundleBuildFixture<T>(
  source: string,
  operation: (root: string) => T,
): T {
  const fixture = createBundleBuildFixture(source);
  try {
    return operation(fixture.root);
  } finally {
    fixture.dispose();
  }
}

import { createHash } from 'node:crypto';

export function producerBundleHashes(
  source: string,
): ReadonlyArray<string | null> {
  return [
    'llxprt.js',
    'memprofile-launcher.js',
    'memprofile-preload.js',
    'memprofile-request.js',
    'memprofile-report.js',
    'memprofile-analyze.js',
  ].map((file) => {
    const artifact = join(source, 'packages/cli/bundle', file);
    return existsSync(artifact)
      ? createHash('sha256').update(readFileSync(artifact)).digest('hex')
      : null;
  });
}

function copyCliInputs(source: string, destination: string): void {
  mkdirSync(destination);
  const inputs = readdirSync(source).filter(
    (item) => !['bundle', 'dist', 'node_modules'].includes(item),
  );
  for (const item of inputs)
    cpSync(join(source, item), join(destination, item), { recursive: true });
}

function linkWorkspaceInputs(
  source: string,
  root: string,
  folder: string,
): void {
  mkdirSync(join(root, folder));
  for (const entry of readdirSync(join(source, folder))) {
    const from = join(source, folder, entry);
    const to = join(root, folder, entry);
    if (folder === 'packages' && entry === 'cli') copyCliInputs(from, to);
    else symlinkSync(from, to);
  }
}

export function createBundleBuildFixture(source: string): {
  readonly root: string;
  dispose(): void;
} {
  mkdirSync(join(source, 'tmp'), { recursive: true });
  const root = mkdtempSync(join(source, 'tmp', 'isolated-bundle-'));
  try {
    for (const file of ['package.json', 'tsconfig.json'])
      cpSync(join(source, file), join(root, file));
    cpSync(join(source, 'scripts'), join(root, 'scripts'), { recursive: true });
    symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'));
    for (const folder of ['packages', 'plugins'])
      linkWorkspaceInputs(source, root, folder);
    return {
      root,
      dispose: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
