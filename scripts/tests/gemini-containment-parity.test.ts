/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Differential negative-control parity suite for the #2628 Gemini containment
 * gate (scripts/check-gemini-containment.ts).
 *
 * Per the #3421 guard-retirement contract, retiring the old guard family
 * (scripts/check-genai-enclave.ts + scripts/genai-enclave/**, the
 * agents-neutral gate pair, scripts/genai-import-inventory.ts, and the
 * packages/agents Gemini naming scanner) requires committed evidence that the
 * new gate flags every injection shape in every context the old guards
 * covered. This suite is the LIVE half of that evidence: for each injection
 * shape (static import, type-only import, inline-braced `import { type X }`,
 * dynamic import(), require(), mock-module/vi.mock specifier, npm-alias
 * manifest disguise) and each context (production lane, test lane,
 * packed-tarball plugin package layout) it builds a minimal fixture tree and
 * asserts the new gate flags the injection. Intentionally-sanctioned zones
 * (plugin src/ and dist/, the plugin-local lockfile) and the clean negative
 * control are asserted to pass.
 *
 * The measured OLD-guard verdicts for the same fixtures, the differential
 * matrix, and every inapplicable-cell justification live in
 * dev-docs/gemini-containment-parity.md. This suite pins only the new gate so
 * it survives guard retirement; old-guard CLIs are deliberately not spawned
 * here.
 *
 * Self-scan note: this file lives in the gate's own scan lane (scripts/) and
 * the gate is zero-allowlist, so every fixture source string is composed
 * through the SDK constants (template interpolation) and this file's raw text
 * never contains a literal import-shaped SDK reference for either SDK.
 * OLD_SDK (@google/genai) is the retired guards' target, kept here only for
 * the retargeting cross-check; the new gate does not target it, and one test
 * pins that live.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runContainmentScan, type ScanResult } from '../check-gemini-containment.ts';

const REPO_ROOT = resolve(import.meta.dir, '..', '..');
const NEW_SDK = '@ai-sdk/google';
const OLD_SDK = '@google/genai';
const ALIAS_NAME = '@google-ai';
const GEMINI_PLUGIN_PKG = '@vybestack/llxprt-plugin-google-gemini';
const MCP_AUTH_PLUGIN_PKG = '@vybestack/llxprt-plugin-google-mcp-auth';
const HINTS_REL =
  'packages/providers/src/composition/runtimePlugins/pluginProvidedProviders.ts';

const PROD_SITE = 'packages/providers/src/parityInjection.ts';
const TEST_SITE = 'packages/core/src/parityInjection.test.ts';
const PLUGIN_NONSRC_SITE = 'plugins/google-gemini/scripts/postinstall.ts';

// ─── Injection shapes ───────────────────────────────────────────────────────

interface InjectionShape {
  readonly id: string;
  readonly source: (sdk: string) => string;
}

const SOURCE_SHAPES: readonly InjectionShape[] = [
  {
    id: 'runtime static import',
    source: (sdk) =>
      `import { createGoogleGenerativeAI } from '${sdk}';\nexport const client = createGoogleGenerativeAI;\n`,
  },
  {
    id: 'type-only import',
    source: (sdk) =>
      `import type { GoogleGenerativeAI } from '${sdk}';\nexport type Alias = GoogleGenerativeAI;\n`,
  },
  {
    id: 'inline-braced type import',
    source: (sdk) =>
      `import { type GoogleGenerativeAI } from '${sdk}';\nexport type Alias = GoogleGenerativeAI;\n`,
  },
  {
    id: 'dynamic import()',
    source: (sdk) =>
      `export async function loadSdk(): Promise<unknown> {\n  return import('${sdk}');\n}\n`,
  },
  {
    id: 'require()',
    source: (sdk) =>
      `export function loadSdkCjs(): unknown {\n  return require('${sdk}');\n}\n`,
  },
  {
    id: 'mock specifier',
    source: (sdk) => `import { mock } from 'bun:test';\nmock.module('${sdk}', () => ({}));\n`,
  },
  {
    id: 'vi.mock specifier',
    source: (sdk) => `import { vi } from 'vitest';\nvi.mock('${sdk}', () => ({}));\n`,
  },
];

// ─── Fixture tree scaffolding (same pattern as check-gemini-containment.test.ts) ──

interface FixtureTree {
  readonly root: string;
  write(rel: string, content: string): void;
}

const createdTrees: string[] = [];

afterEach(() => {
  while (createdTrees.length > 0) {
    const dir = createdTrees.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function newTree(label: string): FixtureTree {
  mkdirSync(join(REPO_ROOT, 'tmp'), { recursive: true });
  const root = mkdtempSync(join(REPO_ROOT, 'tmp', `gemini-parity-${label}-`));
  createdTrees.push(root);
  return {
    root,
    write(rel, content) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    },
  };
}

function manifestJson(
  name: string,
  dependencies: Record<string, string>,
): string {
  return `${JSON.stringify({ name, version: '0.12.0', type: 'module', dependencies }, null, 2)}\n`;
}

function rootBunLockSource(
  deps: Record<string, string>,
  resolvedKeys: string[],
): string {
  const doc = {
    lockfileVersion: 1,
    workspaces: { '': { name: 'fixture-root', dependencies: deps } },
    packages: Object.fromEntries(
      resolvedKeys.map((key) => [
        key,
        [`${key}@1.0.0`, '', {}, 'sha512-fixture'],
      ]),
    ),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function pluginBunLockSource(sdk: string, version: string): string {
  const doc = {
    lockfileVersion: 1,
    workspaces: {
      '': { name: GEMINI_PLUGIN_PKG, dependencies: { [sdk]: version } },
    },
    packages: { [sdk]: [`${sdk}@${version}`, '', {}, 'sha512-fixture'] },
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function rootPackageLockSource(
  workspaceDeps: Record<string, string>,
  resolvedKeys: string[],
): string {
  const doc = {
    name: 'fixture-root',
    version: '0.12.0',
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'fixture-root',
        version: '0.12.0',
        dependencies: workspaceDeps,
      },
      ...Object.fromEntries(
        resolvedKeys.map((key) => [
          `node_modules/${key}`,
          { version: '1.0.0', resolved: `https://registry.npmjs.org/${key}` },
        ]),
      ),
    },
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function pluginIndexSource(
  pluginId: string,
  providerId: string,
  aliases: readonly string[],
): string {
  const aliasBlock =
    aliases.length > 0
      ? `      builtinAliases: [\n${aliases
          .map(
            (alias) =>
              `        { alias: '${alias}', config: { name: '${alias}' } },`,
          )
          .join('\n')}\n      ],\n`
      : '';
  return [
    '/** fixture runtime-plugin manifest */',
    'export const llxprtRuntimePlugin = {',
    '  apiVersion: 1,',
    `  id: '${pluginId}',`,
    '  providers: [',
    '    {',
    `      providerId: '${providerId}',`,
    '      createProvider: () => ({}),',
    aliasBlock,
    '    },',
    '  ],',
    '};',
    '',
  ].join('\n');
}

