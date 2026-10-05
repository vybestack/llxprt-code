/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260917-ISSUE854.P05b3
 * @requirement G6
 *
 * Structural audit (acceptance criterion 1):
 * "No field, property, or closure in HistoryService(Core) retains an
 * array/collection proportional to context length." The audit parses the
 * source with the TypeScript compiler API (ts.createSourceFile), enumerates
 * every class field/property in the facade's standing-state surface, and
 * FAILS when a field's type or initializer admits a collection whose
 * cardinality can grow with the context.
 *
 * Whitelist policy: ONLY O(1) standing state and explicitly-capped windows
 * may stay. Every whitelist entry below names its max bound; an entry whose
 * bound is not enforced by the type or the accessor is a bug in this audit
 * and must be fixed, not extended.
 */

import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  auditSourceText,
  type RetainingProperty,
} from './structural-audit.test-support.js';

async function auditRepoFile(
  relativePath: string,
  whitelist: ReadonlySet<string>,
): Promise<RetainingProperty[]> {
  const sourceText = await fs.readFile(
    path.join(import.meta.dir, relativePath),
    'utf8',
  );
  return auditSourceText(
    sourceText,
    whitelist,
    path.join(import.meta.dir, relativePath),
  );
}

// ---------------------------------------------------------------------------
// Whitelist: O(1) standing state and explicitly-capped windows only
// ---------------------------------------------------------------------------

/**
 * Keyed by `ClassName.property`. Each entry states the max bound and where
 * the bound is enforced. Nothing on this list may scale with context length.
 */
const WHITELIST_BOUNDS: Readonly<Record<string, string>> = {
  'HistoryServiceCore.tokenizerCache':
    'Map keyed by model name; bounded by the handful of models configured for a session, not by context length',
  'HistoryMutationFifo.queue':
    'transient FIFO drained to empty within each mutation cycle (runSynchronous/enqueueAsynchronous drain); bound = in-flight mutations of one cycle',
  'PageWalk.entries':
    'page-window buffer; bound = the caller-supplied entry budget passed to the PageWalk constructor',
  'PageWalk.envelopes':
    'page-window buffer; bound = the same entry budget plus the 128-line group-resolution cap',
  'RecordingIntegration.pendingPersistence':
    'generation-keyed transient map; every entry is deleted when its save settles; bound = concurrent in-flight persistence saves',
  'RecordingIntegration.persistenceFailures':
    'generation-keyed transient map; every entry is deleted when reported; bound = concurrent in-flight persistence saves',
  'JournalResolver.units':
    'survivor interval list (§5c interval-list fold): one unit per journal record that survives the fold, and records are appended only by mutations; rewind/compressed/purge ops destroy units, density compacts them, and the context-floor trim drops resolved units, so the list is bounded by O(mutation events) (rewinds + compressions + purges), not by context length',
};

const WHITELIST: ReadonlySet<string> = new Set(Object.keys(WHITELIST_BOUNDS));

function describeFlag(flag: RetainingProperty): string {
  return `${flag.className}.${flag.property}: ${flag.declared}`;
}

// ---------------------------------------------------------------------------
// Negative controls: the audit must be able to fail
// ---------------------------------------------------------------------------

const RETAINING_STUB = [
  'class RetainingStub {',
  '  private rows: string[] = [];',
  '  private index: Map<string, number> = new Map();',
  '  private tags = new Set<string>();',
  '  private count: number = 0;',
  "  private label = 'plain';",
  '}',
].join('\n');

describe('structural audit engine (P05b3 criterion 1): field controls', () => {
  it('flags collection-typed fields in the negative control stub', () => {
    const flagged = auditSourceText(RETAINING_STUB, WHITELIST);
    expect(
      flagged.map((flag) => `${flag.className}.${flag.property}`),
    ).toStrictEqual([
      'RetainingStub.rows',
      'RetainingStub.index',
      'RetainingStub.tags',
    ]);
  });

  it('leaves scalar fields alone', () => {
    const cleanStub = [
      'class CleanStub {',
      '  private count: number = 0;',
      '  private label = "plain";',
      '  private done?: boolean;',
      '}',
    ].join('\n');
    expect(auditSourceText(cleanStub, WHITELIST)).toStrictEqual([]);
  });

  it('flags initializer-typed collections not on the whitelist', () => {
    const boundedStub = [
      'class BoundedStub {',
      '  private cache = new Map<string, number>();',
      '}',
    ].join('\n');
    const flagged = auditSourceText(boundedStub, WHITELIST);
    expect(
      flagged.map((flag) => `${flag.className}.${flag.property}`),
    ).toStrictEqual(['BoundedStub.cache']);
    expect(WHITELIST.has('BoundedStub.cache')).toBe(false);
  });
});

