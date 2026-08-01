/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import fg from 'fast-glob';
import { createRequire } from 'node:module';
import {
  classifyTestFile,
  buildTestGroups,
  PACKAGE_ROOT,
  SELECTED_FILE_COUNT,
  BASE_EXCLUDE_PATTERNS,
  EXPLICIT_INCLUDE_PATTERNS,
  type TestFileKind,
} from './vitest.test-groups.js';

interface Micromatch {
  isMatch(filepath: string, patterns: readonly string[]): boolean;
}

const require = createRequire(import.meta.url);
const micromatch: Micromatch = require('micromatch');

/**
 * Behavioral tests for the private config-only test-group classifier.
 *
 * These tests prove the *contract*:
 *   - Files are classified by real syntactic runtime imports (TS compiler API),
 *     not source-text regex that matches comments/strings.
 *   - Files importing the local test-utils/render helper route to react-ink-node
 *     (or jsdom if they also have DOM deps).
 *   - Groups are exhaustive and disjoint over the discovered selected set.
 *   - Classification and discovery are package-root-relative, not cwd-dependent.
 *   - The node groups declare 'node' environment; jsdom group declares 'jsdom'.
 *   - Special-selection semantics (exclusions, re-inclusions, multi-runtime argv)
 *     are preserved.
 *
 * Independent oracle: selected-file count is cross-checked against a separate,
 * minimal glob invocation in this test file rather than comparing the helper
 * to itself.
 */

function oracleSelectedCount(): number {
  const all = fg.globSync(
    ['**/*.{test,spec}.?(c|m)[jt]s?(x)', 'config.test.ts'],
    {
      cwd: PACKAGE_ROOT,
      onlyFiles: true,
      absolute: false,
      dot: false,
      ignore: ['**/node_modules/**', '**/dist/**'],
    },
  );
  // Explicit re-include entries carve out specific excluded files, so they
  // bypass the exclude filter — matching discoverTestFiles semantics.
  const explicitSet = new Set(EXPLICIT_INCLUDE_PATTERNS);
  const candidates = [...all, ...EXPLICIT_INCLUDE_PATTERNS];
  const filtered = candidates.filter(
    (f) => explicitSet.has(f) || !micromatch.isMatch(f, BASE_EXCLUDE_PATTERNS),
  );
  const existing = filtered.filter((f) => existsSync(resolve(PACKAGE_ROOT, f)));
  return new Set(existing).size;
}

// ---------------------------------------------------------------------------
// 1. Source-requirement routing (syntactic import analysis)
// ---------------------------------------------------------------------------

describe('classifyTestFile — real syntactic import routing', () => {
  it('routes a file with a real @vitest-environment jsdom pragma to jsdom', () => {
    const file = resolve(
      PACKAGE_ROOT,
      'src/ui/hooks/useFlickerDetector.test.ts',
    );
    expect(classifyTestFile(file)).toBe<TestFileKind>('jsdom');
  });

  it('routes a file that imports react-dom to jsdom', () => {
    const file = resolve(
      PACKAGE_ROOT,
      'src/ui/hooks/useAgentStream.thinking.test.tsx',
    );
    expect(classifyTestFile(file)).toBe<TestFileKind>('jsdom');
  });

  it('routes a file importing @testing-library/react to jsdom', () => {
    const file = resolve(PACKAGE_ROOT, 'src/ui/hooks/useToolScheduler.test.ts');
    expect(classifyTestFile(file)).toBe<TestFileKind>('jsdom');
  });

  it('routes a file importing ink-testing-library (direct) to react-ink-node', () => {
    const file = resolve(
      PACKAGE_ROOT,
      'src/ui/components/messages/ToolResultDisplay.test.tsx',
    );
    expect(classifyTestFile(file)).toBe<TestFileKind>('react-ink-node');
  });

  it('routes a file importing the local test-utils/render helper to react-ink-node', () => {
    const file = resolve(PACKAGE_ROOT, 'src/ui/hooks/useResponsive.test.ts');
    expect(classifyTestFile(file)).toBe<TestFileKind>('react-ink-node');
  });

  it('routes a pure node test file (no React/Ink/DOM/render) to pure-node', () => {
    const file = resolve(PACKAGE_ROOT, 'src/cli.test.tsx');
    expect(classifyTestFile(file)).toBe<TestFileKind>('pure-node');
  });
});

