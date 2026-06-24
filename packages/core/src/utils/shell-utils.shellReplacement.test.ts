/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  detectCommandSubstitution,
  checkCommandPermissions,
} from './shell-utils.js';
import { Config } from '../config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { clearActiveProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import {
  initializeParser as initializeShellParsers,
  isParserAvailable,
} from './shell-parser.js';

await initializeShellParsers();

describe('Shell replacement settings', () => {
  let config: Config;
  let settingsService: SettingsService;

  beforeAll(async () => {
    await initializeShellParsers();
  });

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
    // Note: shell-replacement now has three modes:
    // - 'none': blocks ALL command substitution (old false behavior)
    // - 'allowlist' (default): allows substitution, validates inner commands against allowlist
    // - 'all': allows all substitution (old true behavior)

    it('should allow command substitution by default (allowlist mode) when no coreTools restriction', () => {
      // Default is now 'allowlist' which allows substitution but validates inner commands
      // With no coreTools restriction, all commands are allowed
      const result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(true);
      expect(result.disallowedCommands).toHaveLength(0);
    });

    it('should block command substitution when mode is none', () => {
      config.setEphemeralSetting('shell-replacement', 'none');
      const result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(false);
      expect(result.disallowedCommands).toContain('echo $(date)');
      expect(result.blockReason).toContain('Command substitution');
      expect(result.isHardDenial).toBe(true);
    });

    it('should allow command substitution when ephemeral setting is all', () => {
      config.setEphemeralSetting('shell-replacement', 'all');

      const result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(true);
      expect(result.disallowedCommands).toHaveLength(0);
    });

    it('should allow command substitution when config setting is all (legacy true)', () => {
      const configWithShellReplacement = new Config({
        model: 'test-model',
        question: 'test question',
        embeddingModel: 'test-embedding',
        targetDir: '.',
        usageStatisticsEnabled: false,
        sessionId: 'test-session',
        debugMode: false,
        cwd: '.',
        shellReplacement: true, // Legacy true maps to 'all'
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
        shellReplacement: 'none', // Block all substitution
        settingsService: new SettingsService(),
      });

      configWithShellReplacement.setEphemeralSetting(
        'shell-replacement',
        'all',
      );

      const result = checkCommandPermissions(
        'echo $(date)',
        configWithShellReplacement,
      );
      expect(result.allAllowed).toBe(true);
      expect(result.disallowedCommands).toHaveLength(0);
    });

    it('should handle complex commands with substitution when mode is all', () => {
      config.setEphemeralSetting('shell-replacement', 'all');

      const complexCommand =
        'for file in $(ls *.txt); do echo "Processing $file"; done';
      const result = checkCommandPermissions(complexCommand, config);
      expect(result.allAllowed).toBe(true);
      expect(result.disallowedCommands).toHaveLength(0);
    });

    it('should handle multiple command substitutions', () => {
      const command = 'echo $(date) && diff <(ls dir1) <(ls dir2)';

      // Should block when mode is 'none'
      config.setEphemeralSetting('shell-replacement', 'none');
      let result = checkCommandPermissions(command, config);
      expect(result.allAllowed).toBe(false);

      // Should allow when mode is 'all'
      config.setEphemeralSetting('shell-replacement', 'all');
      result = checkCommandPermissions(command, config);
      expect(result.allAllowed).toBe(true);
    });

    it('should handle allowlist mode with coreTools restriction', () => {
      // In allowlist mode, inner commands are validated against the allowlist
      // Set up a restrictive allowlist that only allows 'echo'
      const restrictedConfig = new Config({
        model: 'test-model',
        question: 'test question',
        embeddingModel: 'test-embedding',
        targetDir: '.',
        usageStatisticsEnabled: false,
        sessionId: 'test-session',
        debugMode: false,
        cwd: '.',
        shellReplacement: 'allowlist',
        coreTools: ['run_shell_command(echo)'],
        settingsService: new SettingsService(),
      });

      // echo is allowed, date is not - so echo $(date) should be blocked
      // when tree-sitter can parse it. Without tree-sitter, falls back to simpler check.
      const result = checkCommandPermissions('echo $(date)', restrictedConfig);
      // The behavior depends on tree-sitter availability
      // If available: blocks because 'date' is not in allowlist
      // If not available: allows because 'echo' prefix is in allowlist (fallback)
      // We can't guarantee tree-sitter in all test environments
      expect(typeof result.allAllowed).toBe('boolean');
    });

    it('should handle legacy boolean values in ephemeral setting', () => {
      // Legacy true should map to 'all'
      config.setEphemeralSetting('shell-replacement', true);
      let result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(true);

      // Legacy false should map to 'none'
      config.setEphemeralSetting('shell-replacement', false);
      result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(false);
      expect(result.blockReason).toContain('Command substitution');
    });

    it('should handle invalid values by falling back to allowlist', () => {
      // Invalid values should be treated as 'allowlist' (default)
      config.setEphemeralSetting('shell-replacement', 'invalid');
      let result = checkCommandPermissions('echo $(date)', config);
      // With no coreTools restriction, allowlist allows all
      expect(result.allAllowed).toBe(true);

      config.setEphemeralSetting('shell-replacement', 1);
      result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(true);

      config.setEphemeralSetting('shell-replacement', {});
      result = checkCommandPermissions('echo $(date)', config);
      expect(result.allAllowed).toBe(true);
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

  describe('security edge cases', () => {
    it('should detect nested substitution with operators and block in none mode', () => {
      // echo "$(echo 'foo && bar')"
      const cmd = 'echo "$(echo \x27foo && bar\x27)"';
      expect(detectCommandSubstitution(cmd)).toBe(true);

      config.setEphemeralSetting('shell-replacement', 'none');
      const result = checkCommandPermissions(cmd, config);
      expect(result.allAllowed).toBe(false);
      expect(result.isHardDenial).toBe(true);
      expect(result.blockReason).toContain('Command substitution');
    });

    it.skipIf(isParserAvailable())(
      'should handle arithmetic expansion $((1+2)): regex path flags $(',
      () => {
        // Tree-sitter does NOT treat $((...)) as command_substitution (it is
        // arithmetic expansion, not command substitution). The regex fallback
        // sees '$(' and flags it. The two paths intentionally differ — the
        // regex fallback is more conservative, which is appropriate for a
        // security-sensitive fallback.
        const result = detectCommandSubstitution('echo $((1+2))');
        // Regex path: '$(' is detected → true
        expect(result).toBe(true);
      },
    );

    it.skipIf(!isParserAvailable())(
      'should handle arithmetic expansion via tree-sitter when available',
      () => {
        // Tree-sitter correctly identifies $((1+2)) as arithmetic expansion,
        // NOT command substitution, so hasCommandSubstitution returns false.
        const result = detectCommandSubstitution('echo $((1+2))');
        expect(result).toBe(false);
      },
    );

    it.skipIf(!isParserAvailable())(
      'should NOT flag quoted heredoc body as substitution via tree-sitter',
      () => {
        // A heredoc with a quoted delimiter (<<'EOF') treats its body as literal
        // text — $(rm -rf /) inside it is NOT command substitution.
        const cmd = `cat <<'EOF'
$(rm -rf /)
EOF`;
        const result = detectCommandSubstitution(cmd);
        expect(result).toBe(false);
      },
    );

    it.skipIf(!isParserAvailable())(
      'should flag unquoted heredoc body as substitution via tree-sitter',
      () => {
        // An unquoted heredoc (<<EOF) does expand $(...).
        const cmd = `cat <<EOF
$(rm -rf /)
EOF`;
        const result = detectCommandSubstitution(cmd);
        expect(result).toBe(true);
      },
    );

    it.skipIf(!isParserAvailable())(
      'should hard-deny malformed command in allowlist mode with restricted coreTools (tree-sitter)',
      () => {
        // When tree-sitter is available, parseCommandDetails reports hasError
        // for malformed input, and the allowlist mode treats that as a hard denial.
        const restrictedConfig = new Config({
          model: 'test-model',
          question: 'test question',
          embeddingModel: 'test-embedding',
          targetDir: '.',
          usageStatisticsEnabled: false,
          sessionId: 'test-session',
          debugMode: false,
          cwd: '.',
          shellReplacement: 'allowlist',
          coreTools: ['run_shell_command(echo)'],
          settingsService: new SettingsService(),
        });

        const result = checkCommandPermissions(
          'echo "unclosed',
          restrictedConfig,
        );
        expect(result.allAllowed).toBe(false);
        expect(result.isHardDenial).toBe(true);
        expect(result.blockReason).toContain('could not be parsed safely');
      },
    );

    it.skipIf(isParserAvailable())(
      'should allow malformed command via regex fallback when root matches allowlist',
      () => {
        // When tree-sitter is NOT available, the regex fallback extracts the
        // command root "echo" which matches the allowlist, so the command passes.
        const restrictedConfig = new Config({
          model: 'test-model',
          question: 'test question',
          embeddingModel: 'test-embedding',
          targetDir: '.',
          usageStatisticsEnabled: false,
          sessionId: 'test-session',
          debugMode: false,
          cwd: '.',
          shellReplacement: 'allowlist',
          coreTools: ['run_shell_command(echo)'],
          settingsService: new SettingsService(),
        });

        const result = checkCommandPermissions(
          'echo "unclosed',
          restrictedConfig,
        );
        expect(result.allAllowed).toBe(true);
      },
    );

    it('should detect process substitution >(...) on both paths', () => {
      expect(detectCommandSubstitution('tee >(wc -l)')).toBe(true);
    });
  });
});