describe('structural audit engine (P05b3 criterion 1): facade children', () => {
  it('rejects a child facade with aliased rows and a scalar-returning retaining closure', () => {
    const source = `
      type Rows = ReadonlyArray<{ text: string }>;
      class HistoryService {}
      class RetainingChild extends HistoryService {
        private rows: Rows = [];
        private retained = (() => {
          const captured = new Map<string, string>();
          return () => captured.size;
        })();
      }
    `;
    expect(
      auditSourceText(source, WHITELIST).map((flag) => flag.property),
    ).toStrictEqual(['rows', 'retained']);
  });
  it('rejects synthetic eager child snapshots hidden in returned closures and nested fields', () => {
    const source = `
      interface IContent { text: string } declare const ForbiddenEagerHistory: new () => { getAll(): IContent[] };
      type Rows = ReturnType<InstanceType<typeof ForbiddenEagerHistory>['getAll']>;
      class RetainingChild extends ForbiddenEagerHistory {
        constructor(private readonly parameterRows: Rows) { super(); }
        private snapshot: Rows = this.getAll();
        private nested = { values: this.getAll() };
        private read = (() => {
          const captured = this.getAll();
          return () => captured.length;
        })();
        private returned = () => this.getAll();
      }
    `;
    const flags = auditSourceText(
      source,
      WHITELIST,
      path.join(import.meta.dir, 'retaining-child.ts'),
    );
    expect(flags.map((flag) => flag.property)).toStrictEqual([
      'parameterRows',
      'snapshot',
      'nested',
      'read',
      'returned',
    ]);
  });
});

describe('structural audit engine (P05b3 criterion 1): method returns', () => {
  it('flags direct, aliased, inferred, and promised method returns admitting history length', () => {
    const source = `
      interface IContent { text: string }
      type Rows = readonly IContent[];
      type Result<T> = { value: T; status: number };
      class ReturnSurface {
        getAll(): IContent[] { return []; }
        getRawHistory(): Rows { return []; }
        getCuratedForProvider(): Promise<Result<Rows>> {
          return Promise.resolve({ value: [], status: 200 });
        }
        inferred() { return [] as IContent[]; }
        get snapshot(): Rows { return []; }
        get count(): number { return 0; }
        scalar(): Promise<number> { return Promise.resolve(0); }
        boundedTuple(): readonly [IContent, IContent] {
          return [{ text: 'a' }, { text: 'b' }];
        }
      }
    `;
    expect(
      auditSourceText(source, WHITELIST).map(
        (flag) => `${flag.className}.${flag.property}`,
      ),
    ).toStrictEqual([
      'ReturnSurface.getAll',
      'ReturnSurface.getRawHistory',
      'ReturnSurface.getCuratedForProvider',
      'ReturnSurface.inferred',
      'ReturnSurface.snapshot',
    ]);
  });

  it('flags history arrays nested in named state, including method results', () => {
    const source = `
      interface IContent { text: string }
      interface TurnState { history: readonly IContent[] }
      type SessionState = { turn: TurnState; count: number };
      interface TurnIndex { turns: ReadonlyArray<{ sequence: number }> }
      class Snapshot { readonly state!: SessionState; }
      class NamedSurface {
        private current!: SessionState;
        private turnIndex!: TurnIndex;
        getState(): Snapshot { return new Snapshot(); }
        async load(): Promise<SessionState> {
          return { turn: { history: [] }, count: 0 };
        }
      }
    `;
    expect(
      auditSourceText(source, WHITELIST).map(
        (flag) => `${flag.className}.${flag.property}`,
      ),
    ).toStrictEqual([
      'Snapshot.state',
      'NamedSurface.current',
      'NamedSurface.turnIndex',
      'NamedSurface.getState',
      'NamedSurface.load',
    ]);
  });
});

