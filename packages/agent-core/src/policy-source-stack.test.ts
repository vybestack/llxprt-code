/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  DefinitionError,
  derivePolicySourceStack,
  validatePolicySourceStacks,
} from '../index.js';
import type { PolicyLayer, PolicyRule, PolicySourceStack } from '../index.js';

const rule = (
  id: string,
  outcome: PolicyRule['outcome'],
  order: number,
): PolicyRule => ({
  id,
  match: { modes: ['yolo'] },
  outcome,
  priority: 3.5,
  order,
  provenance: {
    source: 'admin',
    sourceId: 'admin-domain',
    ruleIndex: order,
    tier: 3,
    sourcePriority: 500,
    expansionIndex: 0,
  },
});

describe('policy source stacks', () => {
  it('derives authority restrictions with prior exceptions while retaining ranked source preferences', () => {
    const preferences: readonly PolicyLayer[] = [
      { name: 'first-file', rules: [rule('allow-operation', 'allow', 0)] },
      { name: 'second-file', rules: [rule('deny-tool', 'deny', 1)] },
    ];
    const stack = derivePolicySourceStack('admin', preferences);

    expect(stack.preferences).toStrictEqual(preferences);
    expect(stack.restrictions[0]?.match.unless).toStrictEqual([
      { modes: ['yolo'] },
    ]);
    expect(stack.restrictions[0]?.id).toBe('deny-tool');
  });

  it('derives cross-file exceptions in ranked priority order, preserving mode predicates', () => {
    const lowerDeny: PolicyRule = {
      ...rule('lower-deny', 'deny', 0),
      match: { tools: ['restricted'], modes: ['yolo'] },
      priority: 3.1,
    };
    const higherAllow: PolicyRule = {
      ...rule('higher-allow', 'allow', 1),
      match: { tools: ['exception'], modes: ['autoEdit'] },
      priority: 3.9,
    };
    const stack = derivePolicySourceStack('admin', [
      { name: 'later-file', rules: [lowerDeny] },
      { name: 'earlier-ranked-file', rules: [higherAllow] },
    ]);

    expect(stack.restrictions[0]?.id).toBe('lower-deny');
    expect(stack.restrictions[0]?.match.unless).toStrictEqual([
      { tools: ['exception'], modes: ['autoEdit'] },
    ]);
  });

  it('rejects accessor input without invoking the accessor', () => {
    let getterCalls = 0;
    const stack: PolicySourceStack = {
      get id() {
        getterCalls += 1;
        return 'admin';
      },
      restrictions: [],
      preferences: [],
    };

    expect(() => validatePolicySourceStacks([stack])).toThrow(DefinitionError);
    expect(getterCalls).toBe(0);
  });

  it('rejects duplicate group identities and stale paired restrictions', () => {
    const derived = derivePolicySourceStack('admin', [
      { name: 'admin', rules: [rule('deny', 'deny', 0)] },
    ]);
    expect(() => validatePolicySourceStacks([derived, derived])).toThrow(
      DefinitionError,
    );
    expect(() =>
      validatePolicySourceStacks([{ ...derived, restrictions: [] }]),
    ).toThrow(DefinitionError);
  });
});