// ---------------------------------------------------------------------------
// 2. Comment / string / type-only false-positive immunity (finding 4)
// ---------------------------------------------------------------------------

describe('classifyTestFile — ignores comments, strings, and type-only imports', () => {
  it('does NOT classify this very test file as jsdom despite mentioning jsdom/react-dom in descriptions', () => {
    const self = resolve(PACKAGE_ROOT, 'vitest.test-groups.test.ts');
    expect(classifyTestFile(self)).toBe<TestFileKind>('pure-node');
  });

  it('this file contains trigger strings in comments/descriptions yet stays pure-node', () => {
    const self = resolve(PACKAGE_ROOT, 'vitest.test-groups.test.ts');
    const content = readFileSync(self, 'utf8');
    expect(content).toContain('react-dom');
    expect(content).toContain('@vitest-environment');
    expect(classifyTestFile(self)).toBe<TestFileKind>('pure-node');
  });

  it('keeps a default React import when named imports are type-only', () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'llxprt-test-groups-'));
    const fixturePath = join(fixtureDirectory, 'mixed-react-import.test.tsx');
    try {
      writeFileSync(
        fixturePath,
        "import React, { type ReactNode } from 'react';\nvoid React;\nexport type Node = ReactNode;\n",
      );
      expect(classifyTestFile(fixturePath)).toBe<TestFileKind>(
        'react-ink-node',
      );
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Exhaustive and disjoint routing
// ---------------------------------------------------------------------------

describe('buildTestGroups — exhaustive and disjoint routing', () => {
  it('produces exactly three disjoint groups with distinct names', () => {
    const groups = buildTestGroups();
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.name).sort()).toEqual([
      'jsdom',
      'pure-node',
      'react-ink-node',
    ]);
  });

  it('declares two environments (node for pure-node/react-ink, jsdom for jsdom)', () => {
    const environments = new Set(buildTestGroups().map((g) => g.environment));
    expect(environments.size).toBe(2);
    expect(environments.has('node')).toBe(true);
    expect(environments.has('jsdom')).toBe(true);
  });

  it('assigns the pure-node group node environment and base setup', () => {
    const pure = buildTestGroups().find((g) => g.name === 'pure-node');
    expect(pure?.environment).toBe('node');
    expect(pure?.setupFile.endsWith('test-setup-base.ts')).toBe(true);
  });

  it('assigns the react-ink-node group node environment and full setup', () => {
    const ri = buildTestGroups().find((g) => g.name === 'react-ink-node');
    expect(ri?.environment).toBe('node');
    expect(ri?.setupFile.endsWith('test-setup.ts')).toBe(true);
  });

  it('assigns the jsdom group jsdom environment and full setup', () => {
    const js = buildTestGroups().find((g) => g.name === 'jsdom');
    expect(js?.environment).toBe('jsdom');
    expect(js?.setupFile.endsWith('test-setup.ts')).toBe(true);
  });

  it('produces groups that are exhaustive and disjoint over the selected set', () => {
    const groups = buildTestGroups();
    const allRouted = groups.flatMap((g) => g.testFiles);
    expect(allRouted.length).toBe(new Set(allRouted).size);
    for (const g of groups) {
      expect(g.testFiles.length).toBeGreaterThan(0);
    }
  });

  it('selects exactly the expected number of files (baseline + this test)', () => {
    const groups = buildTestGroups();
    const total = groups.reduce((sum, g) => sum + g.testFiles.length, 0);
    expect(total).toBe(SELECTED_FILE_COUNT);
  });
});

