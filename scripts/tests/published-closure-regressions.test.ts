/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Exact regression tests for Findings 3-6 (#2352).
 *
 * 3. packed closure use TS AST, include reexports and unresolved errors.
 * 4. recursively traverse nested conditional exports/arrays.
 * 5. reject or safely scan symlinked package dirs/manifests/sources with
 *    root/cycle checks.
 * 6. real protocol resolver canonical exact file/link path plus target
 *    manifest.
 */

import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type WorkspaceManifest,
  deriveAllEntryPaths,
  verifyTransitiveSourceClosure,
  discoverPackageWorkspaces,
} from './workspace-source-helpers.ts';
import { createRealProtocolResolver } from './publish-dependency-helpers.ts';

/**
 * Create a temporary repo root with a workspace directory containing source
 * files. Returns the repo root path and a cleanup function.
 */
function createTempRepo(
  workspaceDir: string,
  files: Record<string, string>,
): { repoRoot: string; cleanup: () => void } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ws-reg-'));
  const fullWsDir = join(repoRoot, workspaceDir);
  mkdirSync(fullWsDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(fullWsDir, relPath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }
  return {
    repoRoot,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

// ─── Finding 3: packed closure use TS AST, include reexports ────────────────

describe('Finding3: packed closure follows re-exports via TS AST', () => {
  it('follows export ... from relative re-exports', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: { '.': { bun: './index.ts' } },
    };
    const { repoRoot, cleanup } = createTempRepo('packages/test-pkg', {
      'index.ts': "export { x } from './helper.js';\n",
      'helper.ts': 'export const x = 42;\n',
    });
    try {
      const packed = new Set([
        'packages/test-pkg/index.ts',
        'packages/test-pkg/helper.ts',
      ]);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      expect(missing).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('follows export * from relative re-exports', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: { '.': { bun: './index.ts' } },
    };
    const { repoRoot, cleanup } = createTempRepo('packages/test-pkg', {
      'index.ts': "export * from './helper.js';\n",
      'helper.ts': 'export const x = 42;\n',
    });
    try {
      const packed = new Set([
        'packages/test-pkg/index.ts',
        'packages/test-pkg/helper.ts',
      ]);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      expect(missing).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('follows export type ... from relative re-exports', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: { '.': { bun: './index.ts' } },
    };
    const { repoRoot, cleanup } = createTempRepo('packages/test-pkg', {
      'index.ts': "export type { T } from './types.js';\n",
      'types.ts': 'export type T = number;\n',
    });
    try {
      const packed = new Set([
        'packages/test-pkg/index.ts',
        'packages/test-pkg/types.ts',
      ]);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      expect(missing).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('reports unresolved re-export specifiers as missing', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: { '.': { bun: './index.ts' } },
    };
    const { repoRoot, cleanup } = createTempRepo('packages/test-pkg', {
      'index.ts': "export { x } from './missing.js';\n",
    });
    try {
      // missing.js does NOT exist on disk — the re-export is unresolved
      const packed = new Set(['packages/test-pkg/index.ts']);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      // The unresolved specifier should produce a missing entry because
      // the re-exported file does not exist on disk and is not packed.
      expect(missing).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it('does NOT follow commented-out re-exports', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: { '.': { bun: './index.ts' } },
    };
    const { repoRoot, cleanup } = createTempRepo('packages/test-pkg', {
      'index.ts': "// export { x } from './helper.js';\nexport const y = 1;\n",
    });
    try {
      // helper.ts does NOT exist; the commented-out export should not be followed
      const packed = new Set(['packages/test-pkg/index.ts']);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      expect(missing).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

// ─── Finding 4: recursively traverse nested conditional exports/arrays ──────

describe('Finding4: deriveAllEntryPaths recursively traverses nested exports', () => {
  it('handles nested conditional exports (import → default)', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': {
          import: { default: './dist/index.js' },
          require: './dist/index.cjs',
        },
      },
    };
    const paths = deriveAllEntryPaths(manifest);
    expect(paths).toContain('./dist/index.js');
    expect(paths).toContain('./dist/index.cjs');
  });

  it('handles arrays in conditional exports', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': ['./index.ts', './fallback.js'],
      },
    };
    const paths = deriveAllEntryPaths(manifest);
    expect(paths).toContain('./index.ts');
    expect(paths).toContain('./fallback.js');
  });

  it('handles mixed arrays and condition objects', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': [{ bun: './src/index.ts' }, './dist/index.js'],
      },
    };
    const paths = deriveAllEntryPaths(manifest);
    expect(paths).toContain('./src/index.ts');
    expect(paths).toContain('./dist/index.js');
  });

  it('handles deeply nested condition objects (3 levels)', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': {
          node: {
            import: {
              default: './node-index.js',
            },
          },
          default: './index.js',
        },
      },
    };
    const paths = deriveAllEntryPaths(manifest);
    expect(paths).toContain('./node-index.js');
    expect(paths).toContain('./index.js');
  });

  it('handles subpath exports with nested conditions', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
        './sub.js': {
          import: { default: './dist/sub.js' },
          require: './dist/sub.cjs',
        },
      },
    };
    const paths = deriveAllEntryPaths(manifest);
    expect(paths).toContain('./index.ts');
    expect(paths).toContain('./dist/sub.js');
    expect(paths).toContain('./dist/sub.cjs');
  });

  it('handles arrays in subpath exports', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
        './feature.js': ['./feature.ts', './feature-fallback.ts'],
      },
    };
    const paths = deriveAllEntryPaths(manifest);
    expect(paths).toContain('./index.ts');
    expect(paths).toContain('./feature.ts');
    expect(paths).toContain('./feature-fallback.ts');
  });
});

