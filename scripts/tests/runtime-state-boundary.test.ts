/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  auditRuntimeStateBoundary,
  discoverProductionSources,
  productionPolicy,
  type AuditPolicy,
} from '../check-runtime-state-boundary.js';

const evidence = join(tmpdir(), 'llxprt-structural-audit-per-package');
let workspace: string;
function put(file: string, text: string): void {
  const path = join(workspace, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
const policy: AuditPolicy = {
  compilerConfig: 'tsconfig.json',
  sourceRoots: ['packages/demo/src'],
  mutableRoots: ['packages/demo/src/runtime'],
  alsRoots: ['packages/demo/src'],
  services: [
    { file: 'packages/demo/src/services.ts', exportName: 'Settings' },
    { file: 'packages/demo/src/services.ts', exportName: 'Manager' },
  ],
  configs: [{ file: 'packages/demo/src/services.ts', exportName: 'Config' }],
  assembly: [
    { file: 'packages/demo/src/assembly.ts', functionName: 'assemble' },
  ],
  ambientSources: [
    { file: 'packages/demo/src/services.ts', exportName: 'active' },
  ],
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
        noEmit: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        types: [],
        skipLibCheck: true,
        baseUrl: '.',
        paths: { '@services': ['packages/demo/src/services.ts'] },
      },
    }),
  );
  put(
    'packages/demo/src/services.ts',
    `
    export class Settings { value = 1; }
    export class Manager { name = 'manager'; }
    export class Config { getSettings(): Settings { return new Settings(); } }
    export function active(): Settings { return new Settings(); }
  `,
  );
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe('runtime boundary production runner', () => {
  it('discovers production sources and excludes tests, specs, fixtures and declarations', () => {
    for (const file of [
      'a.test.ts',
      'b.spec.tsx',
      '__tests__/helper.ts',
      'fixtures/input.ts',
      '__fixtures__/input.ts',
      'types.d.ts',
    ])
      put(`packages/demo/src/${file}`, 'let hidden = 0;');
    put('packages/demo/src/nested/worker.ts', 'export const value = 1;');
    expect(
      discoverProductionSources(workspace, policy.sourceRoots).map((file) =>
        file.slice(workspace.length + 1),
      ),
    ).toEqual([
      'packages/demo/src/nested/worker.ts',
      'packages/demo/src/services.ts',
    ]);
  });

  it('resolves independent runtime-object roots for Config but permits narrow injection', () => {
    put(
      'packages/demo/src/hooks.ts',
      'export class Hooks { private state = 0; run(): void {} }',
    );
    put(
      'packages/demo/src/locator.ts',
      `import { Hooks } from './hooks.js';
      export class Locator { getHooks(): Hooks { return new Hooks(); } }
      export function consume(hooks: Hooks): void {}
      new Locator().getHooks();`,
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      configs: [
        { file: 'packages/demo/src/locator.ts', exportName: 'Locator' },
      ],
      runtimeObjects: [
        { file: 'packages/demo/src/hooks.ts', exportName: 'Hooks' },
      ],
    });
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings.map((finding) => finding.rule)).toEqual([
      'config-service-locator',
    ]);
    expect(result.programs[0]?.resolvedRoots).toContainEqual({
      file: 'packages/demo/src/hooks.ts',
      exportName: 'Hooks',
      resolvedFile: 'packages/demo/src/hooks.ts',
    });
  });

  it('keeps configured JSON asset roots when auditing a composite production project', () => {
    put('packages/demo/package.json', JSON.stringify({ type: 'module' }));
    put(
      'packages/demo/src/core/limits.json',
      JSON.stringify({ defaultLimit: 200000 }),
    );
    put('packages/demo/src/core/schema.ts', 'export const offset = 1;');
    put(
      'packages/demo/src/core/reader.ts',
      "import { offset } from './schema.js'; import limits from './limits.json' with { type: 'json' }; export const limit = limits.defaultLimit + offset;",
    );
    put(
      'packages/demo/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.json',
        compilerOptions: {
          composite: true,
          resolveJsonModule: true,
          outDir: 'dist',
        },
        include: ['src/**/*.ts', 'src/**/*.json'],
      }),
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      compilerProjects: ['packages/demo/tsconfig.json'],
    });
    expect(result.files).toContain('packages/demo/src/core/reader.ts');
    expect(result.files).not.toContain('packages/demo/src/core/limits.json');
    expect(result.programs[0]?.files).toContain(
      'packages/demo/src/core/reader.ts',
    );
    expect(result.compilerDiagnostics).toEqual([]);
  });

  it('keeps excluded source violations out of the audit', () => {
    for (const file of [
      'bad.test.ts',
      'bad.spec.tsx',
      '__tests__/bad.ts',
      'fixtures/bad.ts',
      '__fixtures__/bad.ts',
    ]) {
      put(
        `packages/demo/src/runtime/${file}`,
        'export let state: number = "bad";',
      );
    }
    put(
      'packages/demo/src/fixtures/override.d.ts',
      "declare module '@services' { export const broken: number; }",
    );
    put(
      'packages/demo/src/use.ts',
      "import { Settings } from '@services'; export const setting = new Settings();",
    );
    const result = auditRuntimeStateBoundary(workspace, policy);
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('uses package source exports for service identity instead of built declarations', () => {
    put(
      'packages/demo/package.json',
      JSON.stringify({
        name: '@fixture/demo',
        exports: { '.': { types: './missing.d.ts', bun: './src/services.ts' } },
      }),
    );
    put(
      'packages/demo/src/bag.ts',
      `import { Settings, Manager } from '@fixture/demo';
      export interface Bag { settings: Settings; manager: Manager; }`,
    );
    put(
      'packages/demo/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.json',
        compilerOptions: {
          paths: { '@fixture/demo': ['packages/demo/src/services.ts'] },
        },
        include: ['src/**/*.ts'],
      }),
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      compilerProjects: ['packages/demo/tsconfig.json'],
    });
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings.map((finding) => finding.rule)).toEqual([
      'runtime-service-bundle',
    ]);
  });

  it('does not truncate large finding sets', () => {
    put(
      'packages/demo/src/delegates.ts',
      "import { active } from '@services'; " +
        Array.from(
          { length: 125 },
          (_, index) =>
            `export function delegate${index}() { return active(); }`,
        ).join(' '),
    );
    const result = auditRuntimeStateBoundary(workspace, policy);
    expect(result.findings).toHaveLength(125);
    expect(result.countsByOwner.demo?.['runtime-ambient-delegation']).toBe(125);
    expect(result.exitCode).toBe(1);
  });

  it('returns zero for clean sources with resolved tsconfig path identities', () => {
    put(
      'packages/demo/src/use.ts',
      "import { Settings } from '@services'; export function use(s: Settings): number { return s.value; }",
    );
    const result = auditRuntimeStateBoundary(workspace, policy);
    expect({
      exit: result.exitCode,
      findings: result.findings,
      compiler: result.compilerDiagnostics,
    }).toEqual({ exit: 0, findings: [], compiler: [] });
    expect(result.scanners.serviceShape).toBe('complete');
  });

  it('reports unfinished service queries as incomplete instead of complete', () => {
    put(
      'packages/demo/src/expanding.ts',
      'export interface Expanding<T> { next(): Expanding<{ value: T }> }',
    );
    const result = auditRuntimeStateBoundary(workspace, policy);
    expect(
      result.findings.some(
        (finding) => finding.rule === 'runtime-service-analysis-resource-limit',
      ),
    ).toBe(true);
    expect(result.programs[0]?.scanners.serviceShape).toBe('resource-limit');
    expect(result.scanners.serviceShape).toBe('resource-limit');
  });

  it('runs all three scanners and fails for mutable state, service bags, locators and ambient delegation', () => {
    put(
      'packages/demo/src/runtime/bad.ts',
      `
      import { Settings, Manager, Config, active } from '@services';
      export let counter = 0;
      export interface Bag { settings: Settings; manager: Manager; }
      export function use(bag: Bag, config: Config): Settings {
        counter++; config.getSettings(); return active();
      }
    `,
    );
    const result = auditRuntimeStateBoundary(workspace, policy);
    expect(result.exitCode).toBe(1);
    expect(new Set(result.findings.map((finding) => finding.rule))).toEqual(
      new Set([
        'mutable-state',
        'module-mutation',
        'runtime-service-bundle',
        'runtime-service-bag-parameter',
        'config-service-locator',
        'runtime-ambient-delegation',
      ]),
    );
  });

  it('limits assembly allowances to the named function and never exempts locators', () => {
    put(
      'packages/demo/src/assembly.ts',
      `
      import { Settings, Manager, Config } from '@services';
      export function assemble(bag: {s: Settings; m: Manager}, config: Config): void { config.getSettings(); }
      export function work(bag: {s: Settings; m: Manager}): void {}
      export interface Bag {s: Settings; m: Manager}
    `,
    );
    const result = auditRuntimeStateBoundary(workspace, policy);
    expect(result.findings.map((finding) => finding.rule).sort()).toEqual([
      'config-service-locator',
      'runtime-service-bag-parameter',
      'runtime-service-bundle',
    ]);
  });

  it('allows only the exact BaseProvider call-option ALS scope and still reports runtime identity ALS', () => {
    const file = 'packages/providers/src/BaseProvider.ts';
    put(
      file,
      `import { AsyncLocalStorage } from 'node:async_hooks';
      export class BaseProvider {
        readonly activeCallContext = new AsyncLocalStorage<string>();
        readonly identity = new AsyncLocalStorage<string>();
      }`,
    );
    put(
      'packages/providers/src/Other.ts',
      `import { AsyncLocalStorage } from 'node:async_hooks';
      export class BaseProvider { readonly activeCallContext = new AsyncLocalStorage<string>(); }`,
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      sourceRoots: [...policy.sourceRoots, 'packages/providers/src'],
      alsRoots: ['packages/providers/src'],
      alsAllowances: productionPolicy.alsAllowances,
    });
    expect(
      result.findings
        .filter((f) => f.rule === 'async-local-storage')
        .map((f) => f.declaration)
        .sort(),
    ).toEqual(['BaseProvider.activeCallContext', 'BaseProvider.identity']);
    expect(result.exitCode).toBe(1);
  });

  describe('immutable lookup table allowlist', () => {
    const tableFile = 'packages/demo/src/runtime/table.ts';
    const tableSource = "export const labels = { a: 'x' } as const;";
    const kinds = (
      immutableTables: AuditPolicy['immutableTables'],
    ): Array<[string, string | undefined]> =>
      auditRuntimeStateBoundary(workspace, { ...policy, immutableTables })
        .findings.filter((finding) => finding.rule !== 'runtime-service-bundle')
        .map((finding) => [finding.declaration ?? '', finding.rule]);

    it('rejects an unlisted mutable module literal in a state root', () => {
      put(tableFile, tableSource);
      expect(kinds(undefined)).toEqual([['labels', 'mutable-state']]);
    });

    it('passes the same literal once committed in the allowlist', () => {
      put(tableFile, tableSource);
      expect(
        kinds([
          {
            file: tableFile,
            declaration: 'labels',
            reason: 'Fixed display labels, never written.',
          },
        ]),
      ).toEqual([]);
    });

    it('fails an allowlist entry whose declaration was removed or file is outside the state roots', () => {
      put(tableFile, 'export const labels = 1;');
      put('packages/demo/src/elsewhere.ts', tableSource);
      expect(
        kinds([
          { file: tableFile, declaration: 'labels', reason: 'Was a table.' },
          {
            file: 'packages/demo/src/elsewhere.ts',
            declaration: 'labels',
            reason: 'Outside state roots.',
          },
        ]),
      ).toEqual([
        ['labels', 'stale-immutable-allowance'],
        ['labels', 'stale-immutable-allowance'],
      ]);
    });
  });

  it('resolves AsyncLocalStorage constructors re-exported from another file', () => {
    put(
      'packages/core/src/scopeExport.ts',
      "export { AsyncLocalStorage as Scope } from 'node:async_hooks';",
    );
    put(
      'packages/core/src/scopeUse.ts',
      "import { Scope } from './scopeExport.js'; export const scope = new Scope<string>();",
    );
    put(
      'packages/core/src/scopeChain.ts',
      "export { Scope as Chained } from './scopeExport.js';",
    );
    put(
      'packages/core/src/scopeChainUse.ts',
      "import { Chained } from './scopeChain.js'; export const chained = new Chained<string>();",
    );
    put(
      'packages/core/src/scopeNamespaceUse.ts',
      "import * as scopes from './scopeExport.js'; export const spaced = new scopes.Scope<string>();",
    );
    put(
      'packages/core/src/scopeAliasExport.ts',
      "import { AsyncLocalStorage } from 'node:async_hooks'; export const AliasedScope = AsyncLocalStorage;",
    );
    put(
      'packages/core/src/scopeAliasUse.ts',
      "import { AliasedScope } from './scopeAliasExport.js'; export const aliased = new AliasedScope<string>();",
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      sourceRoots: [...policy.sourceRoots, 'packages/core/src'],
      alsRoots: ['packages/core/src'],
    });
    expect(
      result.findings
        .filter((finding) => finding.rule === 'async-local-storage')
        .map((finding) => finding.file)
        .sort(),
    ).toEqual([
      'packages/core/src/scopeAliasUse.ts',
      'packages/core/src/scopeChainUse.ts',
      'packages/core/src/scopeNamespaceUse.ts',
      'packages/core/src/scopeUse.ts',
    ]);
    expect(result.exitCode).toBe(1);
  });

  it('does not report constructors re-exported from unrelated modules', () => {
    put(
      'packages/core/src/containerExport.ts',
      "export { Map as Container } from './other.js'; export class Other {}",
    );
    put('packages/core/src/other.ts', 'export class Map {}');
    put(
      'packages/core/src/containerUse.ts',
      "import { Container } from './containerExport.js'; export function make() { return new Container(); }",
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      sourceRoots: [...policy.sourceRoots, 'packages/core/src'],
      alsRoots: ['packages/core/src'],
    });
    expect(
      result.findings.filter(
        (finding) => finding.rule === 'async-local-storage',
      ),
    ).toEqual([]);
  });

  it('reports compiler errors and a blocked service scan without disguising the audit as clean', () => {
    put('packages/demo/src/broken.ts', 'export const value: number = "bad";');
    const result = auditRuntimeStateBoundary(workspace, policy);
    expect(result.exitCode).toBe(1);
    expect(result.compilerDiagnostics.some((d) => d.code === 2322)).toBe(true);
    expect(result.scanners.serviceShape).toBe('blocked-by-compiler');
  });

  it('records explicitly deletion-eligible absent roots but fails unresolved required roots', () => {
    const deleted = {
      file: 'packages/demo/src/deleted.ts',
      exportName: 'oldActive',
      absentReason: 'Removed ambient owner in migration',
    };
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      ambientSources: [...policy.ambientSources, deleted],
    });
    expect(result.absentAmbientSources).toEqual([deleted]);
    put(
      deleted.file,
      "import { Settings } from '@services'; export function oldActive() { return new Settings(); }",
    );
    put(
      'packages/demo/src/restore.ts',
      "import { oldActive } from './deleted.js'; export function restored() { return oldActive(); }",
    );
    const restored = auditRuntimeStateBoundary(workspace, {
      ...policy,
      ambientSources: [...policy.ambientSources, deleted],
    });
    expect(restored.absentAmbientSources).toEqual([]);
    expect(restored.findings.map((finding) => finding.rule)).toEqual([
      'runtime-ambient-delegation',
    ]);
    expect(() =>
      auditRuntimeStateBoundary(workspace, {
        ...policy,
        ambientSources: [
          { file: 'packages/demo/src/services.ts', exportName: 'typo' },
        ],
      }),
    ).toThrow('Unresolved ambient source');
  });
});

