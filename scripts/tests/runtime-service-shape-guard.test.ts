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

describe('runtime service shape guard', () => {
  it('finishes an installed SDK stream graph and retains its exposed item services', () => {
    expect(
      scanInstalled(`import { Stream } from 'openai/core/streaming';
      type Data = Stream<{ text: string }>;
      type Bag = Stream<{ clock: Clock; session: Session }>;
      type Platform = { node: Node; event: Event; document: Document };`),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 4 }),
    ]);
  });

  it.each(['Scheduler; second: Context', 'Context; second: Scheduler'])(
    'retains substituted constraints from the same method declaration: %s',
    (pair) => {
      expect(
        scan(
          imports +
            `
        interface Box<T> { value: T }
        interface Factory<T> { make<U extends T>(input: T): Box<U> }
        type Inputs = { first: ${pair} };
        type Bag = { first: Factory<Inputs['first']>; second: Factory<Inputs['second']> };
      `,
        ),
      ).toEqual([
        expect.objectContaining({ rule: 'runtime-service-bundle', line: 5 }),
        expect.objectContaining({ rule: 'runtime-service-bundle', line: 6 }),
      ]);
    },
  );

  it('does not collapse distinct targets or exempt fake platform containers', () => {
    expect(
      scan(
        imports +
          `
      class ReadableStream<T> { value!: T; clock!: Scheduler; }
      class Promise<T> { value!: T; context!: Context; }
      type Bag = { stream: ReadableStream<string>; pending: Promise<string> };
      type SameShape = { schedule(): void };
      type Data = { fake: SameShape; context: Context };
    `,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 5 }),
    ]);
  });

  it('finishes fresh generic method return cycles without erasing substitutions', () => {
    expect(
      scan(
        imports +
          `
      interface Stream<T> { value: T; map<U>(input: T): Stream<U>; }
      type Data = Stream<string>;
      type One = Stream<Scheduler>;
      type Choice = Stream<Scheduler | Context>;
      type Bag = Stream<{ clock: Scheduler; context: Context }>;
      type Pair = { first: Stream<Scheduler>; second: Stream<Context> };
    `,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 7 }),
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 8 }),
    ]);
  });

  it('exhausts a finite recursive branching graph and finds its hidden service bag', () => {
    const findings = scan(
      imports +
        `
      type Branch<Path extends readonly number[]> =
        Path['length'] extends 18
          ? Path[0] extends 1
            ? { clock: Scheduler; context: Context }
            : { data: string }
          : { left: Branch<[0, ...Path]>; right: Branch<[1, ...Path]> };
      type Result = Branch<[]>;
    `,
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 9 }),
    );
    expect(
      findings.filter(
        ({ rule }) => rule === 'runtime-service-analysis-resource-limit',
      ),
    ).toEqual([]);
  }, 60000);

  it('completes root-free enum values carried by an expanding generic', () => {
    expect(
      scan(
        `enum State { Active = 'active', Inactive = 'inactive' }
        interface Wrapped<T> { enumValue: T; next(): Wrapped<{ value: T }> }
        type Data = Wrapped<typeof State>;`,
      ).filter(({ line }) => line === 3),
    ).toEqual([]);
  });

  it('does not certify enum values augmented with service-bearing namespace members', () => {
    expect(
      scan(
        imports +
          `enum State { Active = 'active' }
        namespace State {
          export const clock = new Scheduler();
          export const context = new Context();
        }
        type Bag = typeof State;`,
      ),
    ).toContainEqual(
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 7 }),
    );
  });

  it('fails closed for an endlessly expanding generic return graph', () => {
    expect(
      scan(
        imports + `interface Expanding<T> { next(): Expanding<{ value: T }> }`,
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-analysis-resource-limit',
      }),
    ]);
  });

  it.each([
    'Owner<{ clock: Scheduler; context: Context }>',
    'Pick<Owner<{ clock: Scheduler; context: Context }>, "get">',
    '() => Owner<{ clock: Scheduler; context: Context }>',
  ])('preserves generic return capabilities through %s', (shape) => {
    expect(
      scan(
        imports +
          `class Owner<T> { private value!: T; get(): T { return this.value; } }\ntype Alias = ${shape};`,
      ),
    ).toContainEqual(
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 3 }),
    );
  });

  it.each([
    'class Owner { constructor(private config: Config) {} run(): void {} }',
    'class Base { protected config = new Config(); } class Owner extends Base { run(): void {} }',
    'class Owner { #config = new Config(); run(): void {} }',
    'class Owner<T> { private value!: T; run(): void {} }',
  ])('allows encapsulated behavioral owners: %s', (declaration) => {
    const generic = declaration.includes('Owner<T>');
    const findings = scan(
      imports +
        declaration +
        `
      function consume(owner: Owner${generic ? '<{ clock: Scheduler; context: Context }>' : ''}): void {}
      function factory(make: () => Owner${generic ? '<{ clock: Scheduler; context: Context }>' : ''}): void {}
    `,
    );
    expect(findings.filter((finding) => finding.line > 2)).toEqual([]);
  });

  it.each([
    'class Owner { clock = new Scheduler(); context = new Context(); }',
    'class Owner { get config(): Config { return new Config(); } }',
    'class Owner<T> { private value!: T; get(): T { return this.value; } }',
    'class Owner<T> { private value!: T; clock = new Scheduler(); context = new Context(); }',
    'class Cell<T> { value!: T } class Owner { cell!: Cell<{ clock: Scheduler; context: Context }> }',
  ])('rejects exposed capabilities: %s', (declaration) => {
    const generic = declaration.includes('Owner<T>');
    expect(
      scan(
        imports +
          declaration +
          `\nfunction consume(owner: Owner${generic ? '<{ clock: Scheduler; context: Context }>' : ''}): void {}`,
      ),
    ).toContainEqual(
      expect.objectContaining({
        rule: 'runtime-service-bag-parameter',
        line: 3,
      }),
    );
  });

  it('checks private constructor injection while ignoring private storage for consumers', () => {
    expect(
      scan(
        imports +
          `class Owner { constructor(private bag: { clock: Scheduler; context: Context }) {} }\nfunction use(owner: Owner): void {}`,
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bag-parameter',
        line: 2,
      }),
    ]);
  });

  it('checks encapsulated runtime objects independently for Config locators', () => {
    expect(
      scanRuntimeServiceShapes(
        {
          ...roots,
          'hooks.ts': `export class HookSystem { private state = 0; run(): void {} }`,
          'settings.ts': `import { HookSystem } from './hooks.js'; export class Settings { hooks(): HookSystem { return new HookSystem(); } data(): { enabled: boolean } { return { enabled: true }; } }`,
          'consumer.ts': `import { Settings } from './settings.js'; import { HookSystem } from './hooks.js';
      function use(hooks: HookSystem): void {}
      new Settings().hooks();
      new Settings().data();`,
        },
        {
          ...options,
          configs: [{ file: 'settings.ts', exportName: 'Settings' }],
          runtimeObjects: [{ file: 'hooks.ts', exportName: 'HookSystem' }],
        },
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'config-service-locator',
        file: 'consumer.ts',
        line: 3,
      }),
    ]);
  });

  it('detects a bag beyond twenty exposed edges', () => {
    const nested = `${'{ next: '.repeat(20)}{ clock: Scheduler; context: Context }${' }'.repeat(20)}`;
    expect(scan(imports + `type Deep = ${nested};`)).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle' }),
    ]);
  });

  it('propagates identities through mutual cycles independently of query order', () => {
    for (const declarations of [
      [
        'interface First { next?: Second; clock: Scheduler }',
        'interface Second { next?: First; context: Context }',
      ],
      [
        'interface Second { next?: First; context: Context }',
        'interface First { next?: Second; clock: Scheduler }',
      ],
    ]) {
      expect(scan(imports + declarations.join('\n'))).toEqual([
        expect.objectContaining({ rule: 'runtime-service-bundle', line: 2 }),
        expect.objectContaining({ rule: 'runtime-service-bundle', line: 3 }),
      ]);
    }
  });

  it('finishes platform graphs without hiding proven bags', () => {
    expect(
      scan(
        imports +
          `
      interface PlatformData { node: Node; event: Event; document: Document; }
      interface WithServices { platform: PlatformData; clock: Scheduler; context: Context; }
    `,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 4 }),
    ]);
  }, 15000);

  it('summarizes a branching recursive domain graph and preserves service alternatives', () => {
    const branches = Array.from(
      { length: 24 },
      (_, index) => `field${index}?: Domain;`,
    ).join('\n');
    const findings = scan(
      imports +
        `
      interface Domain { ${branches} value: string | number; }
      interface One { ${branches.replaceAll('Domain', 'One')} clock: Scheduler; }
      interface Two { domain: Domain; one: One; context: Context; }
      type Choice = Scheduler | Context;
      interface Choices { first: Choice; second: Choice; }
    `,
    );
    expect(findings.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'runtime-service-bundle', line: 51 },
      { rule: 'runtime-service-bundle', line: 53 },
    ]);
  }, 15000);

  it('resolves inherited service and Config identities through re-exports', () => {
    expect(
      scanRuntimeServiceShapes(
        {
          ...roots,
          'derived.ts': `import { Config, Scheduler, Context } from './services.js';
        export class Settings extends Config { override scheduler(): Clock { return new Clock(); } }
        export class Clock extends Scheduler {}
        export interface Session extends Context {}`,
          'exports.ts': `export { Settings as Preferences, Clock as Timer, Session as State } from './derived.js';`,
          'consumer.ts': `import { Preferences, Timer, State } from './exports.js';
        type Bag = { timer: Timer; state: State };
        const settings = new Preferences();
        settings.scheduler();
        settings.renamedContext();`,
        },
        options,
      ).filter(({ file }) => file === 'consumer.ts'),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 2 }),
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 3,
        column: 15,
      }),
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 3,
        column: 26,
      }),
      expect.objectContaining({ rule: 'config-service-locator', line: 4 }),
      expect.objectContaining({ rule: 'config-service-locator', line: 5 }),
    ]);
  });

  it.each([
    'ReadonlyArray<A>',
    'A[]',
    '[string, A]',
    'Map<string, A>',
    'Set<A>',
    'Promise<A>',
    'Promise<ReadonlyArray<Map<string, Set<A>>>>',
  ])('finds service identities in %s', (container) => {
    expect(
      scan(`import { Clock as A, Session as B } from './barrel.js';
      type Bag = { wrapped: ${container}; other: B };`),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 2 }),
    ]);
  });

  it('rejects a generic whole-service getter interface', () => {
    expect(
      scan(
        imports +
          `
      interface Getter { get<K extends keyof Catalog>(key: K): Catalog[K] }
      interface Catalog { clock: Scheduler; context: Context }
    `,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 3 }),
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 4 }),
    ]);
  });

  it.each([
    '{ clock: () => A; context: () => B }',
    '{ clock(): Promise<A>; context(): ReadonlyArray<B> }',
    '{ clock: <T extends A>() => T; context: <T extends B>() => T }',
  ])('rejects service-returning capability bags: %s', (shape) => {
    expect(
      scan(`import { Clock as A, Session as B } from './barrel.js';
      interface Bag ${shape}
      function consume(bag: Bag): void {}`),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 2 }),
      expect.objectContaining({
        rule: 'runtime-service-bag-parameter',
        line: 3,
      }),
    ]);
  });

  it.each([
    'const { scheduler: clock } = config;',
    'const { [key]: clock } = config;',
    'function use({ scheduler: clock }: Settings): void {}',
    'let clock: () => Scheduler; ({ scheduler: clock } = config);',
    'const { current: context } = config;',
    'const { nested: { scheduler: clock } } = { nested: config };',
  ])('rejects destructured Config member extraction: %s', (source) => {
    expect(
      scanRuntimeServiceShapes(
        {
          ...roots,
          'settings.ts': `export { Config as Settings, Scheduler } from './services.js';`,
          'consumer.ts': `import { Settings, Scheduler } from './settings.js';
        const config = new Settings(); const key = 'scheduler';
        ${source}`,
        },
        options,
      ).filter(({ rule }) => rule === 'config-service-locator'),
    ).toEqual([
      expect.objectContaining({
        rule: 'config-service-locator',
        file: 'consumer.ts',
        line: 3,
      }),
    ]);
  });

  it('allows domain containers, behavioral callbacks, and unrelated destructuring', () => {
    expect(
      scan(
        imports +
          `
      interface Data { labels: string[]; entries: Map<string, number>; pending: Promise<string>; pair: [number, string]; ids: Set<number> }
      interface Behavior { run(input: string): Promise<string>; cancel(): void; map: <T>(value: T) => T }
      class Other { scheduler(): Scheduler { return new Scheduler(); } }
      class Child extends Other {}
      const { scheduler: unrelated } = new Child();
      const { data } = new Config();
      type Single = { clock: Promise<Scheduler>; duplicate: () => Scheduler };
      interface Recursive { next(): Recursive; label(): string }
    `,
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 8,
        column: 24,
      }),
    ]);
  });

  it.each([
    `type Innocent = { clock: Scheduler; session: Context };`,
    `interface Innocent { clock: Scheduler; session: Context }`,
    `type Innocent = { clock: Scheduler } & { session: Context };`,
    `type Innocent = Pick<{ clock: Scheduler; session: Context; data: string }, 'clock' | 'session'>;`,
    `type Innocent = { wrapped: { clock: Scheduler; session: Context } }['wrapped'];`,
    `const value = { clock: new Scheduler(), session: new Context() }; type Innocent = typeof value;`,
  ])('rejects a multi-service type: %s', (source) => {
    expect(scan(imports + source)).toEqual([
      ...(source.startsWith('const value')
        ? [
            expect.objectContaining({
              rule: 'runtime-service-bundle',
              file: 'consumer.ts',
              line: 2,
              column: 7,
            }),
          ]
        : []),
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        file: 'consumer.ts',
        line: 2,
        column:
          source.indexOf(
            source.includes('interface') ? 'interface' : 'type Innocent',
          ) + 1,
      }),
    ]);
  });

  it('follows renamed imports and re-exports by declaration identity', () => {
    expect(
      scan(
        `import { Clock as A, Session as B } from './barrel.js';\ntype Data = { a: A; b: B };`,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 2 }),
    ]);
  });

  it.each([
    `function consume(innocent: { a: Scheduler; b: Context }): void {}`,
    `function consume({ a, b }: { a: Scheduler; b: Context }): void {}`,
    `class Consumer { constructor({ a, b }: { a: Scheduler; b: Context }) {} }`,
    `const consume = (value = { a: new Scheduler(), b: new Context() }): void => {};`,
    `const consume: (value: { a: Scheduler; b: Context }) => void = (value) => {};`,
  ])('rejects bag parameters: %s', (source) => {
    const findings = scan(imports + source);
    expect(findings.length).toBeGreaterThan(0);
    expect(
      findings.every(
        (finding) => finding.rule === 'runtime-service-bag-parameter',
      ),
    ).toBe(true);
  });

  it.each([
    'config.scheduler()',
    'config["renamedContext"]()',
    'config.current',
    'config[key]()',
  ])('rejects Config runtime object access: %s', (expression) => {
    expect(
      scan(
        imports +
          `const config = new Config(); const key = 'scheduler';\n${expression};`,
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 2,
        column: 7,
      }),
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 2,
        column: 16,
      }),
      expect.objectContaining({
        rule: 'config-service-locator',
        line: 3,
        column: 1,
      }),
    ]);
  });

  it('recognizes aliased Config and service return symbols', () => {
    expect(
      scan(
        `import { Config as Data } from './services.js'; const settings = new Data(); settings.renamedContext();`,
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 1,
        column: 55,
      }),
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 1,
        column: 66,
      }),
      expect.objectContaining({
        rule: 'config-service-locator',
        line: 1,
        column: 78,
      }),
    ]);
  });

  it('allows data, narrow callbacks and instance-owned single services', () => {
    expect(
      scan(
        imports +
          `
      type Data = Readonly<{ model: string; timeout: number }>;
      interface Operations { run: (input: string) => string; cancel: () => void }
      class Owner { constructor(private scheduler: Scheduler) {} }
      function consume(operation: (input: string) => string, data: Data): void {}
      new Provider().getModel();
      new Config().data();
    `,
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 8,
        column: 7,
      }),
    ]);
  });

  it('does not mistake same-named unrelated declarations for roots', () => {
    expect(
      scan(`
      class Scheduler { schedule(): void {} }
      class Context { contextId = 'data'; }
      class Config { scheduler(): Scheduler { return new Scheduler(); } }
      type Data = { a: Scheduler; b: Context };
      new Config().scheduler();
      export {};
    `),
    ).toEqual([]);
  });

  it('exempts only the exact top-level assembly function, not its neighbors or nested functions', () => {
    const findings = scan(
      `import { Scheduler, Context, Config } from '../services.js';
function assemble(bag: { a: Scheduler; b: Context }): void {
  function nested(value: { a: Scheduler; b: Context }): void {}
  new Config().scheduler();
}
function other(bag: { a: Scheduler; b: Context }): void {}
`,
      'agents/assembly.ts',
    );
    expect(findings.map(({ rule, line }) => ({ rule, line }))).toEqual([
      { rule: 'runtime-service-bag-parameter', line: 3 },
      { rule: 'config-service-locator', line: 4 },
      { rule: 'runtime-service-bag-parameter', line: 6 },
    ]);
    expect(
      scan(
        imports +
          `function assemble(bag: { a: Scheduler; b: Context }): void {}`,
      ),
    ).toHaveLength(1);
  });

  it('exempts a local bundle type only inside the exact assembly function', () => {
    expect(
      scan(
        `import { Scheduler, Context } from '../services.js';
function assemble(): void { type Local = { a: Scheduler; b: Context }; }
type Outside = { a: Scheduler; b: Context };`,
        'agents/assembly.ts',
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 3 }),
    ]);
  });
  it('allows alternative single services without treating a union as a bundle', () => {
    expect(
      scan(
        imports +
          `
      type Choice = Scheduler | Context;
      type Wrapped = { service: Scheduler | Context };
      function consume(value: Choice): void {}
    `,
      ),
    ).toEqual([]);
  });

  it('rejects an intersection combining a service and a second service property', () => {
    expect(
      scan(imports + `type Combined = Scheduler & { context: Context };`),
    ).toEqual([expect.objectContaining({ rule: 'runtime-service-bundle' })]);
  });

  it('detects a multi-service branch without combining mutually exclusive branches', () => {
    expect(
      scan(
        imports +
          `type Combined = { a: Scheduler; b: Context } | { label: string };`,
      ),
    ).toEqual([expect.objectContaining({ rule: 'runtime-service-bundle' })]);
  });

  it('terminates recursive shapes and deduplicates identities', () => {
    expect(
      scan(
        imports +
          `
      type One = { next?: One; first: Scheduler; again: Scheduler };
      type Two = { next?: Two; first: Scheduler; other: Context };
    `,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 4 }),
    ]);
  });

  it('fails visibly on unresolved fixture imports instead of silently passing', () => {
    expect(() =>
      scan(
        `import { Missing } from './missing.js'; type Bag = { a: Missing };`,
      ),
    ).toThrow('TypeScript');
  });

  it('fails visibly on an invalid configured identity', () => {
    expect(() =>
      scanRuntimeServiceShapes(roots, {
        ...options,
        services: [{ file: 'services.ts', exportName: 'Missing' }],
      }),
    ).toThrow('Missing');
  });
});
