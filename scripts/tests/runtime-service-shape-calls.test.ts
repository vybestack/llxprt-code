/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import type { RuntimeServiceShapeFinding } from './runtime-service-shape-guard.js';
import {
  imports,
  scan,
  scanInstalled,
} from './runtime-service-shape-test-helpers.js';

describe('actual call-site service shapes', () => {
  it.each([
    `declare const get: <T>() => T;
get<{ clock: Clock; session: Session }>();`,
    `declare const Box: new <T>() => T;
new Box<{ clock: Clock; session: Session }>();`,
    `declare function identity<T>(value: T): T;
identity({ clock: new Clock(), session: new Session() });`,
  ])(
    'reports exactly the instantiated expression and its actual argument: %s',
    (source) => {
      expect(scanInstalled(source)).toEqual([
        {
          file: resolve('closed-type-installed-fixture.ts'),
          rule: 'runtime-service-bundle',
          line: 3,
          column: 1,
        },
        ...(source.includes('identity(')
          ? [
              {
                file: resolve('closed-type-installed-fixture.ts'),
                rule: 'runtime-service-bundle',
                line: 3,
                column: 10,
              } satisfies RuntimeServiceShapeFinding,
            ]
          : []),
      ]);
    },
  );

  it('checks retained argument types before an explicit unknown substitution', () => {
    expect(
      scanInstalled(`declare function identity<T>(value: T): T;
identity<unknown>({ clock: new Clock(), session: new Session() });`),
    ).toEqual([
      {
        file: resolve('closed-type-installed-fixture.ts'),
        rule: 'runtime-service-bundle',
        line: 3,
        column: 19,
      },
    ]);
  });

  it('preserves constrained Config getters', () => {
    expect(
      scan(imports + 'declare const get: <T extends Config>() => T; get();'),
    ).toContainEqual(
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        file: 'consumer.ts',
        line: 2,
        column: 47,
      }),
    );
  });

  it('exempts direct assembly calls but not nested producers or neighboring calls', () => {
    const findings = scan(
      `import { Scheduler, Context } from '../services.js';
declare function identity<T>(value: T): T;
function assemble(): void {
  identity({ clock: new Scheduler(), session: new Context() });
  const callback: () => void = () => ({ clock: new Scheduler(), session: new Context() });
  function producer() { return { clock: new Scheduler(), session: new Context() }; }
}
identity({ clock: new Scheduler(), session: new Context() });`,
      'agents/assembly.ts',
    );
    expect(findings.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'runtime-service-bundle', line: 5 },
      { rule: 'runtime-service-bundle', line: 6 },
      { rule: 'runtime-service-bundle', line: 8 },
      { rule: 'runtime-service-bundle', line: 8 },
    ]);
  });

  it.each([
    `declare function identity<T>(value: T): T;
identity({ clock: new Clock(), session: new Session() });`,
    `declare function erase(value: unknown): void;
erase({ clock: new Clock(), session: new Session() });`,
    `declare const get: <T>() => T;
const result: { clock: Clock; session: Session } = get();`,
    `declare const get: <T>() => T;
get<{ clock: Clock; session: Session }>();`,
    `declare function identity<T>(value: T): T;
const specialized: (value: { clock: Clock; session: Session }) => { clock: Clock; session: Session } = identity;
specialized({ clock: new Clock(), session: new Session() });`,
    `declare function get<T>(): T;
const specialized: () => { clock: Clock; session: Session } = get;
specialized();`,
    `declare class Box<T> { constructor(value: T); value: T; }
new Box({ clock: new Clock(), session: new Session() });`,
    `declare const Box: new <T>() => T;
new Box<{ clock: Clock; session: Session }>();`,
    `declare function choose(value: string): string;
declare function choose<T>(value: T): T;
choose({ clock: new Clock(), session: new Session() });`,
    `declare function produce<T>(callback: () => T): T;
produce(() => ({ clock: new Clock(), session: new Session() }));`,
    `declare function discard(callback: () => void): void;
discard(() => ({ clock: new Clock(), session: new Session() }));`,
    `declare function discard(callback: () => void): void;
discard(() => { return { clock: new Clock(), session: new Session() }; });`,
    `declare function discard(callback: () => void): void;
function producer(): void { return; }
const callback: () => void = () => ({ clock: new Clock(), session: new Session() });
discard(callback);`,
    `declare function discard(callback: () => void): void;
function producer() { return { clock: new Clock(), session: new Session() }; }
discard(producer);`,
    `declare const get: <T>() => T;
const result: string & { clock: Clock; session: Session } = get();`,
    `const result = { clock: new Clock(), session: new Session() };`,
  ])(
    'diagnoses compiler-valid actual capabilities without a bag alias: %s',
    (source) => {
      const findings = scanInstalled(source);
      expect(findings).toContainEqual(
        expect.objectContaining({
          file: resolve('closed-type-installed-fixture.ts'),
          rule: 'runtime-service-bundle',
        }),
      );
      expect(
        new Set(
          findings.map(
            ({ file, line, column, rule }) =>
              `${file}:${line}:${column}:${rule}`,
          ),
        ).size,
      ).toBe(findings.length);
    },
  );

  it.each([
    `declare function identity<T>(value: T): T; identity('data'); identity(1);`,
    `declare function identity<T>(value: T): T; identity({ clock: new Clock() });`,
    `declare class Owner<T> { private value: T; run(): void; } new Owner<{ clock: Clock; session: Session }>().run();`,
    `declare function get<T>(): T; get<Clock | Session>();`,
    `declare function get<T>(): T; get<{ service: Clock | Session }>();`,
    `declare function identity<T>(value: T): T;`,
  ])(
    'allows primitive, private and alternative actual capabilities: %s',
    (source) => {
      expect(scanInstalled(source)).toEqual([]);
    },
  );

  it('reports the installed ast-grep selected kind result without a type alias', () => {
    const findings = scanInstalled(`import { SgNode } from '@ast-grep/napi';
declare const node: SgNode;
const selected = node.findAll<string & { clock: Clock; session: Session }>('identifier');
selected[0].kind();`);
    expect(findings).toContainEqual(
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 5,
        column: 1,
      }),
    );
  });

  it('reports caller-supplied installed Zod transform output without a type alias', () => {
    const findings = scanInstalled(`import { z } from 'zod';
declare const schema: z.ZodType<string, z.ZodTypeDef, unknown>;
const transformed = schema.transform(() => ({ clock: new Clock(), session: new Session() }));
transformed.parse('input');`);
    expect(findings).toContainEqual(
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 5,
        column: 1,
      }),
    );
  });
});
