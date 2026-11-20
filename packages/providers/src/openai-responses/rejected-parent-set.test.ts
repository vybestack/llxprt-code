/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import {
  planStatefulConversation,
  parentHitOf,
  selectStatefulParent,
} from './openAIResponsesStateful.js';
import { rejectedParentRows } from '../__tests__/support/frozenWire/explicit/responsesCases.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProviderCore.js';

function membership(provider: OpenAIResponsesProvider): Set<string> {
  const value: unknown = Object.entries(provider).find(
    ([name]) => name === 'rejectedStatefulParents',
  )?.[1];
  if (
    !(value instanceof Set) ||
    !Array.from(value).every((id: unknown) => typeof id === 'string')
  )
    throw new Error('Missing provider rejection Set');
  return value;
}

describe('provider-owned rejected parent membership', () => {
  it('retains exactly one id per distinct rejection event without creating files', async () => {
    const provider = new OpenAIResponsesProvider('test-api-key');
    try {
      const rejected = membership(provider);
      expect(rejected.size).toBe(0);
      const created = await operationFileCreates(async () => {
        for (const distinct of [1, 30, 100]) {
          for (let index = 0; index < distinct; index++) {
            rejected.add(`rejection-${index}`);
            rejected.add(`rejection-${index}`);
          }
          expect(rejected.size).toBe(distinct);
        }
        expect(rejected.has('absent')).toBe(false);
        for (let index = 0; index < 100; index++)
          expect(rejected.has(`rejection-${index}`)).toBe(true);
      }, true);
      expect(created).toStrictEqual({ directories: [], files: [] });
    } finally {
      provider.dispose();
    }
  });

  it('starts each instance empty and forgets membership on clear and disposal', () => {
    const provider = new OpenAIResponsesProvider('test-api-key');
    const other = new OpenAIResponsesProvider('test-api-key');
    try {
      const rejected = membership(provider);
      rejected.add('parent');
      expect(rejected.has('parent')).toBe(true);
      expect(membership(other).size).toBe(0);
      provider.clearState();
      expect(rejected.size).toBe(0);
      rejected.add('fresh');
      provider.dispose();
      expect(rejected.size).toBe(0);
    } finally {
      provider.dispose();
      other.dispose();
    }
  });

  it('selects the same parent as an independent rejection model across random histories', () => {
    const provider = new OpenAIResponsesProvider('test-api-key');
    const rejected = new Set<string>();
    const logger = new DebugLogger('rejected-parent-selection-test');
    let seed = 731;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const selected = (
      rows: readonly IContent[],
      contains: (id: string) => boolean,
    ): ReturnType<typeof selectStatefulParent> => {
      const plan = planStatefulConversation(
        { invocation: { modelBehavior: {} } },
        { 'responses-stateful': true },
        true,
        false,
        'https://api.openai.com/v1',
        contains,
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
      const parents = membership(provider);
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
          parents.add(id);
        }
        expect(selected(rows, (id) => parents.has(id))).toStrictEqual(
          selected(rows, (id) => rejected.has(id)),
        );
      }
    } finally {
      provider.dispose();
    }
  });

  it('reselects with the unchanged plan after rejection and rejects the cached-parent control', () => {
    const provider = new OpenAIResponsesProvider('test-api-key');
    try {
      const parents = membership(provider);
      const rows = rejectedParentRows().first;
      const logger = new DebugLogger('unchanged-parent-plan-test');
      const plan = planStatefulConversation(
        { invocation: { modelBehavior: {} } },
        { 'responses-stateful': true },
        true,
        false,
        'https://api.openai.com/v1',
        (id) => parents.has(id),
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
      const cached = scan();
      expect(cached.parentId).toBe('resp_dead');
      parents.add('resp_dead');
      const assertNext = (chosen: ReturnType<typeof scan>): void => {
        expect(chosen.parentId).toBe('resp_ok');
      };
      assertNext(scan());
      expect(() => assertNext(cached)).toThrow(Error);
    } finally {
      provider.dispose();
    }
  });
});
