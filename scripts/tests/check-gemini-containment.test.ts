/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fixture + parity tests for the #2628 Gemini containment gate
 * (scripts/check-gemini-containment.ts).
 *
 * Fixture trees are built in-test under the repo's gitignored tmp/ directory
 * and cleaned up after each test. One test anchors parity: the gate must be
 * clean against the REAL repo tree, proving the endpoint (exactly one SDK
 * declaration in plugins/google-gemini, imports confined to plugin src/,
 * no Gemini provider-tree files in the base provider workspace, envelope
 * exact-set parity) holds today.
 *
 * Self-scan note: this test file lives in the gate's own scan lane
 * (scripts/), and the gate is zero-allowlist — no exclusions. Every fixture
 * source string that must contain an import-shaped SDK specifier is therefore
 * composed through the SDK constant (template interpolation), so this file's
 * raw text never contains a literal import-shaped SDK reference.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import {
  checkEnvelopeLayer,
  checkImportLayer,
  checkManifestLayer,
  checkResidencyLayer,
  parsePluginManifestLiteral,
  parseProviderHints,
  resolveGateRoot,
  runContainmentScan,
  scanSourceForSdkImports,
  type ParsedPluginManifest,
} from '../check-gemini-containment.ts';

const REPO_ROOT = resolve(import.meta.dir, '..', '..');
const GATE_SCRIPT = join(REPO_ROOT, 'scripts', 'check-gemini-containment.ts');
const SDK = '@ai-sdk/google';
const GEMINI_PLUGIN_PKG = '@vybestack/llxprt-plugin-google-gemini';
const MCP_AUTH_PLUGIN_PKG = '@vybestack/llxprt-plugin-google-mcp-auth';
const HINTS_REL =
  'packages/providers/src/composition/runtimePlugins/pluginProvidedProviders.ts';

// ─── Fixture tree scaffolding ───────────────────────────────────────────────

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
  const root = mkdtempSync(join(REPO_ROOT, 'tmp', `gemini-gate-${label}-`));
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

