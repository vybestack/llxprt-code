/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { ApprovalMode, PolicyDecision } from '@vybestack/llxprt-code-policy';
import { Config } from '../config/config.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { RuntimePolicyOwner } from './policy-owner.js';
import { createOwnerPolicyEvaluation } from './owner-policy-evaluation.js';

function configuredOwner(mode: ApprovalMode): RuntimePolicyOwner {
  return new RuntimePolicyOwner(
    new Config({
      sessionId: 'same-label',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test',
      trustedFolder: true,
      approvalMode: mode,
      policyEngineConfig: {
        rules: [
          {
            decision: PolicyDecision.ALLOW,
            modes: [ApprovalMode.YOLO],
            priority: 1,
          },
          {
            toolName: 'remote__write',
            argsPattern: /restricted/,
            decision: PolicyDecision.DENY,
            priority: 10,
          },
        ],
      },
    }),
  );
}

describe('owner policy evaluation', () => {
  it('starts with default policy and routes the retained bus to its own live configured policy', async () => {
    const first = createOwnerPolicyEvaluation();
    const second = createOwnerPolicyEvaluation();
    const firstBus = new MessageBus(first);
    const secondBus = new MessageBus(second);
    const firstOwner = configuredOwner(ApprovalMode.YOLO);
    const secondOwner = configuredOwner(ApprovalMode.DEFAULT);
    try {
      expect(firstBus.evaluate('write_file', {})).toBe(PolicyDecision.ASK_USER);
      first.bindPolicyEvaluation(firstOwner.session.decisions.evaluate);
      second.bindPolicyEvaluation(secondOwner.session.decisions.evaluate);
      expect(firstBus.evaluate('write_file', {})).toBe(PolicyDecision.ALLOW);
      expect(secondBus.evaluate('write_file', {})).toBe(
        PolicyDecision.ASK_USER,
      );
      secondOwner.session.confirmation.addRule({
        toolName: 'write_file',
        decision: PolicyDecision.DENY,
        priority: 3,
      });
      expect(secondBus.evaluate('write_file', {})).toBe(PolicyDecision.DENY);
      expect(firstBus.evaluate('write_file', {})).toBe(PolicyDecision.ALLOW);
      first.bindPolicyEvaluation(secondOwner.session.decisions.evaluate);
      expect(firstBus.evaluate('write_file', {})).toBe(PolicyDecision.DENY);
      expect(secondBus.evaluate('write_file', {})).toBe(PolicyDecision.DENY);
    } finally {
      await firstOwner.dispose();
      await secondOwner.dispose();
    }
  });

  it('forwards tool arguments and server identity to the selected owner policy', async () => {
    const routing = createOwnerPolicyEvaluation();
    const owner = configuredOwner(ApprovalMode.YOLO);
    routing.bindPolicyEvaluation(owner.session.decisions.evaluate);
    try {
      expect(
        routing.evaluate('remote__write', { path: 'restricted' }, 'remote'),
      ).toBe(PolicyDecision.DENY);
      expect(
        routing.evaluate('remote__write', { path: 'ordinary' }, 'remote'),
      ).toBe(PolicyDecision.ALLOW);
      expect(
        routing.evaluate('remote__write', { path: 'ordinary' }, 'other'),
      ).toBe(PolicyDecision.DENY);
    } finally {
      await owner.dispose();
    }
  });

  it('propagates disposed-owner failures without returning to defaults or retiring another owner', async () => {
    const first = createOwnerPolicyEvaluation();
    const second = createOwnerPolicyEvaluation();
    const owner = configuredOwner(ApprovalMode.YOLO);
    first.bindPolicyEvaluation(owner.session.decisions.evaluate);
    await owner.dispose();
    expect(() => first.evaluate('write_file', {})).toThrow(
      'Session policy is disposed',
    );
    expect(second.evaluate('write_file', {})).toBe(PolicyDecision.ASK_USER);
  });
});
