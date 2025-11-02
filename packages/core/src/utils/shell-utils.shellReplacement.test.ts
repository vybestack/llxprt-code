/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectCommandSubstitution,
  checkCommandPermissions,
} from './shell-utils.js';
import { Config } from '../config/config.js';
import { SettingsService } from '../settings/SettingsService.js';
import { clearActiveProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';

describe('Shell replacement settings', () => {
  let config: Config;
  let settingsService: SettingsService;

  beforeEach(() => {
    clearActiveProviderRuntimeContext();
    settingsService = new SettingsService();

    config = new Config({
      model: 'test-model',
      question: 'test question',
      embeddingModel: 'test-embedding',
      targetDir: '.',
      usageStatisticsEnabled: false,
      sessionId: 'test-session',
      debugMode: false,
      cwd: '.',
      settingsService,
    });
  });

  describe('detectCommandSubstitution', () => {
    it('should detect $() command substitution', () => {
      expect(detectCommandSubstitution('echo $(date)')).toBe(true);
      expect(detectCommandSubstitution('result=$(ls -la)')).toBe(true);
      expect(detectCommandSubstitution('echo "Today is $(date)"')).toBe(true);
    });

    it('should detect <() process substitution', () => {
      expect(detectCommandSubstitution('diff <(ls dir1) <(ls dir2)')).toBe(
        true,
      );
      expect(detectCommandSubstitution('cat <(echo hello)')).toBe(true);
    });

    it('should detect backtick command substitution', () => {
      expect(detectCommandSubstitution('echo `date`')).toBe(true);
      expect(detectCommandSubstitution('result=`ls -la`')).toBe(true);
      expect(detectCommandSubstitution('echo "Today is `date`"')).toBe(true);
    });

    it('should not detect substitution in single quotes', () => {
      expect(detectCommandSubstitution("echo '$(date)'")).toBe(false);
      expect(detectCommandSubstitution("echo '<(ls)'")).toBe(false);
      expect(detectCommandSubstitution("echo '`date`'")).toBe(false);
    });

    it('should handle escaped characters properly', () => {
      expect(detectCommandSubstitution('echo \\$(date)')).toBe(false);
      expect(detectCommandSubstitution('echo "\\$(date)"')).toBe(false);
      expect(detectCommandSubstitution('echo \\`date\\`')).toBe(false);
    });
  });

  describe('checkCommandPermissions with shell replacement', () => {
    it('should block command substitution by default', () => {
      const result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(false);
      expect(result.disallowedCommands).toContain('echo $(date)');
      expect(result.blockReason).toContain('Command substitution');
      expect(result.isHardDenial).toBe(true);
    });

    it('should allow command substitution when ephemeral setting is enabled', () => {
      config.setEphemeralSetting('shell-replacement', true);

      const result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(true);
      expect(result.disallowedCommands).toHaveLength(0);
    });

    it('should allow command substitution when config setting is enabled', () => {
      const configWithShellReplacement = new Config({
        model: 'test-model',
        question: 'test question',
        embeddingModel: 'test-embedding',
        targetDir: '.',
        usageStatisticsEnabled: false,
        sessionId: 'test-session',
        debugMode: false,
        cwd: '.',
        shellReplacement: true,
        settingsService: new SettingsService(),
      });

      const result = checkCommandPermissions(
        'echo $(date)',
        configWithShellReplacement,
      );
      expect(result.allAllowed).toBe(true);
      expect(result.disallowedCommands).toHaveLength(0);
    });

    it('should respect ephemeral setting over config setting', () => {
      const configWithShellReplacement = new Config({
        model: 'test-model',
        question: 'test question',
        embeddingModel: 'test-embedding',
        targetDir: '.',
        usageStatisticsEnabled: false,
        sessionId: 'test-session',
        debugMode: false,
        cwd: '.',
        shellReplacement: false,
        settingsService: new SettingsService(),
      });

      configWithShellReplacement.setEphemeralSetting('shell-replacement', true);

      const result = checkCommandPermissions(
        'echo $(date)',
        configWithShellReplacement,
      );
      expect(result.allAllowed).toBe(true);
      expect(result.disallowedCommands).toHaveLength(0);
    });

    it('should handle complex commands with substitution when enabled', () => {
      config.setEphemeralSetting('shell-replacement', true);

      const complexCommand =
        'for file in $(ls *.txt); do echo "Processing $file"; done';
      const result = checkCommandPermissions(complexCommand, config);
      expect(result.allAllowed).toBe(true);
      expect(result.disallowedCommands).toHaveLength(0);
    });

    it('should handle multiple command substitutions', () => {
      const command = 'echo $(date) && diff <(ls dir1) <(ls dir2)';

      // Should block by default
      let result = checkCommandPermissions(command, config);
      expect(result.allAllowed).toBe(false);

      // Should allow when enabled
      config.setEphemeralSetting('shell-replacement', true);
      result = checkCommandPermissions(command, config);
      expect(result.allAllowed).toBe(true);
    });

    it('should handle undefined ephemeral setting correctly', () => {
      // Ensure undefined is treated as false
      const result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(false);
      expect(result.blockReason).toContain('Command substitution');
    });

    it('should handle string values in ephemeral setting', () => {
      // Test various non-boolean values
      config.setEphemeralSetting('shell-replacement', 'true');
      let result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(false); // String 'true' should not enable

      config.setEphemeralSetting('shell-replacement', 1);
      result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(false); // Number 1 should not enable

      config.setEphemeralSetting('shell-replacement', {});
      result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(false); // Object should not enable
    });

    it('should not affect commands without substitution', () => {
      // Regular commands should always be allowed (unless blocked by other rules)
      const regularCommands = [
        'ls -la',
        'echo hello world',
        'cat file.txt',
        'grep pattern file',
      ];

      for (const cmd of regularCommands) {
        const result = checkCommandPermissions(cmd, config);
        expect(result.allAllowed).toBe(true);
      }
    });
  });
});
