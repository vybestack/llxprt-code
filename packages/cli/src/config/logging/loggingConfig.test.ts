/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core';

// Mock the Config class to add conversation logging methods that will be implemented
interface ExtendedConfig extends Config {
  getConversationLoggingEnabled(): boolean;
  getConversationLogPath(): string;
  setCliFlags(flags: {
    logConversations?: boolean;
    conversationLogPath?: string;
  }): void;
  updateSettings(settings: {
    telemetry?: {
      logConversations?: boolean;
      conversationLogPath?: string;
      logRetentionDays?: number;
      maxLogSizeMB?: number;
      maxLogFiles?: number;
    };
  }): void;
}

// Mock extended config class for testing
class MockExtendedConfig implements ExtendedConfig {
  private conversationLoggingEnabled = false;
  private conversationLogPath =
    process.env.HOME + '/.llxprt/logs/conversations';
  private cliFlags: {
    logConversations?: boolean;
    conversationLogPath?: string;
  } = {};
  private telemetrySettings: {
    logConversations?: boolean;
    conversationLogPath?: string;
    logRetentionDays?: number;
    maxLogSizeMB?: number;
    maxLogFiles?: number;
  } = {};

  getConversationLoggingEnabled(): boolean {
    // CLI flags take highest precedence
    if (this.cliFlags.logConversations !== undefined) {
      return this.cliFlags.logConversations;
    }

    // Environment variable takes second precedence
    if (process.env.LLXPRT_LOG_CONVERSATIONS !== undefined) {
      return process.env.LLXPRT_LOG_CONVERSATIONS === 'true';
    }

    // Settings file takes third precedence
    if (this.telemetrySettings.logConversations !== undefined) {
      return this.telemetrySettings.logConversations;
    }

    // Default to false (privacy-first)
    return false;
  }

  getConversationLogPath(): string {
    // CLI flags take highest precedence
    if (this.cliFlags.conversationLogPath) {
      return this.expandPath(this.cliFlags.conversationLogPath);
    }

    // Environment variable takes second precedence
    if (process.env.LLXPRT_CONVERSATION_LOG_PATH) {
      return this.expandPath(process.env.LLXPRT_CONVERSATION_LOG_PATH);
    }

    // Settings file takes third precedence
    if (this.telemetrySettings.conversationLogPath) {
      return this.expandPath(this.telemetrySettings.conversationLogPath);
    }

    // Default path
    return this.expandPath(this.conversationLogPath);
  }

  setCliFlags(flags: {
    logConversations?: boolean;
    conversationLogPath?: string;
  }): void {
    this.cliFlags = { ...this.cliFlags, ...flags };
  }

  updateSettings(settings: {
    telemetry?: {
      logConversations?: boolean;
      conversationLogPath?: string;
      logRetentionDays?: number;
      maxLogSizeMB?: number;
      maxLogFiles?: number;
    };
  }): void {
    if (settings.telemetry) {
      this.telemetrySettings = {
        ...this.telemetrySettings,
        ...settings.telemetry,
      };
    }
  }

  // Additional mock methods to satisfy Config interface
  getModel(): string {
    return 'test-model';
  }
  getEmbeddingModel(): string {
    return 'test-embedding';
  }
  getSandbox(): boolean {
    return false;
  }
  getCoreTools(): string[] {
    return [];
  }
  getApprovalMode(): string {
    return 'prompt';
  }
  getDebugMode(): boolean {
    return false;
  }
  getMcpServers(): Record<string, unknown> {
    return {};
  }
  getTelemetryEnabled(): boolean {
    return false;
  }
  getTelemetryLogPromptsEnabled(): boolean {
    return false;
  }
  getFileFilteringRespectGitIgnore(): boolean {
    return true;
  }
  getSessionId(): string {
    return 'test-session';
  }

  private expandPath(path: string): string {
    if (path.startsWith('~/')) {
      return path.replace('~', process.env.HOME || '');
    }
    return path;
  }

  getLogRetentionDays(): number {
    return this.telemetrySettings.logRetentionDays ?? 30;
  }

  getMaxLogSizeMB(): number {
    return this.telemetrySettings.maxLogSizeMB ?? 10;
  }

  getMaxLogFiles(): number {
    return this.telemetrySettings.maxLogFiles ?? 5;
  }
}

