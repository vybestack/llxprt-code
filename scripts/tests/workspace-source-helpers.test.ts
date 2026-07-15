/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral unit tests for workspace-source-helpers (#2352 Task C).
 *
 * These tests exercise the real helper functions directly (no mocks) to
 * verify that:
 *
 * - Transitive static relative runtime import closure is verified, and
 *   missing transitive source files are detected.
 * - Exported subpaths are verified, and missing subpath entry files are
 *   detected.
 *
 * The tests build small in-memory manifests and packed-path sets to prove
 * the helpers correctly identify missing files.
 *
 * Per RULES.md: tests assert behavior (does the helper report a mismatch?),
 * not implementation details.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type WorkspaceManifest,
  deriveAllEntryPaths,
  verifyTransitiveSourceClosure,
  verifyExportedSubpaths,
  buildPackageNameToWorkspaceMap,
  readWorkspaceManifest,
} from './workspace-source-helpers.ts';

/**
 * Create a temporary repo root with a workspace directory containing source
 * files. Returns the repo root path and a cleanup function.
 */
function createTempRepo(
  workspaceDir: string,
  files: Record<string, string>,
): { repoRoot: string; cleanup: () => void } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ws-src-test-'));
  const fullWsDir = join(repoRoot, workspaceDir);
  mkdirSync(fullWsDir, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(fullWsDir, relPath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }
  return {
    repoRoot,
    cleanup: () => {
      try {
        rmSync(repoRoot, { recursive: true, force: true });
      } catch (error) {
        // Best-effort cleanup; do not mask the actual test failure
        console.error(`Failed to cleanup temp repo ${repoRoot}:`, error);
      }
    },
  };
}

describe('deriveAllEntryPaths', () => {
  it('extracts main entry from exports bun condition', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': {
          bun: './index.ts',
          import: './dist/index.js',
        },
      },
    };
    // Finding4: deriveAllEntryPaths now collects ALL leaf paths from every
    // exports entry, not just the bun condition.
    const paths = deriveAllEntryPaths(manifest);
    expect(paths).toContain('./index.ts');
    expect(paths).toContain('./dist/index.js');
  });

  it('extracts main entry from main field when no exports', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      main: './dist/index.js',
    };
    expect(deriveAllEntryPaths(manifest)).toEqual(['./dist/index.js']);
  });

  it('extracts all exported subpaths', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
        './sub-a.js': { bun: './src/sub-a.ts' },
        './sub-b.js': { bun: './src/sub-b.ts' },
      },
    };
    const paths = deriveAllEntryPaths(manifest);
    expect(paths).toContain('./index.ts');
    expect(paths).toContain('./src/sub-a.ts');
    expect(paths).toContain('./src/sub-b.ts');
  });

  it('skips the dot entry from subpath iteration', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
      },
    };
    // Only the main entry; no subpaths
    expect(deriveAllEntryPaths(manifest)).toEqual(['./index.ts']);
  });
});

