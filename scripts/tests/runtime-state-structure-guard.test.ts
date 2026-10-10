/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  scanRuntimeStateStructure,
  type ContainerPolicy,
} from './runtime-state-structure-guard.ts';

const filename = 'packages/providers/src/BaseProvider.ts';

describe('runtime state structure scanner', () => {
  it('detects mutable object storage captured by a returned closure', () => {
    const source = `function make() { const state = {}; return { set(value) { state.current = value; }, get() { return state.current; } }; } const registry = make();`;
    expect(scanRuntimeStateStructure(filename, source)).toContainEqual(
      expect.objectContaining({
        declaration: 'registry',
        kind: 'mutable-state',
      }),
    );
  });

  it('does not treat rebinding a function-local alias as mutating its module container', () => {
    const source = `const registry = {}; function run() { let alias = registry; alias = {}; }`;
    expect(scanRuntimeStateStructure(filename, source)).toEqual([]);
  });

  it('detects shorthand factory results and frozen nested containers', () => {
    const source = `function make() { const cache = new WeakMap(); return Object.freeze({ cache }); } const registry = make();`;
    expect(scanRuntimeStateStructure(filename, source)).toContainEqual(
      expect.objectContaining({
        declaration: 'registry',
        kind: 'mutable-state',
      }),
    );
  });

  it('preserves immutable captured lookup data', () => {
    const source = `function make() { const state = Object.freeze({ current: 1 }); return () => state.current; } const registry = make();`;
    expect(scanRuntimeStateStructure(filename, source)).toEqual([]);
  });

  it.each([
    'function make() { return new Map(); } const registry = make();',
    'const make = () => new WeakMap(); const registry = make();',
    'class Owner { cache = new Map(); } function make() { return new Owner(); } const registry = make();',
    'function make() { const cache = new Map(); return () => cache; } const registry = make();',
    'function make() { let active; return { get: () => active, set(value) { active = value; } }; } const registry = make();',
    'function make() { return new Map(); } const alias = make; const registry = alias();',
    'function first() { return second(); } function second() { return condition ? first() : new Map(); } const registry = first();',
    'function identity(value) { return value; } const registry = identity(new Map());',
    'function make() { return new Map(); } const registry = Object.freeze({ cache: make() });',
    'const registry = Object.freeze({ cache: new Map() });',
    'function make() { return { cache: new WeakMap() }; } const registry = make();',
  ])('rejects factory or nested module state in %s', (source) => {
    expect(scanRuntimeStateStructure(filename, source)).toContainEqual(
      expect.objectContaining({
        declaration: 'registry',
        kind: 'mutable-state',
      }),
    );
  });

  it.each([
    'const Alias = ALS; const Again = Alias; function run() { return new Again(); }',
    'function identity(value) { return value; } const Alias = identity(ALS); const scope = new Alias();',
    'const hooksAlias = hooks; const Alias = hooksAlias.AsyncLocalStorage; class Owner { scope = new Alias(); }',
  ])('rejects aliased ALS construction in %s', (body) => {
    const source = `import { AsyncLocalStorage as ALS } from 'node:async_hooks'; import * as hooks from 'node:async_hooks'; ${body}`;
    expect(
      scanRuntimeStateStructure(filename, source).map((hit) => hit.kind),
    ).toContain('async-local-storage');
  });

  it.each([
    'alias.set("key", value);',
    'alias.add(value);',
    'alias.delete("key");',
    'alias.clear();',
    'alias.current = value;',
    'delete alias.current;',
    'alias.count++;',
  ])('reports original module container for alias mutation %s', (mutation) => {
    const source = `const registry = load(); function run() { const intermediate = registry; const alias = intermediate; ${mutation} }`;
    expect(scanRuntimeStateStructure(filename, source)).toContainEqual(
      expect.objectContaining({
        declaration: 'registry',
        kind: 'module-mutation',
      }),
    );
  });

  it('reports static storage reached through an alias', () => {
    expect(
      scanRuntimeStateStructure(
        filename,
        `class Owner { static readonly cache = load(); } const alias = Owner.cache; alias.clear();`,
      ),
    ).toContainEqual(
      expect.objectContaining({
        declaration: 'Owner.cache',
        kind: 'module-mutation',
      }),
    );
  });

  it('reports static factory state', () => {
    expect(
      scanRuntimeStateStructure(
        filename,
        `function make() { return new Map(); } class Owner { static readonly cache = make(); }`,
      ),
    ).toContainEqual(
      expect.objectContaining({
        declaration: 'Owner.cache',
        kind: 'mutable-state',
      }),
    );
  });

  it.each([
    'function make() { return new Map(); } class Owner { cache = make(); }',
    'function make() { const cache = new Map(); return () => cache; } class Owner { constructor() { this.cache = make(); } }',
    'function make() { const temporary = new Map(); return Object.freeze({ a: 1 }); } const table = make();',
    'function make() { return { first: 1, nested: ["a", "b"] } as const; } const table = make();',
    'function make() { return () => new Map(); } const factory = make();',
    'function first() { return second(); } function second() { return first(); } const table = first();',
    'const first = second; const second = first; first.clear();',
    'function run() { const registry = new Map(); const alias = registry; alias.clear(); }',
    'class Owner { cache = new Map(); run() { const alias = this.cache; alias.clear(); } }',
    'const registry = {}; function run(registry) { const alias = registry; alias.clear(); }',
    'class AsyncLocalStorage {} const Alias = AsyncLocalStorage; function run() { return new Alias(); }',
    'function make() { let temporary = 0; return () => 1; } const table = make();',
  ])(
    'preserves ownership and finite immutable dependencies in %s',
    (source) => {
      expect(scanRuntimeStateStructure(filename, source)).toEqual([]);
    },
  );

  it('keeps exact ALS allowance semantics through aliases', () => {
    const source = `import { AsyncLocalStorage as ALS } from 'node:async_hooks'; const Alias = ALS; class BaseProvider { static readonly activeCallContext = new Alias(); }`;
    const allowance = {
      file: filename,
      declaration: 'BaseProvider.activeCallContext',
      reason: 'Per-call context',
    };
    expect(scanRuntimeStateStructure(filename, source, [allowance])).toEqual(
      [],
    );
    expect(
      scanRuntimeStateStructure(filename, source, [
        { ...allowance, declaration: '*' },
      ]).map((hit) => hit.kind),
    ).toEqual(['async-local-storage']);
  });

  it('recognizes string-literal namespace ALS access', () => {
    const source = `import * as hooks from 'async_hooks'; const scope = new hooks['AsyncLocalStorage']();`;
    expect(
      scanRuntimeStateStructure(filename, source).map((hit) => hit.kind),
    ).toEqual(['async-local-storage']);
  });

  it('permits frozen static primitive lookup tables', () => {
    expect(
      scanRuntimeStateStructure(
        filename,
        `class Domain { static readonly names = Object.freeze({ a: 1, b: -2 }); }`,
      ),
    ).toEqual([]);
  });

  it.each([
    ['let active: Runtime | undefined;', 'active'],
    ['var registry = {};', 'registry'],
    ['const registry = new Map();', 'registry'],
    ['const registry = new Set();', 'registry'],
    ['const registry = new WeakMap();', 'registry'],
    ['const registry = new WeakSet();', 'registry'],
    ['const registry = Object.freeze(new Map());', 'registry'],
    ['class Owner {} const registry = new Owner();', 'registry'],
    ['const registry = { nested: new Map() };', 'registry'],
    [
      'const registry = (() => { let active; return () => active; })();',
      'registry.active',
    ],
    [
      'const registry = (() => { const cache = new Map(); return () => cache; })();',
      'registry.cache',
    ],
    ['class Owner { static cache = new Map(); }', 'Owner.cache'],
    ['class Owner { static readonly cache = new Map(); }', 'Owner.cache'],
    ['class Owner { static current: Owner; }', 'Owner.current'],
    ['class Owner { static readonly cache = {}; }', 'Owner.cache'],
  ])('rejects ambient state in %s', (source, declaration) => {
    expect(scanRuntimeStateStructure(filename, source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ declaration, kind: 'mutable-state' }),
      ]),
    );
  });

  it.each([
    'const registry = {}; registry.current = runtime;',
    'const registry = []; function add(value: unknown) { registry.push(value); }',
    'const registry = {}; delete registry.current;',
    'const registry = { count: 0 }; registry.count++;',
    'const registry = {}; Object.assign(registry, runtime);',
    'const registry = load(); registry.set("key", runtime);',
  ])('reports direct module-container mutations in %s', (source) => {
    expect(scanRuntimeStateStructure(filename, source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          declaration: 'registry',
          kind: 'module-mutation',
        }),
      ]),
    );
  });

  it.each([
    'class Owner { cache = new Map(); current?: Runtime; }',
    'function run(cache: Map<string, string>) { cache.set("a", "b"); }',
    'function run() { let active; const cache = new Map(); cache.clear(); }',
    'const table = Object.freeze({ first: 1, second: "two", third: false });',
    'const table = { first: 1, nested: ["a", "b"] } as const;',
    'class Owner { static readonly tag = "owner"; }',
    'const registry = {}; function run(registry: Map<string, string>) { registry.clear(); }',
    'const registry = {}; function run() { const registry = []; registry.push(1); }',
    'class AsyncLocalStorage {} function run() { return new AsyncLocalStorage(); }',
    'import { AsyncLocalStorage } from "other"; function run() { return new AsyncLocalStorage(); }',
    'import type { AsyncLocalStorage } from "node:async_hooks"; type Scope = AsyncLocalStorage<string>;',
    '// let active; const cache = new Map();\nconst example = "new AsyncLocalStorage()";',
  ])('permits owned or literal data in %s', (source) => {
    expect(scanRuntimeStateStructure(filename, source)).toEqual([]);
  });

  it.each([
    'import { AsyncLocalStorage } from "node:async_hooks"; const scope = new AsyncLocalStorage();',
    'import { AsyncLocalStorage as ALS } from "async_hooks"; const scope = new ALS();',
    'import * as hooks from "node:async_hooks"; const scope = new hooks.AsyncLocalStorage();',
    'import hooks from "async_hooks"; const scope = new hooks.AsyncLocalStorage();',
    'import { AsyncLocalStorage as ALS } from "node:async_hooks"; class Owner { scope = new ALS(); }',
    'import { AsyncLocalStorage as ALS } from "node:async_hooks"; function create() { return new ALS(); }',
  ])('rejects non-allowlisted ALS in %s', (source) => {
    expect(
      scanRuntimeStateStructure(filename, source).map((hit) => hit.kind),
    ).toContain('async-local-storage');
  });

  it('resolves shadowed ALS names to their local declaration', () => {
    expect(
      scanRuntimeStateStructure(
        filename,
        `
      import { AsyncLocalStorage as ALS } from 'node:async_hooks';
      function run(ALS: new () => object) { return new ALS(); }
    `,
      ),
    ).toEqual([]);
  });

  it('allows only the exact ALS declaration and file with a reason', () => {
    const source = `import { AsyncLocalStorage as ALS } from 'node:async_hooks';
class BaseProvider { static readonly activeCallContext = new ALS(); }`;
    const allowlist = [
      {
        file: filename,
        declaration: 'BaseProvider.activeCallContext',
        reason: 'Per-call options context only',
      },
    ];
    expect(scanRuntimeStateStructure(filename, source, allowlist)).toEqual([]);
    expect(
      scanRuntimeStateStructure('other.ts', source, allowlist),
    ).toHaveLength(1);
    expect(
      scanRuntimeStateStructure(
        filename,
        source.replace('activeCallContext', 'identityScope'),
        allowlist,
      ),
    ).toHaveLength(1);
    expect(
      scanRuntimeStateStructure(
        filename,
        `${source}\nconst identityScope = new ALS();`,
        allowlist,
      ),
    ).toHaveLength(1);
    expect(
      scanRuntimeStateStructure(filename, source, [
        { ...allowlist[0], reason: ' ' },
      ]),
    ).toHaveLength(1);
    expect(
      scanRuntimeStateStructure(filename, source, [
        { ...allowlist[0], declaration: '*' },
      ]),
    ).toHaveLength(1);
  });

  it('does not allow mutable state through an ALS exemption', () => {
    expect(
      scanRuntimeStateStructure(
        filename,
        'class BaseProvider { static readonly activeCallContext = new Map(); }',
        [
          {
            file: filename,
            declaration: 'BaseProvider.activeCallContext',
            reason: 'Per-call options',
          },
        ],
      ).map((hit) => hit.kind),
    ).toEqual(['mutable-state']);
  });

  it.each([
    'const sessions: Record<string, object> = {}; export function put(id: string, runtime: object) { const bag = { sessions }; bag.sessions[id] = runtime; }',
    'const sessions: Record<string, object> = {}; export function put(id: string, runtime: object) { const bag = { held: sessions }; bag.held[id] = runtime; }',
    'const sessions: Record<string, object> = {}; export function put(id: string, runtime: object) { const bag = { sessions }; const held = bag.sessions; held[id] = runtime; }',
    'const sessions = new Array<object>(); export function put(runtime: object) { const bag = { sessions }; bag.sessions.push(runtime); }',
  ])('follows storage through container property aliases in %s', (source) => {
    expect(scanRuntimeStateStructure(filename, source)).toContainEqual(
      expect.objectContaining({
        declaration: 'sessions',
        kind: 'module-mutation',
      }),
    );
  });

  it.each([
    'const sessions: Record<string, object> = {}; function store(target: Record<string, object>, id: string, runtime: object) { target[id] = runtime; } export function put(id: string, runtime: object) { store(sessions, id, runtime); }',
    'const sessions = new Map<string, object>(); const store = (target: Map<string, object>, id: string, runtime: object) => { target.set(id, runtime); }; export function put(id: string, runtime: object) { store(sessions, id, runtime); }',
    'const sessions: Record<string, object> = {}; function relay(target: Record<string, object>, id: string, runtime: object) { store(target, id, runtime); } function store(target: Record<string, object>, id: string, runtime: object) { target[id] = runtime; } export function put(id: string, runtime: object) { relay(sessions, id, runtime); }',
  ])(
    'reports module storage handed to a local function that mutates its parameter in %s',
    (source) => {
      expect(scanRuntimeStateStructure(filename, source)).toContainEqual(
        expect.objectContaining({
          declaration: 'sessions',
          kind: 'module-mutation',
        }),
      );
    },
  );

  it('permits module lookup data handed to functions that only read it', () => {
    const source =
      "const labels = Object.freeze({ a: 'x' }); function read(target: Record<string, string>, key: string) { return target[key]; } export function label(key: string) { return read(labels, key); }";
    expect(scanRuntimeStateStructure(filename, source)).toEqual([]);
  });

  it('permits mutating a function-local container handed to a mutating local function', () => {
    const source =
      'function fill(target: Record<string, number>) { target.a = 1; } export function build() { const local: Record<string, number> = {}; fill(local); return local; }';
    expect(scanRuntimeStateStructure(filename, source)).toEqual([]);
  });

  describe('container policy for state roots', () => {
    const noAllowances: ContainerPolicy = { allowlist: [] };
    const allowed = (declaration: string): ContainerPolicy => ({
      allowlist: [
        { file: filename, declaration, reason: 'Fixed lookup, never written.' },
      ],
    });

    it('permits module literal tables when no container policy applies', () => {
      expect(
        scanRuntimeStateStructure(filename, 'const sessions = {};'),
      ).toEqual([]);
    });

    it('rejects an unlisted module object literal even without a recognized mutation', () => {
      expect(
        scanRuntimeStateStructure(
          filename,
          'const sessions = {};',
          [],
          undefined,
          noAllowances,
        ),
      ).toEqual([
        {
          file: filename,
          declaration: 'sessions',
          kind: 'mutable-state',
          line: 1,
          column: 7,
        },
      ]);
    });

    it('rejects unlisted array literals, as-const tables and non-primitive frozen tables', () => {
      const source = [
        'const list = [];',
        "const table = { a: 'x' } as const;",
        'const nested = Object.freeze({ inner: { a: 1 } });',
      ].join('\n');
      expect(
        scanRuntimeStateStructure(
          filename,
          source,
          [],
          undefined,
          noAllowances,
        ).map((finding) => finding.declaration),
      ).toEqual(['list', 'table', 'nested']);
    });

    it('accepts a frozen primitive table without an allowlist entry', () => {
      expect(
        scanRuntimeStateStructure(
          filename,
          "const labels = Object.freeze({ a: 'x', b: 2 });",
          [],
          undefined,
          noAllowances,
        ),
      ).toEqual([]);
    });

    it('accepts deeply frozen tables and rejects a frozen table holding an unfrozen member', () => {
      const source = [
        "const deep = Object.freeze({ a: Object.freeze(['x']), b: 1 });",
        "const shallow = Object.freeze({ a: ['x'] });",
      ].join('\n');
      expect(
        scanRuntimeStateStructure(
          filename,
          source,
          [],
          undefined,
          noAllowances,
        ).map((finding) => finding.declaration),
      ).toEqual(['shallow']);
    });

    it('accepts an allowlisted table only by exact file and declaration with a reason', () => {
      const source = "const table = { a: 'x' } as const;";
      expect(
        scanRuntimeStateStructure(
          filename,
          source,
          [],
          undefined,
          allowed('table'),
        ),
      ).toEqual([]);
      expect(
        scanRuntimeStateStructure(
          filename,
          source,
          [],
          undefined,
          allowed('other'),
        ).map((finding) => [finding.declaration, finding.kind]),
      ).toEqual([
        ['table', 'mutable-state'],
        ['other', 'stale-immutable-allowance'],
      ]);
      expect(
        scanRuntimeStateStructure(filename, source, [], undefined, {
          allowlist: [{ file: filename, declaration: 'table', reason: ' ' }],
        }).map((finding) => finding.kind),
      ).toEqual(['mutable-state', 'stale-immutable-allowance']);
    });

    it('reports an allowlist entry whose declaration no longer exists as stale', () => {
      expect(
        scanRuntimeStateStructure(
          filename,
          'export const x = 1;',
          [],
          undefined,
          allowed('removed'),
        ),
      ).toEqual([
        {
          file: filename,
          declaration: 'removed',
          kind: 'stale-immutable-allowance',
          line: 1,
          column: 1,
        },
      ]);
    });

    it('does not let an allowlist entry hide mutation of the listed table', () => {
      const findings = scanRuntimeStateStructure(
        filename,
        'const table = {}; function put() { table.x = 1; }',
        [],
        undefined,
        allowed('table'),
      );
      expect(findings.map((finding) => finding.kind)).toEqual([
        'module-mutation',
      ]);
    });

    it('does not apply to function locals', () => {
      expect(
        scanRuntimeStateStructure(
          filename,
          'function run() { const local = {}; return local; }',
          [],
          undefined,
          noAllowances,
        ),
      ).toEqual([]);
    });
  });

  it('returns source locations without reading a file', () => {
    expect(
      scanRuntimeStateStructure(filename, '\nconst cache = new Map();'),
    ).toEqual([
      {
        file: filename,
        declaration: 'cache',
        kind: 'mutable-state',
        line: 2,
        column: 7,
      },
    ]);
  });
});
