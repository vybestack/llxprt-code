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

  describe('loadbalancer alias', () => {
    it('should have "loadbalancer" as an alternative name for "lb" subcommand', () => {
      const lbSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'lb',
      );

      expect(lbSubCommand).toBeDefined();
      expect(lbSubCommand?.altNames).toBeDefined();
      expect(lbSubCommand?.altNames).toContain('loadbalancer');
    });

    it('should have correct subcommand metadata for "lb" with alias', () => {
      const lbSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'lb',
      );

      expect(lbSubCommand).toBeDefined();
      expect(lbSubCommand?.name).toBe('lb');
      expect(lbSubCommand?.altNames).toEqual(['loadbalancer']);
      expect(lbSubCommand?.description).toContain('load balancer');
    });
  });

  describe('lb command functionality', () => {
    it('should have "lb" as primary name with "loadbalancer" as alias', () => {
      const lbSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'lb',
      );

      expect(lbSubCommand).toBeDefined();
      expect(lbSubCommand?.name).toBe('lb');
      expect(lbSubCommand?.altNames).toEqual(['loadbalancer']);
    });

    it('should use MessageType.LB_STATS when invoked', () => {
      const lbSubCommand = statsCommand.subCommands?.find(
        (sc) => sc.name === 'lb',
      );

      if (!lbSubCommand?.action) {
        throw new Error('lb subcommand has no action');
      }

      // Clear any previous calls
      vi.clearAllMocks();

      // Test lb
      lbSubCommand.action(mockContext, '');
      const lbCall = (mockContext.ui.addItem as ReturnType<typeof vi.fn>).mock
        .calls[0][0];

      expect(lbCall.type).toBe(MessageType.LB_STATS);
    });
  });
});
