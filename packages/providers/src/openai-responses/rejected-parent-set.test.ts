/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  planStatefulConversation,
  parentHitOf,
  selectStatefulParent,
} from './openAIResponsesStateful.js';
import { rejectedParentRows } from '../__tests__/support/frozenWire/explicit/responsesCases.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProviderCore.js';
import { RejectedParentSet } from './rejected-parent-set.js';

function retainedEntries(
  value: unknown,
  visited = new WeakSet<object>(),
): number {
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value))
    return 0;
  if (visited.has(value)) return 0;
  visited.add(value);
  const entries =
    value instanceof Set || value instanceof Map
      ? Array.from(value.values())
      : Object.values(value);
  return (
    entries.length +
    entries.reduce(
      (count: number, item: unknown) => count + retainedEntries(item, visited),
      0,
    )
  );
}

function assertBounded(value: unknown): void {
  expect(retainedEntries(value)).toBeLessThanOrEqual(64);
}

describe('provider-owned rejected parent disk membership', () => {
  const directory = useTempDir('rejected-parents-');

  it('starts empty, creates one file lazily, and forgets all membership on clear and disposal', async () => {
    const table = new RejectedParentSet({ directory: directory() });
    const other = new RejectedParentSet({ directory: directory() });
    expect(table.has('parent')).toBe(false);
    expect(readdirSync(directory())).toHaveLength(0);
    await table.add('parent');
    await table.add('parent');
    expect(table.has('parent')).toBe(true);
    expect(other.has('parent')).toBe(false);
    expect(readdirSync(directory())).toHaveLength(1);
    table.clear();
    expect(table.has('parent')).toBe(false);
    expect(readdirSync(directory())).toHaveLength(0);
    await table.add('fresh');
    table.dispose();
    expect(readdirSync(directory())).toHaveLength(0);
  });

  it('keeps retained ids and lookup reads flat through 10000 rejections and rehashes', async () => {
    let reads = 0;
    const table = new RejectedParentSet({
      directory: directory(),
      io: {
        read: (...args) => {
          reads++;
          return readSync(...args);
        },
        write: writeSync,
      },
    });
    try {
      const snapshots: number[] = [];
      let index = 0;
      for (const target of [100, 10000]) {
        for (; index < target; index++) await table.add(`rejection-${index}`);
        assertBounded(table);
        snapshots.push(retainedEntries(table));
        const before = reads;
        const found = Array.from({ length: 100 }, (_, probe) =>
          table.has(`rejection-${probe}`),
        );
        expect(found.every(Boolean)).toBe(true);
        expect(reads - before).toBeLessThanOrEqual(110);
        expect(readdirSync(directory())).toHaveLength(1);
      }
      expect(snapshots[0]).toBe(snapshots[1]);
      expect(
        statSync(join(directory(), readdirSync(directory())[0])).size,
      ).toBeGreaterThan(64 + 1024 * 16);
      for (let index = 0; index < 10000; index++)
        expect(table.has(`rejection-${index}`)).toBe(true);
      expect(table.has('absent')).toBe(false);
      const control = new Set(
        Array.from({ length: 10000 }, (_, index) => `rejection-${index}`),
      );
      expect(() => assertBounded(control)).toThrow(Error);
    } finally {
      table.dispose();
    }
  });

  it('keeps one provider instance flat and detects a provider retaining a Set', async () => {
    const provider = new OpenAIResponsesProvider('test-api-key');
    const membership = Object.values(provider).find(
      (value): value is RejectedParentSet => value instanceof RejectedParentSet,
    );
    if (membership === undefined)
      throw new Error('Missing provider rejection membership');
    try {
      for (let index = 0; index < 100; index++)
        await membership.add(`rejection-${index}`);
      const small = retainedEntries(provider);
      for (let index = 100; index < 10000; index++)
        await membership.add(`rejection-${index}`);
      const assertFlat = (candidate: unknown): void => {
        expect(retainedEntries(candidate)).toBe(small);
      };
      assertFlat(provider);
      const control = {
        ...provider,
        retained: new Set(
          Array.from({ length: 10000 }, (_, index) => `rejection-${index}`),
        ),
      };
      expect(() => assertFlat(control)).toThrow(Error);
    } finally {
      provider.dispose();
    }
  });

  it('selects the same parent as a Set across random histories and rejection sequences', async () => {
    const table = new RejectedParentSet({ directory: directory() });
    const rejected = new Set<string>();
    const logger = new DebugLogger('rejected-parent-selection-test');
    let seed = 731;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const selected = (
      rows: readonly IContent[],
      membership: (id: string) => boolean,
    ): ReturnType<typeof selectStatefulParent> => {
      const plan = planStatefulConversation(
        { invocation: { modelBehavior: {} } },
        { 'responses-stateful': true },
        true,
        false,
        'https://api.openai.com/v1',
        membership,
        true,
        logger,
      );
      if (plan.kind !== 'scan') throw new Error('Expected parent scan');
      let hit: ReturnType<typeof parentHitOf>;
      for (const [index, row] of rows.entries())
        hit = parentHitOf(row, index, plan) ?? hit;
      return selectStatefulParent(hit, rows.length, logger);
    };
    try {
      for (let trial = 0; trial < 200; trial++) {
        const rows: IContent[] = Array.from(
          { length: 2 + (random() % 40) },
          () => ({
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'answer' }],
            metadata: {
              id: `parent-${random() % 300}`,
              responsesStored: true,
              providerBaseURL:
                random() % 3 === 0
                  ? 'https://other.invalid'
                  : 'https://api.openai.com/v1',
            },
          }),
        );
        rows.push({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'next question' }],
        });
        for (let index = 0; index < 5; index++) {
          const id = `parent-${random() % 300}`;
          rejected.add(id);
          await table.add(id);
        }
        expect(selected(rows, (id) => table.has(id))).toStrictEqual(
          selected(rows, (id) => rejected.has(id)),
        );
      }
    } finally {
      table.dispose();
    }
  });

  it('reselects with the unchanged plan after rejection and rejects the cached-parent control', async () => {
    const table = new RejectedParentSet({ directory: directory() });
    const rows = rejectedParentRows().first;
    const logger = new DebugLogger('unchanged-parent-plan-test');
    const plan = planStatefulConversation(
      { invocation: { modelBehavior: {} } },
      { 'responses-stateful': true },
      true,
      false,
      'https://api.openai.com/v1',
      (id) => table.has(id),
      true,
      logger,
    );
    if (plan.kind !== 'scan') throw new Error('Expected parent scan');
    const scan = (): ReturnType<typeof selectStatefulParent> => {
      let hit: ReturnType<typeof parentHitOf>;
      for (const [index, row] of rows.entries())
        hit = parentHitOf(row, index, plan) ?? hit;
      return selectStatefulParent(hit, rows.length, logger);
    };
    try {
      const cached = scan();
      expect(cached.parentId).toBe('resp_dead');
      await table.add('resp_dead');
      const assertNext = (selected: ReturnType<typeof scan>): void => {
        expect(selected.parentId).toBe('resp_ok');
      };
      assertNext(scan());
      expect(() => assertNext(cached)).toThrow(Error);
    } finally {
      table.dispose();
    }
  });

  it('propagates a failed slot write without a heap fallback', async () => {
    let writes = 0;
    const table = new RejectedParentSet({
      directory: directory(),
      io: {
        read: readSync,
        write: (...args) => {
          if (++writes > 1) throw new Error('slot write refused');
          return writeSync(...args);
        },
      },
    });
    try {
      await expect(table.add('rejection-failed')).rejects.toThrow(
        'slot write refused',
      );
      expect(table.has('rejection-failed')).toBe(false);
      assertBounded(table);
    } finally {
      table.dispose();
    }
  });
});
