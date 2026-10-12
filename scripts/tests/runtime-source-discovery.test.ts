/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { selectBoundarySources } from '../runtime-source-discovery.js';
import {
  productionEntryManifest,
  verifyBundleEntryDeclarations,
} from '../runtime-entry-manifest.js';
import {
  auditRuntimeStateBoundary,
  type AuditPolicy,
} from '../check-runtime-state-boundary.js';

let workspace: string;
const evidence = join(tmpdir(), 'llxprt-source-discovery-implementation');
function put(file: string, text: string): void {
  mkdirSync(dirname(join(workspace, file)), { recursive: true });
  writeFileSync(join(workspace, file), text);
}
const policy: AuditPolicy = {
  compilerConfig: 'tsconfig.json',
  sourceRoots: ['packages/demo/src'],
  mutableRoots: [],
  alsRoots: [],
  services: [
    { file: 'packages/demo/src/services.ts', exportName: 'Settings' },
    { file: 'packages/demo/src/services.ts', exportName: 'Manager' },
  ],
  configs: [],
  assembly: [],
  ambientSources: [],
  alsAllowances: [],
};
beforeEach(() => {
  mkdirSync(evidence, { recursive: true });
  workspace = mkdtempSync(join(evidence, 'fixture-'));
  put(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        types: [],
      },
    }),
  );
  put(
    'packages/demo/src/services.ts',
    'export class Settings { value = 1; } export class Manager { name = "manager"; }',
  );
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));
for (const [file, source] of [
  [
    'entry.mjs',
    "import { absent as acquire } from './ambient.mjs'; acquire();",
  ],
  ['entry.cjs', "const acquire = require('./ambient.cjs').absent; acquire();"],
  [
    'destructured.cjs',
    "const { absent: acquire } = require('./ambient.cjs'); acquire();",
  ],
])
  it(`rejects unresolved named JavaScript module identities in ${file}`, () => {
    put('ambient.mjs', 'export function active() {}');
    put('ambient.cjs', 'exports.active = function active() {};');
    put(file, source);
    expect(() =>
      auditRuntimeStateBoundary(workspace, {
        ...policy,
        entryManifest: { files: [file] },
      }),
    ).toThrow('Unresolved JavaScript module member');
  });