function pluginBunLockSource(sdkVersion: string): string {
  const doc = {
    lockfileVersion: 1,
    workspaces: {
      '': { name: GEMINI_PLUGIN_PKG, dependencies: { [SDK]: sdkVersion } },
    },
    packages: {
      [SDK]: [`${SDK}@${sdkVersion}`, '', {}, 'sha512-fixture'],
    },
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

interface FixtureContribution {
  readonly providerId: string;
  readonly aliases?: readonly string[];
}

function pluginIndexSource(
  pluginId: string,
  contributions: readonly FixtureContribution[],
): string {
  const blocks = contributions.map((contribution) => {
    const aliasBlock =
      contribution.aliases !== undefined && contribution.aliases.length > 0
        ? `      builtinAliases: [\n${contribution.aliases
            .map(
              (alias) =>
                `        { alias: '${alias}', config: { name: '${alias}' } },`,
            )
            .join('\n')}\n      ],\n`
        : '';
    return [
      '    {',
      `      providerId: '${contribution.providerId}',`,
      '      createProvider: () => ({}),',
      aliasBlock,
      '    },',
    ].join('\n');
  });
  return [
    '/** fixture runtime-plugin manifest */',
    `export const llxprtRuntimePlugin = {`,
    '  apiVersion: 1,',
    `  id: '${pluginId}',`,
    '  providers: [',
    ...blocks,
    '  ],',
    '};',
    '',
  ].join('\n');
}

function hintsSource(
  entries: ReadonlyArray<readonly [string, string]>,
): string {
  // Keys that are not plain identifiers are quoted, exactly as real
  // TypeScript requires (e.g. 'google-mcp-auth').
  const lines = entries
    .map(([id, pkg]) => {
      const key = /^[A-Za-z_$][\w$]*$/.test(id) ? id : `'${id}'`;
      return `    ${key}: '${pkg}',`;
    })
    .join('\n');
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
 * A2A carve-out fixture: protocol shapes with kind / messageId / taskId
 * discriminators referencing the gemini provider id stay legitimate A2A
 * messages (issue #2628 envelope-rule semantics).
 */
const A2A_MESSAGES_SOURCE = [
  '/** fixture A2A protocol envelope */',
  'export interface A2aMessageEnvelope {',
  "  kind: 'message' | 'task';",
  '  messageId: string;',
  '  taskId?: string;',
  '  metadata?: { provider?: string; geminiMessageId?: string };',
  '}',
  '',
  'export function geminiTagged(messageId: string): A2aMessageEnvelope {',
  "  return { kind: 'message', messageId, metadata: { provider: 'gemini' } };",
  '}',
  '',
].join('\n');

function buildCleanTree(): FixtureTree {
  const tree = newTree('clean');
  tree.write('package.json', manifestJson('fixture-root', {}));
  tree.write('bun.lock', rootBunLockSource({}, ['lodash']));
  tree.write('package-lock.json', rootPackageLockSource({}, ['lodash']));
  tree.write(
    'plugins/google-gemini/package.json',
    manifestJson(GEMINI_PLUGIN_PKG, { [SDK]: '4.0.56' }),
  );
  tree.write('plugins/google-gemini/bun.lock', pluginBunLockSource('4.0.56'));
  tree.write(
    'plugins/google-gemini/src/index.ts',
    pluginIndexSource(GEMINI_PLUGIN_PKG, [
      { providerId: 'gemini', aliases: ['gemini'] },
    ]),
  );
  tree.write(
    'plugins/google-gemini/src/gemini/GeminiProvider.ts',
    `import { createGoogleGenerativeAI } from '${SDK}';\nexport const provider = 1;\n`,
  );
  tree.write('plugins/google-gemini/types/host-contract.d.ts', 'export {};\n');
  tree.write(
    'plugins/google-mcp-auth/package.json',
    manifestJson(MCP_AUTH_PLUGIN_PKG, {}),
  );
  tree.write(
    'plugins/google-mcp-auth/src/index.ts',
    pluginIndexSource(MCP_AUTH_PLUGIN_PKG, [{ providerId: 'google-mcp-auth' }]),
  );
  tree.write(HINTS_REL, hintsSource([['gemini', GEMINI_PLUGIN_PKG]]));
  tree.write(
    'packages/providers/src/neutral.ts',
    'export const neutral = 1;\n',
  );
  // Compat parse-direction types live in core llm-types, outside the
  // provider workspace: L3 must not flag them.
  tree.write(
    'packages/core/src/llm-types/geminiContent.ts',
    'export interface GeminiContent {\n  role: string;\n}\n',
  );
  // models.dev metadata records the npm package implementing a provider —
  // a non-import position for the SDK string.
  tree.write(
    'packages/core/test/models/__fixtures__/mock-data.ts',
    `export const googleProvider = {\n  id: 'google',\n  npm: '${SDK}',\n};\n`,
  );
  tree.write('packages/a2a-server/src/messages.ts', A2A_MESSAGES_SOURCE);
  tree.write('scripts/tool.ts', 'export const tool = 1;\n');
  return tree;
}

// ─── Layer behavior on fixture trees ────────────────────────────────────────

describe('gemini-containment gate — fixture layers', () => {
  it('clean tree passes every layer (L1 manifests, L1 lockfiles, L2, L3, envelope)', () => {
    const tree = buildCleanTree();
    const result = runContainmentScan(tree.root);
    expect(result.errors).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  it('L1: SDK declared in a base (non-plugin) package.json fails', () => {
    const tree = buildCleanTree();
    tree.write(
      'packages/foo/package.json',
      manifestJson('@fixture/foo', { [SDK]: '^4.0.0' }),
    );
    const result = checkManifestLayer(tree.root);
    expect(result.errors).toEqual([]);
    const hit = result.violations.find(
      (v) => v.file === 'packages/foo/package.json',
    );
    expect(hit).toBeDefined();
    expect(hit?.layer).toBe('L1-manifest');
    expect(hit?.message).toContain('exactly ONE');
  });

  it('L1: an npm alias disguising the SDK fails even in the sanctioned plugin', () => {
    const tree = buildCleanTree();
    tree.write(
      'plugins/google-gemini/package.json',
      manifestJson(GEMINI_PLUGIN_PKG, { 'friendly-face': `npm:${SDK}@4.0.56` }),
    );
    const result = checkManifestLayer(tree.root);
    expect(
      result.violations.some(
        (v) => v.layer === 'L1-manifest' && v.message.includes('alias'),
      ),
    ).toBe(true);
  });

  it('L2: SDK import under packages/ fails', () => {
    const tree = buildCleanTree();
    tree.write(
      'packages/foo/src/client.ts',
      `import { face } from '${SDK}';\nexport const x = face;\n`,
    );
    const result = checkImportLayer(tree.root);
    const hits = result.violations.filter((v) => v.layer === 'L2-import');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.file).toBe('packages/foo/src/client.ts');
    expect(hits[0]?.line).toBe(1);
  });

  it('L2: the same import inside plugins/<x>/src passes', () => {
    const tree = buildCleanTree();
    tree.write(
      'plugins/foo/src/client.ts',
      `import { face } from '${SDK}';\nexport const x = face;\n`,
    );
    const result = checkImportLayer(tree.root);
    expect(result.errors).toEqual([]);
    expect(result.violations.filter((v) => v.layer === 'L2-import')).toEqual(
      [],
    );
  });

  it('L2: models.dev metadata string is not an import, all statement shapes are caught', () => {
    const tree = buildCleanTree();
    const result = checkImportLayer(tree.root);
    expect(
      result.violations.filter((v) => v.file.includes('mock-data')),
    ).toEqual([]);
    const metadataText =
      "export const googleProvider = {\n  npm: '@ai-sdk/google',\n};\n";
    expect(scanSourceForSdkImports('x.ts', metadataText)).toEqual([]);
    const importShapes = [
      `import { face } from '${SDK}';`,
      `import '${SDK}';`,
      `import type { Face } from '${SDK}';`,
      `const mod = import('${SDK}');`,
      `const req = require('${SDK}');`,
      `export { face } from '${SDK}';`,
      `export * from '${SDK}';`,
      `mock.module('${SDK}', () => ({}));`,
      `vi.mock('${SDK}', () => ({}));`,
      `jest.mock('${SDK}', () => ({}));`,
    ];
    for (const shape of importShapes) {
      const hits = scanSourceForSdkImports('x.ts', shape);
      expect(hits.length).toBeGreaterThan(0);
    }
  });

  it('L3: a gemini-named file under packages/providers/src fails residency', () => {
    const tree = buildCleanTree();
    tree.write(
      'packages/providers/src/geminiHelper.ts',
      'export const helper = 1;\n',
    );
    const result = checkResidencyLayer(tree.root);
    expect(result.errors).toEqual([]);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]?.layer).toBe('L3-residency');
    expect(result.violations[0]?.file).toBe(
      'packages/providers/src/geminiHelper.ts',
    );
  });

  it('L3: gemini-named compat files outside the provider workspace pass', () => {
    const tree = buildCleanTree();
    const result = checkResidencyLayer(tree.root);
    expect(result.violations).toEqual([]);
  });

  it('envelope: hinted id no plugin contributes fails (manifest missing the hinted provider)', () => {
    const tree = buildCleanTree();
    tree.write(
      'plugins/google-gemini/src/index.ts',
      pluginIndexSource(GEMINI_PLUGIN_PKG, [
        { providerId: 'notgemini', aliases: ['notgemini'] },
      ]),
    );
    const result = checkEnvelopeLayer(tree.root);
    expect(result.violations.length).toBeGreaterThan(0);
    const messages = result.violations.map((v) => v.message).join('\n');
    expect(messages).toContain('notgemini');
    expect(messages).toContain('gemini');
  });

  it('envelope: contributed capability absent from the hint table fails', () => {
    const tree = buildCleanTree();
    tree.write(HINTS_REL, hintsSource([]));
    const result = checkEnvelopeLayer(tree.root);
    expect(
      result.violations.some(
        (v) => v.layer === 'envelope' && v.message.includes('absent from'),
      ),
    ).toBe(true);
  });

  it('envelope: a hint pointing at an alias-less reserved stub fails', () => {
    const tree = buildCleanTree();
    tree.write(
      HINTS_REL,
      hintsSource([
        ['gemini', GEMINI_PLUGIN_PKG],
        ['google-mcp-auth', MCP_AUTH_PLUGIN_PKG],
      ]),
    );
    const result = checkEnvelopeLayer(tree.root);
    expect(
      result.violations.some((v) =>
        v.message.includes('WITHOUT a built-in alias'),
      ),
    ).toBe(true);
  });

  it('A2A carve-out: protocol shape referencing gemini passes every layer', () => {
    const tree = buildCleanTree();
    const result = runContainmentScan(tree.root);
    expect(
      result.violations.filter((v) => v.file.includes('a2a-server')),
    ).toEqual([]);
    expect(scanSourceForSdkImports('messages.ts', A2A_MESSAGES_SOURCE)).toEqual(
      [],
    );
  });

  it('structural parsers read the REAL plugin manifest and hint table', () => {
    const pluginSrc = readFileSync(
      join(REPO_ROOT, 'plugins', 'google-gemini', 'src', 'index.ts'),
      'utf8',
    );
    const parsed: ParsedPluginManifest | string =
      parsePluginManifestLiteral(pluginSrc);
    expect(typeof parsed).not.toBe('string');
    if (typeof parsed === 'string') throw new Error(parsed);
    expect(parsed.contributions).toEqual([
      { providerId: 'gemini', aliases: ['gemini'] },
    ]);
    const hintsSrc = readFileSync(join(REPO_ROOT, HINTS_REL), 'utf8');
    const hints = parseProviderHints(hintsSrc);
    expect(typeof hints).not.toBe('string');
    if (typeof hints === 'string') throw new Error(hints);
    expect(hints).toEqual({ gemini: GEMINI_PLUGIN_PKG });
  });
});

// ─── Parity anchor + CLI ────────────────────────────────────────────────────

describe('gemini-containment gate — parity anchor and CLI', () => {
  it('the REAL repo tree is clean (parity anchor)', () => {
    const result = runContainmentScan(REPO_ROOT);
    expect(result.errors).toEqual([]);
    expect(result.violations).toEqual([]);
  }, 120_000);

  it('CLI default mode exits 0 on the real tree', () => {
    const run = spawnSync(process.execPath, [GATE_SCRIPT], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('PASSED');
  }, 120_000);

  it('CLI default mode prints file:line findings and exits 1 on a violating tree', () => {
    const tree = buildCleanTree();
    tree.write(
      'packages/foo/package.json',
      manifestJson('@fixture/foo', { [SDK]: '^4.0.0' }),
    );
    const run = spawnSync(process.execPath, [GATE_SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, LLXPRT_GATE_ROOT: tree.root },
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('[L1-manifest]');
    expect(run.stdout).toContain('packages/foo/package.json');
  }, 60_000);

  it('CLI --report prints the same table but always exits 0', () => {
    const tree = buildCleanTree();
    tree.write(
      'packages/foo/package.json',
      manifestJson('@fixture/foo', { [SDK]: '^4.0.0' }),
    );
    const run = spawnSync(process.execPath, [GATE_SCRIPT, '--report'], {
      encoding: 'utf8',
      env: { ...process.env, LLXPRT_GATE_ROOT: tree.root },
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('[L1-manifest]');
  }, 60_000);

  it('LLXPRT_GATE_ROOT pointing at a nonexistent dir fails closed', () => {
    const bogus = '/nonexistent/gemini-gate-root';
    expect(() => resolveGateRoot(bogus)).toThrow(/failing closed/i);
    const run = spawnSync(process.execPath, [GATE_SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, LLXPRT_GATE_ROOT: bogus },
    });
    expect(run.status).toBe(1);
  }, 60_000);
});
