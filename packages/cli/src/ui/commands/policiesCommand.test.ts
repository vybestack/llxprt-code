/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { PolicyControl } from '../../../../agents/src/api/control/policyControl.js';
import { createMockAgent } from '../../__tests__/mockAgent.js';

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { policiesCommand } from './policiesCommand.js';
import {
  type CommandContext,
  type MessageActionReturn,
  type OpenDialogActionReturn,
} from './types.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core';
import { assertDefined } from '../../__tests__/assertions.js';

const ownedPolicies: RuntimePolicyOwner[] = [];
function makePolicy(): PolicyControl {
  const config = new Config({
    sessionId: 'policy-command',
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    model: 'test',
    policyEngineConfig: {
      rules: [
        {
          toolName: 'edit',
          decision: PolicyDecision.ALLOW,
          priority: 1.05,
          source: 'Default: defaults.toml',
        },
      ],
    },
  });
  const owner = new RuntimePolicyOwner(config);
  ownedPolicies.push(owner);
  return new PolicyControl({ inspection: owner.session.inspection });
}

describe('policiesCommand', () => {
  let mockContext: CommandContext;
  afterEach(async () => {
    for (const owner of ownedPolicies.splice(0)) await owner.dispose();
  });

  beforeEach(() => {
    mockContext = {
      services: {
        config: null,
      },
    } as unknown as CommandContext;
  });

  describe('structure', () => {
    it('should have the correct name and description', () => {
      expect(policiesCommand.name).toBe('policies');
      expect(policiesCommand.description).toBe(
        'inspect and manage policy rules (list or interactive menu)',
      );
    });

    it('should have list and menu subcommands', () => {
      const subNames = policiesCommand.subCommands?.map((s) => s.name);
      expect(subNames).toStrictEqual(['list', 'menu']);
    });
  });

  describe('default action (bare /policies)', () => {
    it('should return an error when neither agent nor config is available', () => {
      assertDefined(policiesCommand.action);
      const result = policiesCommand.action(
        mockContext,
        '',
      ) as MessageActionReturn;
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available',
      });
    });

    it('should render the list table when the session policy is available', () => {
      mockContext.services.agent = {
        ...createMockAgent(
          new Config({
            sessionId: 'commands',
            cwd: process.cwd(),
            targetDir: process.cwd(),
            debugMode: false,
            model: 'test',
          }),
        ),
        policy: makePolicy(),
      };

      assertDefined(policiesCommand.action);
      const result = policiesCommand.action(
        mockContext,
        '',
      ) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Configured Policy Rules:');
      expect(result.content).toContain('Tier 1 (Defaults)');
    });
  });

  describe('/policies list', () => {
    it('should return an error when config is unavailable', () => {
      const listSub = policiesCommand.subCommands!.find(
        (c) => c.name === 'list',
      )!;
      assertDefined(listSub.action);
      const result = listSub.action(mockContext, '') as MessageActionReturn;
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available',
      });
    });

    it('should render a tier-grouped table from the agent policy engine', () => {
      mockContext.services.agent = {
        ...createMockAgent(
          new Config({
            sessionId: 'commands',
            cwd: process.cwd(),
            targetDir: process.cwd(),
            debugMode: false,
            model: 'test',
          }),
        ),
        policy: makePolicy(),
      };

      const listSub = policiesCommand.subCommands!.find(
        (c) => c.name === 'list',
      )!;
      assertDefined(listSub.action);
      const result = listSub.action(mockContext, '') as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('edit');
      expect(result.content).toContain('ALLOW');
      expect(result.content).toContain('Default Decision: ASK_USER');
    });
  });

  describe('/policies menu', () => {
    it('should return an error when config is unavailable', () => {
      const menuSub = policiesCommand.subCommands!.find(
        (c) => c.name === 'menu',
      )!;
      assertDefined(menuSub.action);
      const result = menuSub.action(mockContext, '') as MessageActionReturn;
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available',
      });
    });

    it('should return a dialog action when the session policy is available', () => {
      mockContext.services.agent = {
        ...createMockAgent(
          new Config({
            sessionId: 'commands',
            cwd: process.cwd(),
            targetDir: process.cwd(),
            debugMode: false,
            model: 'test',
          }),
        ),
        policy: makePolicy(),
      };

      const menuSub = policiesCommand.subCommands!.find(
        (c) => c.name === 'menu',
      )!;
      assertDefined(menuSub.action);
      const result = menuSub.action(mockContext, '') as OpenDialogActionReturn;

      expect(result).toStrictEqual({
        type: 'dialog',
        dialog: 'policies',
      });
    });

    it('should return a dialog action when agent is available', () => {
      mockContext.services.agent = {
        ...createMockAgent(
          new Config({
            sessionId: 'commands',
            cwd: process.cwd(),
            targetDir: process.cwd(),
            debugMode: false,
            model: 'test',
          }),
        ),
        policy: makePolicy(),
      };

      const menuSub = policiesCommand.subCommands!.find(
        (c) => c.name === 'menu',
      )!;
      assertDefined(menuSub.action);
      const result = menuSub.action(mockContext, '') as OpenDialogActionReturn;

      expect(result).toStrictEqual({
        type: 'dialog',
        dialog: 'policies',
      });
    });
  });
});
