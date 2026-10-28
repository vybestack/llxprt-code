/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { scanRuntimeServiceShapes } from './runtime-service-shape-guard.js';

const roots = {
  'services.ts': `
    export class Scheduler { schedule(): void {} }
    export class Context { contextId = 'session'; }
    export class Vault { readKey(): string { return 'key'; } }
    export class Journal { append(): void {} }
  `,
};
const options = {
  services: [
    { file: 'services.ts', exportName: 'Scheduler' },
    { file: 'services.ts', exportName: 'Context' },
  ],
  configs: [],
  runtimeObjects: [
    { file: 'services.ts', exportName: 'Vault' },
    { file: 'services.ts', exportName: 'Journal' },
  ],
};
const imports = `import { Scheduler, Context, Vault, Journal } from './services.js';\n`;
function scan(source: string) {
  return scanRuntimeServiceShapes(
    { ...roots, 'consumer.ts': imports + source },
    options,
  );
}
describe('runtime service shape guard flattened aggregates', () => {
  /**
   * The CliUiRuntime shape: several capability read-models, each exposing
   * operations that reach a distinct runtime object, flattened into one type.
   * Nobody hands a service out, so counting services finds nothing; the carrier
   * is the flattened aggregate.
   */
  it('rejects capability read-models over runtime objects flattened into one type', () => {
    expect(
      scan(
        `
      interface VaultReads { readKey(): string; readVault(): Vault }
      interface JournalReads { append(): void; readJournal(): Journal }
      type FlatRuntime = VaultReads & JournalReads;`,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 5 }),
    ]);
  });

  it('rejects a field typed by a flattened capability aggregate', () => {
    expect(
      scan(
        `
      interface VaultReads { readKey(): string; readVault(): Vault }
      interface JournalReads { append(): void; readJournal(): Journal }
      type FlatRuntime = VaultReads & JournalReads;
      class Owner { private readonly runtime!: FlatRuntime; }`,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 5 }),
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 6 }),
    ]);
  });

  it('rejects a carrier built by Object.assign from capability read-models', () => {
    expect(
      scan(
        `
      interface VaultReads { readKey(): string; readVault(): Vault }
      interface JournalReads { append(): void; readJournal(): Journal }
      function build(vault: VaultReads, journal: JournalReads) {
        return Object.assign({}, vault, journal);
      }`,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 6 }),
    ]);
  });

  /**
   * Allowed: one port that includes another and adds reads is composition. The
   * streaming runtime is built this way.
   */
  it('allows an interface that includes one capability port and adds reads', () => {
    expect(
      scan(
        `
      interface VaultReads { readKey(): string; readVault(): Vault }
      interface StreamRuntime extends VaultReads { getModel(): string }`,
      ),
    ).toEqual([]);
  });

  /** Allowed: merged parts that reach no configured capability are data. */
  it('allows a merged type whose parts reach no configured capability', () => {
    expect(
      scan(
        `
      interface LabelReads { label(): string }
      interface CountReads { count(): number }
      type Labels = LabelReads & CountReads;`,
      ),
    ).toEqual([]);
  });

  /** Allowed: one capability read two ways is one capability. */
  it('allows a merged type whose parts reach the same single capability', () => {
    expect(
      scan(
        `
      interface VaultReads { readKey(): string; readVault(): Vault }
      interface VaultWrites { writeVault(): Vault }
      type VaultAccess = VaultReads & VaultWrites;`,
      ),
    ).toEqual([]);
  });

  /** Allowed: narrowing a single port is one part, whatever the projection. */
  it('allows a projection of one capability port', () => {
    expect(
      scan(
        `
      interface VaultReads { readKey(): string; readVault(): Vault }
      type KeyReads = Pick<VaultReads, 'readKey'> & VaultReads;`,
      ),
    ).toEqual([]);
  });

  /** Allowed: an owner holding single capabilities directly is the design. */
  it('allows an owner that holds capabilities one field at a time', () => {
    expect(
      scan(
        `
      class Owner {
        private readonly vault!: Vault;
        private readonly journal!: Journal;
      }`,
      ),
    ).toEqual([]);
  });

  /**
   * The CliUiRuntime combination exactly: one part reads a runtime object
   * directly, and beside it sits a part with an optional callback and an
   * optional port that returns a second runtime object. `restartExtension?:
   * () => …` types as `(() => …) | undefined`, and a nullable type has no call
   * signatures of its own, so the part read as data and the aggregate went
   * unreported.
   */
  it('rejects the CliUiRuntime shape: an optional operation beside an optional capability port', () => {
    expect(
      scan(
        `
      interface KeyReads { getKeys(): Vault }
      interface Persistence { forRecording(): Journal }
      type FlatRuntime = KeyReads & {
        readonly restartExtension?: () => Promise<void>;
        readonly sessionPersistence?: Persistence;
      };
      function consume(runtime: FlatRuntime): void { void runtime; }
      class Holder { protected readonly runtime!: FlatRuntime }`,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 5 }),
      expect.objectContaining({
        rule: 'runtime-service-bag-parameter',
        line: 9,
      }),
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 10 }),
    ]);
  });

  /** Control: the same aggregate with a required callable is reported already. */
  it('rejects the same aggregate when its operation member is required', () => {
    expect(
      scan(
        `
      interface KeyReads { getKeys(): Vault }
      interface Persistence { forRecording(): Journal }
      type FlatRuntime = KeyReads & {
        readonly restartExtension: () => Promise<void>;
        readonly sessionPersistence?: Persistence;
      };`,
      ),
    ).toEqual([
      expect.objectContaining({ rule: 'runtime-service-bundle', line: 5 }),
    ]);
  });

  /**
   * Control: drop the callable and the part is data rather than an operation
   * surface, so one capable part remains and the aggregate is a port.
   */
  it('allows the same aggregate when its last part has no callable member', () => {
    expect(
      scan(
        `
      interface KeyReads { getKeys(): Vault }
      interface Persistence { forRecording(): Journal }
      type FlatRuntime = KeyReads & {
        readonly sessionPersistence?: Persistence;
      };`,
      ),
    ).toEqual([]);
  });
});
