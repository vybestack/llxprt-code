/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  auditRuntimeStateBoundary,
  type AuditPolicy,
} from '../check-runtime-state-boundary.js';

/**
 * Cross-package imported mutators.
 *
 * A module in a runtime state root imports its mutator through a package
 * name, not a relative path. Each package `exports` map names declarations
 * first, as every workspace package here does, so a resolution that follows
 * the declaration finds a signature and no body: the mutator's writes are
 * invisible and module state looks untouched. These cases pin the required
 * behaviour - the scan resolves a workspace package specifier to its
 * implementation source and follows the mutator into its body.
 *
 * The fixture reproduces the production export-map order rather than
 * reordering it, so a resolver that reads conditions in order stays honest.
 */
const policy: AuditPolicy = Object.freeze({
  compilerConfig: 'tsconfig.json',
  sourceRoots: Object.freeze(['packages/demo/src']),
  mutableRoots: Object.freeze(['packages/demo/src/runtime']),
  alsRoots: Object.freeze(['packages/demo/src']),
  services: Object.freeze([]),
  configs: Object.freeze([]),
  assembly: Object.freeze([]),
  ambientSources: Object.freeze([]),
  alsAllowances: Object.freeze([]),
});

let workspace: string;

function put(file: string, source: string): void {
  const path = resolve(workspace, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

function audit(): ReturnType<typeof auditRuntimeStateBoundary> {
  return auditRuntimeStateBoundary(workspace, policy);
}

interface LibraryCase {
  readonly name: string;
  readonly subpath: string;
  readonly source: string;
  readonly declaration: string;
}

function library({ name, subpath, source, declaration }: LibraryCase): void {
  const directory = `packages/${name}`;
  put(
    `${directory}/package.json`,
    JSON.stringify({
      name: `@fixture/${name}`,
      type: 'module',
      exports: {
        [`./${subpath}.js`]: {
          types: `./types/${subpath}.d.ts`,
          bun: `./src/${subpath}.ts`,
          import: `./dist/${subpath}.js`,
        },
      },
    }),
  );
  put(`${directory}/src/${subpath}.ts`, source);
  put(`${directory}/types/${subpath}.d.ts`, declaration);
  const link = `node_modules/@fixture/${name}`;
  mkdirSync(dirname(resolve(workspace, link)), { recursive: true });
  symlinkSync(
    resolve(workspace, directory),
    resolve(workspace, link),
    'junction',
  );
}

const mutateSource =
  'export function mutate(target: Record<string, number>): void { target.current = 1; }';
const mutateDeclaration =
  'export declare function mutate(target: Record<string, number>): void;\n';

beforeEach(() => {
  const evidence = resolve(
    import.meta.dir,
    '../tmp/verify2616-final/scanner-fixtures',
  );
  mkdirSync(evidence, { recursive: true });
  workspace = mkdtempSync(resolve(evidence, 'package-mutation-'));
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
      },
    }),
  );
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

function stateUsing(importLine: string, call: string): void {
  put(
    'packages/demo/src/runtime/state.ts',
    `${importLine} const sessions: Record<string, number> = Object.freeze({ current: 0 }); export function run(): void { ${call}(sessions); }`,
  );
}

function expectMutation(importLine: string, call: string): void {
  stateUsing(importLine, call);
  const result = audit();
  expect(result.compilerDiagnostics).toEqual([]);
  expect(result.findings).toContainEqual(
    expect.objectContaining({
      declaration: 'sessions',
      rule: 'module-mutation',
    }),
  );
  expect(result.exitCode).toBe(1);
}

describe('cross-package imported mutators', () => {
  it('follows a mutator imported through its package root export', () => {
    library({
      name: 'lib',
      subpath: 'index',
      source: mutateSource,
      declaration: mutateDeclaration,
    });
    expectMutation("import { mutate } from '@fixture/lib/index.js';", 'mutate');
  });

  it('follows a mutator exported from a package subpath', () => {
    library({
      name: 'lib',
      subpath: 'state/mutate',
      source: mutateSource,
      declaration: mutateDeclaration,
    });
    expectMutation(
      "import { mutate } from '@fixture/lib/state/mutate.js';",
      'mutate',
    );
  });

  it('follows a mutator the package re-exports from an internal module', () => {
    library({
      name: 'lib',
      subpath: 'index',
      source: "export { mutate } from './mutate.js';",
      declaration: 'export { mutate } from "./mutate.js";\n',
    });
    put('packages/lib/src/mutate.ts', mutateSource);
    put('packages/lib/types/mutate.d.ts', mutateDeclaration);
    expectMutation("import { mutate } from '@fixture/lib/index.js';", 'mutate');
  });

  it('follows a mutator reached through a second package', () => {
    library({
      name: 'lib',
      subpath: 'index',
      source: mutateSource,
      declaration: mutateDeclaration,
    });
    library({
      name: 'relay',
      subpath: 'index',
      source:
        "import { mutate } from '@fixture/lib/index.js'; export function forward(target: Record<string, number>): void { mutate(target); }",
      declaration:
        'export declare function forward(target: Record<string, number>): void;\n',
    });
    expectMutation(
      "import { forward } from '@fixture/relay/index.js';",
      'forward',
    );
  });

  it('permits an imported function that only reads its parameter', () => {
    library({
      name: 'lib',
      subpath: 'index',
      source:
        'export function read(target: Record<string, number>): number { return target.current ?? 0; }',
      declaration:
        'export declare function read(target: Record<string, number>): number;\n',
    });
    put(
      'packages/demo/src/runtime/state.ts',
      "import { read } from '@fixture/lib/index.js'; const sessions: Record<string, number> = Object.freeze({ current: 0 }); export function run(): number { return read(sessions); }",
    );
    const result = audit();
    expect(result.compilerDiagnostics).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});