// ---------------------------------------------------------------------------
// 4. Specific known-file placement
// ---------------------------------------------------------------------------

describe('buildTestGroups — known file placement', () => {
  function ownerOf(relPath: string): readonly string[] {
    const groups = buildTestGroups();
    return groups
      .filter((g) => g.testFiles.includes(relPath))
      .map((g) => g.name);
  }

  it('places a known jsdom-pragma file only in jsdom', () => {
    expect(ownerOf('src/ui/hooks/useFlickerDetector.test.ts')).toEqual([
      'jsdom',
    ]);
  });

  it('places a known react-dom-importing file only in jsdom', () => {
    expect(ownerOf('src/ui/hooks/useAgentStream.thinking.test.tsx')).toEqual([
      'jsdom',
    ]);
  });

  it('places a known ink-testing-library file only in react-ink-node', () => {
    expect(
      ownerOf('src/ui/components/messages/ToolResultDisplay.test.tsx'),
    ).toEqual(['react-ink-node']);
  });

  it('places a known pure-node file only in pure-node', () => {
    expect(ownerOf('src/cli.test.tsx')).toEqual(['pure-node']);
  });

  it('places a known render-helper-importing file only in react-ink-node', () => {
    expect(ownerOf('src/ui/hooks/useResponsive.test.ts')).toEqual([
      'react-ink-node',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5. All render-helper-importing selected files route away from pure-node (finding 1)
// ---------------------------------------------------------------------------

describe('buildTestGroups — all test-utils/render imports route away from pure-node', () => {
  const renderFiles: readonly string[] = [
    'src/ui/components/messages/ProfileChangeMessage.test.tsx',
    'src/ui/__tests__/AppContainer.render-budget.test.tsx',
    'src/ui/__tests__/AppContainer.keybindings.test.tsx',
    'src/ui/__tests__/AppContainer.mount.test.tsx',
    'src/ui/hooks/useSlashCompletion.extensions.test.tsx',
    'src/ui/hooks/usePrivacySettings.test.tsx',
    'src/ui/hooks/useResponsive.test.ts',
    'src/ui/hooks/useMouseClick.test.ts',
    'src/ui/hooks/useBanner.test.ts',
    'src/ui/hooks/useExtensionUpdates.test.tsx',
    'src/ui/hooks/useStaticHistoryRefresh.test.ts',
    'src/ui/hooks/useStableCallback.test.ts',
    'src/ui/hooks/useOAuthOrchestration.spec.ts',
    'src/ui/hooks/__tests__/useSessionBrowser.spec.ts',
    'src/ui/hooks/__tests__/useSessionBrowser.part6.spec.ts',
    'src/ui/hooks/__tests__/useSessionBrowser.part5.spec.ts',
    'src/ui/hooks/__tests__/useSessionBrowser.part4.spec.ts',
    'src/ui/hooks/__tests__/useSessionBrowser.part2.spec.ts',
    'src/ui/hooks/__tests__/useSessionBrowser.part3.spec.ts',
    'src/ui/hooks/useMemoryMonitor.test.tsx',
    'src/ui/containers/AppContainer/hooks/useSlashCommandActions.test.ts',
    'src/ui/containers/AppContainer/hooks/useModelRuntimeSync.test.ts',
    'src/ui/containers/AppContainer/hooks/useShellFocusAutoReset.test.ts',
  ];

  it('all 23 render-importing files are in react-ink-node or jsdom, never pure-node', () => {
    const pureNodeFiles = new Set(
      buildTestGroups().find((g) => g.name === 'pure-node')?.testFiles ?? [],
    );
    for (const rel of renderFiles) {
      expect(
        pureNodeFiles.has(rel),
        `render-importing file ${rel} must not be pure-node`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Preserved special-selection semantics (finding AC8)
// ---------------------------------------------------------------------------

describe('buildTestGroups — preserved special-selection semantics', () => {
  it('excludes the same broad React-19 patterns', () => {
    const allRouted = buildTestGroups().flatMap((g) => g.testFiles);
    expect(
      allRouted.includes('src/ui/components/messages/AiMessage.test.tsx'),
    ).toBe(false);
  });

  it('re-includes carve-out test files from explicit include entries', () => {
    const allRouted = buildTestGroups().flatMap((g) => g.testFiles);
    for (const rel of [
      'src/ui/hooks/useToolScheduler.test.ts',
      'src/ui/commands/directoryCommand.test.tsx',
      'src/ui/components/messages/OAuthUrlMessage.test.tsx',
      'src/ui/components/PoliciesDialog.test.tsx',
    ]) {
      expect(allRouted).toContain(rel);
    }
  });

  it('includes integration tests only with multi-runtime guardrail argv', () => {
    const normalAll = buildTestGroups().flatMap((g) => g.testFiles);
    const integrationRel =
      'src/integration-tests/modelParams.integration.test.ts';
    expect(normalAll.includes(integrationRel)).toBe(false);

    const guardrailAll = buildTestGroups({
      multiRuntimeGuardrail: true,
    }).flatMap((g) => g.testFiles);
    expect(guardrailAll.includes(integrationRel)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Package-root-relative, cwd-independent behavior (finding 2 + 9)
// ---------------------------------------------------------------------------

describe('package-root and cwd independence', () => {
  it('PACKAGE_ROOT is resolved from import.meta.url, not process.cwd()', () => {
    expect(basename(PACKAGE_ROOT)).toBe('cli');
    expect(basename(dirname(PACKAGE_ROOT))).toBe('packages');
  });

  it('group test paths are normalized forward-slash package-relative', () => {
    for (const g of buildTestGroups()) {
      for (const f of g.testFiles) {
        expect(f).not.toContain('\\');
        expect(f).not.toMatch(/^\/|^[A-Z]:\\/);
      }
    }
  });

  it('classification works regardless of process.cwd()', () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpdir());
      const file = resolve(PACKAGE_ROOT, 'src/ui/hooks/useResponsive.test.ts');
      expect(classifyTestFile(file)).toBe<TestFileKind>('react-ink-node');
    } finally {
      process.chdir(originalCwd);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Node-project environment has no DOM/React globals (finding 5)
// ---------------------------------------------------------------------------

describe('pure-node runtime environment has no React globals', () => {
  it('this process has no React global (pure-node does not import React)', () => {
    expect((globalThis as Record<string, unknown>).React).toBeUndefined();
  });

  it('this process has no ReactSharedInternals global', () => {
    expect(
      (globalThis as Record<string, unknown>).ReactSharedInternals,
    ).toBeUndefined();
  });

  it('pure-node group declares node environment and base setup (no React)', () => {
    const pure = buildTestGroups().find((g) => g.name === 'pure-node');
    expect(pure?.environment).toBe('node');
    expect(pure?.setupFile.endsWith('test-setup-base.ts')).toBe(true);
  });

  it('react-ink-node group declares node environment and full setup', () => {
    const ri = buildTestGroups().find((g) => g.name === 'react-ink-node');
    expect(ri?.environment).toBe('node');
    expect(ri?.setupFile.endsWith('test-setup.ts')).toBe(true);
  });

  it('jsdom group declares jsdom environment and full setup', () => {
    const js = buildTestGroups().find((g) => g.name === 'jsdom');
    expect(js?.environment).toBe('jsdom');
    expect(js?.setupFile.endsWith('test-setup.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Independent baseline selection oracle (finding 5)
// ---------------------------------------------------------------------------

describe('independent selection oracle', () => {
  it('helper selected count matches independent glob oracle', () => {
    const oracleCount = oracleSelectedCount();
    const helperCount = buildTestGroups().reduce(
      (s, g) => s + g.testFiles.length,
      0,
    );
    expect(helperCount).toBe(oracleCount);
  });
});