it('uses default package compiler emit paths without mistaking output JavaScript for source', () => {
  put(
    'packages/demo/tsconfig.json',
    JSON.stringify({
      extends: '../../tsconfig.json',
      compilerOptions: { rootDir: '.', outDir: 'dist' },
      include: ['src/**/*.ts', 'index.ts'],
    }),
  );
  put(
    'packages/demo/index.ts',
    'export { Settings, Manager } from "./src/services.js";',
  );
  put(
    'packages/demo/dist/index.js',
    'export { Settings, Manager } from "./src/services.js";',
  );
  put(
    'packages/demo/package.json',
    JSON.stringify({ main: './dist/index.js' }),
  );
  const result = auditRuntimeStateBoundary(workspace, {
    ...policy,
    compilerProjects: ['packages/demo/tsconfig.json'],
    entryManifest: { packages: ['packages/demo'] },
  });
  expect(result.compilerDiagnostics).toEqual([]);
  expect(result.files).toContain('packages/demo/index.ts');
  expect(result.files).not.toContain('packages/demo/dist/index.js');
});
it('resolves CommonJS object-exported service class identities', () => {
  put(
    'packages/demo/services.cjs',
    'class Settings {} class Manager {} module.exports = { Settings, Manager };',
  );
  put(
    'packages/demo/entry.cjs',
    "const { Settings, Manager } = require('./services.cjs'); function accept(value) { return value; } accept({ settings: new Settings(), manager: new Manager() });",
  );
  const result = auditRuntimeStateBoundary(workspace, {
    ...policy,
    entryManifest: { files: ['packages/demo/entry.cjs'] },
    services: [
      { file: 'packages/demo/services.cjs', exportName: 'Settings' },
      { file: 'packages/demo/services.cjs', exportName: 'Manager' },
    ],
  });
  expect(result.compilerDiagnostics).toEqual([]);
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      file: 'packages/demo/entry.cjs',
      rule: 'runtime-service-bag-parameter',
    }),
  );
  expect(result.programs[0].resolvedRoots).toContainEqual({
    file: 'packages/demo/services.cjs',
    exportName: 'Settings',
    resolvedFile: 'packages/demo/services.cjs',
  });
});
it('preserves existing JavaScript conditional implementations beside Bun sources and mapped types', () => {
  put('packages/demo/bun.ts', 'export {};');
  put('packages/demo/node.mjs', 'export let active = 1;');
  put(
    'packages/demo/package.json',
    JSON.stringify({
      exports: {
        '.': {
          bun: './bun.ts',
          import: './node.mjs',
          types: './dist/bun.d.ts',
        },
      },
    }),
  );
  const result = auditRuntimeStateBoundary(workspace, {
    ...policy,
    entryManifest: { packages: ['packages/demo'] },
    mutableRoots: ['packages/demo/node.mjs'],
  });
  expect(result.compilerDiagnostics).toEqual([]);
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      file: 'packages/demo/node.mjs',
      rule: 'mutable-state',
    }),
  );
});
it('follows CommonJS object exports and member aliases by callable identity', () => {
  put(
    'packages/demo/ambient.cjs',
    'function active() { return {}; } module.exports = { active };',
  );
  put(
    'packages/demo/entry.cjs',
    "const acquire = require('./ambient.cjs').active; const alias = acquire; alias();",
  );
  const result = auditRuntimeStateBoundary(workspace, {
    ...policy,
    entryManifest: { files: ['packages/demo/entry.cjs'] },
    ambientSources: [
      { file: 'packages/demo/ambient.cjs', exportName: 'active' },
    ],
  });
  expect(result.compilerDiagnostics).toEqual([]);
  expect(result.findings).toContainEqual(
    expect.objectContaining({ file: 'packages/demo/entry.cjs', kind: 'call' }),
  );
});
for (const extension of ['js', 'mjs', 'cjs']) {
  it(`checks ${extension} JSDoc generic method actual arguments and return exposure`, () => {
    const file = 'packages/demo/generic.' + extension;
    put('packages/demo/package.json', JSON.stringify({ type: 'module' }));
    put(
      file,
      `const { Settings, Manager } = ${extension === 'cjs' ? "require('./src/services.js')" : "await import('./src/services.js')"};
      const receiver = { /** @template T @param {T} value @returns {T} */ accept(value) { return value; } };
      function expose() { return receiver.accept({ settings: new Settings(), manager: new Manager() }); }`,
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      entryManifest: { files: [file] },
    });
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        file,
        line: 3,
        column: 34,
        rule: 'runtime-service-bundle',
      }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ file, rule: 'runtime-service-bag-parameter' }),
    );
  });
  it(`keeps ${extension} ordinary data and same-spelled unrelated sources clean`, () => {
    put(
      'packages/demo/src/ambient.ts',
      'export function active() { return {}; }',
    );
    put(
      'entry.' + extension,
      'function active() { return { value: 1 }; } const api = { accept(value) { return value; } }; api.accept(active());',
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      entryManifest: { files: ['entry.' + extension] },
      ambientSources: [
        { file: 'packages/demo/src/ambient.ts', exportName: 'active' },
      ],
    });
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.programs[0].javascriptAnalysis?.files).toContain(
      'entry.' + extension,
    );
    expect(result.programs[0].javascriptAnalysis?.certifiesRuntimePurity).toBe(
      false,
    );
  });
  it(`retains ${extension} inferred identity-method return exposure`, () => {
    const file = 'packages/demo/return.' + extension;
    put('packages/demo/package.json', JSON.stringify({ type: 'module' }));
    put(
      file,
      `const { Settings, Manager } = ${extension === 'cjs' ? "require('./src/services.js')" : "await import('./src/services.js')"};
      const receiver = { accept(value) { return value; } };
      function expose() { return receiver.accept({ settings: new Settings(), manager: new Manager() }); }`,
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      entryManifest: { files: [file] },
    });
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        file,
        line: 3,
        column: 34,
        rule: 'runtime-service-bundle',
      }),
    );
  });
  it(`checks ${extension} mutable and ALS rules only within their separate policy roots`, () => {
    const file = 'packages/demo/state.' + extension;
    put(
      file,
      `${extension === 'cjs' ? "const { AsyncLocalStorage: Scope } = require('node:async_hooks');" : "import { AsyncLocalStorage as Scope } from 'node:async_hooks';"}
      let active = {};
      const scope = new Scope();`,
    );
    const configured = { ...policy, entryManifest: { files: [file] } };
    expect(auditRuntimeStateBoundary(workspace, configured).findings).toEqual(
      [],
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...configured,
      mutableRoots: [file],
      alsRoots: [file],
    });
    expect(result.findings).toContainEqual(
      expect.objectContaining({ file, rule: 'mutable-state' }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ file, rule: 'async-local-storage' }),
    );
  });
  it(`does not suppress ${extension} compiler diagnostics`, () => {
    put(
      'broken.' + extension,
      '// @ts-check\n/** @type {number} */ const value = "wrong";',
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      entryManifest: { files: ['broken.' + extension] },
    });
    expect(
      result.compilerDiagnostics.some((diagnostic) => diagnostic.code === 2322),
    ).toBe(true);
    expect(result.scanners.serviceShape).toBe('blocked-by-compiler');
    expect(result.exitCode).toBe(1);
  });
  it(`rejects unresolved ${extension} package imports`, () => {
    put(
      'broken.' + extension,
      "const dependency = require('missing-runtime-package');",
    );
    expect(() =>
      auditRuntimeStateBoundary(workspace, {
        ...policy,
        entryManifest: { files: ['broken.' + extension] },
      }),
    ).toThrow('Unresolved dependency');
  });
  it(`checks ${extension} named ambient aliases and outside-src dependency closure`, () => {
    const cjs = extension === 'cjs';
    put('packages/demo/package.json', JSON.stringify({ type: 'module' }));
    put(
      'packages/demo/src/ambient.' + extension,
      cjs
        ? 'exports.active = function active() { return {}; };'
        : 'export function active() { return {}; }',
    );
    put(
      'packages/demo/bridge.' + extension,
      cjs
        ? `exports.alias = require('./src/ambient.${extension}').active;`
        : `export { active as alias } from './src/ambient.${extension}';`,
    );
    put(
      'packages/demo/helper.' + extension,
      cjs
        ? `const { alias: acquire } = require('./bridge.${extension}'); acquire();`
        : `import { alias as acquire } from './bridge.${extension}'; acquire();`,
    );
    put(
      'packages/demo/entry.' + extension,
      cjs
        ? `require('./helper.${extension}');`
        : `import('./helper.${extension}');`,
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      entryManifest: { files: ['packages/demo/entry.' + extension] },
      ambientSources: [
        {
          file: 'packages/demo/src/ambient.' + extension,
          exportName: 'active',
        },
      ],
    });
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        file: 'packages/demo/helper.' + extension,
        rule: 'runtime-ambient-delegation',
      }),
    );
    expect(result.programs[0].files).toContain(
      'packages/demo/helper.' + extension,
    );
  });
  it(`checks ${extension} actual bags passed to unannotated methods and returned`, () => {
    const file = 'packages/demo/entry.' + extension;
    put('packages/demo/package.json', JSON.stringify({ type: 'module' }));
    put(
      file,
      `const { Settings, Manager } = ${extension === 'cjs' ? "require('./src/services.js')" : "await import('./src/services.js')"};
      const receiver = { accept(value) { return value; } };
      const result = receiver.accept({ settings: new Settings(), manager: new Manager() });
      function expose() { return { settings: new Settings(), manager: new Manager() }; }
      expose();`,
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      entryManifest: { files: [file] },
    });
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ file, rule: 'runtime-service-bag-parameter' }),
    );
    expect(
      result.findings.filter(
        (f) => f.file === file && f.rule === 'runtime-service-bundle',
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });
  it(`fails unresolved ${extension} literal dependencies visibly`, () => {
    put('entry.' + extension, `import('./absent.${extension}');`);
    expect(() =>
      auditRuntimeStateBoundary(workspace, {
        ...policy,
        entryManifest: { files: ['entry.' + extension] },
      }),
    ).toThrow('Unresolved local dependency');
  });
}
const bag =
  'import { Settings, Manager } from "./services.js"; export interface Bag { settings: Settings; manager: Manager; }';
