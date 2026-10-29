/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { applyFilters } from '../run_bun_tests.js';
import { resolveBunTestFiles } from '../bun-test-roots.js';
import { workspaceSourcePath } from '../runtime-source-discovery.js';
import { scanRuntimeServiceShapes } from './runtime-service-shape-guard.js';
import { scanRuntimeStateStructure } from './runtime-state-structure-guard.js';
import { nativePathModuleFixture } from './native-path-module-fixture.js';
import { scanInstalled } from './runtime-service-shape-test-helpers.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'native-path-inputs-'));
});
it('checks installed declarations through a native Windows compiler root', () => {
  expect(
    scanInstalled(
      'export const number: Readonly<{ value: number }> = { value: 1 };',
      'C:\\fixture\\installed.ts',
    ),
  ).toEqual([]);
  expect(() =>
    scanInstalled(
      'export const broken: number = "wrong";',
      'C:\\fixture\\installed.ts',
    ),
  ).toThrow('not assignable');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));
it('keeps compiler-normalized Windows sources fully covered by strict audit', async () => {
  const fixture = nativePathModuleFixture(root);
  fixture.put(
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
      },
      include: ['packages'],
    }),
  );
  fixture.put(
    'packages/demo/src/services.ts',
    'export class Clock { tick(): void {} } export class Session { id = 1; }',
  );
  fixture.put(
    'packages/demo/src/bag.ts',
    "import { Clock, Session } from './services.js'; export interface Bag { clock: Clock; session: Session; }",
  );
  const module = resolve(import.meta.dir, '../check-runtime-state-boundary.ts');
  const result = await fixture.run(`
import ts from ${JSON.stringify(resolve(import.meta.dir, '../../node_modules/typescript/lib/typescript.js'))};
import * as fs from ${JSON.stringify(join(root, 'filesystem-adapter.ts'))};
import { auditRuntimeStateBoundary } from ${JSON.stringify(module)};
Object.assign(ts.sys, { fileExists: fs.existsSync, readFile: (path: string) => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : undefined, directoryExists: (path: string) => fs.existsSync(path) && fs.statSync(path).isDirectory(), readDirectory: fs.readDirectory, realpath: fs.realpathSync });
const result = auditRuntimeStateBoundary('C:\\\\fixture', { compilerConfig: 'tsconfig.json', sourceRoots: ['packages/demo/src'], mutableRoots: [], alsRoots: [], services: ['Clock', 'Session'].map(exportName => ({file: 'packages/demo/src/services.ts', exportName})), configs: [], assembly: [], ambientSources: [], alsAllowances: [] });
console.log(JSON.stringify({exitCode: result.exitCode, findings: result.findings, diagnostics: result.compilerDiagnostics, files: result.programs.flatMap(program => program.files)}));
`);
  expect(result).toEqual({
    exitCode: 1,
    findings: [
      {
        rule: 'runtime-service-bundle',
        owner: 'demo',
        file: 'packages/demo/src/bag.ts',
        line: 1,
        column: 49,
      },
    ],
    diagnostics: [],
    files: ['packages/demo/src/bag.ts', 'packages/demo/src/services.ts'],
  });
});

it.each(['fixtures/sentinel-leak-fixture', 'fixtures\\sentinel-leak-fixture'])(
  'narrows the actual discovered inventory with positional filter %s',
  (filter) => {
    const repo = resolve(import.meta.dir, '../..');
    const inventory = resolveBunTestFiles(repo, 'scripts-tests');
    const selected = inventory.filter((entry) =>
      entry.file.endsWith(join('fixtures', 'sentinel-leak-fixture.test.ts')),
    );
    expect(selected).toHaveLength(1);
    expect(applyFilters(inventory, [filter])).toEqual(selected);
    const windowsInventory = inventory.map((entry) => ({
      ...entry,
      file: entry.file.replaceAll('/', '\\'),
    }));
    expect(applyFilters(windowsInventory, [filter])).toEqual(
      selected.map((entry) => ({
        ...entry,
        file: entry.file.replaceAll('/', '\\'),
      })),
    );
    expect(applyFilters(inventory, ['fixtures/nonexistent'])).toEqual([]);
  },
);

it('accepts compiler separator forms at workspace containment without admitting traversal', () => {
  expect(workspaceSourcePath(root, 'packages\\demo\\src\\entry.ts')).toBe(
    join(root, 'packages/demo/src/entry.ts'),
  );
  expect(() => workspaceSourcePath(root, '..\\outside.ts')).toThrow(
    'Path outside audit workspace',
  );
});

