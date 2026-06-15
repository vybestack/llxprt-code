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
      expect(result).toMatchObject({ success: true, value: 'low' });
    });

    it('should accept "medium" as valid verbosity', () => {
      const result = parseEphemeralSettingValue('text.verbosity', 'medium');
      expect(result.success).toBe(true);
      expect(result).toMatchObject({ success: true, value: 'medium' });
    });

    it('should accept "high" as valid verbosity', () => {
      const result = parseEphemeralSettingValue('text.verbosity', 'high');
      expect(result.success).toBe(true);
      expect(result).toMatchObject({ success: true, value: 'high' });
    });

    it('should normalize case to lowercase', () => {
      const result = parseEphemeralSettingValue('text.verbosity', 'HIGH');
      expect(result.success).toBe(true);
      expect(result).toMatchObject({ success: true, value: 'high' });
    });

    it('should reject invalid verbosity values', () => {
      const result = parseEphemeralSettingValue('text.verbosity', 'invalid');
      expect(result.success).toBe(false);
      expect(result).toMatchObject({ success: false });
      expect((result as { success: false; message: string }).message).toContain(
        'must be one of: low, medium, high',
      );
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
