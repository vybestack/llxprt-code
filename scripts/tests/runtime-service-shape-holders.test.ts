/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { imports, scan } from './runtime-service-shape-test-helpers.js';

describe('runtime service shape guard stored and aggregate shapes', () => {
  it.each([
    'class Owner { private bag!: { clock: Scheduler; context: Context }; }',
    'class Owner { protected bag!: { clock: Scheduler; context: Context }; }',
    'class Owner { #bag!: { clock: Scheduler; context: Context }; }',
    'class Owner { static bag: { clock: Scheduler; context: Context } = { clock: new Scheduler(), context: new Context() }; }',
  ])('rejects a bundle stored in a class field: %s', (declaration) => {
    expect(scan(imports + declaration)).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 2 }),
    ]);
  });

  it('rejects both a public bag field and the class surface exposing it', () => {
    expect(
      scan(
        imports +
          'class Owner { public bag!: { clock: Scheduler; context: Context }; }',
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 2,
        column: 1,
      }),
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 2,
        column: 15,
      }),
    ]);
  });

  it.each([
    `interface Ports { clock: Scheduler; context: Context }
     class Owner { private bag!: Ports; }`,
    `type Ports = { clock: Scheduler; context: Context };
     class Owner { protected bag!: Ports; }`,
  ])('rejects a bundle named by a stored field type: %s', (declaration) => {
    expect(scan(imports + declaration)).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 2,
        column: 1,
      }),
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 3,
        column: 20,
      }),
    ]);
  });

  it('rejects a protected field whose declared type is a bundle', () => {
    expect(
      scan(
        imports +
          `class Base { protected readonly ports!: { clock: Scheduler; context: Context }; }`,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 2 }),
    ]);
  });

  it('rejects a constructor parameter property that holds a bundle', () => {
    expect(
      scan(
        imports +
          `class Owner { constructor(private readonly bag: { clock: Scheduler; context: Context }) {} }`,
      ),
    ).toContainEqual(
      expect.objectContaining({
        rule: 'runtime-service-bag-parameter',
        line: 2,
      }),
    );
  });

  it('rejects a bundle stored in an optional field', () => {
    expect(
      scan(
        imports +
          `class Owner { private readonly ports?: { clock: Scheduler; context: Context }; }`,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 2 }),
    ]);
  });

  it('rejects a class bag with two public service fields behind a private field', () => {
    expect(
      scan(
        imports +
          `class Services { scheduler = new Scheduler(); context = new Context(); }
class Owner { private readonly services!: Services; }`,
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 2,
        column: 1,
      }),
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 3 }),
    ]);
  });

  it('rejects a class bag with two public getters returning services', () => {
    expect(
      scan(
        imports +
          `class Services {
  private readonly scheduler!: Scheduler;
  get clock(): Scheduler { return this.scheduler; }
  get context(): Context { return new Context(); }
}
class Owner { private readonly services!: Services; }`,
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 2,
        column: 1,
      }),
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 7 }),
    ]);
  });

  it('rejects a class bag whose public methods return services', () => {
    expect(
      scan(
        imports +
          `class Services {
  private readonly scheduler!: Scheduler;
  clock(): Scheduler { return this.scheduler; }
  context(): Context { return new Context(); }
}
class Owner { private readonly services!: Services; }`,
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 2,
        column: 1,
      }),
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 7 }),
    ]);
  });

  it('allows an owner that keeps collaborators private and exposes operations', () => {
    expect(
      scan(
        imports +
          `class Owner {
  private readonly scheduler!: Scheduler;
  #context = new Context();
  schedule(): void { this.scheduler.schedule(); }
  contextId(): string { return this.#context.contextId; }
}
class Holder { private readonly owner!: Owner; }
function consume(owner: Owner): void {}`,
      ),
    ).toEqual([]);
  });

  it('rejects an intersection of capability services as the CliUiRuntime shape', () => {
    expect(
      scan(
        imports +
          `
      interface ClockCapability { clock(): Scheduler }
      interface ContextCapability { context(): Context }
      type FlattenedRuntime = ClockCapability & ContextCapability;
      class Owner { private readonly runtime!: FlattenedRuntime; }`,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 5 }),
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 6 }),
    ]);
  });

  it('rejects a flattened aggregate assigned from several services', () => {
    expect(
      scan(
        imports +
          `
      interface ClockCapability { clock(): Scheduler }
      interface ContextCapability { context(): Context }
      type FlattenedRuntime = ClockCapability & ContextCapability;
      function build(a: ClockCapability, b: ContextCapability): FlattenedRuntime {
        return Object.assign({}, a, b);
      }
      function consume(runtime: FlattenedRuntime): void {}`,
      ),
    ).toEqual([
      {
        rule: 'runtime-service-bundle',
        file: 'consumer.ts',
        line: 5,
        column: 7,
      },
      {
        rule: 'runtime-service-bundle',
        file: 'consumer.ts',
        line: 7,
        column: 16,
      },
      {
        rule: 'runtime-service-bag-parameter',
        file: 'consumer.ts',
        line: 9,
        column: 24,
      },
    ]);
  });

  it('rejects a spread aggregate that flattens several services', () => {
    expect(
      scan(
        imports +
          `
      const clock = new Scheduler();
      const context = new Context();
      const carrier = { ...{ clock }, ...{ context } };`,
      ),
    ).toEqual([expect.objectContaining({ rule: 'runtime-service-bundle' })]);
  });

  it.each([
    'class Owner { private clock!: Scheduler; private context!: Context; }',
    'class Owner { protected clock!: Scheduler; protected context!: Context; }',
    'class Owner { #clock = new Scheduler(); #context = new Context(); }',
    'class Owner { constructor(private clock: Scheduler, private context: Context) {} }',
  ])(
    'allows an owner that keeps several single-service fields: %s',
    (declaration) => {
      expect(scan(imports + declaration)).toEqual([]);
    },
  );

  it('rejects public services combined through class inheritance', () => {
    expect(
      scan(
        imports +
          'class Base { clock!: Scheduler } class Owner extends Base { context!: Context }',
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 2,
        column: 34,
      }),
    ]);
  });

  it('rejects an owner whose public methods expose two capabilities', () => {
    expect(
      scan(
        imports +
          `
      interface ClockCapability { clock(): Scheduler }
      interface ContextCapability { context(): Context }
      class Owner {
        private readonly clockSource!: ClockCapability;
        private readonly contextSource!: ContextCapability;
        clock(): Scheduler { return this.clockSource.clock(); }
        context(): Context { return this.contextSource.context(); }
      }`,
      ),
    ).toEqual([
      expect.objectContaining({
        rule: 'runtime-service-bundle',
        line: 5,
        column: 7,
      }),
    ]);
  });

  it.each([
    'class Owner { private clock!: Scheduler; }',
    'class Owner { protected readonly scheduler = new Scheduler(); }',
    'class Owner { constructor(private scheduler: Scheduler) {} }',
    'class Owner { clock(): Scheduler { return new Scheduler(); } }',
  ])('allows a single-service holder: %s', (declaration) => {
    expect(scan(imports + declaration)).toEqual([]);
  });

  it.each([
    `interface ClockPort { now(): number }
     class Owner { private port!: ClockPort; }`,
    `interface ClockPort { now(): number }
     class Owner { protected readonly ports!: { clock: ClockPort; context: ContextPort }; }
     interface ContextPort { contextId(): string }`,
    `type ClockReader = Pick<Scheduler, 'schedule'>;
     interface Port { schedule(reader: ClockReader): void }
     class Owner { private port!: Port; }`,
    `class Owner { private readonly either!: Scheduler | Context; }`,
  ])('allows a narrow port: %s', (declaration) => {
    expect(scan(imports + declaration)).toEqual([]);
  });
});
