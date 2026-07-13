/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Published-root dependency bridge manifest regression coverage.
 *
 * The root packaging bridge (root package.json declaring @google/genai) is
 * required: CI proved that without it, npm install does not resolve the SDK
 * for the workspace packages that need it at runtime. These tests verify:
 *
 * 1. The root package.json declares @google/genai at the exact version.
 * 2. packages/core and packages/providers declare it at the exact version.
 * 3. The version in all three manifests matches the config baseline.
 *
 * No mocks — these assertions read the real package manifests. The CI Node
 * Consumer Smoke separately packs and installs the artifact in a clean project.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SANCTIONED_GENAI_VERSION } from '../genai-enclave/config.ts';
import { REPO_ROOT, bunAvailable } from './genai-enclave-guard-helpers.ts';

const GENAI_PACKAGE = '@google/genai';
const REQUIRED_VERSION = SANCTIONED_GENAI_VERSION;
const REQUIRED_WORKSPACES = [
  '.',
  'packages/core',
  'packages/providers',
] as const;

interface DependencyManifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

function readManifest(workspaceDir: string): DependencyManifest {
  const manifestPath = join(REPO_ROOT, workspaceDir, 'package.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as DependencyManifest;
}

function getGenaiVersion(manifest: DependencyManifest): string | undefined {
  return (
    manifest.dependencies?.[GENAI_PACKAGE] ??
    manifest.devDependencies?.[GENAI_PACKAGE] ??
    manifest.peerDependencies?.[GENAI_PACKAGE] ??
    manifest.optionalDependencies?.[GENAI_PACKAGE]
  );
}

describe.skipIf(process.env.CI !== 'true' && !bunAvailable())(
  'published-root packaging bridge regression (finding2)',
  () => {
    describe('exact dependency declarations exist', () => {
      for (const workspace of REQUIRED_WORKSPACES) {
        const label =
          workspace === '.' ? 'root package.json' : `${workspace}/package.json`;

        it(`${label} declares ${GENAI_PACKAGE} at exactly ${REQUIRED_VERSION}`, () => {
          const manifest = readManifest(workspace);
          const version = getGenaiVersion(manifest);
          expect(
            version,
            `${label} must declare ${GENAI_PACKAGE}`,
          ).toBeDefined();
          expect(version).toBe(REQUIRED_VERSION);
        });
      }

      it('all three workspace versions are identical (no drift)', () => {
        const versions = REQUIRED_WORKSPACES.map((ws) =>
          getGenaiVersion(readManifest(ws)),
        );
        const unique = new Set(versions);
        expect(unique.size).toBe(1);
        expect([...unique][0]).toBe(REQUIRED_VERSION);
      });
    });

    describe('root packaging bridge rationale', () => {
      it('root package.json is the packaging bridge (private but declares deps)', () => {
        // The root is "private": true (not published directly), but it
        // declares @google/genai so workspace installs resolve the SDK.
        const rootManifest = JSON.parse(
          readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
        ) as { private?: boolean };
        expect(rootManifest.private).toBe(true);
      });
    });
  },
);