describe('verifyTransitiveSourceClosure', () => {
  it('passes when all transitive source files are packed', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
      },
    };
    const { repoRoot, cleanup } = createTempRepo('packages/test-pkg', {
      'index.ts': "import { x } from './helper.js';\nexport const entry = x;\n",
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

  it('fails when a transitive source file is missing from packed set', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
      },
    };
    const { repoRoot, cleanup } = createTempRepo('packages/test-pkg', {
      'index.ts': "import { x } from './helper.js';\nexport const entry = x;\n",
      'helper.ts': 'export const x = 42;\n',
    });
    try {
      // helper.ts exists on disk but is NOT in the packed set
      const packed = new Set(['packages/test-pkg/index.ts']);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      expect(missing).toHaveLength(1);
      expect(missing[0].missingFile).toContain('helper.ts');
    } finally {
      cleanup();
    }
  });

  it('fails when a deep transitive dependency is missing', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
      },
    };
    const { repoRoot, cleanup } = createTempRepo('packages/test-pkg', {
      'index.ts': "import { a } from './a.js';\nexport { a };\n",
      'a.ts': "import { b } from './b.js';\nexport const a = b;\n",
      'b.ts': 'export const b = 42;\n',
    });
    try {
      // b.ts exists on disk but is NOT packed
      const packed = new Set([
        'packages/test-pkg/index.ts',
        'packages/test-pkg/a.ts',
      ]);
      const missing = verifyTransitiveSourceClosure(
        'packages/test-pkg',
        manifest,
        packed,
        repoRoot,
      );
      expect(missing).toHaveLength(1);
      expect(missing[0].missingFile).toContain('b.ts');
    } finally {
      cleanup();
    }
  });

  it('follows imports through subdirectories', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
      },
    };
    const { repoRoot, cleanup } = createTempRepo('packages/test-pkg', {
      'index.ts':
        "import { deep } from './src/deep/deepValue.js';\nexport { deep };\n",
      'src/deep/deepValue.ts': 'export const deep = 42;\n',
    });
    try {
      const packed = new Set([
        'packages/test-pkg/index.ts',
        'packages/test-pkg/src/deep/deepValue.ts',
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
});

describe('verifyExportedSubpaths', () => {
  it('passes when all exported subpath entry files are packed', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
        './sub-a.js': { bun: './src/sub-a.ts' },
        './sub-b.js': { bun: './src/sub-b.ts' },
      },
    };
    const packed = new Set([
      'packages/test-pkg/index.ts',
      'packages/test-pkg/src/sub-a.ts',
      'packages/test-pkg/src/sub-b.ts',
    ]);
    const missing = verifyExportedSubpaths(
      'packages/test-pkg',
      manifest,
      packed,
    );
    expect(missing).toEqual([]);
  });

  it('fails when an exported subpath entry file is missing', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
        './sub-a.js': { bun: './src/sub-a.ts' },
        './sub-b.js': { bun: './src/sub-b.ts' },
      },
    };
    // sub-b.ts is missing from the packed set
    const packed = new Set([
      'packages/test-pkg/index.ts',
      'packages/test-pkg/src/sub-a.ts',
    ]);
    const missing = verifyExportedSubpaths(
      'packages/test-pkg',
      manifest,
      packed,
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].entry).toBe('./sub-b.js');
    expect(missing[0].missingFile).toContain('sub-b.ts');
  });

  it('skips the dot entry (handled by main entry check)', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      exports: {
        '.': { bun: './index.ts' },
      },
    };
    // Even if index.ts is missing, verifyExportedSubpaths should return empty
    // because the dot entry is NOT a subpath.
    const packed = new Set<string>();
    const missing = verifyExportedSubpaths(
      'packages/test-pkg',
      manifest,
      packed,
    );
    expect(missing).toEqual([]);
  });

  it('returns empty when no exports map exists', () => {
    const manifest: WorkspaceManifest = {
      name: 'test-pkg',
      main: './dist/index.js',
    };
    const packed = new Set<string>();
    expect(
      verifyExportedSubpaths('packages/test-pkg', manifest, packed),
    ).toEqual([]);
  });
});

describe('buildPackageNameToWorkspaceMap', () => {
  it('maps package names to workspace directories', () => {
    const { repoRoot, cleanup } = createTempRepo('packages/core', {
      'package.json': JSON.stringify({ name: '@scope/core' }),
    });
    try {
      const map = buildPackageNameToWorkspaceMap(repoRoot, ['packages/core']);
      expect(map.get('@scope/core')).toBe('packages/core');
    } finally {
      cleanup();
    }
  });

  it('skips workspaces without package.json', () => {
    const { repoRoot, cleanup } = createTempRepo('packages/empty', {});
    try {
      const map = buildPackageNameToWorkspaceMap(repoRoot, ['packages/empty']);
      expect(map.size).toBe(0);
    } finally {
      cleanup();
    }
  });
});

describe('readWorkspaceManifest', () => {
  it('reads a valid workspace manifest', () => {
    const { repoRoot, cleanup } = createTempRepo('packages/core', {
      'package.json': JSON.stringify({
        name: '@scope/core',
        main: './dist/index.js',
        exports: { '.': { bun: './index.ts' } },
      }),
    });
    try {
      const manifest = readWorkspaceManifest('packages/core', repoRoot);
      expect(manifest).not.toBeNull();
      expect(manifest!.name).toBe('@scope/core');
      expect(manifest!.main).toBe('./dist/index.js');
    } finally {
      cleanup();
    }
  });

  it('returns null for a workspace without package.json', () => {
    const { repoRoot, cleanup } = createTempRepo('packages/empty', {});
    try {
      expect(readWorkspaceManifest('packages/empty', repoRoot)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('throws with contextual path when package.json is malformed JSON', () => {
    const { repoRoot, cleanup } = createTempRepo('packages/broken', {
      'package.json': '{ "name": ',
    });
    try {
      expect(() => readWorkspaceManifest('packages/broken', repoRoot)).toThrow(
        join(repoRoot, 'packages/broken', 'package.json'),
      );
    } finally {
      cleanup();
    }
  });
});
