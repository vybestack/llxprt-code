/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for load balancer stats command
 * Issue #489 Phase 8
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { statsCommand } from '../statsCommand.js';
import { type CommandContext } from '../types.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import { MessageType } from '../../types.js';

describe('statsCommand - load balancer stats', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = createMockCommandContext();
  });

  describe('lb subcommand', () => {
    it('should display load balancer stats when using "lb" subcommand', () => {
      const lbSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'lb',
      );
      if (!lbSubCommand?.action) throw new Error('lb subcommand has no action');

      lbSubCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.LB_STATS,
        },
        expect.any(Number),
      );
    });

    it('should have correct subcommand metadata for "lb"', () => {
      const lbSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'lb',
      );

      expect(lbSubCommand).toBeDefined();
      expect(lbSubCommand?.name).toBe('lb');
      expect(lbSubCommand?.description).toContain('load balancer');
    });
  });

  describe('loadbalancer subcommand (alias)', () => {
    it('should display load balancer stats when using "loadbalancer" subcommand', () => {
      const loadbalancerSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'loadbalancer',
      );
      if (!loadbalancerSubCommand?.action) {
        throw new Error('loadbalancer subcommand has no action');
      }

      loadbalancerSubCommand.action(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.LB_STATS,
        },
        expect.any(Number),
      );
    });

    it('should have correct subcommand metadata for "loadbalancer"', () => {
      const loadbalancerSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'loadbalancer',
      );

      expect(loadbalancerSubCommand).toBeDefined();
      expect(loadbalancerSubCommand?.name).toBe('loadbalancer');
      expect(loadbalancerSubCommand?.description).toContain('load balancer');
    });
  });

  describe('both lb and loadbalancer aliases', () => {
    it('should have both "lb" and "loadbalancer" subcommands', () => {
      const lbSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'lb',
      );
      const loadbalancerSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'loadbalancer',
      );

      expect(lbSubCommand).toBeDefined();
      expect(loadbalancerSubCommand).toBeDefined();
    });

    it('should use the same MessageType.LB_STATS for both aliases', () => {
      const lbSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'lb',
      );
      const loadbalancerSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'loadbalancer',
      );

      if (!lbSubCommand?.action || !loadbalancerSubCommand?.action) {
        throw new Error('Subcommands missing actions');
      }

      // Clear any previous calls
      vi.clearAllMocks();

      // Test lb
      lbSubCommand.action(mockContext, '');
      const lbCall = (mockContext.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];

      // Clear and test loadbalancer
      vi.clearAllMocks();
      loadbalancerSubCommand.action(mockContext, '');
      const loadbalancerCall = (
        mockContext.ui.addItem as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];

      expect(lbCall.type).toBe(MessageType.LB_STATS);
      expect(loadbalancerCall.type).toBe(MessageType.LB_STATS);
      expect(lbCall.type).toBe(loadbalancerCall.type);
    });
  });
});
