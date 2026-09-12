/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { intersectPolicy } from './policyIntersection.js';
import type { PolicyCeiling } from './policyIntersection.js';

function checkBasics(
  intent: Parameters<typeof intersectPolicy>[0],
  environment: PolicyCeiling,
  session: PolicyCeiling,
) {
  const outcome = intersectPolicy(intent, environment, session);
  expect(outcome.errors).toStrictEqual([]);
  expect(outcome.warnings).toStrictEqual([]);
  expect(outcome.explanations).toStrictEqual([]);
  return outcome;
}

describe('intersectPolicy', () => {
  it('seeds disabled tools from the intent, not from the allowed list', () => {
    const outcome = checkBasics(
      { allowedTools: ['read', 'write', 'exec'], disabledTools: ['exec'] },
      {},
      {},
    );
    expect(outcome.policy.disabledTools).toStrictEqual(['exec']);
    expect(outcome.policy.allowedTools).toStrictEqual(['read', 'write']);
  });

  it('rolls back an unavailable tool and emits the removal warning', () => {
    const outcome = intersectPolicy(
      { allowedTools: ['read', 'magic'] },
      {},
      {},
      undefined,
      (id) => id !== 'magic',
    );
    expect(outcome.policy.allowedTools).toStrictEqual(['read']);
    expect(outcome.warnings).toStrictEqual([
      'tool magic requested but unavailable; removed from effective policy',
    ]);
    expect(outcome.errors).toStrictEqual([]);
    expect(outcome.explanations).toStrictEqual([]);
  });

  it('uses the isToolAvailable predicate to remove a ceiling-covered unavailable tool', () => {
    const unavailable = intersectPolicy(
      { allowedTools: ['db'], requiredTools: ['db'] },
      { allowedTools: ['db'] },
      {},
      undefined,
      () => false,
    );
    expect(unavailable.policy.allowedTools).toStrictEqual([]);
    expect(unavailable.errors).toStrictEqual([
      'required tool db is not effectively allowed',
    ]);
    expect(unavailable.explanations).toStrictEqual([]);
  });

  it('unions disabled tools across the intent and all layers', () => {
    const outcome = intersectPolicy(
      { disabledTools: ['a'] },
      { disabledTools: ['b'] },
      { disabledTools: ['c'] },
    );
    expect(outcome.policy.disabledTools).toStrictEqual(['a', 'b', 'c']);
    expect(outcome.policy.allowedTools).toStrictEqual([]);
  });

  it('removes a tool disabled by a ceiling layer from the effective set', () => {
    const outcome = checkBasics(
      { allowedTools: ['read', 'write'] },
      {},
      { disabledTools: ['write'] },
    );
    expect(outcome.policy.allowedTools).toStrictEqual(['read']);
    expect(outcome.policy.disabledTools).toStrictEqual(['write']);
  });

  it('does not treat an omitted allowlist as an empty restriction', () => {
    const outcome = checkBasics(
      { allowedTools: ['read'] },
      { disabledTools: ['unrelated'] },
      {},
    );
    expect(outcome.policy.allowedTools).toStrictEqual(['read']);
  });

  it('narrows an absent-intent shell mode to the narrowest layer', () => {
    const outcome = intersectPolicy(
      {},
      { shellMode: 'allowlist' as const },
      { shellMode: 'none' as const },
    );
    expect(outcome.policy.shellMode).toBe('none');
    expect(outcome.explanations).toContainEqual({
      aspect: 'shell mode',
      requested: 'all',
      effective: 'none',
      note: 'no intent; environment ceiling applies',
    });
  });

  it('errors when a required tool is disabled by a ceiling layer', () => {
    const outcome = intersectPolicy(
      { allowedTools: ['read'], requiredTools: ['read'] },
      {},
      { disabledTools: ['read'] },
    );
    expect(outcome.errors).toStrictEqual([
      'required tool read is disabled by policy',
    ]);
    expect(outcome.policy.allowedTools).toStrictEqual([]);
  });

  it('errors when a required tool is disabled by the intent', () => {
    const outcome = intersectPolicy(
      {
        allowedTools: ['write'],
        requiredTools: ['write'],
        disabledTools: ['write'],
      },
      {},
      {},
    );
    expect(outcome.errors).toStrictEqual([
      'required tool write is disabled by policy',
    ]);
  });

  it('picks the narrowest shell mode across intent and layers', () => {
    const outcome = intersectPolicy(
      { shellMode: 'all' as const },
      { shellMode: 'none' as const },
      {},
    );
    expect(outcome.policy.shellMode).toBe('none');
    expect(outcome.explanations).toContainEqual({
      aspect: 'shell mode',
      requested: 'all',
      effective: 'none',
    });
  });

  it('keeps an absent ceiling unrestricted for shell mode', () => {
    const outcome = checkBasics({}, {}, {});
    expect(outcome.policy.shellMode).toBe('all');
  });

  it('applies the strictest approval ceiling', () => {
    const outcome = intersectPolicy(
      {},
      { approvalCeiling: 'yolo' as const },
      { approvalCeiling: 'strict' as const },
    );
    expect(outcome.policy.shellMode).toBe('all');
  });
});
