/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { policiesCommand } from './policiesCommand.js';
import { type CommandContext, type MessageActionReturn } from './types.js';
import {
  PolicyEngine,
  PolicyDecision,
  type PolicyRule,
} from '@vybestack/llxprt-code-core';

describe('policiesCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      services: {
        config: null,
      },
    } as unknown as CommandContext;
  });

  it('should have the correct name and description', () => {
    expect(policiesCommand.name).toBe('policies');
    expect(policiesCommand.description).toBe(
      'display active policy rules and their priorities',
    );
  });

  it('should return an error when config is not available', () => {
    if (!policiesCommand.action) {
      throw new Error('Policies command has no action');
    }

    const result = policiesCommand.action(
      mockContext,
      '',
    ) as MessageActionReturn;

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Configuration not available',
    });
  });

  it('should display message when no rules are configured', () => {
    const mockPolicyEngine = new PolicyEngine({
      rules: [],
      defaultDecision: PolicyDecision.ASK_USER,
      nonInteractive: false,
    });

    mockContext.services.config = {
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as CommandContext['services']['config'];

    if (!policiesCommand.action) {
      throw new Error('Policies command has no action');
    }

    const result = policiesCommand.action(
      mockContext,
      '',
    ) as MessageActionReturn;

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'No policy rules configured.',
    });
  });

  it('should display rules sorted by priority', () => {
    const rules: PolicyRule[] = [
      {
        toolName: 'edit',
        decision: PolicyDecision.ALLOW,
        priority: 1.01,
      },
      {
        toolName: 'glob',
        decision: PolicyDecision.ALLOW,
        priority: 1.05,
      },
      {
        toolName: 'shell',
        decision: PolicyDecision.DENY,
        priority: 2.4,
      },
    ];

    const mockPolicyEngine = new PolicyEngine({
      rules,
      defaultDecision: PolicyDecision.ASK_USER,
      nonInteractive: false,
    });

    mockContext.services.config = {
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as CommandContext['services']['config'];

    if (!policiesCommand.action) {
      throw new Error('Policies command has no action');
    }

    const result = policiesCommand.action(
      mockContext,
      '',
    ) as MessageActionReturn;

    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('Active Policy Rules:');
    expect(result.content).toContain('shell → DENY');
    expect(result.content).toContain('glob → ALLOW');
    expect(result.content).toContain('edit → ALLOW');

    // Verify higher priority (2.4) appears before lower priorities
    const shellIndex = result.content.indexOf('shell');
    const globIndex = result.content.indexOf('glob');
    const editIndex = result.content.indexOf('edit');
    expect(shellIndex).toBeLessThan(globIndex);
    expect(globIndex).toBeLessThan(editIndex);
  });

  it('should group rules by tier bands', () => {
    const rules: PolicyRule[] = [
      {
        toolName: 'edit',
        decision: PolicyDecision.ALLOW,
        priority: 1.01,
      },
      {
        toolName: 'shell',
        decision: PolicyDecision.DENY,
        priority: 2.4,
      },
    ];

    const mockPolicyEngine = new PolicyEngine({
      rules,
      defaultDecision: PolicyDecision.ASK_USER,
      nonInteractive: false,
    });

    mockContext.services.config = {
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as CommandContext['services']['config'];

    if (!policiesCommand.action) {
      throw new Error('Policies command has no action');
    }

    const result = policiesCommand.action(
      mockContext,
      '',
    ) as MessageActionReturn;

    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('Tier 2 (User-defined):');
    expect(result.content).toContain('Tier 1 (Defaults):');
  });

  it('should display wildcard tool name as *', () => {
    const rules: PolicyRule[] = [
      {
        toolName: undefined, // wildcard
        decision: PolicyDecision.ALLOW,
        priority: 1.999,
      },
    ];

    const mockPolicyEngine = new PolicyEngine({
      rules,
      defaultDecision: PolicyDecision.ASK_USER,
      nonInteractive: false,
    });

    mockContext.services.config = {
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as CommandContext['services']['config'];

    if (!policiesCommand.action) {
      throw new Error('Policies command has no action');
    }

    const result = policiesCommand.action(
      mockContext,
      '',
    ) as MessageActionReturn;

    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('Priority 1.999: * → ALLOW');
  });

  it('should display args pattern when present', () => {
    const rules: PolicyRule[] = [
      {
        toolName: 'shell',
        decision: PolicyDecision.DENY,
        priority: 2.0,
        argsPattern: /rm -rf \//,
      },
    ];

    const mockPolicyEngine = new PolicyEngine({
      rules,
      defaultDecision: PolicyDecision.ASK_USER,
      nonInteractive: false,
    });

    mockContext.services.config = {
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as CommandContext['services']['config'];

    if (!policiesCommand.action) {
      throw new Error('Policies command has no action');
    }

    const result = policiesCommand.action(
      mockContext,
      '',
    ) as MessageActionReturn;

    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('(pattern: rm -rf \\/)');
  });

  it('should display default decision and non-interactive mode status', () => {
    const rules: PolicyRule[] = [
      {
        toolName: 'edit',
        decision: PolicyDecision.ALLOW,
        priority: 1.01,
      },
    ];

    const mockPolicyEngine = new PolicyEngine({
      rules,
      defaultDecision: PolicyDecision.DENY,
      nonInteractive: true,
    });

    mockContext.services.config = {
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as CommandContext['services']['config'];

    if (!policiesCommand.action) {
      throw new Error('Policies command has no action');
    }

    const result = policiesCommand.action(
      mockContext,
      '',
    ) as MessageActionReturn;

    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('Default Decision: DENY');
    expect(result.content).toContain(
      'Non-Interactive Mode: true (ASK_USER → DENY)',
    );
  });

  it('should display non-interactive mode as false when not enabled', () => {
    const rules: PolicyRule[] = [
      {
        toolName: 'edit',
        decision: PolicyDecision.ALLOW,
        priority: 1.01,
      },
    ];

    const mockPolicyEngine = new PolicyEngine({
      rules,
      defaultDecision: PolicyDecision.ASK_USER,
      nonInteractive: false,
    });

    mockContext.services.config = {
      getPolicyEngine: vi.fn().mockReturnValue(mockPolicyEngine),
    } as unknown as CommandContext['services']['config'];

    if (!policiesCommand.action) {
      throw new Error('Policies command has no action');
    }

    const result = policiesCommand.action(
      mockContext,
      '',
    ) as MessageActionReturn;

    expect(result.type).toBe('message');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('Non-Interactive Mode: false');
  });
});
