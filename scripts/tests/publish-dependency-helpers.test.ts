/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral unit tests for the publish-dependency-helpers (#2352).
 *
 * These tests exercise the real helper functions directly (no mocks) to
 * verify that mandatory vs optional dependencies are distinguished, that
 * semver.intersects is used for registry range comparison, and that npm
 * aliases and file/workspace protocols are handled correctly.
 *
 * Per RULES.md: tests assert behavior (does the helper report a mismatch?),
 * not implementation details.
 */

import { describe, it, expect } from 'vitest';
import {
  isProtocolSpecifier,
  isNpmAlias,
  extractSemverRange,
  extractNpmAliasTarget,
  rangesIntersect,
  isRootSubsetOfWorkspace,
  isRootSectionAdequate,
  checkDependencyCoverage,
  checkWorkspaceDependencies,
  deriveShippedWorkspaceDirs,
  iterateWorkspaceDependencies,
  type ManifestDependencies,
  type RootManifest,
} from './publish-dependency-helpers.ts';

describe('isProtocolSpecifier', () => {
  it('detects file: protocol', () => {
    expect(isProtocolSpecifier('file:../storage')).toBe(true);
  });

  it('detects workspace: protocol', () => {
    expect(isProtocolSpecifier('workspace:*')).toBe(true);
    expect(isProtocolSpecifier('workspace:^1.0.0')).toBe(true);
  });

  it('detects link: protocol', () => {
    expect(isProtocolSpecifier('link:../sibling')).toBe(true);
  });

  it('does NOT flag a plain semver range', () => {
    expect(isProtocolSpecifier('^3.0.1')).toBe(false);
    expect(isProtocolSpecifier('>=2.1.35 <4')).toBe(false);
    expect(isProtocolSpecifier('3.0.1')).toBe(false);
  });
});

describe('isNpmAlias', () => {
  it('detects npm: prefix', () => {
    expect(isNpmAlias('npm:realName@^1.2.3')).toBe(true);
    expect(isNpmAlias('npm:@scope/realName@2.0.0')).toBe(true);
  });

  it('does NOT flag a plain semver range', () => {
    expect(isNpmAlias('^3.0.1')).toBe(false);
  });
});

describe('extractSemverRange', () => {
  it('returns the range from an npm alias', () => {
    expect(extractSemverRange('npm:mime-types@^2.1.35')).toBe('^2.1.35');
  });

  it('returns the range from a scoped npm alias', () => {
    expect(extractSemverRange('npm:@scope/pkg@2.0.0')).toBe('2.0.0');
  });

  it('returns null for file: protocol', () => {
    expect(extractSemverRange('file:../storage')).toBeNull();
  });

  it('returns null for workspace: protocol', () => {
    expect(extractSemverRange('workspace:*')).toBeNull();
  });

  it('returns the plain range as-is', () => {
    expect(extractSemverRange('^3.0.1')).toBe('^3.0.1');
    expect(extractSemverRange('>=2.1.35 <4')).toBe('>=2.1.35 <4');
  });

  it('returns null for a malformed npm alias with no version', () => {
    expect(extractSemverRange('npm:pkg')).toBeNull();
  });
});

describe('extractNpmAliasTarget', () => {
  it('extracts target from a plain npm alias', () => {
    expect(extractNpmAliasTarget('npm:mime-types@^2.1.35')).toBe('mime-types');
  });

  it('extracts target from a scoped npm alias', () => {
    expect(extractNpmAliasTarget('npm:@scope/pkg@2.0.0')).toBe('@scope/pkg');
  });

  it('extracts target from an @jrichman alias', () => {
    expect(extractNpmAliasTarget('npm:@jrichman/ink@^6.4.8')).toBe(
      '@jrichman/ink',
    );
  });

  it('returns null for a non-alias specifier', () => {
    expect(extractNpmAliasTarget('^3.0.1')).toBeNull();
  });

  it('returns the target for a versionless npm alias', () => {
    expect(extractNpmAliasTarget('npm:pkg')).toBe('pkg');
  });
});

describe('rangesIntersect', () => {
  it('returns true for intersecting ranges', () => {
    expect(rangesIntersect('^3.0.1', '^3.0.1')).toBe(true);
    expect(rangesIntersect('^2.1.35', '^2.1.35')).toBe(true);
  });

  it('returns false for non-intersecting ranges', () => {
    expect(rangesIntersect('^3.0.1', '^2.1.35')).toBe(false);
  });

  it('returns false for invalid ranges (fail-closed)', () => {
    expect(rangesIntersect('not-a-range', '^3.0.1')).toBe(false);
  });
});

describe('isRootSubsetOfWorkspace', () => {
  it('returns true when root range equals workspace range', () => {
    expect(isRootSubsetOfWorkspace('^3.0.1', '^3.0.1')).toBe(true);
  });

  it('returns true when root range is narrower than workspace range', () => {
    // root ^3.0.2 ⊆ workspace ^3.0.1
    expect(isRootSubsetOfWorkspace('^3.0.2', '^3.0.1')).toBe(true);
  });

  it('returns false when root range is broader than workspace range', () => {
    // root ^3.0.1 ⊄ workspace ^3.0.2
    expect(isRootSubsetOfWorkspace('^3.0.1', '^3.0.2')).toBe(false);
  });

  it('#2352: rejects root >=2 <4 for workspace ^3.0.1', () => {
    expect(isRootSubsetOfWorkspace('>=2 <4', '^3.0.1')).toBe(false);
  });

  it('returns false for completely disjoint ranges', () => {
    expect(isRootSubsetOfWorkspace('^3.0.1', '^2.1.35')).toBe(false);
  });

  it('returns false for invalid ranges (fail-closed)', () => {
    expect(isRootSubsetOfWorkspace('not-a-range', '^3.0.1')).toBe(false);
  });

  it('accepts exact version equality', () => {
    expect(isRootSubsetOfWorkspace('1.30.0', '1.30.0')).toBe(true);
  });
});

describe('isRootSectionAdequate', () => {
  it('accepts root dependencies for a mandatory workspace dep', () => {
    expect(isRootSectionAdequate('dependencies', 'mandatory')).toBe(true);
  });

  it('rejects root optionalDependencies for a mandatory workspace dep', () => {
    // #2352: mandatory deps must be in root dependencies —
    // optionalDependencies may be skipped by platform-specific installs.
    expect(isRootSectionAdequate('optionalDependencies', 'mandatory')).toBe(
      false,
    );
  });

  it('rejects missing root section for a mandatory workspace dep', () => {
    expect(isRootSectionAdequate(undefined, 'mandatory')).toBe(false);
  });

  it('accepts root dependencies for an optional workspace dep', () => {
    expect(isRootSectionAdequate('dependencies', 'optional')).toBe(true);
  });

  it('accepts root optionalDependencies for an optional workspace dep', () => {
    expect(isRootSectionAdequate('optionalDependencies', 'optional')).toBe(
      true,
    );
  });
});

describe('checkDependencyCoverage', () => {
  const rootWithDeps: ManifestDependencies = {
    dependencies: { 'mime-types': '^3.0.1', chalk: '^4.0.0' },
    optionalDependencies: { '@napi-rs/keyring': '^1.0.0' },
  };
  const internalPackages = new Set<string>([
    '@vybestack/llxprt-code-core',
    '@vybestack/llxprt-code-cli',
  ]);

  it('returns null when a mandatory dep matches the root range', () => {
    expect(
      checkDependencyCoverage(
        'packages/cli',
        'mime-types',
        '^3.0.1',
        'mandatory',
        rootWithDeps,
        internalPackages,
      ),
    ).toBeNull();
  });

  it('returns null when root range is a subset of the workspace range', () => {
    // root ^3.0.1 ⊆ workspace ^3.0.0 → true (^3.0.1 is narrower)
    expect(
      checkDependencyCoverage(
        'packages/cli',
        'mime-types',
        '^3.0.0',
        'mandatory',
        rootWithDeps,
        internalPackages,
      ),
    ).toBeNull();
  });

  it('returns a mismatch when root range is NOT a subset of workspace range', () => {
    // root ^3.0.1 ⊄ workspace ^3.0.2 → false (3.0.1 is in root but not workspace)
    const mismatch = checkDependencyCoverage(
      'packages/cli',
      'mime-types',
      '^3.0.2',
      'mandatory',
      rootWithDeps,
      internalPackages,
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch!.message).toContain('not a subset');
  });

  it('#2352: rejects root broad range >=2 <4 for workspace ^3.0.1', () => {
    // root >=2 <4 ⊄ workspace ^3.0.1 → false (2.x is in root but not workspace)
    const mismatch = checkDependencyCoverage(
      'packages/cli',
      'mime-types',
      '^3.0.1',
      'mandatory',
      { dependencies: { 'mime-types': '>=2 <4' } },
      internalPackages,
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch!.message).toContain('not a subset');
  });

  it('returns a mismatch when a mandatory dep is missing from root', () => {
    const mismatch = checkDependencyCoverage(
      'packages/cli',
      'unknown-pkg',
      '^1.0.0',
      'mandatory',
      rootWithDeps,
      internalPackages,
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch!.message).toContain('not declared in root');
  });

  it('returns a mismatch when ranges do not intersect', () => {
    const mismatch = checkDependencyCoverage(
      'packages/core',
      'mime-types',
      '^2.1.35',
      'mandatory',
      rootWithDeps,
      internalPackages,
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch!.message).toContain('not a subset');
  });

  it('#2352: rejects a mandatory workspace dep only in root optionalDependencies', () => {
    const mismatch = checkDependencyCoverage(
      'packages/core',
      'mime-types',
      '^3.0.1',
      'mandatory',
      { optionalDependencies: { 'mime-types': '^3.0.1' } },
      internalPackages,
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch!.message).toContain('insufficient');
  });

  it('returns null for an internal package with file: protocol (in internal set)', () => {
    expect(
      checkDependencyCoverage(
        'packages/cli',
        '@vybestack/llxprt-code-core',
        'file:../core',
        'mandatory',
        rootWithDeps,
        internalPackages,
      ),
    ).toBeNull();
  });

  it('#2352: rejects a file: protocol specifier NOT in the internal set', () => {
    const mismatch = checkDependencyCoverage(
      'packages/cli',
      'some-external',
      'file:../some-external',
      'mandatory',
      rootWithDeps,
      internalPackages,
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch!.message).toContain('unresolved external');
  });

  it('#2352: rejects a workspace: protocol specifier NOT in the internal set', () => {
    const mismatch = checkDependencyCoverage(
      'packages/cli',
      'some-external',
      'workspace:*',
      'mandatory',
      rootWithDeps,
      internalPackages,
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch!.message).toContain('unresolved external');
  });

  it('#2352: rejects a link: protocol specifier NOT in the internal set', () => {
    const mismatch = checkDependencyCoverage(
      'packages/cli',
      'some-external',
      'link:../some-external',
      'mandatory',
      rootWithDeps,
      internalPackages,
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch!.message).toContain('unresolved external');
  });

  it('returns null for a workspace: protocol specifier that IS in the internal set', () => {
    expect(
      checkDependencyCoverage(
        'packages/cli',
        '@vybestack/llxprt-code-cli',
        'workspace:*',
        'mandatory',
        rootWithDeps,
        internalPackages,
      ),
    ).toBeNull();
  });

  it('handles npm alias in the workspace version', () => {
    expect(
      checkDependencyCoverage(
        'packages/cli',
        'ink',
        'npm:@jrichman/ink@^6.4.8',
        'mandatory',
        { dependencies: { ink: 'npm:@jrichman/ink@^6.4.8' } },
        internalPackages,
      ),
    ).toBeNull();
  });

  it('returns a mismatch when an npm alias version is not a subset', () => {
    const mismatch = checkDependencyCoverage(
      'packages/cli',
      'ink',
      'npm:@jrichman/ink@^5.0.0',
      'mandatory',
      { dependencies: { ink: 'npm:@jrichman/ink@^6.4.8' } },
      internalPackages,
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch!.message).toContain('not a subset');
  });

  it('#2352: rejects differing npm alias targets', () => {
    const mismatch = checkDependencyCoverage(
      'packages/cli',
      'ink',
      'npm:@jrichman/ink@^6.4.8',
      'mandatory',
      { dependencies: { ink: 'npm:@other/ink@^6.4.8' } },
      internalPackages,
    );
    expect(mismatch).not.toBeNull();
    expect(mismatch!.message).toContain('differs from root alias target');
  });

  it('accepts an optional dep from root optionalDependencies', () => {
    expect(
      checkDependencyCoverage(
        'packages/storage',
        '@napi-rs/keyring',
        '^1.0.0',
        'optional',
        rootWithDeps,
        internalPackages,
      ),
    ).toBeNull();
  });

  it('accepts an optional dep from root dependencies', () => {
    expect(
      checkDependencyCoverage(
        'packages/storage',
        'chalk',
        '^4.0.0',
        'optional',
        rootWithDeps,
        internalPackages,
      ),
    ).toBeNull();
  });
});

describe('checkWorkspaceDependencies', () => {
  it('aggregates mismatches from both mandatory and optional deps', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
    };
    const workspace: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0', missing: '^1.0.0' },
      optionalDependencies: { 'also-missing': '^2.0.0' },
    };
    const mismatches = checkWorkspaceDependencies(
      'packages/cli',
      workspace,
      root,
    );
    expect(mismatches).toHaveLength(2);
    expect(mismatches[0].name).toBe('missing');
    expect(mismatches[0].kind).toBe('mandatory');
    expect(mismatches[1].name).toBe('also-missing');
    expect(mismatches[1].kind).toBe('optional');
  });

  it('returns empty when all deps are covered', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
      optionalDependencies: { '@napi-rs/keyring': '^1.0.0' },
    };
    const workspace: ManifestDependencies = {
      // root ^4.0.0 ⊆ workspace ^4.0.0 → true
      dependencies: { chalk: '^4.0.0' },
      optionalDependencies: { '@napi-rs/keyring': '^1.0.0' },
    };
    expect(checkWorkspaceDependencies('packages/cli', workspace, root)).toEqual(
      [],
    );
  });

  it('#2352: returns a mismatch when root range is broader than workspace', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
    };
    const workspace: ManifestDependencies = {
      // root ^4.0.0 ⊄ workspace ^4.1.0
      dependencies: { chalk: '^4.1.0' },
    };
    const mismatches = checkWorkspaceDependencies(
      'packages/cli',
      workspace,
      root,
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].message).toContain('not a subset');
  });

  it('#2352: passes internal package protocol specifiers via internalPackages', () => {
    const root: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
    };
    const workspace: ManifestDependencies = {
      dependencies: {
        chalk: '^4.0.0',
        '@vybestack/llxprt-code-core': 'workspace:*',
      },
    };
    const internalPackages = new Set(['@vybestack/llxprt-code-core']);
    const mismatches = checkWorkspaceDependencies(
      'packages/cli',
      workspace,
      root,
      internalPackages,
    );
    expect(mismatches).toEqual([]);
  });

  it('#2352: flags unresolved workspace: protocol without internalPackages', () => {
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
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].message).toContain('unresolved external');
  });

  it('#2352 F7: rejects mixed alias/plain semantic targets (workspace alias, root plain)', () => {
    const root: ManifestDependencies = {
      dependencies: { 'mime-types': '^3.0.1' },
    };
    const workspace: ManifestDependencies = {
      dependencies: {
        'mime-types': 'npm:mime-types@^3.0.1',
      },
    };
    const mismatches = checkWorkspaceDependencies(
      'packages/core',
      workspace,
      root,
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].message).toContain('mixed');
  });

  it('#2352 F7: rejects mixed alias/plain semantic targets (workspace plain, root alias)', () => {
    const root: ManifestDependencies = {
      dependencies: {
        'mime-types': 'npm:mime-types@^3.0.1',
      },
    };
    const workspace: ManifestDependencies = {
      dependencies: { 'mime-types': '^3.0.1' },
    };
    const mismatches = checkWorkspaceDependencies(
      'packages/core',
      workspace,
      root,
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].message).toContain('mixed');
  });

  it('#2352 F7: does NOT reject when both use matching npm aliases', () => {
    const root: ManifestDependencies = {
      dependencies: {
        'mime-types': 'npm:mime-types@^3.0.1',
      },
    };
    const workspace: ManifestDependencies = {
      dependencies: {
        'mime-types': 'npm:mime-types@^3.0.1',
      },
    };
    const mismatches = checkWorkspaceDependencies(
      'packages/core',
      workspace,
      root,
    );
    expect(mismatches).toEqual([]);
  });

  it('#2352 F7: does NOT reject when both use plain versions', () => {
    const root: ManifestDependencies = {
      dependencies: { 'mime-types': '^3.0.1' },
    };
    const workspace: ManifestDependencies = {
      dependencies: { 'mime-types': '^3.0.1' },
    };
    const mismatches = checkWorkspaceDependencies(
      'packages/core',
      workspace,
      root,
    );
    expect(mismatches).toEqual([]);
  });
});

