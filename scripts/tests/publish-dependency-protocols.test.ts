/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for protocol target resolution, duplicate dependency
 * detection, and peerDependencies coverage (#2352 F6/F8).
 *
 * Split from publish-dependency-helpers.test.ts to keep each file under
 * the lint max-lines limit. These tests exercise the real helper functions
 * directly (no mocks).
 */

import { describe, it, expect } from 'vitest';
import {
  checkDependencyCoverage,
  checkWorkspaceDependencies,
  iterateWorkspaceDependencies,
  detectRootDuplicateDependencies,
  isRootSectionAdequate,
  type ManifestDependencies,
  type ProtocolTargetResolver,
} from './publish-dependency-helpers.ts';

describe('#2352 F8: protocol target resolution against workspace name-directory map', () => {
  // A resolver that maps package names to workspace directories and target manifests.
  const resolver: ProtocolTargetResolver = (depName, specifier) => {
    const nameToDir: Record<string, string> = {
      '@vybestack/llxprt-code-core': 'packages/core',
      '@vybestack/llxprt-code-tools': 'packages/tools',
    };
    const dir = nameToDir[depName];
    if (dir === undefined) return { resolved: false };
    // Verify the specifier actually points to the expected directory
    if (specifier.startsWith('file:')) {
      const target = specifier.slice(5);
      if (!target.includes(dir.split('/')[1])) {
        return { resolved: false };
      }
    }
    return { resolved: true, workspaceDir: dir };
  };

  it('passes when a workspace: protocol resolves to a known workspace', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
    };
    const workspace: ManifestDependencies = {
      dependencies: {
        chalk: '^4.0.0',
        '@vybestack/llxprt-code-core': 'workspace:*',
      },
    };
    const mismatches = checkWorkspaceDependencies(
      'packages/cli',
      workspace,
      root,
      new Set(['@vybestack/llxprt-code-core']),
      resolver,
    );
    expect(mismatches).toEqual([]);
  });

  it('passes when a file: protocol resolves to a known workspace directory', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
    };
    const workspace: ManifestDependencies = {
      dependencies: {
        chalk: '^4.0.0',
        '@vybestack/llxprt-code-core': 'file:../core',
      },
    };
    const mismatches = checkWorkspaceDependencies(
      'packages/cli',
      workspace,
      root,
      new Set(['@vybestack/llxprt-code-core']),
      resolver,
    );
    expect(mismatches).toEqual([]);
  });

  it('rejects when a file: protocol points to the WRONG directory', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
    };
    const workspace: ManifestDependencies = {
      dependencies: {
        chalk: '^4.0.0',
        '@vybestack/llxprt-code-core': 'file:../tools',
      },
    };
    const mismatches = checkWorkspaceDependencies(
      'packages/cli',
      workspace,
      root,
      new Set(['@vybestack/llxprt-code-core']),
      resolver,
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].message).toContain('unresolved');
  });

  it('rejects when a workspace: protocol targets an unknown package name', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
    };
    const workspace: ManifestDependencies = {
      dependencies: {
        chalk: '^4.0.0',
        '@vybestack/unknown-pkg': 'workspace:*',
      },
    };
    const mismatches = checkWorkspaceDependencies(
      'packages/cli',
      workspace,
      root,
      new Set(),
      resolver,
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].message).toContain('unresolved');
  });

  it('falls back to name-only set check when no resolver is provided', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
    };
    const workspace: ManifestDependencies = {
      dependencies: {
        chalk: '^4.0.0',
        '@vybestack/llxprt-code-core': 'workspace:*',
      },
    };
    // No resolver → falls back to name-only check
    const mismatches = checkWorkspaceDependencies(
      'packages/cli',
      workspace,
      root,
      new Set(['@vybestack/llxprt-code-core']),
    );
    expect(mismatches).toEqual([]);
  });
});

