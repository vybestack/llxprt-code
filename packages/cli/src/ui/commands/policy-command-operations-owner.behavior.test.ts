/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config, PolicyDecision } from '@vybestack/llxprt-code-core';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { PolicyControl } from '../../../../agents/src/api/control/policyControl.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createPoliciesCommand } from './policiesCommand.js';
import { bindPoliciesCommand } from './policiesCommandHost.js';

describe('policy command independent reads', () => {
  const makeOwner = useCommandOwners();
  it('renders registered rules despite a conflicting policy collaborator on the input value', async () => {
    const owner = await makeOwner('policy-operation-owner');
    const sibling = await makeOwner('policy-operation-sibling');
    const config = new Config({
      sessionId: 'policy-operations',
      targetDir: owner.workspace.getWorkingDirectory(),
      cwd: owner.workspace.getWorkingDirectory(),
      model: owner.getModel(),
      debugMode: false,
      policyEngineConfig: {
        rules: [
          {
            toolName: 'owned_policy_tool',
            decision: PolicyDecision.DENY,
            priority: 1.9,
          },
        ],
      },
    });
    const root = new RuntimePolicyOwner(config);
    try {
      const policy = new PolicyControl({ inspection: root.session.inspection });
      const readRules = () =>
        Object.assign([...policy.getRules()], { policy: sibling.policy });
      const command = createPoliciesCommand(
        bindPoliciesCommand(
          readRules,
          policy.getDefaultDecision.bind(policy),
          policy.isNonInteractive.bind(policy),
        ),
      );
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            { ...createUnconfiguredBuiltinOwners(), policiesCommand: command },
            null,
          ),
        ],
        new AbortController().signal,
      );
      const list = registry
        .getCommands()
        .find((entry) => entry.name === 'policies')
        ?.subCommands?.find((entry) => entry.name === 'list');
      if (!list?.action) throw new Error('Missing policies list command');
      const result = await list.action(
        createMockCommandContext({ services: { agent: sibling } }),
        '',
      );
      expect(result).toStrictEqual(
        expect.objectContaining({
          type: 'message',
          content: expect.stringContaining('owned_policy_tool'),
        }),
      );
      expect(result).toStrictEqual(
        expect.objectContaining({ content: expect.stringContaining('DENY') }),
      );
      expect(
        sibling.policy
          .getRules()
          .some((rule) => rule.toolName === 'owned_policy_tool'),
      ).toBe(false);
    } finally {
      await root.dispose();
      await config.dispose();
    }
  });
});
