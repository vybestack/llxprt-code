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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { messageOf } from './utils/error-guards.ts';
import { isDeclarationsOnly } from './build_package.ts';
import { prepareWorkspaceBuild } from './prepare-workspace-build.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

/**
 * Workspaces the declaration-only build (issue #2983) skips, because no
 * tsconfig `paths` entry and no source import resolves their declarations, so
 * building them produces nothing that type-aware lint or `tsc --noEmit` reads.
 * Both still build normally on the release path.
 *
 *  - `llxprt-code-vscode-ide-companion` ends its build in esbuild, which
 *    resolves its workspace dependencies at `dist/*.js` — exactly what
 *    declaration-only emit does not produce. CI and the release workflow build
 *    it on their own track through `npm run build:vscode`.
 *  - `@vybestack/llxprt-code-lsp` builds with a bare `tsc -p tsconfig.json`
 *    that never sees `--emitDeclarationOnly`, so including it would emit
 *    JavaScript into a build whose whole point is not to. It is reached at
 *    runtime by module resolution from a spawned process, never imported, so
 *    nothing type-checks against its declarations.
 */
const NON_DECLARATION_WORKSPACES = new Set([
  'llxprt-code-vscode-ide-companion',
  '@vybestack/llxprt-code-lsp',
]);

/**
 * Characters an npm package name may contain. Names reach a shell command line
 * below, so a name outside this grammar is rejected rather than interpolated.
 * Uppercase is accepted: npm rejects it for *new* packages but still resolves
 * legacy names that use it, and it is shell-safe either way.
 */
const PACKAGE_NAME_PATTERN =
  /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Package names of the root `workspaces` entries, in declaration order. The
 * array holds concrete directory paths (enforced by
 * scripts/verify-bun-workspace-links.ts), so no glob expansion is needed.
 */
function readWorkspacePackageNames(): string[] {
  const rootPkg = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf-8'),
  ) as { workspaces?: string[] };
  const workspaces = rootPkg.workspaces;
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new Error('Root package.json must declare a non-empty `workspaces`.');
  }
  return workspaces.map((relativeDir) => {
    let pkg: { name?: string };
    try {
      pkg = JSON.parse(
        readFileSync(join(root, relativeDir, 'package.json'), 'utf-8'),
      ) as { name?: string };
    } catch (error) {
      // Name the workspace: a bare SyntaxError from JSON.parse leaves the
      // reader to guess which of the workspace manifests is malformed.
      throw new Error(
        `Could not read ${relativeDir}/package.json: ${messageOf(error)}`,
      );
    }
    if (!pkg.name || !PACKAGE_NAME_PATTERN.test(pkg.name)) {
      throw new Error(
        `Workspace ${relativeDir} has no usable package name: ${String(pkg.name)}`,
      );
    }
    return pkg.name;
  });
}

export function declarationBuildWorkspaces(names: string[]): string[] {
  return names.filter((name) => !NON_DECLARATION_WORKSPACES.has(name));
}

function workspaceBuildSelector(): string {
  if (!isDeclarationsOnly()) {
    return '--workspaces';
  }
  const selected = declarationBuildWorkspaces(readWorkspacePackageNames());
  if (selected.length === 0) {
    // An empty selector would leave a bare `npm run build`, which re-enters
    // this script instead of fanning out to the workspaces — a silent wrong
    // build rather than a failure.
    throw new Error(
      'Declaration build selected no workspaces; check NON_DECLARATION_WORKSPACES.',
    );
  }
  return selected.map((name) => `--workspace=${name}`).join(' ');
}

function sandboxAvailable(): boolean {
  try {
    execSync('bun scripts/sandbox_command.ts -q', {
      stdio: 'inherit',
      cwd: root,
    });
    return true;
  } catch {
    return false;
  }
}

export interface CoordinatedWorkspaceBuildOperations {
  prepare(): void;
  generate(): void;
  compile(): void;
  verify(): void;
}

export function runCoordinatedWorkspaceBuild(
  operations: CoordinatedWorkspaceBuildOperations,
): void {
  operations.prepare();
  operations.generate();
  operations.compile();
  operations.verify();
}

function main(): void {
  // npm install if node_modules was removed (e.g. via npm run clean or
  // scripts/clean.ts)
  if (!existsSync(join(root, 'node_modules'))) {
    execSync('npm install', { stdio: 'inherit', cwd: root });
  }

  // build all workspaces/packages
  if (isDeclarationsOnly()) {
    execSync('npm run generate', { stdio: 'inherit', cwd: root });
    execSync(`npm run build ${workspaceBuildSelector()}`, {
      stdio: 'inherit',
      cwd: root,
    });
  } else {
    runCoordinatedWorkspaceBuild({
      prepare: () => prepareWorkspaceBuild(root),
      generate: () =>
        execSync('npm run generate', { stdio: 'inherit', cwd: root }),
      compile: () =>
        execSync(`npm run build ${workspaceBuildSelector()}`, {
          stdio: 'inherit',
          cwd: root,
        }),
      verify: () =>
        execSync('bun scripts/verify-lazy-mcp-build-coherence.ts', {
          stdio: 'inherit',
          cwd: root,
        }),
    });
  }

  // also build container image if sandboxing is enabled
  // skip (-s) npm install + build since we did that above
  const buildSandboxRequested =
    process.env.BUILD_SANDBOX === '1' || process.env.BUILD_SANDBOX === 'true';

  if (buildSandboxRequested && sandboxAvailable()) {
    try {
      execSync('bun scripts/build_sandbox.ts -s', {
        stdio: 'inherit',
        cwd: root,
      });
    } catch (error) {
      console.error(`Sandbox image build failed: ${messageOf(error)}`);
      throw error;
    }
  }
}

if (import.meta.main) {
  main();
}