function hintsSource(entries: ReadonlyArray<readonly [string, string]>): string {
  const lines = entries.map(([id, pkg]) => `    '${id}': '${pkg}',`).join('\n');
  return [
    '/** fixture base hint table */',
    'export const PLUGIN_PROVIDED_PROVIDER_HINTS: Readonly<Record<string, string>> =',
    '  {',
    lines,
    '  };',
    '',
  ].join('\n');
}

/**
 * Base tree that passes every new-gate layer when nothing is injected, and
 * carries the required manifests the retired genai-enclave guard also
 * expected (root + packages/providers), so the same layout family was
 * measurable against both guard generations.
 */
function buildBaseTree(label: string): FixtureTree {
  const tree = newTree(label);
  tree.write('package.json', manifestJson('fixture-root', {}));
  tree.write('bun.lock', rootBunLockSource({}, ['lodash']));
  tree.write('package-lock.json', rootPackageLockSource({}, ['lodash']));
  tree.write(
    'plugins/google-gemini/package.json',
    manifestJson(GEMINI_PLUGIN_PKG, { [NEW_SDK]: '4.0.56' }),
  );
  tree.write('plugins/google-gemini/bun.lock', pluginBunLockSource(NEW_SDK, '4.0.56'));
  tree.write(
    'plugins/google-gemini/src/index.ts',
    pluginIndexSource(GEMINI_PLUGIN_PKG, 'gemini', ['gemini']),
  );
  tree.write('plugins/google-gemini/types/host-contract.d.ts', 'export {};\n');
  tree.write(
    'plugins/google-mcp-auth/package.json',
    manifestJson(MCP_AUTH_PLUGIN_PKG, {}),
  );
  tree.write(
    'plugins/google-mcp-auth/src/index.ts',
    pluginIndexSource(MCP_AUTH_PLUGIN_PKG, 'google-mcp-auth', []),
  );
  tree.write(HINTS_REL, hintsSource([['gemini', GEMINI_PLUGIN_PKG]]));
  tree.write(
    'packages/providers/package.json',
    manifestJson('@fixture/providers', {}),
  );
  tree.write('packages/providers/src/neutral.ts', 'export const neutral = 1;\n');
  return tree;
}