it.each(['C:\\fixture\\services.ts', 'C:/fixture/services.ts'])(
  'checks typed service roots and nested imports with compiler identity %s',
  (file) => {
    const findings = scanRuntimeServiceShapes(
      {
        [file]:
          'export class Clock { tick(): void {} } export class Session { id = 1; }',
        'C:\\fixture\\nested\\consumer.ts':
          "import { Clock, Session } from '../services.js'; export interface Bag { clock: Clock; session: Session; }",
      },
      {
        services: ['Clock', 'Session'].map((exportName) => ({
          file,
          exportName,
        })),
        configs: [],
      },
    );
    expect(findings).toEqual([
      {
        rule: 'runtime-service-bundle',
        file: 'C:\\fixture\\nested\\consumer.ts',
        line: 1,
        column: 50,
      },
    ]);
  },
);

it('binds Windows single-source mutation nodes to their actual checker program', () => {
  const file = 'C:\\fixture\\state.ts';
  expect(
    scanRuntimeStateStructure(
      file,
      'const sessions = {}; function fill(target) { target.current = 1; } function run() { fill(sessions); }',
    ),
  ).toEqual([
    {
      file,
      declaration: 'sessions',
      kind: 'module-mutation',
      line: 1,
      column: 85,
    },
  ]);
});

it.each(['errors.ts', 'RetryOrchestrator.ts'])(
  'rejects ambient retry identity on native Windows basename %s',
  async (name) => {
    const fixture = nativePathModuleFixture(root);
    fixture.put(name, 'export const value = getActiveRuntimeIdentity();');
    const module = resolve(import.meta.dir, 'ambient-runtime-symbols-guard.ts');
    const result = await fixture.run(
      `import { scanForBannedAmbientSymbols } from ${JSON.stringify(module)};
console.log(JSON.stringify(scanForBannedAmbientSymbols(['C:/fixture/'])));`,
    );
    expect(result).toEqual({
      scannedFiles: 1,
      violations: [
        {
          file: `C:\\fixture\\${name}`,
          line: 1,
          text: 'export const value = getActiveRuntimeIdentity();',
        },
      ],
    });
  },
);

it('classifies real compiler maps with native Windows filenames and rejects a mismatched map', async () => {
  const fixture = nativePathModuleFixture(root);
  const file = 'packages/core/src/current.ts';
  const source = 'export class Current { value(): number { return 2; } }';
  const emitted = ts.transpileModule(source, {
    fileName: 'C:\\fixture\\packages\\core\\src\\current.ts',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
    },
    reportDiagnostics: true,
  });
  expect(emitted.diagnostics).toEqual([]);
  if (emitted.sourceMapText === undefined)
    throw new Error('Compiler emitted no source map');
  fixture.put(file, source);
  fixture.put(file.replace('.ts', '.js'), emitted.outputText);
  fixture.put(file.replace('.ts', '.js.map'), emitted.sourceMapText);
  fixture.put('packages/core/src/authored.js', 'export const authored = 1;');
  const module = resolve(import.meta.dir, '../compiler-emitted-siblings.ts');
  const run = (): Promise<unknown> =>
    fixture.run(
      `import { compilerEmittedSiblings } from ${JSON.stringify(module)};
console.log(JSON.stringify(compilerEmittedSiblings('C:/fixture/')));`,
    );
  expect(await run()).toEqual(['packages/core/src/current.js']);
  const resolver = resolve(
    import.meta.dir,
    '../source-emitted-sibling-resolution.ts',
  );
  expect(
    await fixture.run(`
import { resolveEmittedSiblingImport, releaseSourceEmittedSiblingPlugin } from ${JSON.stringify(resolver)};
const root = 'C:/fixture/';
const emitted = new Set(['packages/core/src/current.js']);
const resolved = ['./current.js', '.\\\\current.js'].map(specifier => resolveEmittedSiblingImport(specifier, 'C:/fixture/packages/core/src/consumer.ts', root, emitted));
const plugin = releaseSourceEmittedSiblingPlugin(root);
const matches: boolean[] = [];
const built = await Bun.build({entrypoints: [${JSON.stringify(join(root, 'filesystem/packages/core/src/current.ts'))}], target: 'bun', plugins: [{name: 'observe registered native import filter', setup(build) {
  return plugin.setup({...build, onResolve(options, callback) { matches.push(options.filter.test('./current.js'), options.filter.test('.\\\\current.js')); return build.onResolve(options, callback); }});
}}]});
if (!built.success) throw new Error(built.logs.join('\\n'));
console.log(JSON.stringify({resolved, matches}));
`),
  ).toEqual({
    resolved: [
      'C:\\fixture\\packages\\core\\src\\current.ts',
      'C:\\fixture\\packages\\core\\src\\current.ts',
    ],
    matches: [true, true],
  });
  fixture.put(
    file.replace('.ts', '.js.map'),
    emitted.sourceMapText.replace('current.js', 'other.js'),
  );
  expect(await run()).toEqual([]);
});