it('excludes orphan Bun suites and helpers but inventories them', () => {
  put('packages/demo/src/orphan.bun.ts', bag);
  put('packages/demo/src/test-utils/orphan.ts', 'export const orphan = 1;');
  const result = auditRuntimeStateBoundary(workspace, policy);
  expect(result.files).toEqual(['packages/demo/src/services.ts']);
  expect(
    result.discovery.filter(
      (entry) => entry.classification === 'excluded-test',
    ),
  ).toHaveLength(2);
});
for (const [file, edge] of [
  ['bad.test.ts', 'export type { Bag } from "./bad.test.js";'],
  ['bad.bun.ts', 'export type B = import("./bad.bun.js").Bag;'],
  ['bad.fixture.ts', 'export const load = () => import("./bad.fixture.js");'],
  ['test-utils/bad.ts', 'export type { Bag } from "./bridge.js";'],
])
  it(`scans production-reached ${file} including transitive and type edges`, () => {
    put(
      `packages/demo/src/${file}`,
      file.includes('/') ? bag.replace('./services', '../services') : bag,
    );
    put(
      'packages/demo/src/bridge.ts',
      'export type { Bag } from "./test-utils/bad.js";',
    );
    if (!file.includes('/')) put('packages/demo/src/bridge.ts', 'export {};');
    put('packages/demo/src/use.ts', edge);
    const result = auditRuntimeStateBoundary(workspace, policy);
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        file: `packages/demo/src/${file}`,
        rule: 'runtime-service-bundle',
      }),
    );
    expect(result.exitCode).toBe(1);
  });