// ─── Finding 5: symlinked package dirs with root/cycle checks ──────────────

describe('Finding5: discoverPackageWorkspaces rejects unsafe symlinks', () => {
  it('discovers normal (non-symlinked) package directories', () => {
    const { repoRoot, cleanup } = createTempRepo('packages/normal', {
      'package.json': JSON.stringify({ name: 'normal' }),
    });
    try {
      const dirs = discoverPackageWorkspaces(repoRoot);
      expect(dirs).toContain('packages/normal');
    } finally {
      cleanup();
    }
  });

  it('rejects symlinked package directories pointing outside repo root', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-symlink-'));
    const externalDir = mkdtempSync(join(tmpdir(), 'external-'));
    try {
      // Write a valid package.json in the external dir so that the
      // exclusion is due to the symlink crossing the repo root boundary,
      // not a missing manifest.
      writeFileSync(
        join(externalDir, 'package.json'),
        JSON.stringify({ name: 'external-pkg' }),
      );
      // Create packages/ dir with a symlink to external dir
      mkdirSync(join(repoRoot, 'packages'), { recursive: true });
      symlinkSync(
        externalDir,
        join(repoRoot, 'packages', 'evil'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const dirs = discoverPackageWorkspaces(repoRoot);
      // The symlink pointing outside repo root must NOT be discovered
      expect(dirs).not.toContain('packages/evil');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

  it('safely follows symlinks pointing within repo root', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-safe-symlink-'));
    try {
      // Create a real packages/real dir and a symlink packages/linked → real
      mkdirSync(join(repoRoot, 'packages', 'real'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'real', 'package.json'),
        JSON.stringify({ name: 'real' }),
      );
      symlinkSync(
        join(repoRoot, 'packages', 'real'),
        join(repoRoot, 'packages', 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      const dirs = discoverPackageWorkspaces(repoRoot);
      // The symlink within repo root should be safely discovered
      expect(dirs).toContain('packages/linked');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ─── Finding 6: real protocol resolver canonical path + target manifest ────

describe('Finding6: createRealProtocolResolver — canonical path + target manifest', () => {
  it('resolves a file: protocol to the canonical workspace directory and verifies the target manifest name', () => {
    const { repoRoot, cleanup } = createTempRepo('packages/core', {
      'package.json': JSON.stringify({ name: '@scope/core' }),
    });
    try {
      // Also create packages/cli that depends on core via file:
      mkdirSync(join(repoRoot, 'packages', 'cli'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'cli', 'package.json'),
        JSON.stringify({ name: '@scope/cli' }),
      );
      const nameToDir = new Map([['@scope/core', 'packages/core']]);
      const resolver = createRealProtocolResolver(repoRoot, nameToDir);
      const result = resolver('@scope/core', 'file:../core', 'packages/cli');
      expect(result.resolved).toBe(true);
      expect(result.workspaceDir).toBe('packages/core');
    } finally {
      cleanup();
    }
  });

  it('rejects a file: protocol when the target manifest name does not match', () => {
    const { repoRoot, cleanup } = createTempRepo('packages/core', {
      'package.json': JSON.stringify({ name: '@scope/wrong-name' }),
    });
    try {
      // Create a consumer workspace so file: resolution is relative to it
      mkdirSync(join(repoRoot, 'packages', 'cli'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'cli', 'package.json'),
        JSON.stringify({ name: '@scope/cli' }),
      );
      const nameToDir = new Map([['@scope/core', 'packages/core']]);
      const resolver = createRealProtocolResolver(repoRoot, nameToDir);
      const result = resolver('@scope/core', 'file:../core', 'packages/cli');
      // The target manifest's name (@scope/wrong-name) does not match the
      // dependency name (@scope/core), so resolution must fail.
      expect(result.resolved).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('rejects a file: protocol pointing to a non-existent directory', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-proto-'));
    try {
      // Create a consumer workspace so file: resolution is relative to it
      mkdirSync(join(repoRoot, 'packages', 'cli'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'cli', 'package.json'),
        JSON.stringify({ name: '@scope/cli' }),
      );
      const nameToDir = new Map([['@scope/core', 'packages/core']]);
      const resolver = createRealProtocolResolver(repoRoot, nameToDir);
      const result = resolver(
        '@scope/core',
        'file:../nonexistent',
        'packages/cli',
      );
      expect(result.resolved).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects a file: protocol pointing to the wrong workspace', () => {
    const { repoRoot, cleanup } = createTempRepo('packages/core', {
      'package.json': JSON.stringify({ name: '@scope/core' }),
    });
    try {
      mkdirSync(join(repoRoot, 'packages', 'tools'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'tools', 'package.json'),
        JSON.stringify({ name: '@scope/tools' }),
      );
      // Create a consumer workspace so file: resolution is relative to it
      mkdirSync(join(repoRoot, 'packages', 'cli'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'cli', 'package.json'),
        JSON.stringify({ name: '@scope/cli' }),
      );
      const nameToDir = new Map([
        ['@scope/core', 'packages/core'],
        ['@scope/tools', 'packages/tools'],
      ]);
      const resolver = createRealProtocolResolver(repoRoot, nameToDir);
      // file:../tools from packages/cli points to packages/tools, but depName
      // is @scope/core which maps to packages/core — mismatch must be rejected.
      const result = resolver('@scope/core', 'file:../tools', 'packages/cli');
      expect(result.resolved).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('resolves a workspace: protocol to the canonical workspace directory', () => {
    const { repoRoot, cleanup } = createTempRepo('packages/core', {
      'package.json': JSON.stringify({ name: '@scope/core' }),
    });
    try {
      const nameToDir = new Map([['@scope/core', 'packages/core']]);
      const resolver = createRealProtocolResolver(repoRoot, nameToDir);
      const result = resolver('@scope/core', 'workspace:*');
      expect(result.resolved).toBe(true);
      expect(result.workspaceDir).toBe('packages/core');
    } finally {
      cleanup();
    }
  });

  it('resolves a link: protocol to the canonical workspace directory', () => {
    const { repoRoot, cleanup } = createTempRepo('packages/core', {
      'package.json': JSON.stringify({ name: '@scope/core' }),
    });
    try {
      // Create a consumer workspace so file:/link: resolution is relative
      // to the consuming workspace.
      mkdirSync(join(repoRoot, 'packages', 'cli'), { recursive: true });
      writeFileSync(
        join(repoRoot, 'packages', 'cli', 'package.json'),
        JSON.stringify({ name: '@scope/cli' }),
      );
      const nameToDir = new Map([['@scope/core', 'packages/core']]);
      const resolver = createRealProtocolResolver(repoRoot, nameToDir);
      const result = resolver('@scope/core', 'link:../core', 'packages/cli');
      expect(result.resolved).toBe(true);
      expect(result.workspaceDir).toBe('packages/core');
    } finally {
      cleanup();
    }
  });

  it('rejects an unknown package name', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ws-proto-unknown-'));
    try {
      const nameToDir = new Map([['@scope/core', 'packages/core']]);
      const resolver = createRealProtocolResolver(repoRoot, nameToDir);
      const result = resolver('@scope/unknown', 'workspace:*');
      expect(result.resolved).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
