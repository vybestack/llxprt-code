/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * TDD tests for reasoning.summary ephemeral setting
 * @issue #922 - GPT-5.2-Codex thinking blocks not visible
 */

import { describe, it, expect } from 'vitest';
import {
  isValidEphemeralSetting,
  ephemeralSettingHelp,
} from './ephemeralSettings.js';

describe('reasoning.summary ephemeral setting @issue:922', () => {
  describe('ephemeralSettingHelp', () => {
    it('should include reasoning.summary in descriptions', () => {
      expect(ephemeralSettingHelp['reasoning.summary']).toBeDefined();
    });

    it('should mention OpenAI in the description', () => {
      const description = ephemeralSettingHelp['reasoning.summary'];
      expect(description?.toLowerCase()).toContain('openai');
    });

    it('should mention valid values in the description', () => {
      const description = ephemeralSettingHelp['reasoning.summary'];
      expect(description).toContain('auto');
      expect(description).toContain('concise');
      expect(description).toContain('detailed');
      expect(description).toContain('none');
    });
  });

  describe('isValidEphemeralSetting validation', () => {
    it('should accept reasoning.summary=auto', () => {
      expect(isValidEphemeralSetting('reasoning.summary', 'auto')).toBe(true);
    });

    it('should accept reasoning.summary=concise', () => {
      expect(isValidEphemeralSetting('reasoning.summary', 'concise')).toBe(
        true,
      );
    });

    it('should accept reasoning.summary=detailed', () => {
      expect(isValidEphemeralSetting('reasoning.summary', 'detailed')).toBe(
        true,
      );
    });

    it('should accept reasoning.summary=none', () => {
      expect(isValidEphemeralSetting('reasoning.summary', 'none')).toBe(true);
    });

    it('should reject reasoning.summary=invalid', () => {
      expect(isValidEphemeralSetting('reasoning.summary', 'invalid')).toBe(
        false,
      );
    });

    it('should reject reasoning.summary=true (wrong type)', () => {
      expect(isValidEphemeralSetting('reasoning.summary', true)).toBe(false);
    });

    it('should reject reasoning.summary=123 (wrong type)', () => {
      expect(isValidEphemeralSetting('reasoning.summary', 123)).toBe(false);
    });
  });
});
