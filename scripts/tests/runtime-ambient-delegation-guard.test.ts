/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import ts from 'typescript';
import {
  scanAmbientDelegation,
  type AmbientSource,
} from './runtime-ambient-delegation-guard.js';

const declarations = `
export interface Service { run(): void; child: Service }
export declare function lookup(): Service;
export declare function scope(): string;
export declare function operate(service: Service): void;
export declare const registry: { get(key: string): Service };
export declare const identity: { getStore(): Service };
`;

function fixture(body: string): ts.Program {
  const files = new Map([
    ['/ambient.ts', declarations],
    ['/barrel.ts', "export { lookup as renamed } from './ambient';"],
    [
      '/helper.ts',
      "import { lookup } from './ambient'; export const renamedLookup = () => lookup();",
    ],
    [
      '/consumer.ts',
      `import { lookup, scope, operate, registry, identity, type Service } from './ambient';\n${body}`,
    ],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    noLib: true,
    types: [],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host = ts.createCompilerHost(options);
  host.fileExists = (file): boolean => files.has(file);
  host.readFile = (file): string | undefined => files.get(file);
  host.getSourceFile = (file, version): ts.SourceFile | undefined => {
    const text = files.get(file);
    return text === undefined
      ? undefined
      : ts.createSourceFile(file, text, version, true);
  };
  const program = ts.createProgram([...files.keys()], options, host);
  expect(program.getSyntacticDiagnostics()).toEqual([]);
  expect(program.getSemanticDiagnostics()).toEqual([]);
  return program;
}

const sources: readonly AmbientSource[] = [
  { file: '/ambient.ts', exportName: 'lookup' },
  { file: '/ambient.ts', exportName: 'registry', members: ['get'] },
  { file: '/ambient.ts', exportName: 'identity', members: ['getStore'] },
];

function scan(body: string): ReturnType<typeof scanAmbientDelegation> {
  const program = fixture(body);
  return scanAmbientDelegation(
    program,
    [program.getSourceFile('/consumer.ts')!],
    sources,
  );
}

describe('ambient delegation provenance guard', () => {
  it.each([
    'function wrapper() { operate(lookup()); }',
    "import { lookup as renamed } from './ambient'; function wrapper() { operate(renamed()); }",
    "import { renamed } from './barrel'; function wrapper() { operate(renamed()); }",
    'function wrapper() { const get = lookup; const service = get(); operate(service); }',
    'function wrapper() { let get = lookup; const alias = get; operate(alias()); }',
    'function intermediary() { return lookup(); } function wrapper() { operate(intermediary()); }',
    'const intermediary = () => lookup(); function wrapper() { operate(intermediary()); }',
    'function wrapper() { operate(registry.get("active")); }',
    'function wrapper() { const r = registry; operate(r.get("active")); }',
    'function wrapper() { operate(identity.getStore()); }',
    'function oldWrapper() { return operate(lookup()); }',
    'function wrapper() { let service: Service; service = lookup(); operate(service); }',
    'function wrapper() { const { child: service } = lookup(); operate(service); }',
    'function wrapper() { let service: Service; ({ child: service } = lookup()); operate(service); }',
    'function wrapper() { const [service] = [lookup()]; operate(service); }',
    'function wrapper() { let child: Service; ({ child } = lookup()); operate(child); }',
    'function wrapper() { let get: typeof lookup; get = lookup; operate(get()); }',
    'function wrapper() { const get = identity.getStore; operate(get()); }',
    'function helper() { return lookup(); } function wrapper() { const get = helper; operate(get()); }',
  ])('rejects ambient flow: %s', (body) => {
    expect(
      scan(body).some(
        (finding) =>
          finding.rule === 'runtime-ambient-delegation' &&
          finding.kind === 'argument',
      ),
    ).toBe(true);
  });

  it.each([
    'function wrapper(service: Service) { operate(service); service.run(); return service; }',
    'function wrapper() { return scope(); }',
    'const DOMAIN = 42; function pure() { return DOMAIN; } function wrapper() { return pure(); }',
    'class Owned { constructor(private service: Service) {} run() { this.service.run(); return this.service; } }',
    'function wrapper() { function lookup() { return 42; } return lookup(); }',
    'function one(): Service { return two(); } function two(): Service { return one(); }',
  ])('permits explicit or unconfigured provenance: %s', (body) => {
    expect(scan(body)).toEqual([]);
  });

  it('reports the delegated argument location after helper summaries converge', () => {
    const findings = scan(
      'function wrapper() { operate(first()); }\nfunction first(): Service { return second(); }\nfunction second(): Service { if (scope()) return first(); return lookup(); }',
    );
    expect(findings).toContainEqual({
      rule: 'runtime-ambient-delegation',
      file: '/consumer.ts',
      line: 2,
      column: 22,
      kind: 'argument',
    });
  });

  it('reports receiver and returned-service sinks separately', () => {
    expect(
      scan('function wrapper() { const s = lookup(); s.run(); return s; }').map(
        (finding) => finding.kind,
      ),
    ).toEqual(['receiver', 'return']);
  });

  it('does not confuse a same-named member on an explicit collaborator', () => {
    expect(
      scan(
        'function wrapper(other: { get(key: string): Service }) { operate(other.get("active")); }',
      ),
    ).toEqual([]);
  });

  it('uses helper bodies outside the selected reporting sources', () => {
    const program = fixture(
      "import { renamedLookup } from './helper'; function wrapper() { operate(renamedLookup()); }",
    );
    const file = program.getSourceFile('/consumer.ts')!;
    expect(scanAmbientDelegation(program, [], sources)).toEqual([]);
    expect(scanAmbientDelegation(program, [file], sources)).toEqual([
      {
        rule: 'runtime-ambient-delegation',
        file: '/consumer.ts',
        line: 2,
        column: 64,
        kind: 'argument',
      },
    ]);
  });

  it('fails visibly for a missing source export or member', () => {
    const program = fixture('');
    expect(() =>
      scanAmbientDelegation(
        program,
        [],
        [{ file: '/ambient.ts', exportName: 'missing' }],
      ),
    ).toThrow('Unresolved ambient source');
    expect(() =>
      scanAmbientDelegation(
        program,
        [],
        [{ file: '/ambient.ts', exportName: 'registry', members: ['missing'] }],
      ),
    ).toThrow('Unresolved ambient source');
  });
  it.each([
    "import { lookup as ambient } from './ambient'; const service = ambient();\nnew Consumer(service);",
    "import { renamed as ambient } from './barrel';\nnew Consumer(ambient());",
    'function wrapper() { new Consumer(lookup()); }',
    'class Wrapper { constructor() { new Consumer(lookup()); } }',
    "import { lookup as ambient } from './ambient'; class Wrapper { constructor() { operate(ambient()); } }",
    'operate(lookup());',
  ])('detects construction and module sinks: %s', (body) => {
    expect(
      scan(`class Consumer { constructor(service: Service) {} }\n${body}`).some(
        (finding) => finding.kind === 'argument',
      ),
    ).toBe(true);
  });

  it('reports getter returns and constructor receivers with exact locations', () => {
    expect(
      scan(
        "import { lookup as ambient } from './ambient';\nclass Wrapper {\n  get service() { return ambient(); }\n  constructor() { ambient().run(); }\n}",
      ),
    ).toEqual([
      {
        rule: 'runtime-ambient-delegation',
        file: '/consumer.ts',
        line: 4,
        column: 19,
        kind: 'return',
      },
      {
        rule: 'runtime-ambient-delegation',
        file: '/consumer.ts',
        line: 5,
        column: 19,
        kind: 'receiver',
      },
    ]);
  });

  it.each([
    'function pass(value: Service) { return value; }',
    'const pass = (value: Service) => value;',
    'function pass(value: Service) { const alias = value; return alias; }',
    'function first(value: Service) { return value; } const pass = first;',
    'function pass(value: Service): Service { return second(value); } function second(value: Service): Service { if (scope()) return pass(value); return value; }',
  ])(
    'substitutes helper return parameters at the outer delegate: %s',
    (helper) => {
      expect(scan(`${helper}\noperate(pass(lookup()));`)).toContainEqual({
        rule: 'runtime-ambient-delegation',
        file: '/consumer.ts',
        line: 3,
        column: 1,
        kind: 'argument',
      });
    },
  );

  it.each([
    'declare const service: Service; class Owned { constructor(private service: Service) { operate(service); service.run(); } get current() { return this.service; } } new Owned(service);',
    'class Domain { constructor(value: string) {} } new Domain(scope());',
    'function pass(value: Service) { return value; } function wrapper(service: Service) { operate(pass(service)); }',
    'function pass(value: Service): Service { return again(value); } function again(value: Service): Service { return pass(value); }',
  ])('permits explicit construction and helper provenance: %s', (body) => {
    expect(scan(body)).toEqual([]);
  });

  it('does not contaminate other helper invocations or ignored parameters', () => {
    const findings = scan(
      'function pass(value: Service) { return value; }\nfunction select(ignored: Service, explicit: Service) { return explicit; }\ndeclare const service: Service;\noperate(pass(lookup()));\noperate(pass(service));\noperate(select(lookup(), service));',
    );
    expect(
      findings
        .filter((finding) => finding.column === 1)
        .map((finding) => finding.line),
    ).toEqual([5]);
  });
});
