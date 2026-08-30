/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3221 — a2a-server fail-closed import boundary.
 *
 * Two layers are pinned here:
 *
 * 1. The PRODUCTION TypeScript-AST checker
 *    (scripts/a2a-boundary/a2aBoundary.ts, run by
 *    `npm run lint:a2a-boundary` in CI) — exercised directly against
 *    synthetic sources covering every known bypass class: legacy runtime
 *    reach-through symbols imported from an allowed ROOT (Config,
 *    AgentClient), absolute specifiers, prefix lookalikes (@a2a-js/sdkish),
 *    runner subpaths (bun:test/foo), runtime deep subpaths, dynamic imports
 *    of undeclared packages, and non-literal dynamic imports / vi.mock calls.
 *    It then runs the real scan over packages/a2a-server and asserts zero
 *    violations.
 *
 * 2. The ESLint no-restricted-imports fail-closed block in eslint.config.js —
 *    still present, still scoped to the a2a tree, so editors flag violations
 *    before CI does.
 */

import { describe, expect, it } from 'bun:test';
import { resolve, join as joinForSynthetic } from 'node:path';
import config from '../../eslint.config.js';
import {
  evaluateSpecifier,
  scanSourceText,
  scanA2aBoundary,
  RUNTIME_ROOT_PACKAGES,
} from '../a2a-boundary/a2aBoundary.ts';

const REPO_ROOT = resolve(import.meta.dir, '..', '..');
const PRODUCTION_DEPENDENCIES = [
  '@a2a-js/sdk',
  '@google-cloud/storage',
  '@vybestack/llxprt-code-agents',
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-mcp',
  '@vybestack/llxprt-code-storage',
  'dotenv',
  'express',
  'fs-extra',
  'strip-json-comments',
  'tar',
  'uuid',
  'winston',
] as const;

const TEST_FILE_DEPENDENCIES = [...PRODUCTION_DEPENDENCIES] as const;
const NL = '\n';

