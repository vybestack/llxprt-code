/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Config } from '../config.js';
import { SettingsService } from '../../settings/SettingsService.js';

describe('Config - Terminal Background', () => {
  let config: Config;

  beforeEach(() => {
    const settingsService = new SettingsService();
    config = new Config({
      cwd: '/tmp',
      targetDir: '/tmp/test',
      debugMode: false,
      question: undefined,
      userMemory: '',
      sessionId: 'test-session',
      model: 'test-model',
      settingsService,
    });
  });

  describe('getTerminalBackground', () => {
    it('should return undefined by default', () => {
      expect(config.getTerminalBackground()).toBeUndefined();
    });
  });

  describe('setTerminalBackground', () => {
    it('should set and get a color string', () => {
      const color = '#1E1E2E';
      config.setTerminalBackground(color);
      expect(config.getTerminalBackground()).toBe(color);
    });

    it('should set to undefined', () => {
      config.setTerminalBackground('#1E1E2E');
      expect(config.getTerminalBackground()).toBe('#1E1E2E');

      config.setTerminalBackground(undefined);
      expect(config.getTerminalBackground()).toBeUndefined();
    });

    it('should handle multiple sets', () => {
      config.setTerminalBackground('#000000');
      expect(config.getTerminalBackground()).toBe('#000000');

      config.setTerminalBackground('#FFFFFF');
      expect(config.getTerminalBackground()).toBe('#FFFFFF');
    });
  });
});