describe('deriveShippedWorkspaceDirs', () => {
  it('extracts workspace dirs from files entries', () => {
    const root: RootManifest = {
      files: [
        'packages/cli/bin/',
        'packages/cli/index.ts',
        'packages/core/src/',
        'README.md',
      ],
    };
    const dirs = deriveShippedWorkspaceDirs(root);
    expect(dirs).toEqual(new Set(['packages/cli', 'packages/core']));
  });

  it('extracts scoped workspace dirs and ignores incomplete scopes', () => {
    const root: RootManifest = {
      files: [
        'packages/@scope/pkg/src/',
        'packages/@scope/pkg/index.ts',
        'packages/@scope',
      ],
    };
    expect(deriveShippedWorkspaceDirs(root)).toEqual(
      new Set(['packages/@scope/pkg']),
    );
  });
  it('ignores non-packages entries', () => {
    const root: RootManifest = {
      files: ['scripts/preinstall.cjs', 'README.md', 'packages/cli/src/'],
    };
    const dirs = deriveShippedWorkspaceDirs(root);
    expect(dirs).toEqual(new Set(['packages/cli']));
  });

  it('returns empty set when no files entries exist', () => {
    const root: RootManifest = {};
    expect(deriveShippedWorkspaceDirs(root)).toEqual(new Set());
  });
});

