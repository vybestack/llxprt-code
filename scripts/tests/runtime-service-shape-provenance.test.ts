/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  imports,
  scan,
  scanInstalled,
} from './runtime-service-shape-test-helpers.js';

describe('finite typed receiver exposure', () => {
  it('keeps the exact unbound indexed receiver noncertificate separate from its concrete service alias', () => {
    expect(
      scanInstalled(
        `export class Config { clock(): Clock { return new Clock(); } session(): Session { return new Session(); } }\ninterface Owner<T> { value: {item: T}['item']; next(): Owner<{value:T}> } type Bag = Owner<string & {clock: Clock; session: Session}>;`,
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-analysis-resource-limit',
        line: 3,
        column: 1,
      }),
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 3,
        column: 75,
      }),
    ]);
  }, 30000);

  it.each([
    ['data', 'string & { label: string }', false],
    ['services', 'string & { clock: Clock; session: Session }', true],
  ] as const)(
    'settles the concrete indexed intersection receiver: %s',
    (_name, argument, service) => {
      const findings = scanInstalled(
        `interface Owner<T> { value: {item: T}['item']; next(): Owner<{value:T}> }\ntype Concrete = Owner<${argument}>;`,
      );
      expect(findings.filter(({ line }) => line === 2)).toEqual([
        expect.objectContaining({
          rule: 'runtime-service-analysis-resource-limit',
        }),
      ]);
      expect(findings.filter(({ line }) => line === 3)).toEqual(
        service
          ? [expect.objectContaining({ rule: 'runtime-service-bundle' })]
          : [],
      );
    },
    30000,
  );

  const indexedSites = [
    [
      'call',
      'declare const owner: { get<T>(): {item:T}["item"] };',
      'owner.get<ARG>();',
    ],
    [
      'specialized property value',
      'declare const owner: { get<T>(): {item:T}["item"] };',
      'owner.get<ARG>;',
    ],
    [
      'stored property value',
      'declare const owner: { get<T>(): {item:T}["item"] };',
      'class Consumer { selected = owner.get<ARG>; }',
    ],
    [
      'constructor',
      'declare class Owner<T> { value: {item:T}["item"] }',
      'new Owner<ARG>();',
    ],
    [
      'specialized constructor value',
      'declare class Owner<T> { value: {item:T}["item"] }',
      'Owner<ARG>;',
    ],
    [
      'return',
      'declare function get<T>(): {item:T}["item"];',
      'function selected() { return get<ARG>; }',
    ],
    [
      'callback',
      'declare function get<T>(): {item:T}["item"]; declare function accept(callback: () => unknown): void;',
      'accept(() => get<ARG>);',
    ],
  ];
  for (const [name, declaration, use] of indexedSites) {
    it.each([
      ['data', 'string & { label: string }', false],
      ['services', 'string & { clock: Clock; session: Session }', true],
    ] as const)(
      `checks actual indexed intersection ${name}: %s`,
      (_kind, argument, service) => {
        const findings = scanInstalled(
          `${declaration}\n${use.replace('ARG', argument)}`,
        );
        if (service) {
          expect(findings).toContainEqual(
            expect.objectContaining({
              rule: 'runtime-service-bundle',
              line: 3,
            }),
          );
          expect(
            findings.some(
              ({ rule }) => rule === 'runtime-service-analysis-resource-limit',
            ),
          ).toBe(false);
        } else expect(findings).toEqual([]);
      },
      30000,
    );
  }

  it.each([
    ['broad string check retains literal keys', 'string extends K', true],
    ['literal string check removes literal keys', 'K extends string', false],
  ] as const)(
    'respects mapped key conditional direction: %s',
    (_name, condition, service) => {
      const findings = scanInstalled(
        `type Select<T> = { [K in keyof T as ${condition} ? never : K]: T[K] };\ndeclare const owner: { get<T>(): Select<T> };\nowner.get<{clock: Clock; session: Session}>;`,
      );
      expect(findings).toEqual(
        service
          ? [
              expect.objectContaining({
                rule: 'runtime-service-bundle',
                line: 4,
              }),
            ]
          : [],
      );
    },
    30000,
  );

  it.each(['any', 'unknown'])(
    'does not erase fixed siblings when a declaration contains %s',
    (erased) => {
      expect(
        scan(
          imports +
            `interface Wrapped<T> { erased: ${erased}; clock: Scheduler; context: Context; next(): Wrapped<{ value: T }> }\ntype Bag = Wrapped<string>;`,
        ),
      ).toContainEqual(
        expect.objectContaining({ rule: 'runtime-service-bundle', line: 3 }),
      );
    },
  );

  it('retains an explicit limit for an unresolved computed declaration equation', () => {
    expect(
      scan(
        `declare function key(): string; abstract class Wrapped<T> { [key()](): T { throw 0; } abstract next(): Wrapped<{ value: T }>; }\ntype Data = Wrapped<string>;`,
      ),
    ).toContainEqual(
      expect.objectContaining({
        rule: 'runtime-service-analysis-resource-limit',
        line: 2,
      }),
    );
  });

  it('checks a generic callable specialized by an actual property assignment', () => {
    expect(
      scanInstalled(
        `declare const holder: { get: () => { clock: Clock; session: Session } }; declare function get<T>(): T;\nholder.get = get;`,
      ),
    ).toContainEqual(
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 3,
        column: 14,
      }),
    );
  });

  it.each(['readonly T[]', 'readonly [T]', 'ReadonlyArray<T>'])(
    'checks merged readonly array declarations: %s',
    (array) => {
      expect(
        scan(
          imports +
            `declare global { interface ReadonlyArray<T> { clock: Scheduler; context: Context } }\ninterface Wrapped<T> { items: ${array}; next(): Wrapped<{ value: T }> }\ntype Bag = Wrapped<string>;`,
        ),
      ).toContainEqual(
        expect.objectContaining({ rule: 'runtime-service-bundle', line: 4 }),
      );
    },
  );

  it.each(['T[]', '[T]', 'Array<T>'])(
    'checks merged array declarations even through syntax sugar: %s',
    (array) => {
      expect(
        scan(
          imports +
            `declare global { interface Array<T> { clock: Scheduler; context: Context } }\ninterface Wrapped<T> { items: ${array}; next(): Wrapped<{ value: T }> }\ntype Bag = Wrapped<string>;`,
        ),
      ).toContainEqual(
        expect.objectContaining({ rule: 'runtime-service-bundle', line: 4 }),
      );
    },
  );

  it('does not confuse static value selectors with instance declarations', () => {
    expect(
      scan(
        imports +
          `declare class Factory { static make(): { clock: Scheduler; context: Context }; }\ninterface Wrapped<T> { fixed: (typeof Factory)['make']; next(): Wrapped<{ value: T }> }\ntype Bag = Wrapped<string>;`,
      ),
    ).toContainEqual(
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 4 }),
    );
  });

  it.each([
    `declare function get<T>(): T; function wrap(): () => { clock: Clock; session: Session } { return get; }`,
    `declare function get<T>(): T; const wrap: () => () => { clock: Clock; session: Session } = () => get;`,
    `declare function get<T>(): T; declare function accept(value: () => { clock: Clock; session: Session }): void;\naccept(get);`,
  ])(
    'checks contextual specialization at the actual returned or passed callable: %s',
    (source) => {
      expect(scanInstalled(source)).toContainEqual(
        expect.objectContaining({
          rule: 'runtime-service-bundle',
          line: source.includes('accept') ? 3 : 2,
        }),
      );
    },
  );

  it('retains public constructor parameter properties in expanding receivers', () => {
    expect(
      scan(
        imports +
          `abstract class Owner<T> { constructor(public bag: Config) {} abstract next(): Owner<{ value: T }>; }\ntype Bag = Owner<string>;`,
      ),
    ).toContainEqual(
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 3 }),
    );
  });

  it('does not expose an unused method parameter default', () => {
    expect(
      scan(imports + `interface Getter { get<T = Config>(): string }`),
    ).toEqual([]);
  });

  it('keeps unrelated predicate and boolean callable summaries distinct', () => {
    expect(
      scan(
        imports +
          `interface Data { check(value: unknown): boolean }\ninterface Predicate { check(value: unknown): value is { clock: Scheduler; context: Context } }`,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 3 }),
    ]);
  });

  it.each([
    'declare const key: unique symbol; interface Wrapped<T> { [key]: T; next(): Wrapped<{ value: T }> }',
    'interface Base<T> { value: T } interface Wrapped<T> extends Base<T> { next(): Wrapped<this> }',
    'namespace Library { export interface Wrapped<T> { value: T; next(): Wrapped<{ value: T }> } } import Wrapped = Library.Wrapped;',
  ])(
    'preserves exact symbols through public keys, inheritance and namespace aliases: %s',
    (declaration) => {
      expect(
        scan(
          imports +
            declaration +
            '\ntype Bag = Wrapped<{ clock: Scheduler; context: Context }>;',
        ),
      ).toContainEqual(
        expect.objectContaining({ rule: 'runtime-service-bundle', line: 3 }),
      );
    },
    15000,
  );

  it.each([
    `import {z} from 'zod'; type Data = z.ZodType<string, z.ZodTypeDef, unknown>;`,
    `import {SgNode} from '@ast-grep/napi'; type Data = SgNode;`,
    `import {z} from 'zod'; declare const data: z.ZodType<string, z.ZodTypeDef, unknown>; data.optional().nullable().array();`,
    `import {SgNode} from '@ast-grep/napi'; declare const data: SgNode; data.parent(); data.findAll('identifier');`,
  ])('completes primitive installed receiver graphs: %s', (source) => {
    expect(scanInstalled(source)).toEqual([]);
  });

  it.each([
    'interface Wrapped<T> { value: T; get<U>(): U; next(): Wrapped<{ value: T }> }',
    'declare class Wrapped<T> { private state: T; value: T; next(): Wrapped<this>; self(): this; get<U>(): U; }',
    'interface Wrapped<T> { value: T; get<U extends T>(): U; next(): Wrapped<{ value: T }> }',
    'interface Wrapped<T> { value: T; next(): Wrapped<T extends infer U ? { value: U } : never> }',
  ])(
    'discharges expanding declarations only with bound receiver arguments: %s',
    (declaration) => {
      expect(
        scan(`${declaration}\ntype Data = Wrapped<string>;`).filter(
          ({ line }) => line === 2,
        ),
      ).toEqual([]);
    },
  );

  it.each([
    'interface Getter { get<T = Config>(): T }',
    'interface Getter { get<T extends Config>(): T }',
    'interface Getter { get<T>(): T & { clock: Scheduler; context: Context } }',
    'interface Getter { get<T>(): () => { clock: Scheduler; context: Context } }',
    'interface Getter { check(value: unknown): value is { clock: Scheduler; context: Context } }',
  ])(
    'retains fixed roots alongside deferred substitutions: %s',
    (declaration) => {
      expect(scan(imports + declaration)).toContainEqual(
        expect.objectContaining({ rule: 'runtime-service-bundle', line: 2 }),
      );
    },
  );

  it.each([
    `import {z} from 'zod'; type Bag = z.ZodType<string, z.ZodTypeDef, { clock: Clock; session: Session }>;`,
    `import {z} from 'zod'; type Bag = z.ZodType<unknown, z.ZodTypeDef & { clock: Clock; session: Session }, unknown>;`,
    `import {z} from 'zod'; declare const schema: z.ZodType<string, z.ZodTypeDef, unknown>;
schema.refine((value): value is string & { clock: Clock; session: Session } => true);`,
    `import {SgNode} from '@ast-grep/napi'; declare const node: SgNode;
node.parent<string & { clock: Clock; session: Session }>()?.kind();`,
    `declare function accept(check: (value: unknown) => boolean): void;
accept((value): value is { clock: Clock; session: Session } => true);`,
    `declare function get<T>(): T;
const specialized = get<{ clock: Clock; session: Session }>;`,
    `declare function outer(): () => { clock: Clock; session: Session };
outer();`,
  ])(
    'diagnoses actual specialized and predicate-bearing boundaries: %s',
    (source) => {
      expect(scanInstalled(source)).toContainEqual(
        expect.objectContaining({ rule: 'runtime-service-bundle' }),
      );
    },
  );
});
