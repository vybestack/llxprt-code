/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the runtime dependency declaration guard (#3305).
 *
 * Every case builds a real synthetic workspace tree on disk under the OS temp
 * directory and calls the guard's exported analysis functions against it, so
 * the assertions are about observable guard output rather than about test
 * doubles.
 */

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type RuntimeDependencyViolation,
  type WorkspaceManifest,
  checkAllWorkspaces,
  checkWorkspaceRuntimeDeclarations,
  collectProductionSourceFiles,
  extractBareRuntimeImports,
  packageNameOf,
} from '../check-runtime-dependency-declarations.ts';

const WORKSPACE_DIR = 'packages/fixture';
const FIXTURE_NAME = '@fixture/pkg';

interface FixtureSpec {
  /** Files relative to the workspace directory. */
  readonly files: Record<string, string>;
  /** Manifest overrides merged over the default fixture manifest. */
  readonly manifest?: Partial<WorkspaceManifest>;
  /** Extra workspaces, keyed by workspace directory. */
  readonly extraWorkspaces?: Record<string, WorkspaceManifest>;
}

interface Fixture {
  readonly repoRoot: string;
  readonly manifest: WorkspaceManifest;
  readonly cleanup: () => void;
}

function writeFileEnsuringDir(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

function writeWorkspace(
  repoRoot: string,
  workspaceDir: string,
  manifest: WorkspaceManifest,
  files: Record<string, string> = {},
): void {
  writeFileEnsuringDir(
    join(repoRoot, workspaceDir, 'package.json'),
    JSON.stringify(manifest, null, 2),
  );
  for (const [relPath, contents] of Object.entries(files)) {
    writeFileEnsuringDir(join(repoRoot, workspaceDir, relPath), contents);
  }
}

/** Build a throwaway repo containing one fixture workspace (plus any extras). */
function createFixture(spec: FixtureSpec): Fixture {
  const repoRoot = mkdtempSync(join(tmpdir(), 'llxprt-3305-guard-'));
  const manifest: WorkspaceManifest = {
    name: FIXTURE_NAME,
    main: 'index.ts',
    exports: { '.': { bun: './index.ts' } },
    ...spec.manifest,
  };
  const extraWorkspaces = spec.extraWorkspaces ?? {};
  writeFileEnsuringDir(
    join(repoRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-root',
        private: true,
        workspaces: [WORKSPACE_DIR, ...Object.keys(extraWorkspaces)],
      },
      null,
      2,
    ),
  );
  writeWorkspace(repoRoot, WORKSPACE_DIR, manifest, spec.files);
  for (const [dir, extraManifest] of Object.entries(extraWorkspaces)) {
    writeWorkspace(repoRoot, dir, extraManifest, {
      'index.ts': "import 'undeclared-by-extra';\n",
    });
  }
  return {
    repoRoot,
    manifest,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

/** Run the guard over the fixture workspace and return its violations. */
function violationsFor(spec: FixtureSpec): RuntimeDependencyViolation[] {
  const fixture = createFixture(spec);
  try {
    return checkWorkspaceRuntimeDeclarations(
      WORKSPACE_DIR,
      fixture.manifest,
      fixture.repoRoot,
    );
  } finally {
    fixture.cleanup();
  }
}

describe('undeclared runtime imports (#3305)', () => {
  it('reports an entrypoint value-import of an undeclared package', () => {
    const violations = violationsFor({
      files: {
        'index.ts':
          "\nimport { thing } from 'undeclared';\nexport { thing };\n",
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('undeclared');
    expect(violations[0].specifier).toBe('undeclared');
    expect(violations[0].file).toBe(`${WORKSPACE_DIR}/index.ts`);
    expect(violations[0].line).toBe(2);
    expect(violations[0].workspaceDir).toBe(WORKSPACE_DIR);
  });

  it('accepts a package declared in dependencies', () => {
    expect(
      violationsFor({
        files: {
          'index.ts': "import { thing } from 'declared';\nexport { thing };\n",
        },
        manifest: { dependencies: { declared: '^1.0.0' } },
      }),
    ).toEqual([]);
  });

  it('accepts a package declared in peerDependencies', () => {
    expect(
      violationsFor({
        files: {
          'index.ts': "import { thing } from 'declared';\nexport { thing };\n",
        },
        manifest: { peerDependencies: { declared: '^1.0.0' } },
      }),
    ).toEqual([]);
  });

  it('accepts a package declared in optionalDependencies', () => {
    expect(
      violationsFor({
        files: {
          'index.ts': "import { thing } from 'declared';\nexport { thing };\n",
        },
        manifest: { optionalDependencies: { declared: '^1.0.0' } },
      }),
    ).toEqual([]);
  });

  it('rejects a package declared only in devDependencies', () => {
    // The exact #3305 shape: consumers never install devDependencies.
    const violations = violationsFor({
      files: {
        'index.ts': "import { thing } from 'devonly';\nexport { thing };\n",
      },
      manifest: { devDependencies: { devonly: '^1.0.0' } },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('devonly');
    expect(violations[0].declaredIn).toEqual(['devDependencies']);
    expect(violations[0].message).toContain('devDependencies');
  });
});

describe('type-only imports are erased and never reported', () => {
  it('ignores import type declarations', () => {
    expect(
      violationsFor({
        files: {
          'index.ts':
            "import type { T } from 'undeclared';\nexport type U = T;\n",
        },
      }),
    ).toEqual([]);
  });

  it('ignores export type re-exports', () => {
    expect(
      violationsFor({
        files: { 'index.ts': "export type { T } from 'undeclared';\n" },
      }),
    ).toEqual([]);
  });

  it('ignores a declaration whose named bindings are all inline-type', () => {
    expect(
      violationsFor({
        files: {
          'index.ts':
            "import { type A, type B } from 'undeclared';\nexport type C = A | B;\n",
        },
      }),
    ).toEqual([]);
  });

  it('reports a declaration mixing an inline-type and a value binding', () => {
    const violations = violationsFor({
      files: {
        'index.ts':
          "import { type A, b } from 'undeclared';\nexport const v: A = b;\n",
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('undeclared');
  });
});

describe('runtime import forms', () => {
  it('reports a bare side-effect import', () => {
    const violations = violationsFor({
      files: { 'index.ts': "import 'undeclared';\nexport const x = 1;\n" },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('undeclared');
  });

  it('reports a dynamic import with a literal specifier', () => {
    const violations = violationsFor({
      files: {
        'index.ts':
          "export async function load() {\n  return await import('undeclared');\n}\n",
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('undeclared');
    expect(violations[0].line).toBe(2);
  });

  it('reports a require call with a literal specifier', () => {
    const violations = violationsFor({
      files: {
        'index.ts': "export const mod = require('undeclared');\n",
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('undeclared');
  });

  it('reports export-star re-exports', () => {
    const violations = violationsFor({
      files: { 'index.ts': "export * from 'undeclared';\n" },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('undeclared');
  });

  it('ignores a dynamic import with a non-literal specifier', () => {
    expect(
      violationsFor({
        files: {
          'index.ts':
            'export async function load(name: string) {\n  return await import(name);\n}\n',
        },
      }),
    ).toEqual([]);
  });
});

describe('specifiers that need no declaration', () => {
  it('ignores node builtins with and without the node: prefix, and bun: modules', () => {
    expect(
      violationsFor({
        files: {
          'index.ts':
            "import { readFileSync } from 'fs';\n" +
            "import { join } from 'node:path';\n" +
            "import { sql } from 'bun:sqlite';\n" +
            'export const used = [readFileSync, join, sql];\n',
        },
      }),
    ).toEqual([]);
  });

  it('ignores an import of the workspace own package name', () => {
    expect(
      violationsFor({
        files: { 'index.ts': `export * from '${FIXTURE_NAME}/sub.js';\n` },
      }),
    ).toEqual([]);
  });
});

describe('specifier to package-name mapping', () => {
  it('attributes an unscoped subpath specifier to its package', () => {
    const violations = violationsFor({
      files: {
        'index.ts':
          "import { x } from 'undeclared/sub/path.js';\nexport { x };\n",
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('undeclared');
    expect(violations[0].specifier).toBe('undeclared/sub/path.js');
  });

  it('attributes a scoped subpath specifier to its scoped package', () => {
    const violations = violationsFor({
      files: {
        'index.ts': "import { x } from '@scope/pkg/sub.js';\nexport { x };\n",
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].importedPackage).toBe('@scope/pkg');
  });

  it('maps specifiers to package names directly', () => {
    expect(packageNameOf('pkg')).toBe('pkg');
    expect(packageNameOf('pkg/sub/deep.js')).toBe('pkg');
    expect(packageNameOf('@scope/pkg')).toBe('@scope/pkg');
    expect(packageNameOf('@scope/pkg/sub.js')).toBe('@scope/pkg');
  });
});

describe('production source is defined by entrypoint reachability', () => {
  it('does not scan a file unreachable from any entrypoint', () => {
    const spec: FixtureSpec = {
      files: {
        'index.ts': 'export const x = 1;\n',
        'src/orphan.ts': "import 'undeclared';\nexport const y = 2;\n",
      },
    };
    expect(violationsFor(spec)).toEqual([]);

    const fixture = createFixture(spec);
    try {
      const files = collectProductionSourceFiles(
        WORKSPACE_DIR,
        fixture.manifest,
        fixture.repoRoot,
      );
      expect(files.some((file) => file.endsWith('orphan.ts'))).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it('scans a file reachable only transitively', () => {
    const violations = violationsFor({
      files: {
        'index.ts': "export * from './src/a.js';\n",
        'src/a.ts': "export * from './b.js';\n",
        'src/b.ts': "import { deep } from 'undeclared';\nexport { deep };\n",
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe(`${WORKSPACE_DIR}/src/b.ts`);
    expect(violations[0].importedPackage).toBe('undeclared');
  });

  it('follows every exports subpath, not just the root entry', () => {
    const violations = violationsFor({
      files: {
        'index.ts': 'export const x = 1;\n',
        'src/extra.ts': "import 'undeclared';\nexport const y = 2;\n",
      },
      manifest: {
        exports: {
          '.': { bun: './index.ts' },
          './extra.js': { bun: './src/extra.ts' },
        },
      },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe(`${WORKSPACE_DIR}/src/extra.ts`);
  });

  it('prefers the bun source condition over build output in main', () => {
    // Every published workspace points `main` at dist/ and the `bun` condition
    // at source. Scanning dist/ would make the guard depend on whether the tree
    // is built and would report each defect twice.
    const fixture = createFixture({
      files: {
        'index.ts': 'export const x = 1;\n',
        'dist/index.js': "import 'undeclared';\nexport const x = 1;\n",
      },
      manifest: {
        main: 'dist/index.js',
        exports: { '.': { bun: './index.ts', import: './dist/index.js' } },
      },
    });
    try {
      const files = collectProductionSourceFiles(
        WORKSPACE_DIR,
        fixture.manifest,
        fixture.repoRoot,
      );
      expect(files.some((file) => file.includes('/dist/'))).toBe(false);
      expect(
        checkWorkspaceRuntimeDeclarations(
          WORKSPACE_DIR,
          fixture.manifest,
          fixture.repoRoot,
        ),
      ).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('falls back to main when the manifest declares no exports', () => {
    const violations = violationsFor({
      files: { 'entry.ts': "import 'undeclared';\nexport const x = 1;\n" },
      manifest: { main: 'entry.ts', exports: undefined },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe(`${WORKSPACE_DIR}/entry.ts`);
  });

  it('resolves the TypeScript .js to .ts import convention', () => {
    const fixture = createFixture({
      files: {
        'index.ts': "export * from './src/impl.js';\n",
        'src/impl.ts': 'export const value = 1;\n',
      },
    });
    try {
      const files = collectProductionSourceFiles(
        WORKSPACE_DIR,
        fixture.manifest,
        fixture.repoRoot,
      );
      expect(files.some((file) => file.endsWith('src/impl.ts'))).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });
});

describe('workspace selection', () => {
  it('skips private workspaces', () => {
    const fixture = createFixture({
      files: { 'index.ts': 'export const x = 1;\n' },
      extraWorkspaces: {
        'packages/privatepkg': {
          name: '@fixture/private',
          private: true,
          main: 'index.ts',
        },
      },
    });
    try {
      expect(checkAllWorkspaces(fixture.repoRoot)).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('skips workspaces the release pipeline does not publish to NPM', () => {
    const fixture = createFixture({
      files: { 'index.ts': 'export const x = 1;\n' },
      extraWorkspaces: {
        'packages/testutils': {
          name: '@vybestack/llxprt-code-test-utils',
          main: 'index.ts',
        },
      },
    });
    try {
      expect(checkAllWorkspaces(fixture.repoRoot)).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('reports violations in a published extra workspace', () => {
    const fixture = createFixture({
      files: { 'index.ts': 'export const x = 1;\n' },
      extraWorkspaces: {
        'packages/published': { name: '@fixture/published', main: 'index.ts' },
      },
    });
    try {
      const violations = checkAllWorkspaces(fixture.repoRoot);
      expect(violations).toHaveLength(1);
      expect(violations[0].workspaceDir).toBe('packages/published');
      expect(violations[0].importedPackage).toBe('undeclared-by-extra');
    } finally {
      fixture.cleanup();
    }
  });
});

describe('extractBareRuntimeImports', () => {
  it('returns specifier, package name, and 1-based line for each bare import', () => {
    const imports = extractBareRuntimeImports(
      '/virtual/example.ts',
      "import { a } from './relative.js';\n" +
        "import { b } from 'node:fs';\n" +
        "import { c } from '@scope/pkg/deep.js';\n" +
        "import { d } from 'plain';\n",
    );
    expect(imports).toEqual([
      { specifier: '@scope/pkg/deep.js', packageName: '@scope/pkg', line: 3 },
      { specifier: 'plain', packageName: 'plain', line: 4 },
    ]);
  });
});