function packagePolicy(): AuditPolicy {
  for (const name of ['demo', 'other']) {
    put(
      `packages/${name}/tsconfig.json`,
      JSON.stringify({
        extends: '../../tsconfig.json',
        compilerOptions: {
          noUnusedLocals: name === 'demo',
          skipLibCheck: false,
        },
        include: ['src/**/*.ts'],
      }),
    );
    put(
      `packages/${name}/src/global.d.ts`,
      `declare const packageValue: ${name === 'demo' ? 'number' : 'string'};`,
    );
  }
  put(
    'packages/other/src/use.ts',
    'const unused = 1; export const value: string = packageValue;',
  );
  return {
    ...policy,
    compilerProjects: [
      'packages/demo/tsconfig.json',
      'packages/other/tsconfig.json',
    ],
    sourceRoots: ['packages/demo/src', 'packages/other/src'],
  };
}

describe('package compiler integration', () => {
  it('keeps package options and incompatible ambient declarations separate', () => {
    const progress: string[] = [];
    const result = auditRuntimeStateBoundary(
      workspace,
      packagePolicy(),
      (event) => {
        progress.push(`${event.compilerConfig}:${event.phase}`);
      },
    );
    expect(progress).toEqual([
      'packages/demo/tsconfig.json:compiler-complete',
      'packages/demo/tsconfig.json:scanners-complete',
      'packages/other/tsconfig.json:compiler-complete',
      'packages/other/tsconfig.json:scanners-complete',
    ]);
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.programs.map((p) => p.scanners.serviceShape)).toEqual([
      'complete',
      'complete',
    ]);
    expect(result.programs[1]?.unavailableRoots).toContainEqual({
      ...policy.services[0],
      reason: 'not-in-program',
    });
  });

  it('retains genuine package errors and scans the other clean program', () => {
    const packages = packagePolicy();
    put('packages/demo/src/broken.ts', 'const unused = 1; export {};');
    const result = auditRuntimeStateBoundary(workspace, packages);
    expect(result.compilerDiagnostics.some((d) => d.code === 6133)).toBe(true);
    expect(result.programs.map((p) => p.scanners.serviceShape)).toEqual([
      'blocked-by-compiler',
      'complete',
    ]);
    expect(result.exitCode).toBe(1);
  });

  it('covers independent entry graphs and deduplicates overlapping program findings', () => {
    const packages = packagePolicy();
    put(
      'packages/demo/src/one.ts',
      "import { active } from './services.js'; export function one() { return active(); }",
    );
    put(
      'packages/demo/src/two.ts',
      "import { active } from './services.js'; export function two() { return active(); }",
    );
    put(
      'packages/demo/tsconfig.extra.json',
      JSON.stringify({ extends: './tsconfig.json' }),
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...packages,
      compilerProjects: [
        ...(packages.compilerProjects ?? []),
        'packages/demo/tsconfig.extra.json',
      ],
    });
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toHaveLength(2);
    expect(result.files).toContain('packages/demo/src/two.ts');
  });

  it('fails explicitly for production files outside every configured program', () => {
    const packages = packagePolicy();
    put(
      'packages/demo/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.json',
        files: ['src/services.ts'],
        include: [],
      }),
    );
    put('packages/demo/src/orphan.ts', 'export const value = 1;');
    expect(() => auditRuntimeStateBoundary(workspace, packages)).toThrow(
      'Uncovered production sources',
    );
  });

  it('does not treat a misspelled required root as an absent dependency', () => {
    const packages = packagePolicy();
    expect(() =>
      auditRuntimeStateBoundary(workspace, {
        ...packages,
        services: [
          { file: 'packages/demo/src/missing.ts', exportName: 'Missing' },
        ],
      }),
    ).toThrow('Unresolved class/interface declaration root');
  });
  it('maps policy roots to the declarations actually imported by a package', () => {
    const packages = packagePolicy();
    put(
      'packages/demo/tsconfig.build.json',
      JSON.stringify({
        extends: './tsconfig.json',
        compilerOptions: {
          noEmit: false,
          declaration: true,
          rootDir: 'src',
          outDir: 'dist',
        },
      }),
    );
    put(
      'packages/demo/dist/services.d.ts',
      'export declare class Settings { value: number; } export declare class Manager { name: string; } export declare class Config { getSettings(): Settings; } export declare function active(): Settings;',
    );
    put(
      'packages/other/src/bag.ts',
      "import { Settings, Manager } from '../../demo/dist/services.js'; export interface Bag { settings: Settings; manager: Manager; }",
    );
    const result = auditRuntimeStateBoundary(workspace, packages);
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings.map((f) => [f.file, f.rule])).toEqual([
      ['packages/other/src/bag.ts', 'runtime-service-bundle'],
    ]);
    expect(result.programs[1]?.resolvedRoots).toContainEqual({
      ...policy.services[0],
      resolvedFile: 'packages/demo/dist/services.d.ts',
    });
  });

  it('maps independent runtime objects through emitted declarations by identity', () => {
    const packages = packagePolicy();
    put(
      'packages/demo/tsconfig.build.json',
      JSON.stringify({
        extends: './tsconfig.json',
        compilerOptions: {
          noEmit: false,
          declaration: true,
          rootDir: 'src',
          outDir: 'dist',
        },
      }),
    );
    put(
      'packages/demo/src/hooks.ts',
      'export class Hooks { run(): void {} } export class Locator { hooks(): Hooks { return new Hooks(); } }',
    );
    put(
      'packages/demo/dist/hooks.d.ts',
      'export declare class Hooks { run(): void; } export declare class Locator { hooks(): Hooks; }',
    );
    put(
      'packages/other/src/locator.ts',
      `import { Locator, Hooks } from '../../demo/dist/hooks.js';
      export function use(hooks: Hooks): void {}
      new Locator().hooks();
      class Unrelated { hooks(): { label: string } { return { label: 'data' }; } }
      new Unrelated().hooks();`,
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...packages,
      configs: [{ file: 'packages/demo/src/hooks.ts', exportName: 'Locator' }],
      runtimeObjects: [
        { file: 'packages/demo/src/hooks.ts', exportName: 'Hooks' },
      ],
    });
    expect(result.compilerDiagnostics).toEqual([]);
    expect(
      result.findings.map((finding) => [finding.file, finding.rule]),
    ).toEqual([['packages/other/src/locator.ts', 'config-service-locator']]);
    expect(result.programs[1]?.resolvedRoots).toContainEqual({
      file: 'packages/demo/src/hooks.ts',
      exportName: 'Hooks',
      resolvedFile: 'packages/demo/dist/hooks.d.ts',
    });
  });

  it('records removed exports only with the existing explicit deletion reason', () => {
    const removed = {
      file: 'packages/demo/src/services.ts',
      exportName: 'removed',
      absentReason: 'Migration removed this export',
    };
    const result = auditRuntimeStateBoundary(workspace, {
      ...policy,
      ambientSources: [removed],
    });
    expect(result.absentAmbientSources).toEqual([removed]);
    expect(result.exitCode).toBe(0);
  });
  it('ignores stale emitted exports and JS siblings while auditing current TS and shipped JS', () => {
    const packages = packagePolicy();
    put(
      'packages/demo/tsconfig.build.json',
      JSON.stringify({
        extends: './tsconfig.json',
        compilerOptions: {
          noEmit: false,
          declaration: true,
          rootDir: 'src',
          outDir: 'dist',
        },
      }),
    );
    put(
      'packages/demo/src/services.ts',
      `export class Settings { value = 1; }
       export class Manager { name = 'manager'; }
       export class Config { getSettings(): Settings { return new Settings(); } }
       export function active(): Settings { return new Settings(); }`,
    );
    put(
      'packages/demo/dist/services.d.ts',
      `export declare class Settings { value: number; }
       export declare class Manager { name: string; }
       export declare class Config { getSettings(): Settings; }
       export declare function active(): Settings;
       export declare function retired(): Settings;`,
    );
    put('packages/demo/src/sibling.ts', 'export const current = 1;');
    put(
      'packages/demo/src/sibling.d.ts',
      'export declare const current: number;',
    );
    put('packages/demo/src/sibling.js', 'export let staleRuntime = 1;');
    put('packages/demo/src/shipped.js', 'export let shippedRuntime = 1;');
    put(
      'packages/other/src/current.ts',
      `import { Settings, Manager } from '../../demo/dist/services.js';
       export interface Bag { settings: Settings; manager: Manager; }`,
    );
    put(
      'packages/other/src/stale.ts',
      `import { retired } from '../../demo/dist/services.js';
       export function oldDelegate() { return retired(); }`,
    );
    put(
      'packages/demo/src/live.ts',
      `import { active } from './services.js';
       export function currentDelegate() { return active(); }`,
    );
    const result = auditRuntimeStateBoundary(workspace, {
      ...packages,
      mutableRoots: ['packages/demo/src'],
      ambientSources: [
        ...policy.ambientSources,
        {
          file: 'packages/demo/src/services.ts',
          exportName: 'retired',
          absentReason: 'Removed from current TS source',
        },
      ],
    });
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.absentAmbientSources.map((root) => root.exportName)).toEqual([
      'retired',
    ]);
    expect(result.findings.map((f) => [f.file, f.rule])).toEqual([
      ['packages/demo/src/live.ts', 'runtime-ambient-delegation'],
      ['packages/demo/src/shipped.js', 'mutable-state'],
      ['packages/other/src/current.ts', 'runtime-service-bundle'],
    ]);
    expect(result.files).not.toContain('packages/demo/src/sibling.js');
    expect(result.files).toContain('packages/demo/src/shipped.js');
  });
});
