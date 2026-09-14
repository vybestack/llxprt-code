/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  createTurnContext,
  createProviderCallContext,
  createToolInvocationContext,
  type ToolPolicySnapshot,
} from './routingContexts.js';

const policy: ToolPolicySnapshot = {
  allowedTools: ['read', 'write'],
  disabledTools: ['dangerous-tool'],
  shellMode: 'allowlist',
  approvalCeiling: 'standard',
};

describe('createTurnContext', () => {
  it('round-trips its fields', () => {
    const target = { agentId: 'agent-1', parentAgentId: 'root' };
    const turn = createTurnContext(target, 5, 1234);
    expect(turn).toStrictEqual({ target, profileRevision: 5, startedAt: 1234 });
  });

  it('preserves an absent parentAgentId', () => {
    const turn = createTurnContext({ agentId: 'agent-1' }, 0, 0);
    expect(turn.target.parentAgentId).toStrictEqual(undefined);
  });

  it('captures an independent target without freezing the input', () => {
    const target = { agentId: 'agent-1', parentAgentId: 'root' };
    const turn = createTurnContext(target, 5, 1234);
    expect(Object.isFrozen(target)).toStrictEqual(false);
    target.agentId = 'changed';
    target.parentAgentId = 'changed-root';
    expect(turn.target).toStrictEqual({
      agentId: 'agent-1',
      parentAgentId: 'root',
    });
  });

  it('returns a deeply frozen object', () => {
    const turn = createTurnContext(
      { agentId: 'agent-1', parentAgentId: 'root' },
      5,
      1234,
    );
    expect(Object.isFrozen(turn)).toStrictEqual(true);
    expect(Reflect.set(turn.target, 'agentId', 'changed')).toStrictEqual(false);
  });
});

describe('createProviderCallContext', () => {
  it('round-trips its fields', () => {
    const turn = createTurnContext({ agentId: 'agent-1' }, 5, 1234);
    const call = createProviderCallContext(turn, 'openai', 'gpt-4o', policy);
    expect(call).toStrictEqual({
      turn,
      providerName: 'openai',
      model: 'gpt-4o',
      capturedPolicy: policy,
    });
  });

  it('returns a deeply frozen object', () => {
    const turn = createTurnContext(
      { agentId: 'agent-1', parentAgentId: 'root' },
      5,
      1234,
    );
    const call = createProviderCallContext(turn, 'openai', 'gpt-4o', policy);
    expect(Object.isFrozen(call)).toStrictEqual(true);
    expect(Object.isFrozen(call.turn)).toStrictEqual(true);
    expect(Object.isFrozen(call.turn.target)).toStrictEqual(true);
    expect(Object.isFrozen(call.capturedPolicy)).toStrictEqual(true);
    expect(Reflect.set(call, 'providerName', 'anthropic')).toStrictEqual(false);
    expect(
      Reflect.set(call.capturedPolicy.allowedTools, '0', 'edit'),
    ).toStrictEqual(false);
  });
});

describe('createToolInvocationContext', () => {
  it('round-trips its fields', () => {
    const turn = createTurnContext({ agentId: 'agent-1' }, 5, 1234);
    const invocation = createToolInvocationContext(
      turn,
      'tool-9',
      policy,
      true,
    );
    expect(invocation).toStrictEqual({
      turn,
      toolId: 'tool-9',
      capturedPolicy: policy,
      background: true,
    });
  });

  it('returns a deeply frozen object', () => {
    const turn = createTurnContext(
      { agentId: 'agent-1', parentAgentId: 'root' },
      5,
      1234,
    );
    const invocation = createToolInvocationContext(
      turn,
      'tool-9',
      policy,
      true,
    );
    expect(Object.isFrozen(invocation)).toStrictEqual(true);
    expect(Object.isFrozen(invocation.capturedPolicy)).toStrictEqual(true);
    expect(Reflect.set(invocation, 'toolId', 'tool-10')).toStrictEqual(false);
    expect(
      Reflect.set(invocation.capturedPolicy.disabledTools, '0', 'x'),
    ).toStrictEqual(false);
  });
});

describe('routing snapshots own caller-provided data', () => {
  it.each(['provider', 'tool'])(
    'isolates mutable turn and policy inputs for %s contexts',
    (kind) => {
      const turn = {
        target: { agentId: 'agent-1', parentAgentId: 'root' },
        profileRevision: 5,
        startedAt: 1234,
      };
      const allowedTools = ['read', 'write'];
      const disabledTools = ['dangerous-tool'];
      const capturedPolicy: ToolPolicySnapshot = {
        ...policy,
        allowedTools,
        disabledTools,
      };
      const context =
        kind === 'provider'
          ? createProviderCallContext(turn, 'openai', 'gpt-4o', capturedPolicy)
          : createToolInvocationContext(turn, 'tool-9', capturedPolicy, false);

      expect(
        [turn, turn.target, capturedPolicy, allowedTools, disabledTools].map(
          Object.isFrozen,
        ),
      ).toStrictEqual([false, false, false, false, false]);
      turn.target.agentId = 'changed';
      turn.target.parentAgentId = 'changed-root';
      turn.profileRevision = 6;
      turn.startedAt = 5678;
      allowedTools.push('edit');
      disabledTools.push('shell');
      expect(context.turn).toStrictEqual({
        target: { agentId: 'agent-1', parentAgentId: 'root' },
        profileRevision: 5,
        startedAt: 1234,
      });
      expect(context.capturedPolicy).toStrictEqual(policy);
      expect(Object.isFrozen(context.turn.target)).toStrictEqual(true);
      expect(
        Object.isFrozen(context.capturedPolicy.allowedTools),
      ).toStrictEqual(true);
      expect(
        Object.isFrozen(context.capturedPolicy.disabledTools),
      ).toStrictEqual(true);
    },
  );
});
