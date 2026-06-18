/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  HookEventName,
  ToolCallDecision,
  getDecisionFromOutcome,
} from './types.js';
import { ToolConfirmationOutcome } from '../internal/interfaces.js';

/**
 * Export-surface tests for telemetry/types.js.
 *
 * These tests guard against regressions where runtime values (enums,
 * functions) are accidentally exported as type-only. A type-only export
 * compiles fine but resolves to `undefined` at runtime, breaking consumers
 * that depend on these symbols through the telemetry/types public surface.
 */
describe('telemetry/types.js public export surface', () => {
  describe('HookEventName', () => {
    it('is a value-exported enum with expected members', () => {
      expect(HookEventName).toBeDefined();
      expect(HookEventName.BeforeTool).toBe('BeforeTool');
      expect(HookEventName.AfterTool).toBe('AfterTool');
      expect(HookEventName.SessionStart).toBe('SessionStart');
    });
  });

  describe('ToolCallDecision', () => {
    it('is a value-exported enum with expected members', () => {
      expect(ToolCallDecision).toBeDefined();
      expect(ToolCallDecision.ACCEPT).toBe('accept');
      expect(ToolCallDecision.REJECT).toBe('reject');
      expect(ToolCallDecision.MODIFY).toBe('modify');
      expect(ToolCallDecision.AUTO_ACCEPT).toBe('auto_accept');
    });
  });

  describe('getDecisionFromOutcome', () => {
    it('is a value-exported function', () => {
      expect(typeof getDecisionFromOutcome).toBe('function');
    });

    it('maps ProceedOnce to ACCEPT via the types.js surface', () => {
      expect(
        getDecisionFromOutcome(ToolConfirmationOutcome.ProceedOnce),
      ).toStrictEqual(ToolCallDecision.ACCEPT);
    });

    it('maps Cancel to REJECT via the types.js surface', () => {
      expect(
        getDecisionFromOutcome(ToolConfirmationOutcome.Cancel),
      ).toStrictEqual(ToolCallDecision.REJECT);
    });
  });
});