function writeAliasManifest(tree: FixtureTree, sdk: string, manifestRel: string): void {
  tree.write(
    manifestRel,
    manifestJson('@fixture/foo', { [ALIAS_NAME]: `npm:${sdk}@4` }),
  );
}

function scanWithInjection(
  label: string,
  site: string,
  source: string,
): ScanResult {
  const tree = buildBaseTree(label);
  tree.write(site, source);
  return runContainmentScan(tree.root);
}

function assertSingleViolation(
  result: ScanResult,
  expectedLayer: string,
  expectedFile: string,
): void {
  expect(result.errors).toEqual([]);
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]?.layer).toBe(expectedLayer);
  expect(result.violations[0]?.file).toBe(expectedFile);
}

function expectCleanTree(result: ScanResult, because: string): void {
  expect(result.errors).toEqual([]);
  expect(
    result.violations,
    `expected no violations (${because}), got: ${JSON.stringify(result.violations)}`,
  ).toEqual([]);
}

// ─── The differential matrix rows (new-gate half) ───────────────────────────

interface MatrixContext {
  readonly id: string;
  readonly site: (shape: InjectionShape) => string;
  /** Manifest carriers for the npm-alias shape; first entry is flagged. */
  readonly manifestSite: string;
}

const MATRIX_CONTEXTS: readonly MatrixContext[] = [
  {
    id: 'production lane (packages/providers/src)',
    site: () => PROD_SITE,
    manifestSite: 'packages/foo/package.json',
  },
  {
    id: 'test lane (packages/core *.test.ts)',
    site: () => TEST_SITE,
    manifestSite: 'packages/foo/package.json',
  },
  {
    id: 'packed-tarball lane (plugin package tree outside src/dist)',
    site: () => PLUGIN_NONSRC_SITE,
    manifestSite: 'plugins/google-gemini/package.json',
  },
];

describe('gemini containment parity — new gate flags every injection shape x context', () => {
  for (const context of MATRIX_CONTEXTS) {
    for (const shape of SOURCE_SHAPES) {
      it(`flags ${shape.id} in ${context.id}`, () => {
        const result = scanWithInjection(
          'inject',
          context.site(shape),
          shape.source(NEW_SDK),
        );
        assertSingleViolation(
          result,
          'L2-import',
          context.site(shape),
        );
      });
    }

    it(`flags the npm-alias manifest disguise in ${context.id}`, () => {
      const tree = buildBaseTree('alias');
      writeAliasManifest(tree, NEW_SDK, context.manifestSite);
      const result = runContainmentScan(tree.root);
      const manifestHits = result.violations.filter(
        (v) => v.layer === 'L1-manifest' && v.file === context.manifestSite,
      );
      expect(result.errors).toEqual([]);
      expect(manifestHits.length).toBeGreaterThanOrEqual(1);
      expect(manifestHits[0]?.message).toContain('alias');
    });
  }
});

// ─── Intentionally-sanctioned zones (asserted passes with documented why) ──

