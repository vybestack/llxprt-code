/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Environment switch that selects declaration-only emit (issue #2983).
 *
 * Who reads `packages/*\/dist`:
 *
 *  - **Type resolution does.** Three workspace tsconfigs map cross-workspace
 *    imports at `dist/*.d.ts` (cli -> tools, core -> mcp, and a2a-server ->
 *    settings/storage/tools), so type-aware lint and `tsc --noEmit` need those
 *    declarations on disk.
 *  - **npm consumers of the published library packages do.** Every workspace
 *    except the CLI declares `main: dist/index.js` and ships `dist`, so a Node
 *    consumer that resolves without the `bun` export condition loads compiled
 *    JavaScript. The release build must keep emitting it.
 *  - **The PR path does not.** Tests resolve TypeScript source through each
 *    workspace's `bun` condition, and the published CLI runs raw TypeScript or
 *    the separate publish-time bundle at `packages/cli/bundle/llxprt.js`
 *    (issues #2999/#3013), which `prepack` builds and this script never
 *    touches.
 *
 * When this variable is set to `1`, `tsc --build` runs with
 * `--emitDeclarationOnly`: declarations are still written, transpilation and
 * JavaScript emit are skipped. Non-code assets are still staged by
 * `copy_files.ts` so `dist`-mapped JSON imports keep resolving. The release
 * path deliberately leaves the variable unset.
 */
export const DECLARATIONS_ONLY_ENV = 'LLXPRT_EMIT_DECLARATIONS_ONLY';

/**
 * True when the caller asked for declaration-only emit. Only the exact value
 * `1` enables it, so a stray empty or `0` value cannot silently change what
 * the release build emits.
 */
export function isDeclarationsOnly(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[DECLARATIONS_ONLY_ENV] === '1';
}

/**
 * The `tsc --build` argument list for a package build.
 *
 * `--emitDeclarationOnly` is accepted in build mode, so declaration-only emit
 * needs no parallel tsconfig tree — one pipeline, two emit modes.
 */
export function buildTscArgs(
  tsconfig: string,
  declarationsOnly: boolean,
): string[] {
  return declarationsOnly
    ? ['--build', '--emitDeclarationOnly', tsconfig]
    : ['--build', tsconfig];
}

/** The tsconfig a package builds with: an explicit build config wins. */
export function resolveTsconfigName(
  hasBuildConfig: boolean = existsSync('tsconfig.build.json'),
): string {
  return hasBuildConfig ? 'tsconfig.build.json' : 'tsconfig.json';
}

function main(): void {
  if (!process.cwd().includes('packages')) {
    console.error('must be invoked from a package directory');
    process.exit(1);
  }

  const tsconfig = resolveTsconfigName();
  const declarationsOnly = isDeclarationsOnly();

  // Perform a full clean of previous build artifacts _including_ the cached
  // incremental graph (.tsbuildinfo). We still preserve incremental rebuilds
  // by letting TypeScript regenerate a fresh cache right after the clean.
  // This avoids TS6305 ("output file has not been built") when dist is wiped
  // but the .tsbuildinfo still references old artifacts.
  execSync(`tsc --build --clean ${tsconfig}`, { stdio: 'inherit' });

  // Re-build the project (this creates a new .tsbuildinfo for subsequent
  // fast incremental compilations).
  execSync(`tsc ${buildTscArgs(tsconfig, declarationsOnly).join(' ')}`, {
    stdio: 'inherit',
  });

  // copy .{md,json} files
  execSync('bun ../../scripts/copy_files.ts', { stdio: 'inherit' });

  // touch dist/.last_build
  writeFileSync(join(process.cwd(), 'dist', '.last_build'), '');
  process.exit(0);
}

if (import.meta.main) {
  main();
}
