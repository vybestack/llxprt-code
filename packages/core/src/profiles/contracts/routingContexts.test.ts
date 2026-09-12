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
    expect(turn.target.agentId).toBe('agent-1');
    expect(turn.target.parentAgentId).toBe('root');
    expect(turn.profileRevision).toBe(5);
    expect(turn.startedAt).toBe(1234);
  });

  it('preserves an absent parentAgentId', () => {
    const turn = createTurnContext({ agentId: 'agent-1' }, 0, 0);
    expect(turn.target.parentAgentId).toBeUndefined();
  });

  it('returns a deeply frozen object', () => {
    const turn = createTurnContext(
      { agentId: 'agent-1', parentAgentId: 'root' },
      5,
      1234,
    );
    expect(Object.isFrozen(turn)).toBe(true);
    expect(Object.isFrozen(turn.target)).toBe(true);
    expect(() => {
      turn.target.agentId = 'changed';
    }).toThrow(TypeError);
  });
});

describe('createProviderCallContext', () => {
  it('round-trips its fields', () => {
    const turn = createTurnContext({ agentId: 'agent-1' }, 5, 1234);
    const call = createProviderCallContext(turn, 'openai', 'gpt-4o', policy);
    expect(call.turn === turn).toBe(true);
    expect(call.providerName).toBe('openai');
    expect(call.model).toBe('gpt-4o');
    expect(call.capturedPolicy.allowedTools).toStrictEqual(['read', 'write']);
    expect(call.capturedPolicy.disabledTools).toStrictEqual(['dangerous-tool']);
    expect(call.capturedPolicy.shellMode).toBe('allowlist');
    expect(call.capturedPolicy.approvalCeiling).toBe('standard');
  });

  it('returns a deeply frozen object', () => {
    const turn = createTurnContext(
      { agentId: 'agent-1', parentAgentId: 'root' },
      5,
      1234,
    );
    const call = createProviderCallContext(turn, 'openai', 'gpt-4o', policy);
    expect(Object.isFrozen(call)).toBe(true);
    expect(Object.isFrozen(call.turn)).toBe(true);
    expect(Object.isFrozen(call.turn.target)).toBe(true);
    expect(Object.isFrozen(call.capturedPolicy)).toBe(true);
    expect(Object.isFrozen(call.capturedPolicy.allowedTools)).toBe(true);
    expect(() => {
      call.providerName = 'anthropic';
    }).toThrow(TypeError);
    expect(() => {
      (call.capturedPolicy.allowedTools as string[]).push('edit');
    }).toThrow(TypeError);
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
    expect(invocation.turn === turn).toBe(true);
    expect(invocation.toolId).toBe('tool-9');
    expect(invocation.capturedPolicy).toStrictEqual(policy);
    expect(invocation.background).toBe(true);
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
    expect(Object.isFrozen(invocation)).toBe(true);
    expect(Object.isFrozen(invocation.capturedPolicy)).toBe(true);
    expect(Object.isFrozen(invocation.capturedPolicy.allowedTools)).toBe(true);
    expect(() => {
      invocation.toolId = 'tool-10';
    }).toThrow(TypeError);
    expect(() => {
      (invocation.capturedPolicy.disabledTools as string[]).push('x');
    }).toThrow(TypeError);
  });
});

describe('captured policy is immutable across the shared snapshot input', () => {
  it('freezes the caller-provided policy object in place', () => {
    const mutablePolicy: ToolPolicySnapshot = policy;
    expect(Object.isFrozen(mutablePolicy)).toBe(true);
  });
});