describe('Conversation Logging Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let config: ExtendedConfig;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear relevant environment variables
    delete process.env.LLXPRT_LOG_CONVERSATIONS;
    delete process.env.LLXPRT_CONVERSATION_LOG_PATH;

    config = new MockExtendedConfig();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  /**
   * @requirement CONFIG-001: Configuration hierarchy
   * @scenario CLI flag overrides environment variable
   * @given Environment variable LLXPRT_LOG_CONVERSATIONS=false
   * @when CLI flag --log-conversations is provided
   * @then getConversationLoggingEnabled() returns true
   */
  it('should respect configuration hierarchy with CLI flags taking precedence', () => {
    process.env.LLXPRT_LOG_CONVERSATIONS = 'false';

    config.setCliFlags({ logConversations: true });

    expect(config.getConversationLoggingEnabled()).toBe(true);
  });

  /**
   * @requirement CONFIG-002: Environment variable precedence over settings
   * @scenario Environment variable overrides settings file
   * @given Settings file with logConversations: false
   * @when Environment variable LLXPRT_LOG_CONVERSATIONS=true
   * @then getConversationLoggingEnabled() returns true
   */
  it('should respect environment variable over settings file', () => {
    config.updateSettings({
      telemetry: { logConversations: false },
    });

    process.env.LLXPRT_LOG_CONVERSATIONS = 'true';

    expect(config.getConversationLoggingEnabled()).toBe(true);
  });

  /**
   * @requirement CONFIG-003: Default disabled state
   * @scenario Fresh configuration with no explicit settings
   * @given New Config instance with no conversation logging settings
   * @when getConversationLoggingEnabled() is called
   * @then Returns false (disabled by default for privacy)
   */
  it('should have conversation logging disabled by default', () => {
    const freshConfig = new MockExtendedConfig();
    expect(freshConfig.getConversationLoggingEnabled()).toBe(false);
  });

  /**
   * @requirement CONFIG-004: Settings file configuration
   * @scenario Conversation logging enabled via settings file
   * @given Settings with telemetry.logConversations: true
   * @when getConversationLoggingEnabled() is called
   * @then Returns true
   */
  it('should enable conversation logging via settings file', () => {
    config.updateSettings({
      telemetry: { logConversations: true },
    });

    expect(config.getConversationLoggingEnabled()).toBe(true);
  });

  /**
   * @requirement CONFIG-005: Custom conversation log path
   * @scenario Custom conversation log path is set
   * @given Settings with conversationLogPath: '/custom/path'
   * @when getConversationLogPath() is called
   * @then Returns expanded path '/custom/path'
   */
  it('should handle custom conversation log path configuration', () => {
    config.updateSettings({
      telemetry: {
        conversationLogPath: '/custom/path',
      },
    });

    expect(config.getConversationLogPath()).toBe('/custom/path');
  });

  /**
   * @requirement CONFIG-006: Path expansion for home directory
   * @scenario Tilde path expansion for log path
   * @given Settings with conversationLogPath: '~/logs/conversations'
   * @when getConversationLogPath() is called
   * @then Returns expanded path with actual home directory
   */
  it('should expand tilde paths for conversation log directory', () => {
    config.updateSettings({
      telemetry: {
        conversationLogPath: '~/logs/conversations',
      },
    });

    const expectedPath = (process.env.HOME || '') + '/logs/conversations';
    expect(config.getConversationLogPath()).toBe(expectedPath);
  });

  /**
   * @requirement CONFIG-007: CLI path override
   * @scenario CLI flag overrides all other path settings
   * @given Environment variable and settings both set different paths
   * @when CLI flag --conversation-log-path is provided
   * @then CLI path takes precedence
   */
  it('should use CLI path override above all other sources', () => {
    process.env.LLXPRT_CONVERSATION_LOG_PATH = '/env/path';
    config.updateSettings({
      telemetry: { conversationLogPath: '/settings/path' },
    });

    config.setCliFlags({ conversationLogPath: '/cli/path' });

    expect(config.getConversationLogPath()).toBe('/cli/path');
  });

  /**
   * @requirement CONFIG-008: Environment path override
   * @scenario Environment variable overrides settings path
   * @given Settings file with conversationLogPath: '/settings/path'
   * @when Environment variable LLXPRT_CONVERSATION_LOG_PATH=/env/path
   * @then Environment path takes precedence
   */
  it('should use environment path over settings path', () => {
    config.updateSettings({
      telemetry: { conversationLogPath: '/settings/path' },
    });

    process.env.LLXPRT_CONVERSATION_LOG_PATH = '/env/path';

    expect(config.getConversationLogPath()).toBe('/env/path');
  });

  /**
   * @requirement CONFIG-009: Log rotation settings
   * @scenario Configuration for log file rotation
   * @given Settings with maxLogSizeMB and maxLogFiles
   * @when getMaxLogSizeMB() and getMaxLogFiles() are called
   * @then Returns configured values
   */
  it('should handle log rotation configuration', () => {
    config.updateSettings({
      telemetry: {
        maxLogSizeMB: 5,
        maxLogFiles: 10,
      },
    });

    expect((config as MockExtendedConfig).getMaxLogSizeMB()).toBe(5);
    expect((config as MockExtendedConfig).getMaxLogFiles()).toBe(10);
  });

  /**
   * @requirement CONFIG-010: Log retention configuration
   * @scenario Configuration for log retention period
   * @given Settings with logRetentionDays: 7
   * @when getLogRetentionDays() is called
   * @then Returns 7 days
   */
  it('should handle log retention configuration', () => {
    config.updateSettings({
      telemetry: {
        logRetentionDays: 7,
      },
    });

    expect((config as MockExtendedConfig).getLogRetentionDays()).toBe(7);
  });

  /**
   * @requirement CONFIG-011: Default log settings
   * @scenario Default values for log management settings
   * @given Fresh configuration with no log settings
   * @when log management getters are called
   * @then Returns appropriate default values
   */
  it('should provide sensible defaults for log management settings', () => {
    const freshConfig = new MockExtendedConfig();

    expect((freshConfig as MockExtendedConfig).getLogRetentionDays()).toBe(30);
    expect((freshConfig as MockExtendedConfig).getMaxLogSizeMB()).toBe(10);
    expect((freshConfig as MockExtendedConfig).getMaxLogFiles()).toBe(5);
    expect(freshConfig.getConversationLogPath()).toContain(
      '/.llxprt/logs/conversations',
    );
  });

  /**
   * @requirement CONFIG-012: Boolean environment variable parsing
   * @scenario Environment variable string to boolean conversion
   * @given Environment variable LLXPRT_LOG_CONVERSATIONS with various string values
   * @when getConversationLoggingEnabled() is called
   * @then Correctly parses 'true'/'false' strings to booleans
   */
  it('should correctly parse boolean environment variables', () => {
    const testCases = [
      { envValue: 'true', expected: true },
      { envValue: 'false', expected: false },
      { envValue: 'TRUE', expected: false }, // Case sensitive
      { envValue: '1', expected: false }, // Only 'true' string is truthy
      { envValue: 'yes', expected: false }, // Only 'true' string is truthy
    ];

    testCases.forEach(({ envValue, expected }) => {
      process.env.LLXPRT_LOG_CONVERSATIONS = envValue;
      const testConfig = new MockExtendedConfig();
      expect(testConfig.getConversationLoggingEnabled()).toBe(expected);
    });
  });

  /**
   * @requirement CONFIG-013: Configuration precedence chain validation
   * @scenario All configuration sources set with different values
   * @given CLI flags, environment variables, and settings all set
   * @when configuration getters are called
   * @then CLI takes precedence over env, env over settings, settings over defaults
   */
  it('should maintain correct precedence chain for all sources', () => {
    // Set up conflicting values at all levels
    config.updateSettings({
      telemetry: {
        logConversations: false,
        conversationLogPath: '/settings/path',
      },
    });

    process.env.LLXPRT_LOG_CONVERSATIONS = 'true';
    process.env.LLXPRT_CONVERSATION_LOG_PATH = '/env/path';

    config.setCliFlags({
      logConversations: false,
      conversationLogPath: '/cli/path',
    });

    // CLI should win for both settings
    expect(config.getConversationLoggingEnabled()).toBe(false); // CLI false overrides env true
    expect(config.getConversationLogPath()).toBe('/cli/path'); // CLI path overrides env path

    // Remove CLI flags, env should win
    config.setCliFlags({});
    expect(config.getConversationLoggingEnabled()).toBe(true); // Env true overrides settings false
    expect(config.getConversationLogPath()).toBe('/env/path'); // Env path overrides settings path

    // Remove env vars, settings should win
    delete process.env.LLXPRT_LOG_CONVERSATIONS;
    delete process.env.LLXPRT_CONVERSATION_LOG_PATH;
    expect(config.getConversationLoggingEnabled()).toBe(false); // Settings false overrides default false
    expect(config.getConversationLogPath()).toBe('/settings/path'); // Settings path overrides default path
  });

  /**
   * @requirement CONFIG-014: Invalid configuration handling
   * @scenario Invalid or malformed configuration values
   * @given Settings with invalid values (negative numbers, invalid paths)
   * @when configuration getters are called
   * @then Gracefully handles invalid values with fallbacks
   */
  it('should handle invalid configuration values gracefully', () => {
    config.updateSettings({
      telemetry: {
        maxLogSizeMB: -5, // Invalid negative value
        maxLogFiles: 0, // Invalid zero value
        logRetentionDays: -10, // Invalid negative value
        conversationLogPath: '', // Invalid empty path
      },
    });

    // Should still return reasonable defaults for invalid values
    expect((config as MockExtendedConfig).getMaxLogSizeMB()).toBeGreaterThan(0);
    expect((config as MockExtendedConfig).getMaxLogFiles()).toBeGreaterThan(0);
    expect(
      (config as MockExtendedConfig).getLogRetentionDays(),
    ).toBeGreaterThan(0);
    expect(config.getConversationLogPath()).toBeTruthy();
  });
});
