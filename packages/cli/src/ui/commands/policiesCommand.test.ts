/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { policiesCommand } from './policiesCommand.js';
import {
  type CommandContext,
  type MessageActionReturn,
  type OpenDialogActionReturn,
} from './types.js';
import { PolicyDecision, type PolicyEngine } from '@vybestack/llxprt-code-core';
import { assertDefined } from '../../test-utils/assertions.js';

function makeMockEngine(): PolicyEngine {
  return {
    getRules: () => [
      {
        toolName: 'edit',
        decision: PolicyDecision.ALLOW,
        priority: 1.05,
        source: 'Default: defaults.toml',
      },
    ],
    getDefaultDecision: () => PolicyDecision.ASK_USER,
    isNonInteractive: () => false,
  } as unknown as PolicyEngine;
}

describe('policiesCommand', () => {
  let mockContext: CommandContext;

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

    it('should render the list table when config is available', () => {
      mockContext.services.config = {
        getPolicyEngine: () => makeMockEngine(),
      } as unknown as CommandContext['services']['config'];

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
        policy: makeMockEngine(),
      } as unknown as CommandContext['services']['agent'];

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

    it('should return a dialog action when config is available', () => {
      mockContext.services.config = {
        getPolicyEngine: () => makeMockEngine(),
      } as unknown as CommandContext['services']['config'];

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
        policy: makeMockEngine(),
      } as unknown as CommandContext['services']['agent'];

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
