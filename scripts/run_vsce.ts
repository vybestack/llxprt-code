#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Release-only VSCE runner (issue #2754).
 *
 * `@vscode/vsce` packages and publishes the VS Code extension. It is not a
 * runtime dependency and is not needed to compile, lint, or test the
 * companion, so it is deliberately absent from every workspace manifest and
 * from both root lockfiles: an ordinary `npm install` / `bun install` must not
 * resolve it (and must not drag in its cheerio -> encoding-sniffer ->
 * whatwg-encoding tree).
 *
 * This script is the single owner of the pinned version. It materialises VSCE
 * on demand into a gitignored cache and then executes it, so packaging and
 * publishing keep working without VSCE ever entering the repository graph.
 *
 * Two details are deliberate:
 *
 *  - The cache lives under `node_modules/.cache`. vsce 3.x calls the legacy
 *    `mime.lookup()` API and therefore needs mime@1, but this repository
 *    hoists mime@3, which does not have it. Node resolves a module's
 *    dependencies from the nearest `node_modules` to the module file, so
 *    installing VSCE under its own prefix gives it mime@1 there and the
 *    hoisted mime@3 never shadows it. (Running VSCE via `npm exec` from the
 *    repository root fails with "mime_1.default.lookup is not a function"
 *    for exactly this reason.)
 *  - The install uses `--ignore-scripts`. VSCE's transitive lifecycle scripts
 *    (@vscode/vsce-sign, keytar) build credential-store/signing binaries that
 *    packaging and `--azure-credential` publishing do not use, and this
 *    repository does not run unreviewed install-time code.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The exact VSCE version used for every packaging and publishing invocation.
 * An exact pin (not a range) keeps the release reproducible: a range would let
 * an unreviewed VSCE ship the extension. Changing it is a deliberate act, and
 * scripts/tests/issue-2754-vsce-release-only.test.ts asserts the pin is exact.
 */
export const VSCE_VERSION = '3.9.2';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where the pinned VSCE is installed. Keyed by version so a version bump
 * installs alongside rather than silently reusing a stale tree, and placed
 * under `node_modules` so it is gitignored and invisible to tooling that
 * copies the repository while excluding `node_modules`.
 */
export function vsceCacheDir(root: string = repoRoot): string {
  return join(root, 'node_modules', '.cache', `vsce-${VSCE_VERSION}`);
}

/** The VSCE entry point inside the cache (its package.json `bin` target). */
export function vsceBinary(root: string = repoRoot): string {
  return join(vsceCacheDir(root), 'node_modules', '@vscode', 'vsce', 'vsce');
}

/**
 * Installs the pinned VSCE if it is not already present. Idempotent: a warm
 * cache is a no-op, so repeated packaging runs do not re-hit the registry.
 */
export function ensureVsce(root: string = repoRoot): string {
  const binary = vsceBinary(root);
  if (existsSync(binary)) {
    return binary;
  }
  const cacheDir = vsceCacheDir(root);
  mkdirSync(cacheDir, { recursive: true });
  execFileSync(
    'npm',
    [
      'install',
      '--prefix',
      cacheDir,
      '--no-save',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      `@vscode/vsce@${VSCE_VERSION}`,
    ],
    { stdio: 'inherit' },
  );
  if (!existsSync(binary)) {
    throw new Error(
      `Installed @vscode/vsce@${VSCE_VERSION} but no executable at ${binary}.`,
    );
  }
  return binary;
}

/**
 * Runs VSCE with the given arguments in `cwd`. `vsce package` reads the
 * extension manifest from the working directory, so callers that package must
 * invoke this from the extension directory; `vsce publish --packagePath` takes
 * an explicit path and is cwd-independent.
 */
export function runVsce(args: readonly string[], cwd: string = process.cwd()) {
  const binary = ensureVsce();
  execFileSync('node', [binary, ...args], { stdio: 'inherit', cwd });
}

if (import.meta.main) {
  runVsce(process.argv.slice(2));
}