describe('#2352 F6: detectRootDuplicateDependencies — duplicate root dependency/optional', () => {
  it('detects a package in both root dependencies and optionalDependencies', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
      optionalDependencies: { chalk: '^4.0.0' },
    };
    const dups = detectRootDuplicateDependencies(root);
    expect(dups).toHaveLength(1);
    expect(dups[0].name).toBe('chalk');
  });

  it('detects multiple duplicate packages across sections', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0', 'mime-types': '^3.0.1' },
      optionalDependencies: { chalk: '^4.0.0', 'mime-types': '^3.0.1' },
    };
    const dups = detectRootDuplicateDependencies(root);
    expect(dups).toHaveLength(2);
    const names = dups.map((d) => d.name).sort();
    expect(names).toEqual(['chalk', 'mime-types']);
  });

  it('does NOT flag packages in only one section', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
      optionalDependencies: { '@napi-rs/keyring': '^1.0.0' },
    };
    expect(detectRootDuplicateDependencies(root)).toEqual([]);
  });

  it('does NOT flag when only dependencies is present', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0', 'mime-types': '^3.0.1' },
    };
    expect(detectRootDuplicateDependencies(root)).toEqual([]);
  });

  it('does NOT flag when only optionalDependencies is present', () => {
    const root: ManifestDependencies = {
      optionalDependencies: { '@napi-rs/keyring': '^1.0.0' },
    };
    expect(detectRootDuplicateDependencies(root)).toEqual([]);
  });

  it('does NOT flag an empty manifest', () => {
    expect(detectRootDuplicateDependencies({})).toEqual([]);
  });

  it('detects a package in both root dependencies and peerDependencies', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
      peerDependencies: { chalk: '^4.0.0' },
    };
    const dups = detectRootDuplicateDependencies(root);
    expect(dups).toHaveLength(1);
    expect(dups[0].name).toBe('chalk');
  });

  it('detects a package across dependencies, optionalDependencies, and peerDependencies', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
      optionalDependencies: { chalk: '^4.0.0' },
      peerDependencies: { chalk: '^4.0.0' },
    };
    const dups = detectRootDuplicateDependencies(root);
    expect(dups).toHaveLength(1);
    expect(dups[0].sections.length).toBe(3);
  });
});

describe('#2352 F8: peerDependencies in runtime coverage', () => {
  it('iterateWorkspaceDependencies yields peer deps with kind "peer"', () => {
    const manifest: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
      peerDependencies: { react: '^18.0.0' },
    };
    const entries = Array.from(iterateWorkspaceDependencies(manifest));
    const peer = entries.filter((e) => e.kind === 'peer');
    expect(peer.length).toBe(1);
    expect(peer[0].name).toBe('react');
    expect(peer[0].version).toBe('^18.0.0');
  });

  it('iterateWorkspaceDependencies yields deps from all three sections', () => {
    const manifest: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
      optionalDependencies: { '@napi-rs/keyring': '^1.0.0' },
      peerDependencies: { react: '^18.0.0' },
    };
    const entries = Array.from(iterateWorkspaceDependencies(manifest));
    expect(entries.length).toBe(3);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['@napi-rs/keyring', 'chalk', 'react']);
  });

  it('checkDependencyCoverage accepts a peer dep in root dependencies', () => {
    expect(
      checkDependencyCoverage(
        'packages/cli',
        'react',
        '^18.0.0',
        'peer',
        { dependencies: { react: '^18.0.0' } },
        new Set(),
      ),
    ).toBeNull();
  });

  it('checkDependencyCoverage accepts a peer dep in root peerDependencies', () => {
    expect(
      checkDependencyCoverage(
        'packages/cli',
        'react',
        '^18.0.0',
        'peer',
        { peerDependencies: { react: '^18.0.0' } },
        new Set(),
      ),
    ).toBeNull();
  });

  it('checkDependencyCoverage flags a peer dep missing from root entirely', () => {
    const mismatch = checkDependencyCoverage(
      'packages/cli',
      'react',
      '^18.0.0',
      'peer',
      { dependencies: { chalk: '^4.0.0' } },
      new Set(),
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch!.message).toContain('not declared in root');
  });

  it('isRootSectionAdequate accepts root dependencies for a peer dep', () => {
    expect(isRootSectionAdequate('dependencies', 'peer')).toBe(true);
  });

  it('isRootSectionAdequate accepts root peerDependencies for a peer dep', () => {
    expect(isRootSectionAdequate('peerDependencies', 'peer')).toBe(true);
  });

  it('isRootSectionAdequate rejects root optionalDependencies for a peer dep', () => {
    expect(isRootSectionAdequate('optionalDependencies', 'peer')).toBe(false);
  });
});
