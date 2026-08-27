/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Repository-level regression for runtime dependency declarations (#3305).
 *
 * The synthetic-fixture suite in `runtime-dependency-declarations.test.ts`
 * pins the guard's behavior. This file pins the repository's compliance with
 * it, so a package that starts importing something it does not declare fails
 * in CI rather than at `npm install` time on a consumer's machine.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkAllWorkspaces,
  discoverPublishedWorkspaces,
} from '../check-runtime-dependency-declarations.ts';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

function readManifest(workspaceDir: string): Manifest {
  return JSON.parse(
    readFileSync(join(repoRoot, workspaceDir, 'package.json'), 'utf8'),
  ) as Manifest;
}

describe('workspace runtime dependency declarations (#3305)', () => {
  it('scans every published workspace', () => {
    const workspaces = discoverPublishedWorkspaces(repoRoot);
    expect(workspaces.length).toBeGreaterThan(0);
    expect(workspaces.map(({ workspaceDir }) => workspaceDir)).toContain(
      'packages/mcp',
    );
  });

  it('has no published package importing an undeclared package at runtime', () => {
    const violations = checkAllWorkspaces(repoRoot);
    expect(
      violations.map((violation) => violation.message),
      'Published packages must declare every package they import at ' +
        'runtime. Workspace hoisting and the tsconfig path wildcards ' +
        'satisfy these imports in-repo, so the failure only appears once ' +
        'the tarball is installed standalone:\n  - ' +
        violations.map((violation) => violation.message).join('\n  - '),
    ).toEqual([]);
  }, 120_000); // Parses the transitive source closure of every published workspace.

  it('declares core as a runtime dependency of the mcp package', () => {
    // Named assertion so a regression points straight at #3305 rather than
    // only at the generic guard failure above. packages/mcp value-imports
    // getErrorMessage, DebugLogger, debugLogger, coreEvents,
    // openBrowserSecurely, AuthProviderType, and safeJsonStringify from core.
    const manifest = readManifest('packages/mcp');
    expect(Object.keys(manifest.dependencies ?? {})).toContain(
      '@vybestack/llxprt-code-core',
    );
    expect(Object.keys(manifest.devDependencies ?? {})).not.toContain(
      '@vybestack/llxprt-code-core',
    );
  });

  it('declares both directions of the core/mcp cycle', () => {
    // The cycle is deliberate and documented in
    // dev-docs/architecture/package-dependency-cycles.md. Declaring only one
    // direction is what let the published mcp tarball ship broken.
    expect(
      Object.keys(readManifest('packages/core').dependencies ?? {}),
    ).toContain('@vybestack/llxprt-code-mcp');
    expect(
      Object.keys(readManifest('packages/mcp').dependencies ?? {}),
    ).toContain('@vybestack/llxprt-code-core');
  });
});
