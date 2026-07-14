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
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SANCTIONED_GENAI_VERSION } from '../genai-enclave/config.ts';
import { REPO_ROOT } from './genai-enclave-guard-helpers.ts';

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
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!isDependencyManifest(parsed)) {
      throw new Error('dependency sections must be objects when present');
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot read dependency manifest ${manifestPath}: ${message}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasPrivateFlag(value: unknown): boolean {
  if (!isRecord(value) || !Object.hasOwn(value, 'private')) return false;
  return Object.getOwnPropertyDescriptor(value, 'private')?.value === true;
}

function isDependencyManifest(value: unknown): value is DependencyManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const manifest: Record<string, unknown> = Object.fromEntries(
    Object.entries(value),
  );
  return [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ].every((key) => {
    const section = manifest[key];
    if (section === undefined) return true;
    if (
      typeof section !== 'object' ||
      section === null ||
      Array.isArray(section)
    ) {
      return false;
    }
    // Only enforce that @google/genai (if present) is a string, so that
    // valid manifests with object-style dependency specs in other entries
    // are not rejected.
    const entries = Object.entries(section);
    for (const [name, version] of entries) {
      if (name === GENAI_PACKAGE && typeof version !== 'string') {
        return false;
      }
    }
    return true;
  });
}

function getGenaiVersion(manifest: DependencyManifest): string | undefined {
  const sections = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];
  for (const section of sections) {
    if (section !== undefined && GENAI_PACKAGE in section) {
      return section[GENAI_PACKAGE];
    }
  }
  return undefined;
}

describe('published-root packaging bridge regression (finding2)', () => {
  describe('exact dependency declarations exist', () => {
    for (const workspace of REQUIRED_WORKSPACES) {
      const label =
        workspace === '.' ? 'root package.json' : `${workspace}/package.json`;

      it(`${label} declares ${GENAI_PACKAGE} at exactly ${REQUIRED_VERSION}`, () => {
        const manifest = readManifest(workspace);
        const version = getGenaiVersion(manifest);
        expect(version, `${label} must declare ${GENAI_PACKAGE}`).toBeDefined();
        expect(version).toBe(REQUIRED_VERSION);
      });
    }

    it('all three workspace versions are identical (no drift)', () => {
      const versions = REQUIRED_WORKSPACES.map((ws) =>
        getGenaiVersion(readManifest(ws)),
      );
      const uniqueVersions = new Set(versions);
      expect(uniqueVersions.size).toBe(1);
      expect([...uniqueVersions][0]).toBe(REQUIRED_VERSION);
    });
  });

  describe('root packaging bridge rationale', () => {
    it('root package.json is the packaging bridge (private but declares deps)', () => {
      const rootManifest: unknown = JSON.parse(
        readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
      );
      expect(hasPrivateFlag(rootManifest)).toBe(true);
    });
  });

  describe('broad publish dependency invariant', () => {
    // The package-tree invariant: @google/genai may appear only in core and
    // providers. Root bridge coverage is handled by the focused checks above.
    // The repository currently uses a flat packages/* workspace layout.
    it('no workspace OTHER than root/core/providers declares @google/genai', () => {
      const rogueWorkspaces: string[] = [];
      const packagesDir = join(REPO_ROOT, 'packages');
      for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
        const wsDir = `packages/${entry.name}`;
        const manifestPath = join(packagesDir, entry.name, 'package.json');
        const shouldCheck =
          entry.isDirectory() &&
          !(REQUIRED_WORKSPACES as readonly string[]).includes(wsDir) &&
          existsSync(manifestPath);
        if (shouldCheck) {
          const version = getGenaiVersion(readManifest(wsDir));
          if (version !== undefined) {
            rogueWorkspaces.push(`${wsDir} (${version})`);
          }
        }
      }
      expect(
        rogueWorkspaces,
        `Non-sanctioned workspaces declaring ${GENAI_PACKAGE}: ` +
          rogueWorkspaces.join(', '),
      ).toEqual([]);
    });
  });
});