describe('gemini containment parity — sanctioned zones pass (intentional scope)', () => {
  it('passes an SDK import inside plugins/google-gemini/dist (built artifact of the owning plugin)', () => {
    const tree = buildBaseTree('dist');
    tree.write(
      'plugins/google-gemini/dist/bundle.js',
      `import { createGoogleGenerativeAI } from '${NEW_SDK}';\nexport const provider = createGoogleGenerativeAI;\n`,
    );
    expectCleanTree(runContainmentScan(tree.root), 'plugin dist/ is the sanctioned consumption zone');
  });

  it('passes an SDK import inside plugins/google-gemini/src (the sanctioned owner)', () => {
    const tree = buildBaseTree('srczone');
    tree.write(
      'plugins/google-gemini/src/deeper/provider.ts',
      `import { createGoogleGenerativeAI } from '${NEW_SDK}';\nexport const provider = createGoogleGenerativeAI;\n`,
    );
    expectCleanTree(runContainmentScan(tree.root), 'plugin src/ is the sanctioned owner zone');
  });

  it('passes the SDK in the plugin-local bun.lock (separate install context)', () => {
    const tree = buildBaseTree('pluglock');
    tree.write('plugins/google-gemini/bun.lock', pluginBunLockSource(NEW_SDK, '9.9.9'));
    expectCleanTree(runContainmentScan(tree.root), 'plugin-local lockfile is a sanctioned install context');
  });

  it('flags the SDK in the ROOT bun.lock (old guards had no lockfile layer)', () => {
    const tree = buildBaseTree('rootlock');
    tree.write('bun.lock', rootBunLockSource({ [NEW_SDK]: '^4.0.0' }, [NEW_SDK, 'lodash']));
    // Both lockfile surfaces fire: the workspace dependency entry and the
    // packages["<sdk>"] resolution entry.
    const result = runContainmentScan(tree.root);
    expect(result.errors).toEqual([]);
    expect(result.violations).toHaveLength(2);
    for (const violation of result.violations) {
      expect(violation.layer).toBe('L1-lockfile');
      expect(violation.file).toBe('bun.lock');
    }
  });

  it('passes the alias disguise probe ONLY through the sanctioned plugin manifest rule it trips', () => {
    // Cross-context confirmation of the alias rule: the alias is flagged in
    // the plugin manifest even though that manifest is the sanctioned SDK
    // declaration site — disguised declarations are prohibited everywhere.
    const tree = buildBaseTree('plugalias');
    tree.write(
      'plugins/google-gemini/package.json',
      manifestJson(GEMINI_PLUGIN_PKG, {
        [NEW_SDK]: '4.0.56',
        [ALIAS_NAME]: `npm:${NEW_SDK}@4`,
      }),
    );
    const result = runContainmentScan(tree.root);
    expect(
      result.violations.some(
        (v) =>
          v.layer === 'L1-manifest' &&
          v.file === 'plugins/google-gemini/package.json' &&
          v.message.includes('alias'),
      ),
    ).toBe(true);
  });
});

// ─── Negative control + retargeting cross-check ─────────────────────────────

describe('gemini containment parity — negative control and SDK retargeting', () => {
  it('clean tree (no injection) passes every layer', () => {
    expectCleanTree(runContainmentScan(buildBaseTree('clean').root), 'negative control');
  });

  it('the retired guards\u2019 SDK (@google/genai) is NOT the new gate\u2019s target — documented retargeting, not a coverage claim', () => {
    // The legacy SDK is fully evicted from packages/** (zero importers,
    // measured for dev-docs/gemini-containment-parity.md) and the containment
    // contract moved to @ai-sdk/google. This test PINS that the new gate does
    // not police the legacy specifier; the differential matrix in the parity
    // doc records the old guards\u2019 measured verdicts on the same fixtures.
    const tree = buildBaseTree('legacy');
    tree.write(PROD_SITE, `import { GoogleGenAI } from '${OLD_SDK}';\nexport const ai = GoogleGenAI;\n`);
    tree.write(TEST_SITE, `import type { Content } from '${OLD_SDK}';\n`);
    expectCleanTree(
      runContainmentScan(tree.root),
      'legacy-SDK specifier is outside the new gate\u2019s target by design',
    );
  });
});
