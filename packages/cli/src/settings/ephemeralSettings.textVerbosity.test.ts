/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseEphemeralSettingValue,
  ephemeralSettingHelp,
} from './ephemeralSettings.js';

describe('text.verbosity ephemeral setting', () => {
  describe('parseEphemeralSettingValue', () => {
    it('should accept "low" as valid verbosity', () => {
      const result = parseEphemeralSettingValue('text.verbosity', 'low');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe('low');
      }
    });

    it('should accept "medium" as valid verbosity', () => {
      const result = parseEphemeralSettingValue('text.verbosity', 'medium');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe('medium');
      }
    });

    it('should accept "high" as valid verbosity', () => {
      const result = parseEphemeralSettingValue('text.verbosity', 'high');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe('high');
      }
    });

    it('should normalize case to lowercase', () => {
      const result = parseEphemeralSettingValue('text.verbosity', 'HIGH');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe('high');
      }
    });

    it('should reject invalid verbosity values', () => {
      const result = parseEphemeralSettingValue('text.verbosity', 'invalid');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('must be one of: low, medium, high');
      }
    });
  });

  describe('ephemeralSettingHelp', () => {
    it('should have help text for text.verbosity', () => {
      expect(ephemeralSettingHelp['text.verbosity']).toBeDefined();
      expect(ephemeralSettingHelp['text.verbosity']).toContain('verbosity');
      expect(ephemeralSettingHelp['text.verbosity']).toContain('OpenAI');
    });
  });
});
