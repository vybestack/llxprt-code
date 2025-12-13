/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for load balancer ephemeral settings in setCommand
 * Issue #489 Phase 6
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import type { CommandContext } from '../types.js';
import { setCommand } from '../setCommand.js';

const mockRuntime = {
  getActiveModelParams: vi.fn(() => ({})),
  getEphemeralSettings: vi.fn(() => ({})),
  setEphemeralSetting: vi.fn(),
  setActiveModelParam: vi.fn(),
  clearActiveModelParam: vi.fn(),
};

vi.mock('../../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => mockRuntime,
}));

describe('setCommand - load balancer settings', () => {
  let context: CommandContext;

  beforeEach(() => {
    context = createMockCommandContext();
    vi.clearAllMocks();
  });

  describe('tpm_threshold setting', () => {
    it('sets tpm_threshold with valid positive integer', async () => {
      const result = await setCommand.action!(context, 'tpm_threshold 1000');

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'tpm_threshold',
        1000,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'tpm_threshold' set to 1000 (session only, use /profile save to persist)",
      });
    });

    it('rejects tpm_threshold with zero', async () => {
      const result = await setCommand.action!(context, 'tpm_threshold 0');

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'tpm_threshold must be a positive integer',
      });
    });

    it('rejects tpm_threshold with negative value', async () => {
      const result = await setCommand.action!(context, 'tpm_threshold -100');

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'tpm_threshold must be a positive integer',
      });
    });

    it('rejects tpm_threshold with decimal value', async () => {
      const result = await setCommand.action!(context, 'tpm_threshold 100.5');

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'tpm_threshold must be a positive integer',
      });
    });

    it('shows help text when only key provided', async () => {
      const result = await setCommand.action!(context, 'tpm_threshold');

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'tpm_threshold: Minimum tokens per minute before triggering failover (positive integer, load balancer only)',
      });
    });
  });

  describe('timeout_ms setting', () => {
    it('sets timeout_ms with valid positive integer', async () => {
      const result = await setCommand.action!(context, 'timeout_ms 30000');

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'timeout_ms',
        30000,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'timeout_ms' set to 30000 (session only, use /profile save to persist)",
      });
    });

    it('rejects timeout_ms with zero', async () => {
      const result = await setCommand.action!(context, 'timeout_ms 0');

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'timeout_ms must be a positive integer',
      });
    });

    it('rejects timeout_ms with negative value', async () => {
      const result = await setCommand.action!(context, 'timeout_ms -5000');

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'timeout_ms must be a positive integer',
      });
    });

    it('rejects timeout_ms with decimal value', async () => {
      const result = await setCommand.action!(context, 'timeout_ms 30000.5');

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'timeout_ms must be a positive integer',
      });
    });

    it('shows help text when only key provided', async () => {
      const result = await setCommand.action!(context, 'timeout_ms');

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'timeout_ms: Maximum request duration in milliseconds before timeout (positive integer, load balancer only)',
      });
    });
  });

  describe('circuit_breaker_enabled setting', () => {
    it('sets circuit_breaker_enabled to true', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_enabled true',
      );

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'circuit_breaker_enabled',
        true,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'circuit_breaker_enabled' set to true (session only, use /profile save to persist)",
      });
    });

    it('sets circuit_breaker_enabled to false', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_enabled false',
      );

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'circuit_breaker_enabled',
        false,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'circuit_breaker_enabled' set to false (session only, use /profile save to persist)",
      });
    });

    it('rejects circuit_breaker_enabled with non-boolean value', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_enabled yes',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: "circuit_breaker_enabled must be either 'true' or 'false'",
      });
    });

    it('shows help text when only key provided', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_enabled',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'circuit_breaker_enabled: Enable circuit breaker pattern for failing backends (true/false, load balancer only)',
      });
    });
  });

  describe('circuit_breaker_failure_threshold setting', () => {
    it('sets circuit_breaker_failure_threshold with valid positive integer', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_failure_threshold 3',
      );

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'circuit_breaker_failure_threshold',
        3,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'circuit_breaker_failure_threshold' set to 3 (session only, use /profile save to persist)",
      });
    });

    it('rejects circuit_breaker_failure_threshold with zero', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_failure_threshold 0',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'circuit_breaker_failure_threshold must be a positive integer',
      });
    });

    it('rejects circuit_breaker_failure_threshold with negative value', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_failure_threshold -2',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'circuit_breaker_failure_threshold must be a positive integer',
      });
    });

    it('rejects circuit_breaker_failure_threshold with decimal value', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_failure_threshold 3.5',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'circuit_breaker_failure_threshold must be a positive integer',
      });
    });

    it('shows help text when only key provided', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_failure_threshold',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'circuit_breaker_failure_threshold: Number of failures before opening circuit (positive integer, default: 3, load balancer only)',
      });
    });
  });

  describe('circuit_breaker_failure_window_ms setting', () => {
    it('sets circuit_breaker_failure_window_ms with valid positive integer', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_failure_window_ms 60000',
      );

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'circuit_breaker_failure_window_ms',
        60000,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'circuit_breaker_failure_window_ms' set to 60000 (session only, use /profile save to persist)",
      });
    });

    it('rejects circuit_breaker_failure_window_ms with zero', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_failure_window_ms 0',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'circuit_breaker_failure_window_ms must be a positive integer',
      });
    });

    it('rejects circuit_breaker_failure_window_ms with negative value', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_failure_window_ms -1000',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'circuit_breaker_failure_window_ms must be a positive integer',
      });
    });

    it('rejects circuit_breaker_failure_window_ms with decimal value', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_failure_window_ms 60000.5',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'circuit_breaker_failure_window_ms must be a positive integer',
      });
    });

    it('shows help text when only key provided', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_failure_window_ms',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'circuit_breaker_failure_window_ms: Time window for counting failures in milliseconds (positive integer, default: 60000, load balancer only)',
      });
    });
  });

  describe('circuit_breaker_recovery_timeout_ms setting', () => {
    it('sets circuit_breaker_recovery_timeout_ms with valid positive integer', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_recovery_timeout_ms 30000',
      );

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'circuit_breaker_recovery_timeout_ms',
        30000,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'circuit_breaker_recovery_timeout_ms' set to 30000 (session only, use /profile save to persist)",
      });
    });

    it('rejects circuit_breaker_recovery_timeout_ms with zero', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_recovery_timeout_ms 0',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'circuit_breaker_recovery_timeout_ms must be a positive integer',
      });
    });

    it('rejects circuit_breaker_recovery_timeout_ms with negative value', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_recovery_timeout_ms -5000',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'circuit_breaker_recovery_timeout_ms must be a positive integer',
      });
    });

    it('rejects circuit_breaker_recovery_timeout_ms with decimal value', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_recovery_timeout_ms 30000.5',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'circuit_breaker_recovery_timeout_ms must be a positive integer',
      });
    });

    it('shows help text when only key provided', async () => {
      const result = await setCommand.action!(
        context,
        'circuit_breaker_recovery_timeout_ms',
      );

      expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          'circuit_breaker_recovery_timeout_ms: Cooldown period before retrying after circuit opens in milliseconds (positive integer, default: 30000, load balancer only)',
      });
    });
  });

  describe('unset command for load balancer settings', () => {
    it('clears tpm_threshold setting', async () => {
      const result = await setCommand.action!(context, 'unset tpm_threshold');

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'tpm_threshold',
        undefined,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Ephemeral setting 'tpm_threshold' cleared",
      });
    });

    it('clears timeout_ms setting', async () => {
      const result = await setCommand.action!(context, 'unset timeout_ms');

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'timeout_ms',
        undefined,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Ephemeral setting 'timeout_ms' cleared",
      });
    });

    it('clears circuit_breaker_enabled setting', async () => {
      const result = await setCommand.action!(
        context,
        'unset circuit_breaker_enabled',
      );

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'circuit_breaker_enabled',
        undefined,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: "Ephemeral setting 'circuit_breaker_enabled' cleared",
      });
    });

    it('clears circuit_breaker_failure_threshold setting', async () => {
      const result = await setCommand.action!(
        context,
        'unset circuit_breaker_failure_threshold',
      );

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'circuit_breaker_failure_threshold',
        undefined,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'circuit_breaker_failure_threshold' cleared",
      });
    });

    it('clears circuit_breaker_failure_window_ms setting', async () => {
      const result = await setCommand.action!(
        context,
        'unset circuit_breaker_failure_window_ms',
      );

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'circuit_breaker_failure_window_ms',
        undefined,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'circuit_breaker_failure_window_ms' cleared",
      });
    });

    it('clears circuit_breaker_recovery_timeout_ms setting', async () => {
      const result = await setCommand.action!(
        context,
        'unset circuit_breaker_recovery_timeout_ms',
      );

      expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
        'circuit_breaker_recovery_timeout_ms',
        undefined,
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          "Ephemeral setting 'circuit_breaker_recovery_timeout_ms' cleared",
      });
    });
  });
});