describe('structural audit engine (P05b3 criterion 1): safe surfaces', () => {
  it('flags method returns declared in an interface contract', () => {
    const source = `
      interface IContent { text: string }
      type Rows = IContent[];
      interface HistoryPort {
        materializeHistory(): Rows;
        count(): number;
      }
    `;
    expect(
      auditSourceText(source, WHITELIST).map(
        (flag) => `${flag.className}.${flag.property}`,
      ),
    ).toStrictEqual(['HistoryPort.materializeHistory']);
  });

  it('does not flag scalar named state, fixed tuples, row blocks, page windows, or input-only arrays', () => {
    const source = `
      interface IContent { blocks: string[] }
      type FixedPair = readonly [IContent, IContent];
      interface Metrics { readonly count: number; readonly pair: FixedPair }
      interface Page { entries: string[]; readonly offset: number }
      class SafeSurface {
        private metrics!: Metrics;
        accept(history: IContent[]): number { return history.length; }
        one(): IContent { return { blocks: [] }; }
        page(): Page { return { entries: [], offset: 0 }; }
        async getMetrics(): Promise<Metrics> {
          return { count: 0, pair: [{ blocks: [] }, { blocks: [] }] };
        }
      }
    `;
    expect(auditSourceText(source, WHITELIST)).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The audit itself: today RED, listing the fields the green session deletes
// ---------------------------------------------------------------------------

describe('no context-retaining collections in the facade surface (P05b3): production files', () => {
  it('HistoryServiceCore.ts retains nothing unwhitelisted', async () => {
    const flagged = await auditRepoFile('./HistoryServiceCore.ts', WHITELIST);
    expect(flagged.map(describeFlag)).toStrictEqual([]);
  });

  it('HistoryService.ts retains nothing unwhitelisted', async () => {
    const flagged = await auditRepoFile('./HistoryService.ts', WHITELIST);
    expect(flagged.map(describeFlag)).toStrictEqual([]);
  });

  it('historyMutationFifo.ts retains nothing unwhitelisted', async () => {
    const flagged = await auditRepoFile('./historyMutationFifo.ts', WHITELIST);
    expect(flagged.map(describeFlag)).toStrictEqual([]);
  });

  it('journalResolver.ts retains nothing unwhitelisted', async () => {
    const flagged = await auditRepoFile(
      path.join('..', '..', 'recording', 'journalResolver.ts'),
      WHITELIST,
    );
    expect(flagged.map(describeFlag)).toStrictEqual([]);
  });

  it('journalCursor.ts retains nothing unwhitelisted', async () => {
    const flagged = await auditRepoFile(
      path.join('..', '..', 'recording', 'journalCursor.ts'),
      WHITELIST,
    );
    expect(flagged.map(describeFlag)).toStrictEqual([]);
  });

  it('RecordingIntegration.ts retains nothing unwhitelisted', async () => {
    const flagged = await auditRepoFile(
      path.join('..', '..', 'recording', 'RecordingIntegration.ts'),
      WHITELIST,
    );
    expect(flagged.map(describeFlag)).toStrictEqual([]);
  });

  it('exposes no eager whole-history API on the product prototype chain', async () => {
    const { HistoryService } = await import('./HistoryService.js');
    expect('getAll' in HistoryService.prototype).toBe(false);
    expect('materializeHistory' in HistoryService.prototype).toBe(false);
  });

  it('rejects reintroducing the eager API in the actual product source', async () => {
    const file = path.join(import.meta.dir, 'HistoryService.ts');
    const source = await fs.readFile(file, 'utf8');
    const insertion = '  dispose(): void {';
    expect(source).toContain(insertion);
    const mutated = source.replace(
      insertion,
      '  getAll(): IContent[] { return this.journal.materialize(); }\n' +
        insertion,
    );
    expect(mutated).not.toBe(source);
    const eagerFlags = (text: string): RetainingProperty[] =>
      auditSourceText(text, WHITELIST, file).filter(
        (flag) =>
          flag.className === 'HistoryService' && flag.property === 'getAll',
      );
    expect(eagerFlags(source)).toStrictEqual([]);
    expect(eagerFlags(mutated)).toStrictEqual([
      {
        className: 'HistoryService',
        property: 'getAll',
        declared: 'IContent[]',
      },
    ]);
  });

  it('documents a bound for every whitelist entry', () => {
    expect(Object.keys(WHITELIST_BOUNDS).length).toBe(WHITELIST.size);
    for (const [key, bound] of Object.entries(WHITELIST_BOUNDS)) {
      expect(bound.length).toBeGreaterThan(20);
      expect(key.includes('.')).toBe(true);
    }
  });
});

async function verifyRollbackHelperControls(
  source: string,
  file: string,
): Promise<void> {
  const helperFile = path.join(import.meta.dir, 'historyMutationEffects.ts');
  const helper = await fs.readFile(helperFile, 'utf8');
  const mutatedHelper = helper.replace(
    'const failures: unknown[] = [];',
    'const failures: unknown[] = materializeHistory();',
  );
  expect(mutatedHelper).not.toBe(helper);
  const rollbackFlags = (text: string, name: string): string[] =>
    auditSourceText(text, WHITELIST, name)
      .filter((flag) => flag.property === 'rollbackMutationEffects')
      .map((flag) => flag.property);
  expect(rollbackFlags(helper, helperFile)).toStrictEqual([]);
  expect(rollbackFlags(mutatedHelper, helperFile)).toStrictEqual([
    'rollbackMutationEffects',
  ]);
  for (const [before, after] of [
    [
      'const failures: unknown[] = [];',
      'const failures: unknown[] = materializeHistory();',
    ],
    ['[...effects].reverse()', 'materializeHistory()'],
    ['failures.push(error);', 'failures.push(...materializeHistory());'],
    ['return failures;', 'return materializeHistory();'],
    ['effects.push(', 'effects.push(...materializeHistory(),'],
  ]) {
    const mutation = helper.replace(before, after);
    expect(mutation).not.toBe(helper);
    expect(
      auditSourceText(
        source,
        WHITELIST,
        file,
        undefined,
        new Map([[helperFile, mutation]]),
      )
        .filter((flag) => flag.property === 'rollbackMutationEffects')
        .map((flag) => flag.property),
    ).toStrictEqual(['rollbackMutationEffects']);
  }
}

describe('no context-retaining collections in the facade surface (P05b3): mutation controls', () => {
  it('keeps the resolver file read return scalar and rejects a returned buffer', async () => {
    const file = path.join(
      import.meta.dir,
      '..',
      '..',
      'recording',
      'journalResolver.ts',
    );
    const source = await fs.readFile(file, 'utf8');
    const scalar = '): Promise<number>;';
    const returnedBuffer =
      '): Promise<{ readonly bytesRead: number; readonly buffer: Buffer }>;';
    expect(source).toContain(scalar);
    const mutated = source.replace(scalar, returnedBuffer);
    expect(mutated).not.toBe(source);
    const readFlags = (text: string): string[] =>
      auditSourceText(text, WHITELIST, file)
        .filter(
          (flag) =>
            flag.className === 'ResolverFileHandle' && flag.property === 'read',
        )
        .map(describeFlag);
    expect(readFlags(source)).toStrictEqual([]);
    expect(readFlags(mutated)).toHaveLength(1);
  });

  it('rejects rollback failures if the caller grows effects with history', async () => {
    const file = path.join(import.meta.dir, 'HistoryServiceCore.ts');
    const source = await fs.readFile(file, 'utf8');
    await verifyRollbackHelperControls(source, file);
    const mutated = source.replace(
      'const effects: PreparedHistoryBatchEffect[] = [];',
      'const effects: PreparedHistoryBatchEffect[] = this.materializeHistory() as PreparedHistoryBatchEffect[];',
    );
    expect(mutated).not.toBe(source);
    expect(
      auditSourceText(source, WHITELIST, file).some(
        (flag) => flag.property === 'rollbackMutationEffects',
      ),
    ).toBe(false);
    expect(
      auditSourceText(mutated, WHITELIST, file).some(
        (flag) => flag.property === 'rollbackMutationEffects',
      ),
    ).toBe(true);
  });

  it('rejects resume warnings if cleanup count tracks history or facade returns it', async () => {
    const file = path.join(import.meta.dir, 'HistoryService.ts');
    const helperFile = path.join(import.meta.dir, 'historyResumeAdoption.ts');
    const source = await fs.readFile(file, 'utf8');
    const helper = await fs.readFile(helperFile, 'utf8');
    const mutatedHelper = helper.replace(
      'const warnings: string[] = [];',
      'const warnings: string[] = [...input.journal.materialize()];',
    );
    const mutatedFacade = source.replace(
      'return warnings;',
      'return this.getAll().map(() => "warning");',
    );
    expect(mutatedHelper).not.toBe(helper);
    expect(mutatedFacade).not.toBe(source);
    const flags = (facade: string, adoption: string): string[] =>
      auditSourceText(facade, WHITELIST, file, adoption)
        .filter((flag) => flag.property.startsWith('adoptResumeBoot'))
        .map((flag) => flag.property);
    expect(flags(source, helper)).toStrictEqual([]);
    expect(flags(source, mutatedHelper)).toStrictEqual([
      'adoptResumeBoot',
      'adoptResumeBootInternal',
    ]);
    expect(flags(mutatedFacade, helper)).toContain('adoptResumeBoot');
  });
});

describe('cursor scalar read mutation control', () => {
  it('keeps cursor chunk reads scalar and detects a Buffer-returning mutation', async () => {
    const file = path.join(
      import.meta.dir,
      '..',
      '..',
      'recording',
      'journalCursor.ts',
    );
    const source = await fs.readFile(file, 'utf8');
    const scalar =
      'private async readChunk(\n    buffer: Buffer,\n    start: number,\n    length: number,\n  ): Promise<number>';
    const returnedBuffer = scalar.replace('Promise<number>', 'Promise<Buffer>');
    expect(source).toContain(scalar);
    const mutated = source.replace(scalar, returnedBuffer);
    expect(mutated).not.toBe(source);
    const readFlags = (text: string): string[] =>
      auditSourceText(text, WHITELIST, file)
        .filter(
          (flag) =>
            flag.className === 'JournalCursor' && flag.property === 'readChunk',
        )
        .map(describeFlag);
    expect(readFlags(source)).toStrictEqual([]);
    expect(readFlags(mutated)).toHaveLength(1);
  });
});
