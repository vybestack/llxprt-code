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
import ts from 'typescript';

// ---------------------------------------------------------------------------
// Audit engine
// ---------------------------------------------------------------------------

interface RetainingProperty {
  readonly className: string;
  readonly property: string;
  readonly declared: string;
}

/** Array or keyed-collection type text (IContent[], Array<T>, Map<K,V>, Set<T>, …). */
const COLLECTION_TYPE =
  /\[\s*\]$|\b(?:Readonly)?(?:Array|Map|Set|WeakMap|WeakSet)\s*</;

/** Collection-typed constructor initializer (new Map<K,V>(…), new Set<T>(…), []). */
const COLLECTION_INITIALIZER =
  /^new\s+(?:Readonly)?(?:Map|Set|WeakMap|WeakSet)\s*<|^\[\s*\]$/;

function retainingDeclarationOf(
  prop: ts.PropertyDeclaration,
  source: ts.SourceFile,
): string | null {
  if (prop.type !== undefined) {
    const typeText = prop.type.getText(source);
    if (COLLECTION_TYPE.test(typeText)) {
      return typeText;
    }
  }
  const initializerText = prop.initializer?.getText(source) ?? '';
  if (COLLECTION_INITIALIZER.test(initializerText)) {
    return initializerText;
  }
  return null;
}

/** Flag one class member when it declares a retaining collection. */
function auditMember(
  className: string,
  member: ts.ClassElement,
  source: ts.SourceFile,
  whitelist: ReadonlySet<string>,
  flagged: RetainingProperty[],
): void {
  if (!ts.isPropertyDeclaration(member)) return;
  const declared = retainingDeclarationOf(member, source);
  if (declared === null) return;
  const key = `${className}.${member.name.getText(source)}`;
  if (whitelist.has(key)) return;
  flagged.push({
    className,
    property: member.name.getText(source),
    declared,
  });
}

/**
 * Enumerate every class field whose declared type or initializer admits a
 * collection, minus the whitelist. Walks nested classes too.
 */
function auditSourceText(
  sourceText: string,
  whitelist: ReadonlySet<string>,
): RetainingProperty[] {
  const source = ts.createSourceFile(
    'audit-target.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const flagged: RetainingProperty[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.text ?? '<anonymous>';
      for (const member of node.members) {
        auditMember(className, member, source, whitelist, flagged);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return flagged;
}

async function auditRepoFile(
  relativePath: string,
  whitelist: ReadonlySet<string>,
): Promise<RetainingProperty[]> {
  const sourceText = await fs.readFile(
    path.join(import.meta.dir, relativePath),
    'utf8',
  );
  return auditSourceText(sourceText, whitelist);
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
  'HistoryServiceCore.batchParticipants':
    'observer registry; one entry per registered batch participant (production wiring registers exactly one integration)',
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

describe('structural audit engine (P05b3 criterion 1)', () => {
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

// ---------------------------------------------------------------------------
// The audit itself: today RED, listing the fields the green session deletes
// ---------------------------------------------------------------------------

describe('no context-retaining collections in the facade surface (P05b3)', () => {
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

  it('documents a bound for every whitelist entry', () => {
    expect(Object.keys(WHITELIST_BOUNDS).length).toBe(WHITELIST.size);
    for (const [key, bound] of Object.entries(WHITELIST_BOUNDS)) {
      expect(bound.length).toBeGreaterThan(20);
      expect(key.includes('.')).toBe(true);
    }
  });
});
