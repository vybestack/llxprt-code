/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { DefinitionError } from './errors.js';
import { isPlainData } from './plain-data.js';
import type {
  DefinitionProblem,
  PolicyLayer,
  PolicyMatch,
  PolicyRule,
  PolicySourceStack,
  RestrictionRule,
} from './types.js';

function sourceRules(
  preferences: readonly PolicyLayer[],
): readonly PolicyRule[] {
  return preferences
    .flatMap((layer) => layer.rules)
    .sort((left, right) => {
      if (left.priority !== right.priority)
        return left.priority > right.priority ? -1 : 1;
      if (left.order === right.order) return 0;
      return left.order < right.order ? -1 : 1;
    });
}

function predicate(rule: PolicyRule): PolicyMatch {
  return rule.match;
}

function sameData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null) return false;
  if (typeof right !== 'object' || right === null) return false;
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  const rightKeySet = new Set(rightKeys);
  if (leftKeys.some((key) => !rightKeySet.has(key))) return false;
  return leftKeys.every((key) => {
    const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
    const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
    if (leftDescriptor === undefined || rightDescriptor === undefined)
      return false;
    if (!('value' in leftDescriptor) || !('value' in rightDescriptor))
      return false;
    return sameData(leftDescriptor.value, rightDescriptor.value);
  });
}

export function derivePolicySourceStack(
  id: string,
  preferences: readonly PolicyLayer[],
): PolicySourceStack {
  if (typeof id !== 'string' || !isPlainData(preferences)) {
    throw new DefinitionError([
      {
        code: 'invalid-source-stack-input',
        path: ['preferences'],
        message: 'Source stack inputs must be plain data.',
      },
    ]);
  }
  const rules = sourceRules(preferences);
  const restrictions: RestrictionRule[] = [];
  rules.forEach((rule, index) => {
    if (rule.outcome === 'allow') return;
    const earlierRules = [
      ...(rule.match.unless ?? []),
      ...rules.slice(0, index).map(predicate),
    ];
    restrictions.push({
      ...rule,
      outcome: rule.outcome,
      match: {
        ...rule.match,
        ...(earlierRules.length > 0 ? { unless: earlierRules } : {}),
      },
    });
  });
  return { id, restrictions, preferences };
}

export function validatePolicySourceStacks(
  stacks: readonly PolicySourceStack[],
): void {
  if (!isPlainData(stacks)) {
    throw new DefinitionError([
      {
        code: 'invalid-source-stack-input',
        path: ['sourceStacks'],
        message: 'Source stacks must be plain data.',
      },
    ]);
  }
  const problems: DefinitionProblem[] = [];
  const ids = new Set<string>();
  stacks.forEach((stack, index) => {
    if (ids.has(stack.id)) {
      problems.push({
        code: 'duplicate-source-stack',
        path: ['sourceStacks', index, 'id'],
        message: `Duplicate source stack ${stack.id}.`,
      });
    }
    ids.add(stack.id);
    const expected = derivePolicySourceStack(stack.id, stack.preferences);
    if (!sameData(stack.restrictions, expected.restrictions)) {
      problems.push({
        code: 'source-stack-mismatch',
        path: ['sourceStacks', index, 'restrictions'],
        message: `Source stack ${stack.id} restrictions do not derive from its preference rules.`,
      });
    }
  });
  if (problems.length > 0) throw new DefinitionError(problems);
}
