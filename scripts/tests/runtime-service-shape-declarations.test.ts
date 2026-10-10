/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { scanRuntimeServiceShapes } from './runtime-service-shape-guard.js';
import {
  roots,
  options,
  imports,
  scan,
  scanInstalled,
} from './runtime-service-shape-test-helpers.js';

describe('closed declaration proof', () => {
  it.each([
    'fixed: { hidden: { clock: Scheduler; context: Context } };',
    'fixed: import("./services.js").Config;',
    'fixed: T extends string ? string : { clock: Scheduler; context: Context };',
    'fixed: { text: string; service: Config }[T extends string ? "text" : "service"];',
    'fixed: { [K in "clock" | "context"]: { clock: Scheduler; context: Context }[K] };',
    'fixed(): <U extends Config>() => U;',
  ])(
    'does not let a primitive argument hide fixed capability dependencies: %s',
    (member) => {
      expect(
        scan(
          imports +
            `interface Wrapped<T> { ${member} next(): Wrapped<{ value: T }> }\ntype Bag = Wrapped<string>;`,
        ),
      ).toContainEqual(
        expect.objectContaining({ rule: 'runtime-service-bundle', line: 3 }),
      );
    },
  );

  it('retains installed Zod service-bearing substitutions', () => {
    expect(
      scanInstalled(
        `import {z} from 'zod'; type Bag = z.ZodType<{clock: Clock; session: Session}, z.ZodTypeDef, unknown>;`,
      ),
    ).toEqual([expect.objectContaining({ rule: 'runtime-service-bundle' })]);
  });

  it('retains service augmentation inside the installed ast-grep graph', () => {
    expect(
      scanInstalled(`import {SgNode} from '@ast-grep/napi';
      import type { TypesMap, Kinds } from '@ast-grep/napi/types/staticTypes';
      declare module '@ast-grep/napi/types/sgnode' { interface SgNode<M extends TypesMap, T extends Kinds<M>> { clock: Clock; session: Session } }
      type Bag = SgNode;`),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 4 }),
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 5 }),
    ]);
  });

  it.each([
    `import {z} from 'zod'; type Data = z.ZodType<string, z.ZodTypeDef, unknown>;`,
    `import {SgNode} from '@ast-grep/napi'; type Data = SgNode;`,
  ])(
    'completes fixed typed exposure for installed primitive receivers: %s',
    (source) => {
      expect(scanInstalled(source)).toEqual([]);
    },
  );

  it.each([
    'erased: any;',
    'opaque: unknown;',
    'callback<U>(): U;',
    'self(): this;',
    'imported: import("./services.js").Scheduler;',
    '[Symbol.iterator](): Iterator<T>;',
    'inferred: T extends infer U ? U : never;',
  ])(
    'distinguishes supported typed closure from unsupported import queries: %s',
    (member) => {
      const findings = scanRuntimeServiceShapes(
        {
          ...roots,
          'library.ts': `export interface Wrapped<T> { ${member} next(): Wrapped<{ value: T }> }`,
          'consumer.ts': `import { Wrapped } from './library.js'; type Data = Wrapped<string>;`,
        },
        options,
      );
      expect(findings.filter(({ file }) => file === 'consumer.ts')).toEqual(
        member.startsWith('imported:')
          ? [
              expect.objectContaining({
                rule: 'runtime-service-analysis-resource-limit',
              }),
            ]
          : [],
      );
    },
  );

  it('keeps conditional discriminants and indexed property correlations distinct', () => {
    expect(
      scan(
        imports +
          `
      interface Box<T extends 'clock' | 'context'> {
        conditional: T extends 'clock' ? Scheduler : Context;
        indexed: { clock: Scheduler; context: Context }[T];
        next(): Box<T>;
      }
      type ClockOnly = Box<'clock'>;
      type ContextOnly = Box<'context'>;
      type Pair = { first: Box<'clock'>; second: Box<'context'> };
    `,
      ).filter(({ line }) => line >= 8),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 10 }),
    ]);
  });

  it('checks every dependency before certifying mutually recursive declarations', () => {
    for (const order of [false, true]) {
      const declarations = [
        'interface First<T> { next(): Second<{ value: T }> }',
        'interface Second<T> { next(): First<T>; clock: Scheduler; context: Context }',
      ];
      expect(
        scan(
          imports +
            `${(order ? declarations.toReversed() : declarations).join('\n')}\ntype Bag = First<string>;`,
        ),
      ).toContainEqual(
        expect.objectContaining({ rule: 'runtime-service-bundle', line: 4 }),
      );
    }
  });

  it('preserves Config capabilities exposed through generic owners', () => {
    expect(
      scan(
        imports +
          `declare class Owner<T> { private state: T; get(): T; next(): Owner<{ value: T }> }\ntype Bag = Owner<Config>;`,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 3 }),
    ]);
  });

  it.each([
    'interface Wrapped<T> { value: T; next(): Wrapped<{ value: T }> }',
    'interface Wrapped<T> { value: T; next(): Other<{ value: T }> } interface Other<T> { next(): Wrapped<T> }',
    'type Cell<T> = { value: T }; interface Wrapped<T> { value: T; next(): Wrapped<Cell<T>> }',
    'interface Wrapped<T> { value: T; next(): Wrapped<T extends string ? { text: T } : { data: T }> }',
    'interface Wrapped<T> { value: T; next(): Wrapped<{ nested: { item: T }["item"] }> }',
    'interface Wrapped<T> { value: T; next(): Wrapped<{ [K in "item"]: T }> }',
  ])(
    'proves closed expanding declarations for concrete data: %s',
    (declaration) => {
      const findings = scanRuntimeServiceShapes(
        {
          ...roots,
          'library.ts': `${declaration}; export { Wrapped };`,
          'consumer.ts': `import { Wrapped } from './library.js'; type Data = Wrapped<string>;`,
        },
        options,
      );
      expect(findings.filter(({ file }) => file === 'consumer.ts')).toEqual([]);
    },
  );

  it.each([
    'interface Wrapped<T> { value: T; next(): Wrapped<{ value: T }> }',
    'interface Wrapped<T> { value(): () => T; next(): Wrapped<{ value: T }> }',
    'interface Wrapped<T> { value: T extends string ? string : { clock: Scheduler; context: Context }; next(): Wrapped<{ value: T }> }',
    'interface Wrapped<T> { value: { item: T }["item"]; next(): Wrapped<{ value: T }> }',
  ])(
    'retains services in the same expanding declaration: %s',
    (declaration) => {
      const findings = scanRuntimeServiceShapes(
        {
          ...roots,
          'library.ts': imports + `export ${declaration}`,
          'consumer.ts':
            imports +
            `import { Wrapped } from './library.js'; type Bag = Wrapped<{ clock: Scheduler; context: Context }>;`,
        },
        options,
      );
      expect(findings.filter(({ file }) => file === 'consumer.ts')).toEqual([
        expect.objectContaining({ rule: 'runtime-service-bundle' }),
      ]);
    },
  );

  it('invalidates a closed cycle when an augmentation injects services', () => {
    expect(
      scanRuntimeServiceShapes(
        {
          ...roots,
          'library.ts': `export interface Wrapped<T> { value: T; next(): Wrapped<{ value: T }> }`,
          'consumer.ts':
            imports +
            `import { Wrapped } from './library.js';
        type Data = Wrapped<string>;
        declare module './library.js' { interface Wrapped<T> { clock: Scheduler; context: Context } }`,
        },
        options,
      ).filter(({ file, line }) => file === 'consumer.ts' && line === 3),
    ).toEqual([expect.objectContaining({ rule: 'runtime-service-bundle' })]);
  });
});
