/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Config } from './config.js';

describe('Config always allowed commands', () => {
  let config: Config;

  beforeEach(() => {
    config = new Config({
      model: 'test-model',
      question: 'test question',
      embeddingModel: 'test-embedding',
      targetDir: '.',
      usageStatisticsEnabled: false,
      sessionId: 'test-session',
      debugMode: false,
      cwd: '.',
    });
  });

  describe('addAlwaysAllowedCommand', () => {
    it('should add a command to the always allowed list', () => {
      config.addAlwaysAllowedCommand('mv');
      expect(config.isCommandAlwaysAllowed('mv')).toBe(true);
    });

    it('should handle multiple commands', () => {
      config.addAlwaysAllowedCommand('mv');
      config.addAlwaysAllowedCommand('cp');
      config.addAlwaysAllowedCommand('rm');

      expect(config.isCommandAlwaysAllowed('mv')).toBe(true);
      expect(config.isCommandAlwaysAllowed('cp')).toBe(true);
      expect(config.isCommandAlwaysAllowed('rm')).toBe(true);
    });

    it('should not duplicate commands', () => {
      config.addAlwaysAllowedCommand('mv');
      config.addAlwaysAllowedCommand('mv');
      config.addAlwaysAllowedCommand('mv');

      const commands = config.getAlwaysAllowedCommands();
      expect(commands).toHaveLength(1);
      expect(commands).toContain('mv');
    });
  });

  describe('isCommandAlwaysAllowed', () => {
    it('should return false for commands not in the list', () => {
      expect(config.isCommandAlwaysAllowed('mv')).toBe(false);
      expect(config.isCommandAlwaysAllowed('cp')).toBe(false);
    });

    it('should return true only for added commands', () => {
      config.addAlwaysAllowedCommand('mv');

      expect(config.isCommandAlwaysAllowed('mv')).toBe(true);
      expect(config.isCommandAlwaysAllowed('cp')).toBe(false);
    });

    it('should be case sensitive', () => {
      config.addAlwaysAllowedCommand('mv');

      expect(config.isCommandAlwaysAllowed('mv')).toBe(true);
      expect(config.isCommandAlwaysAllowed('MV')).toBe(false);
      expect(config.isCommandAlwaysAllowed('Mv')).toBe(false);
    });
  });

  describe('getAlwaysAllowedCommands', () => {
    it('should return empty array when no commands are allowed', () => {
      expect(config.getAlwaysAllowedCommands()).toEqual([]);
    });

    it('should return all added commands', () => {
      config.addAlwaysAllowedCommand('mv');
      config.addAlwaysAllowedCommand('cp');
      config.addAlwaysAllowedCommand('ls');

      const commands = config.getAlwaysAllowedCommands();
      expect(commands).toHaveLength(3);
      expect(commands).toContain('mv');
      expect(commands).toContain('cp');
      expect(commands).toContain('ls');
    });

    it('should return a copy of the internal set', () => {
      config.addAlwaysAllowedCommand('mv');

      const commands1 = config.getAlwaysAllowedCommands();
      commands1.push('cp'); // Modify the returned array

      const commands2 = config.getAlwaysAllowedCommands();
      expect(commands2).toEqual(['mv']); // Original should be unchanged
    });
  });
});
