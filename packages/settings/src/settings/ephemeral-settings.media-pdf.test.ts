/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';

import {
  isValidEphemeralSetting,
  ephemeralSettingHelp,
} from './ephemeral-settings.js';

function mediaPdfHelpText(): string {
  return ephemeralSettingHelp['media.pdf.enabled'] ?? '';
}

describe('media.pdf.enabled ephemeral setting @issue:2608', () => {
  describe('registry validation', () => {
    it('accepts media.pdf.enabled=true', () => {
      expect(isValidEphemeralSetting('media.pdf.enabled', true)).toBe(true);
    });

    it('accepts media.pdf.enabled=false', () => {
      expect(isValidEphemeralSetting('media.pdf.enabled', false)).toBe(true);
    });

    it('rejects media.pdf.enabled=invalid string', () => {
      expect(isValidEphemeralSetting('media.pdf.enabled', 'maybe')).toBe(false);
    });

    it('rejects media.pdf.enabled=123 (wrong type)', () => {
      expect(isValidEphemeralSetting('media.pdf.enabled', 123)).toBe(false);
    });
  });

  describe('ephemeralSettingHelp', () => {
    it('includes media.pdf.enabled in descriptions', () => {
      expect(ephemeralSettingHelp['media.pdf.enabled']).toBeDefined();
    });

    it('mentions PDF in the description', () => {
      const description = mediaPdfHelpText();
      expect(description.toLowerCase()).toContain('pdf');
    });
  });
});