describe('issue #3221: a2a-server fail-closed import boundary (AST checker)', () => {
  it('synthetic allowed specifiers evaluate clean', () => {
    const allowed = [
      'node:fs',
      'node:path',
      './types.js',
      '../config/config.js',
      'bun:test',
      '@a2a-js/sdk',
      '@a2a-js/sdk/server',
      '@a2a-js/sdk/server/express',
      '@google-cloud/storage',
      ...RUNTIME_ROOT_PACKAGES,
      'dotenv',
      'express',
      'express/lib/router',
      'fs-extra',
      'strip-json-comments',
      'tar',
      'uuid',
      'winston',
    ];
    for (const specifier of allowed) {
      const evaluation = evaluateSpecifier(specifier, PRODUCTION_DEPENDENCIES);
      expect(
        evaluation.allowed,
        `expected allowed: ${specifier} (${evaluation.reason})`,
      ).toBe(true);
    }
  });

  it('test-only devDependencies are rejected in production but allowed for test files', () => {
    expect(
      evaluateSpecifier('supertest', PRODUCTION_DEPENDENCIES).allowed,
    ).toBe(false);
    expect(
      evaluateSpecifier('supertest', [...PRODUCTION_DEPENDENCIES, 'supertest'])
        .allowed,
    ).toBe(true);
  });

  it('synthetic prohibited specifiers are rejected (bypass classes)', () => {
    const prohibited: Array<{ specifier: string; why: string }> = [
      {
        specifier: '/Users/attacker/core/src/core/client.js',
        why: 'absolute specifier',
      },
      {
        specifier: '@a2a-js/sdkish',
        why: 'prefix lookalike of the A2A SDK',
      },
      {
        specifier: '@a2a-js/sdk-evil',
        why: 'prefix lookalike of the A2A SDK',
      },
      { specifier: 'bun:test/foo', why: 'runner subpath lookalike' },
      { specifier: 'bun:testish', why: 'runner lookalike' },
      {
        specifier: '@vybestack/llxprt-code-core/src/core/client.js',
        why: 'runtime deep subpath',
      },
      {
        specifier: '@vybestack/llxprt-code-agents/src/internal/scheduler.js',
        why: 'runtime deep subpath',
      },
      {
        specifier: '@vybestack/llxprt-code-storage/dist/src/backends/gcs.js',
        why: 'runtime deep subpath',
      },
      {
        specifier: '@vybestack/llxprt-code-cli',
        why: 'implementation package',
      },
      {
        specifier: '@vybestack/llxprt-code-providers',
        why: 'implementation package',
      },
      {
        specifier: '@anthropic-ai/sdk',
        why: 'provider SDK',
      },
      { specifier: 'openai', why: 'provider SDK' },
      { specifier: 'lodash', why: 'undeclared module' },
      { specifier: 'left-pad', why: 'undeclared module' },
      { specifier: 'node:test', why: 'non-bun test runner' },
    ];
    for (const { specifier, why } of prohibited) {
      const evaluation = evaluateSpecifier(specifier, PRODUCTION_DEPENDENCIES);
      expect(
        evaluation.allowed,
        `expected rejection (${why}): ${specifier}`,
      ).toBe(false);
    }
  });

  it('synthetic sources: every bypass class is caught by the scanner', () => {
    const sources: Array<{ relFile: string; source: string; expect: string }> =
      [
        {
          relFile: 'src/evil/reachThrough.ts',
          source:
            "import { Config, AgentClient } from '@vybestack/llxprt-code-core';\n" +
            'export const x = 1;\n',
          expect: 'banned-symbol',
        },
        {
          relFile: 'src/evil/absolute.ts',
          source:
            "import { x } from '/Users/x/repo/packages/core/src/index.js';\n" +
            'export { x };\n',
          expect: 'absolute',
        },
        {
          relFile: 'src/evil/lookalike.ts',
          source: "import { a } from '@a2a-js/sdkish';\nexport { a };\n",
          expect: 'lookalike',
        },
        {
          relFile: 'src/evil/deep.ts',
          source:
            "import { c } from '@vybestack/llxprt-code-core/src/core/client.js';\nexport { c };\n",
          expect: 'deep subpath',
        },
        {
          relFile: 'src/evil/dynamic.ts',
          source: "const m = await import('lodash');\nexport { m };\n",
          expect: 'dynamic undeclared',
        },
        {
          relFile: 'src/evil/nonliteral.ts',
          source: 'const m = await import(someVar);\nexport { m };\n',
          expect: 'non-literal dynamic import',
        },
        {
          relFile: 'src/evil/mockTheater.ts',
          source: 'vi.mock(someVar);\nexport {};\n',
          expect: 'non-literal vi.mock',
        },
      ];
    for (const { relFile, source, expect: label } of sources) {
      const violations = scanSourceText(
        relFile,
        source,
        PRODUCTION_DEPENDENCIES,
      );
      expect(
        violations.length,
        `expected a violation for: ${label} (${relFile})`,
      ).toBeGreaterThan(0);
    }
  });

  it('synthetic sources: the mock-family call surface is evaluated or rejected', () => {
    const ROOT = '@vybestack/llxprt-code-core';
    const rejected: Array<{ label: string; source: string; kind: string }> = [
      {
        label: 'literal vi.mock of a runtime deep subpath',
        source:
          "vi.mock('" +
          ROOT +
          "/src/core/client.js');" +
          NL +
          'export {};' +
          NL,
        kind: 'vi.mock',
      },
      {
        label: 'literal vi.doMock of an undeclared module',
        source: "vi.doMock('lodash');" + NL + 'export {};' + NL,
        kind: 'vi.mock',
      },
      {
        label: 'literal bare mock() alias of a runtime deep subpath',
        source:
          "mock('" + ROOT + "/src/core/client.js');" + NL + 'export {};' + NL,
        kind: 'vi.mock',
      },
      {
        label: 'literal vi.importActual reach into a runtime deep subpath',
        source:
          "const m = await vi.importActual('" +
          ROOT +
          "/src/core/client.js');" +
          NL +
          'export { m };' +
          NL,
        kind: 'vi.mock',
      },
      {
        label: 'non-literal vi.doMock',
        source: 'vi.doMock(someVar);' + NL + 'export {};' + NL,
        kind: 'vi.mock-non-literal',
      },
      {
        label: 'non-literal bare mock() alias',
        source:
          'const spec = compute();' +
          NL +
          'mock(spec);' +
          NL +
          'export {};' +
          NL,
        kind: 'vi.mock-non-literal',
      },
      {
        label: 'non-literal vi.importMock',
        source:
          'const m = await vi.importMock(spec);' + NL + 'export { m };' + NL,
        kind: 'vi.mock-non-literal',
      },
    ];
    for (const { label, source, kind } of rejected) {
      const violations = scanSourceText(
        'src/evil/mockFamily.ts',
        source,
        PRODUCTION_DEPENDENCIES,
      );
      expect(
        violations.some((v) => v.kind === kind),
        'expected a ' + kind + ' violation for: ' + label,
      ).toBe(true);
    }

    // The mocking escape hatch stays open for declared test-time modules.
    const legal = scanSourceText(
      'src/ok/mockFamily.test.ts',
      "vi.mock('bun:test');" +
        NL +
        "vi.doMock('node:fs');" +
        NL +
        'export {};' +
        NL,
      TEST_FILE_DEPENDENCIES,
    );
    expect(legal).toHaveLength(0);
  });

  it('synthetic sources: CommonJS require() calls are evaluated or rejected', () => {
    const ROOT = '@vybestack/llxprt-code-core';
    const rejected: Array<{ label: string; source: string; kind: string }> = [
      {
        label: 'require of a runtime deep subpath',
        source:
          "const c = require('" +
          ROOT +
          "/src/core/client.js');" +
          NL +
          'export { c };' +
          NL,
        kind: 'require',
      },
      {
        label: 'require of an undeclared module',
        source: "const l = require('lodash');" + NL + 'export { l };' + NL,
        kind: 'require',
      },
      {
        label: 'non-literal require',
        source: 'const m = require(spec);' + NL + 'export { m };' + NL,
        kind: 'require-non-literal',
      },
      {
        label: 'require of a runtime root (namespace binding)',
        source:
          "const ns = require('" + ROOT + "');" + NL + 'export { ns };' + NL,
        kind: 'runtime-root-form',
      },
    ];
    for (const { label, source, kind } of rejected) {
      const violations = scanSourceText(
        'src/evil/requireCalls.ts',
        source,
        PRODUCTION_DEPENDENCIES,
      );
      expect(
        violations.some((v) => v.kind === kind),
        'expected a ' + kind + ' violation for: ' + label,
      ).toBe(true);
    }

    // require of node builtins stays legal.
    const legal = scanSourceText(
      'src/ok/requireCalls.ts',
      "const fs = require('node:fs');" + NL + 'export { fs };' + NL,
      PRODUCTION_DEPENDENCIES,
    );
    expect(legal).toHaveLength(0);
  });

  it('synthetic sources: un-constrainable runtime-root forms are rejected', () => {
    const ROOT = '@vybestack/llxprt-code-core';
    const forms: Array<{
      label: string;
      source: string;
      kind: string;
    }> = [
      {
        label: 'namespace import',
        source: `import * as core from '${ROOT}';\nexport const c = core.Config;\n`,
        kind: 'runtime-root-form',
      },
      {
        label: 'default import',
        source: `import core from '${ROOT}';\nexport { core };\n`,
        kind: 'runtime-root-form',
      },
      {
        label: 'import-equals',
        source: `import core = require('${ROOT}');\nexport { core };\n`,
        kind: 'runtime-root-form',
      },
      {
        label: 'dynamic import of runtime root',
        source: `const m = await import('${ROOT}');\nexport { m };\n`,
        kind: 'runtime-root-form',
      },
      {
        label: 'export star from runtime root',
        source: `export * from '${ROOT}';\n`,
        kind: 'runtime-root-form',
      },
      {
        label: 'namespace re-export from runtime root',
        source: `export * as core from '${ROOT}';\n`,
        kind: 'runtime-root-form',
      },
      {
        label: 'named re-export of a banned symbol',
        source: `export { Config } from '${ROOT}';\n`,
        kind: 'banned-symbol',
      },
      {
        label: 'aliased named re-export of a banned symbol',
        source: `export { AgentClient as AC } from '${ROOT}';\n`,
        kind: 'banned-symbol',
      },
      {
        label: 'default-alias import of a banned symbol',
        source: `import { default as Config } from '${ROOT}';\nexport { Config };\n`,
        kind: 'banned-symbol',
      },
      {
        label: 'default-alias re-export of a banned symbol',
        source: `export { default as AgentClient } from '${ROOT}';\n`,
        kind: 'banned-symbol',
      },
    ];
    for (const { label, source, kind } of forms) {
      const violations = scanSourceText(
        'src/evil/rootForm.ts',
        source,
        PRODUCTION_DEPENDENCIES,
      );
      expect(
        violations.some((v) => v.kind === kind),
        `expected a ${kind} violation for: ${label}`,
      ).toBe(true);
    }

    // Fail-closed only where symbols cannot be constrained: side-effect
    // imports and named imports of allowed symbols stay legal.
    const legalForms = [
      `import '${ROOT}';\n`,
      `import { GitService } from '${ROOT}';\nexport { GitService };\n`,
      `export { GitService } from '${ROOT}';\n`,
    ];
    for (const source of legalForms) {
      expect(
        scanSourceText('src/ok/rootForm.ts', source, PRODUCTION_DEPENDENCIES),
        `expected no violations for: ${source}`,
      ).toEqual([]);
    }
  });

  it('the real a2a-server tree has zero violations', () => {
    const result = scanA2aBoundary(
      resolve(REPO_ROOT, 'packages', 'a2a-server'),
    );
    expect(result.fileCount).toBeGreaterThan(20);
    expect(result.violations).toEqual([]);
  });

  it('scanA2aBoundary scopes devDependencies to test files only', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import(
      'node:fs'
    );
    const { tmpdir } = await import('node:os');
    const synthetic = mkdtempSync(joinForSynthetic(tmpdir(), 'a2a-scope-'));
    try {
      // supertest is declared ONLY as a devDependency.
      writeFileSync(
        joinForSynthetic(synthetic, 'package.json'),
        JSON.stringify({
          dependencies: { express: '^5.0.0' },
          devDependencies: { supertest: '^7.0.0' },
        }),
      );
      mkdirSync(joinForSynthetic(synthetic, 'src'));
      writeFileSync(
        joinForSynthetic(synthetic, 'src', 'prod.ts'),
        "import request from 'supertest';\n",
      );
      writeFileSync(
        joinForSynthetic(synthetic, 'src', 'prod.test.ts'),
        "import request from 'supertest';\n",
      );

      const result = scanA2aBoundary(synthetic);
      expect(result.fileCount).toBe(2);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].file).toBe('src/prod.ts');
      expect(result.violations[0].kind).toBe('static-import');
      expect(result.violations[0].detail).toBe('supertest');
    } finally {
      rmSync(synthetic, { recursive: true, force: true });
    }
  });
});

describe('issue #3221: a2a-server fail-closed ESLint layer', () => {
  it('the no-restricted-imports fail-closed block exists in the flat config', () => {
    const blocks = config as unknown as Array<{
      files?: string[];
      rules?: Record<string, unknown>;
    }>;
    const block = blocks.find(
      (b) =>
        b.files?.length === 2 &&
        b.files?.includes('packages/a2a-server/src/**/*.ts') === true &&
        b.files?.includes('packages/a2a-server/index.ts') === true,
    );
    expect(block).toBeDefined();
    const rule = block!.rules?.['no-restricted-imports'] as
      | [string, { patterns?: Array<{ regex?: string }> }]
      | undefined;
    // The guardrail only holds while the rule FAILS the build: severity must
    // stay 'error' (a downgrade to 'warn' would let banned imports pass CI).
    expect(rule).toBeDefined();
    expect(rule![0]).toBe('error');
    expect(typeof rule![1]?.patterns?.[0]?.regex).toBe('string');
  });
});