it('scans outside-src exports and their dependency closure', () => {
  put('packages/demo/index.ts', 'export type { Bag } from "./support.js";');
  put('packages/demo/support.ts', bag.replace('./services', './src/services'));
  put(
    'packages/demo/package.json',
    JSON.stringify({
      exports: { '.': { bun: './index.ts', import: './dist/index.js' } },
    }),
  );
  const result = auditRuntimeStateBoundary(workspace, {
    ...policy,
    entryManifest: { packages: ['packages/demo'] },
  });
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      file: 'packages/demo/support.ts',
      rule: 'runtime-service-bundle',
    }),
  );
});
it('preserves public testing classification and promotes ordinary imports', () => {
  put(
    'packages/demo/src/test-utils/public.ts',
    bag.replace('./services', '../services'),
  );
  put(
    'packages/demo/package.json',
    JSON.stringify({ exports: { './testing': './src/test-utils/public.ts' } }),
  );
  const configured = {
    ...policy,
    entryManifest: { packages: ['packages/demo'] },
  };
  const first = auditRuntimeStateBoundary(workspace, configured);
  expect(first.discovery).toContainEqual(
    expect.objectContaining({
      file: 'packages/demo/src/test-utils/public.ts',
      classification: 'public-testing-export',
    }),
  );
  expect(first.findings.some((f) => f.file.endsWith('/public.ts'))).toBe(true);
  put(
    'packages/demo/src/use.ts',
    'export type { Bag } from "./test-utils/public.js";',
  );
  const second = auditRuntimeStateBoundary(workspace, configured);
  expect(second.discovery).toContainEqual(
    expect.objectContaining({
      file: 'packages/demo/src/test-utils/public.ts',
      classification: 'production',
      publicTestingExport: true,
    }),
  );
});
it('rejects each missing or empty required root beside a healthy package', () => {
  mkdirSync(join(workspace, 'empty'), { recursive: true });
  for (const root of ['missing', 'empty'])
    expect(() =>
      auditRuntimeStateBoundary(workspace, {
        ...policy,
        sourceRoots: [...policy.sourceRoots, root],
      }),
    ).toThrow();
});
it('supports explicit file roots', () => {
  put('entry.ts', 'export const entry = 1;');
  expect(
    auditRuntimeStateBoundary(workspace, {
      ...policy,
      sourceRoots: [...policy.sourceRoots, 'entry.ts'],
    }).files,
  ).toContain('entry.ts');
});
it('fails undeclared packages and missing exported sources', () => {
  put(
    'packages/omitted/package.json',
    JSON.stringify({ exports: './index.ts' }),
  );
  put('packages/omitted/index.ts', 'export {};');
  expect(() =>
    auditRuntimeStateBoundary(workspace, {
      ...policy,
      entryManifest: {
        packages: ['packages/demo'],
        packageDirectories: ['packages'],
      },
    }),
  ).toThrow('Undeclared shipped package');
  put(
    'packages/demo/package.json',
    JSON.stringify({ exports: './missing.ts' }),
  );
  expect(() =>
    auditRuntimeStateBoundary(workspace, {
      ...policy,
      entryManifest: { packages: ['packages/demo'] },
    }),
  ).toThrow('Missing entry source');
});
it('scans an existing JavaScript launcher with ordinary data', () => {
  put('launcher.cjs', 'module.exports = { value: 1 };');
  const result = auditRuntimeStateBoundary(workspace, {
    ...policy,
    entryManifest: { files: ['launcher.cjs'] },
  });
  expect(result.compilerDiagnostics).toEqual([]);
  expect(result.findings).toEqual([]);
  expect(result.programs[0].files).toContain('launcher.cjs');
});
it('retains all 57 census modules and their precise entry derivations', () => {
  expect(productionEntryManifest.requiredClosure).toHaveLength(57);
  expect(productionEntryManifest.requiredClosure).toContain(
    'plugins/google-gemini/src/gemini/GeminiProvider.ts',
  );
  expect(productionEntryManifest.files).not.toContain('scripts/build.ts');
  const source = 'const config = {entrypoints: ["app.ts"]};';
  expect(() => verifyBundleEntryDeclarations(source, ['app.ts'])).not.toThrow();
  expect(() => verifyBundleEntryDeclarations(source, ['old.ts'])).toThrow(
    'manifest drift',
  );
  expect(() =>
    verifyBundleEntryDeclarations('const config = {entrypoints: compute()};', [
      'app.ts',
    ]),
  ).toThrow('Unsupported bundle entry');
});
it('selects both JavaScript launchers while retaining TypeScript closure', () => {
  put('launcher.cjs', 'module.exports = {};');
  put('launcher.mjs', 'export {};');
  const selection = selectBoundarySources(
    workspace,
    policy.sourceRoots,
    ['tsconfig.json'],
    {
      files: ['launcher.cjs', 'launcher.mjs'],
      requiredClosure: [
        'launcher.cjs',
        'launcher.mjs',
        'packages/demo/src/services.ts',
      ],
    },
  );
  expect(selection.gaps).toEqual([]);
  expect(selection.files).toEqual([
    join(workspace, 'launcher.cjs'),
    join(workspace, 'launcher.mjs'),
    join(workspace, 'packages/demo/src/services.ts'),
  ]);
});
it('rejects plugin host-contract stubs as substitutes for source identity', () => {
  put('plugin/src/index.ts', 'export {};');
  put('plugin/types/host-contract.d.ts', 'export interface Host {}');
  put(
    'plugin/tsconfig.json',
    JSON.stringify({
      extends: '../tsconfig.json',
      compilerOptions: {
        baseUrl: '.',
        paths: { '@host': ['types/host-contract.d.ts'] },
      },
    }),
  );
  expect(() =>
    selectBoundarySources(workspace, ['plugin/src'], ['plugin/tsconfig.json'], {
      identities: [
        {
          compilerConfig: 'plugin/tsconfig.json',
          from: 'plugin/src/index.ts',
          specifier: '@host',
          source: 'packages/demo/src/services.ts',
        },
      ],
    }),
  ).toThrow('Compiler source identity mismatch');
});
it('fails omitted required shipped closure even beside healthy roots', () => {
  expect(() =>
    selectBoundarySources(workspace, policy.sourceRoots, ['tsconfig.json'], {
      requiredClosure: ['missing-shipped.ts'],
    }),
  ).toThrow('Omitted shipped entry/closure');
});
it('excludes orphan test-utils files and integration helpers until reached', () => {
  put('packages/demo/src/test-utils.ts', bag);
  put(
    'packages/demo/src/integration-tests/helper.ts',
    'export const value = 1;',
  );
  expect(auditRuntimeStateBoundary(workspace, policy).files).toEqual([
    'packages/demo/src/services.ts',
  ]);
  put(
    'packages/demo/src/use.ts',
    'export type { Bag } from "./test-utils.js";',
  );
  expect(auditRuntimeStateBoundary(workspace, policy).findings).toContainEqual(
    expect.objectContaining({
      file: 'packages/demo/src/test-utils.ts',
      rule: 'runtime-service-bundle',
    }),
  );
});
it('uses a plugin own project aliases and exact host source identities', () => {
  put(
    'packages/demo/tsconfig.json',
    JSON.stringify({
      extends: '../../tsconfig.json',
      include: ['src/**/*.ts'],
    }),
  );
  put(
    'plugins/sample/tsconfig.json',
    JSON.stringify({
      extends: '../../tsconfig.json',
      compilerOptions: {
        baseUrl: '.',
        paths: { '@host': ['../../packages/demo/src/services.ts'] },
      },
      include: ['src/**/*.ts'],
    }),
  );
  put(
    'plugins/sample/src/index.ts',
    'import { Settings, Manager } from "@host"; export interface Bag { settings: Settings; manager: Manager; }',
  );
  const result = auditRuntimeStateBoundary(workspace, {
    ...policy,
    compilerProjects: [
      'packages/demo/tsconfig.json',
      'plugins/sample/tsconfig.json',
    ],
    sourceRoots: [...policy.sourceRoots, 'plugins/sample/src'],
    entryManifest: {
      identities: [
        {
          compilerConfig: 'plugins/sample/tsconfig.json',
          from: 'plugins/sample/src/index.ts',
          specifier: '@host',
          source: 'packages/demo/src/services.ts',
        },
      ],
    },
  });
  expect(result.compilerDiagnostics).toEqual([]);
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      file: 'plugins/sample/src/index.ts',
      rule: 'runtime-service-bundle',
    }),
  );
  expect(
    result.programs.find(
      (program) => program.compilerConfig === 'plugins/sample/tsconfig.json',
    )?.resolvedRoots,
  ).toContainEqual({
    file: 'packages/demo/src/services.ts',
    exportName: 'Settings',
    resolvedFile: 'packages/demo/src/services.ts',
  });
});
it('does not count unmapped generated declarations as source closure', () => {
  put('packages/demo/dist/unknown.d.ts', 'export interface Unknown {}');
  put(
    'packages/demo/src/use.ts',
    'export type { Unknown } from "../dist/unknown.js";',
  );
  expect(() => auditRuntimeStateBoundary(workspace, policy)).toThrow(
    'Unmapped emitted dependency',
  );
});
it('scans distinct source implementations in conditional exports', () => {
  put('packages/demo/bun.ts', 'export {};');
  put('packages/demo/node.ts', bag.replace('./services', './src/services'));
  put(
    'packages/demo/package.json',
    JSON.stringify({
      exports: { '.': { bun: './bun.ts', import: './node.ts' } },
    }),
  );
  const result = auditRuntimeStateBoundary(workspace, {
    ...policy,
    entryManifest: { packages: ['packages/demo'] },
  });
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      file: 'packages/demo/node.ts',
      rule: 'runtime-service-bundle',
    }),
  );
});
it('maps generated public exports through actual compiler emit paths', () => {
  put(
    'packages/demo/tsconfig.json',
    JSON.stringify({
      extends: '../../tsconfig.json',
      include: ['src/**/*.ts'],
    }),
  );
  put(
    'packages/demo/tsconfig.build.json',
    JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: { declaration: true, rootDir: '.', outDir: 'artifact' },
      include: ['src/**/*.ts', 'public.ts'],
    }),
  );
  put('packages/demo/public.ts', bag.replace('./services', './src/services'));
  put(
    'packages/demo/package.json',
    JSON.stringify({
      exports: {
        '.': {
          types: './artifact/public.d.ts',
          import: './artifact/public.js',
        },
      },
    }),
  );
  const result = auditRuntimeStateBoundary(workspace, {
    ...policy,
    compilerProjects: ['packages/demo/tsconfig.json'],
    entryManifest: { packages: ['packages/demo'] },
  });
  expect(result.compilerDiagnostics).toEqual([]);
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      file: 'packages/demo/public.ts',
      rule: 'runtime-service-bundle',
    }),
  );
});
it('discovers explicitly published support files without enrolling build scripts', () => {
  put(
    'packages/demo/scripts/install.ts',
    bag.replace('./services', '../src/services'),
  );
  put('packages/demo/scripts/build.ts', 'export let unused = 1;');
  put(
    'packages/demo/package.json',
    JSON.stringify({
      files: ['src', 'scripts/install.ts'],
      scripts: { build: 'bun scripts/build.ts' },
    }),
  );
  const result = auditRuntimeStateBoundary(workspace, {
    ...policy,
    entryManifest: { packages: ['packages/demo'] },
  });
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      file: 'packages/demo/scripts/install.ts',
      rule: 'runtime-service-bundle',
    }),
  );
  expect(result.files).not.toContain('packages/demo/scripts/build.ts');
});
