/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  DefinitionError,
  derivePolicySourceStack,
  normalizePolicyRegex,
  validateAgentCommand,
  validateDefinition,
  type PolicyRule,
} from '../index.js';
import { validDefinition } from '../type-fixtures/definition-fixtures.js';

function definitionProblems(
  action: () => unknown,
): DefinitionError['problems'] {
  try {
    action();
  } catch (error) {
    if (error instanceof DefinitionError) return error.problems;
    throw error;
  }
  throw new Error('Expected a DefinitionError.');
}

describe('P01a embedded policy validation', () => {
  it('reports invalid regexes at the nested PolicyMatch path', () => {
    const rule: PolicyRule = {
      id: 'nested-invalid-regex',
      match: {
        unless: [
          {
            args: [
              {
                serializedArgs: {
                  flavor: 'ecmascript',
                  source: '[',
                  flags: '',
                  input: { path: 'direct', source: '[', flags: '' },
                },
              },
            ],
          },
        ],
      },
      outcome: 'deny',
      priority: 1,
      order: 0,
      provenance: {
        source: 'admin',
        sourceId: 'nested-regex-source',
        ruleIndex: 0,
        expansionIndex: 0,
      },
    };
    const problems = definitionProblems(() =>
      validateAgentCommand({ type: 'set-authority', rules: [rule] }),
    );
    expect(problems).toContainEqual(
      expect.objectContaining({
        code: 'invalid-policy-regex',
        path: [
          'policy',
          'authority',
          0,
          'match',
          'unless',
          0,
          'args',
          0,
          'serializedArgs',
        ],
      }),
    );
  });

  it('rejects child policies whose effective pattern differs from its evidence', () => {
    const normalized = normalizePolicyRegex({
      path: 'directory-commandRegex',
      text: '/',
    });
    const rule: PolicyRule = {
      id: 'child-slash-command',
      match: {
        args: [
          {
            serializedArgs: {
              ...normalized,
              source: '"command":"(?:/)',
            },
          },
        ],
      },
      outcome: 'deny',
      priority: 1,
      order: 0,
      provenance: {
        source: 'admin',
        sourceId: 'child-slash-source',
        ruleIndex: 0,
        expansionIndex: 0,
      },
    };
    const problems = definitionProblems(() =>
      validateDefinition({
        ...validDefinition,
        subagents: [
          {
            name: 'child',
            instructions: [],
            tools: [],
            policy: {
              ...validDefinition.policy,
              preferences: [{ name: 'child', rules: [rule] }],
            },
            limits: validDefinition.limits,
          },
        ],
      }),
    );
    expect(problems).toContainEqual(
      expect.objectContaining({
        code: 'invalid-policy-regex',
        path: [
          'subagents',
          0,
          'policy',
          'preferences',
          0,
          'rules',
          0,
          'match',
          'args',
          0,
          'serializedArgs',
        ],
      }),
    );
  });

  it('rejects child policies whose source stack pair is stale', () => {
    const rule: PolicyRule = {
      id: 'child-denied-tool',
      match: { tools: ['read'] },
      outcome: 'deny',
      priority: 1,
      order: 0,
      provenance: {
        source: 'admin',
        sourceId: 'child-stack-source',
        ruleIndex: 0,
        expansionIndex: 0,
      },
    };
    const stack = derivePolicySourceStack('child-admin', [
      { name: 'child-admin', rules: [rule] },
    ]);
    const problems = definitionProblems(() =>
      validateDefinition({
        ...validDefinition,
        subagents: [
          {
            name: 'child',
            instructions: [],
            tools: [],
            policy: {
              ...validDefinition.policy,
              sourceStacks: [{ ...stack, restrictions: [] }],
            },
            limits: validDefinition.limits,
          },
        ],
      }),
    );
    expect(problems).toContainEqual({
      code: 'source-stack-mismatch',
      path: ['subagents', 0, 'policy', 'sourceStacks', 0, 'restrictions'],
      message: expect.stringContaining('child-admin'),
    });
  });

  it('accepts line-break normalized sources and rejects raw line-break evidence', () => {
    const normalized = normalizePolicyRegex({
      path: 'single-file-commandRegex',
      text: 'git\nstatus',
    });
    const definitionWithSource = (source: string) =>
      validateDefinition({
        ...validDefinition,
        policy: {
          ...validDefinition.policy,
          preferences: [
            {
              name: 'line-break',
              rules: [
                {
                  id: 'line-break-command',
                  match: {
                    args: [{ serializedArgs: { ...normalized, source } }],
                  },
                  outcome: 'deny',
                  priority: 1,
                  order: 0,
                  provenance: {
                    source: 'admin',
                    sourceId: 'line-break-source',
                    ruleIndex: 0,
                    expansionIndex: 0,
                  },
                },
              ],
            },
          ],
        },
      });

    expect(
      definitionWithSource(normalized.source).policy.preferences[0]?.rules[0]
        ?.id,
    ).toBe('line-break-command');
    expect(() => definitionWithSource('"command":"git\nstatus')).toThrow(
      DefinitionError,
    );
  });

  it('reports a structural command error together with its stale source stack', () => {
    const stack = derivePolicySourceStack('admin', [
      {
        name: 'admin',
        rules: [
          {
            id: 'deny-read',
            match: { tools: ['read'] },
            outcome: 'deny',
            priority: 1,
            order: 0,
            provenance: {
              source: 'admin',
              sourceId: 'admin-source',
              ruleIndex: 0,
              expansionIndex: 0,
            },
          },
        ],
      },
    ]);
    const problems = definitionProblems(() =>
      validateAgentCommand({
        id: '',
        type: 'set-source-stacks',
        stacks: [{ ...stack, restrictions: [] }],
      }),
    );

    expect(problems).toContainEqual(expect.objectContaining({ path: ['id'] }));
    expect(problems).toContainEqual({
      code: 'source-stack-mismatch',
      path: ['policy', 'sourceStacks', 0, 'restrictions'],
      message: expect.stringContaining('admin'),
    });
  });

  it('rejects command accessors without invoking them', () => {
    let getterCalls = 0;
    const command = Object.defineProperty({ type: 'clear' }, 'id', {
      enumerable: true,
      get(): string {
        getterCalls += 1;
        return 'cmd-1';
      },
    });

    expect(() => validateAgentCommand(command)).toThrow(DefinitionError);
    expect(getterCalls).toBe(0);
  });
});