describe('#2352 F11: iterateWorkspaceDependencies — shared manifest-derived iterator', () => {
  it('yields mandatory deps from dependencies with kind "mandatory"', () => {
    const manifest: ManifestDependencies = {
      dependencies: { 'mime-types': '^3.0.1', chalk: '^4.0.0' },
    };
    const entries = Array.from(iterateWorkspaceDependencies(manifest));
    const mandatory = entries.filter((e) => e.kind === 'mandatory');
    expect(mandatory.length).toBe(2);
    expect(mandatory.map((e) => e.name).sort()).toEqual([
      'chalk',
      'mime-types',
    ]);
  });

  it('yields optional deps from optionalDependencies with kind "optional"', () => {
    const manifest: ManifestDependencies = {
      optionalDependencies: { '@napi-rs/keyring': '^1.0.0' },
    };
    const entries = Array.from(iterateWorkspaceDependencies(manifest));
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe('@napi-rs/keyring');
    expect(entries[0].kind).toBe('optional');
    expect(entries[0].version).toBe('^1.0.0');
  });

  it('yields BOTH mandatory and optional deps from a single manifest', () => {
    const manifest: ManifestDependencies = {
      dependencies: { chalk: '^4.0.0' },
      optionalDependencies: { '@napi-rs/keyring': '^1.0.0' },
    };
    const entries = Array.from(iterateWorkspaceDependencies(manifest));
    expect(entries.length).toBe(2);
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['@napi-rs/keyring', 'chalk']);
  });

  it('does NOT filter by any naming prefix — all entries included', () => {
    const manifest: ManifestDependencies = {
      dependencies: {
        '@vybestack/internal': '1.0.0',
        '@google/genai': '1.30.0',
        'plain-pkg': '^2.0.0',
        '@napi-rs/keyring': '^1.0.0',
      },
    };
    const entries = Array.from(iterateWorkspaceDependencies(manifest));
    expect(entries.length).toBe(4);
  });

  it('yields nothing for an empty manifest', () => {
    const manifest: ManifestDependencies = {};
    const entries = Array.from(iterateWorkspaceDependencies(manifest));
    expect(entries).toEqual([]);
  });

  it('yields nothing for a manifest with empty sections', () => {
    const manifest: ManifestDependencies = {
      dependencies: {},
      optionalDependencies: {},
    };
    const entries = Array.from(iterateWorkspaceDependencies(manifest));
    expect(entries).toEqual([]);
  });

  it('includes each dep exactly once when declared in the correct section', () => {
    const manifest: ManifestDependencies = {
      dependencies: { 'mime-types': '^3.0.1' },
      optionalDependencies: { '@napi-rs/keyring': '^1.0.0' },
    };
    const entries = Array.from(iterateWorkspaceDependencies(manifest));
    const names = entries.map((e) => e.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});
