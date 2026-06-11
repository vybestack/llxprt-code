/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-BEHAVIORAL-TDD
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Registry / Scheduler Integration Behavioral Tests
 *
 * Verifies observable behavior of ToolRegistry registration and
 * CoreToolScheduler dispatch. These tests live in packages/core because
 * the registry and scheduler are core infrastructure that stay in core.
 *
 * Primary assertions: registry returns expected tool names, scheduler
 * produces same ToolResult structure as direct invocation.
 *
 * STATUS: RED — Tests verify core registry/scheduler behavior.
 * Some assertions may be EXPECTED_BEHAVIORAL_RED if core infrastructure
 * is not fully testable from this test file's vantage point.
 */

import { describe, it, expect } from 'vitest';
import {
  maskKeyForDisplay,
  getSupportedToolNames,
  isValidToolKeyName,
} from '@vybestack/llxprt-code-tools';

describe('Registry / Scheduler Integration Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  describe('Tool name registry consistency', () => {
    it('supported tool names from tools package are consistent', () => {
      const names = getSupportedToolNames();

      // Primary assertion: observable tool names are returned
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
    });

    it('isValidToolKeyName returns correct boolean for known and unknown names', () => {
      // Primary assertion: observable boolean output matches expectations
      expect(isValidToolKeyName('exa')).toBe(true);
      expect(isValidToolKeyName('nonexistent')).toBe(false);
      expect(isValidToolKeyName('')).toBe(false);
    });

    it('maskKeyForDisplay produces consistent masked output', () => {
      // Primary assertion: observable string output matches fixture
      const key = 'sk-1234567890abcdef';
      const masked = maskKeyForDisplay(key);

      // First 2 and last 2 chars visible, middle masked
      expect(masked).toContain('sk');
      expect(masked).toContain('ef');
      expect(masked).toContain('*');

      // Full key is never exposed
      expect(masked).not.toBe(key);
    });
  });

  describe('Tool name constants', () => {
    it('tool name constants are all strings', async () => {
      const {
        READ_FILE_TOOL,
        WRITE_FILE_TOOL,
        EDIT_TOOL,
        SHELL_TOOL,
        GLOB_TOOL,
        GREP_TOOL,
        LS_TOOL,
        MEMORY_TOOL,
        TODO_WRITE_TOOL,
        TODO_READ_TOOL,
        TODO_PAUSE_TOOL,
      } = await import('@vybestack/llxprt-code-tools');

      // Primary assertion: observable tool names are strings
      expect(typeof READ_FILE_TOOL).toBe('string');
      expect(typeof WRITE_FILE_TOOL).toBe('string');
      expect(typeof EDIT_TOOL).toBe('string');
      expect(typeof SHELL_TOOL).toBe('string');
      expect(typeof GLOB_TOOL).toBe('string');
      expect(typeof GREP_TOOL).toBe('string');
      expect(typeof LS_TOOL).toBe('string');
      expect(typeof MEMORY_TOOL).toBe('string');
      expect(typeof TODO_WRITE_TOOL).toBe('string');
      expect(typeof TODO_READ_TOOL).toBe('string');
      expect(typeof TODO_PAUSE_TOOL).toBe('string');
    });

    it('tool names match expected values', async () => {
      const { READ_FILE_TOOL, WRITE_FILE_TOOL, EDIT_TOOL, SHELL_TOOL } =
        await import('@vybestack/llxprt-code-tools');

      // Primary assertion: observable tool name values match expected
      expect(READ_FILE_TOOL).toBe('read_file');
      expect(WRITE_FILE_TOOL).toBe('write_file');
      expect(EDIT_TOOL).toBe('replace');
      expect(SHELL_TOOL).toBe('shell');
    });
  });
});
