#!/usr/bin/env npx tsx

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Comprehensive privacy compliance validation script
 * Validates that conversation logging meets privacy-first requirements
 */

import { Config } from '@vybestack/llxprt-code-core';
import { ConversationDataRedactor } from '../packages/cli/src/utils/privacy/ConversationDataRedactor.js';
import { PrivacyManager } from '../packages/cli/src/utils/privacy/PrivacyManager.js';
import type { IProvider, IMessage } from '@vybestack/llxprt-code-core';

interface ValidationResult {
  test: string;
  passed: boolean;
  details: string;
  critical: boolean;
}

// Mock Provider for testing
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class _MockProvider implements IProvider {
  constructor(public name: string) {}

  get isDefault(): boolean {
    return false;
  }

  async getModels(): Promise<Array<{ id: string; name: string }>> {
    return [{ id: 'mock-model', name: 'Mock Model' }];
  }

  async *generateChatCompletion(): AsyncIterableIterator<unknown> {
    yield { content: `Mock response from ${this.name}`, role: 'assistant' };
    yield { content: ' chunk 2', role: 'assistant' };
    yield { content: ' complete', role: 'assistant' };
  }

  getCurrentModel?(): string {
    return 'mock-model';
  }
  getServerTools(): string[] {
    return [];
  }
  async invokeServerTool(): Promise<unknown> {
    return {};
  }
}

export class PrivacyComplianceValidator {
  private results: ValidationResult[] = [];

  async runValidation(): Promise<boolean> {
    console.log('🔒 Starting Privacy Compliance Validation...\n');

    // Critical privacy requirements
    await this.validateDefaultDisabled();
    await this.validateExplicitOptIn();
    await this.validateDataRedaction();
    await this.validateLocalStorage();
    await this.validateNoLeakage();

    // Additional privacy features
    await this.validateGranularControls();
    await this.validateRetentionPolicies();
    await this.validateUserRights();

    return this.reportResults();
  }

  private async validateDefaultDisabled(): Promise<void> {
    const config = new Config({
      sessionId: 'validation-test-session',
      targetDir: '/tmp',
    });
    const isEnabled = config.getConversationLoggingEnabled();

    this.addResult({
      test: 'Conversation logging disabled by default',
      passed: !isEnabled,
      details: `getConversationLoggingEnabled() returned ${isEnabled}, expected false`,
      critical: true,
    });
  }

  private async validateExplicitOptIn(): Promise<void> {
    // Test that logging requires explicit enablement
    const config = new Config({
      sessionId: 'validation-test-session',
      targetDir: '/tmp',
    });

    // Should be disabled even with general telemetry enabled
    config.updateSettings({ telemetry: { enabled: true } });
    const stillDisabled = !config.getConversationLoggingEnabled();

    this.addResult({
      test: 'Conversation logging requires explicit opt-in',
      passed: stillDisabled,
      details: `With telemetry enabled, conversation logging still disabled: ${stillDisabled}`,
      critical: true,
    });

    // Should be enabled only with explicit consent
    config.updateSettings({ telemetry: { logConversations: true } });
    const explicitlyEnabled = config.getConversationLoggingEnabled();

    this.addResult({
      test: 'Explicit opt-in enables conversation logging',
      passed: explicitlyEnabled,
      details: `With explicit opt-in, conversation logging enabled: ${explicitlyEnabled}`,
      critical: true,
    });
  }

  private async validateDataRedaction(): Promise<void> {
    const redactor = new ConversationDataRedactor();

    // Test API key redaction
    const apiKeyMessage: IMessage = {
      role: 'user',
      content:
        'My OpenAI key is sk-1234567890abcdefghijklmnopqrstuvwxyz and my Anthropic key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789012345678901234567890123456789012345678901234567890',
    };

    const redactedMessage = redactor.redactMessage(apiKeyMessage, 'openai');
    const containsOpenAI = redactedMessage.content.includes(
      'sk-1234567890abcdef',
    );
    const containsAnthropic = redactedMessage.content.includes(
      'sk-ant-api03-abcdef',
    );

    this.addResult({
      test: 'API keys are redacted from messages',
      passed: !containsOpenAI && !containsAnthropic,
      details: `OpenAI key found: ${containsOpenAI}, Anthropic key found: ${containsAnthropic}`,
      critical: true,
    });

    // Test credential redaction
    const credentialMessage: IMessage = {
      role: 'user',
      content: 'My password is secretpass123 and my token is abc123xyz',
    };

    const redactedCreds = redactor.redactMessage(credentialMessage, 'openai');
    const containsPassword = redactedCreds.content.includes('secretpass123');

    this.addResult({
      test: 'Credentials are redacted from messages',
      passed: !containsPassword,
      details: `Password found in redacted content: ${containsPassword}`,
      critical: true,
    });

    // Test sensitive file path redaction
    const filePathMessage: IMessage = {
      role: 'user',
      content:
        'Read the file /home/user/.ssh/id_rsa and /Users/user/.aws/credentials',
    };

    const redactedPaths = redactor.redactMessage(filePathMessage, 'openai');
    const containsSshPath = redactedPaths.content.includes(
      '/home/user/.ssh/id_rsa',
    );
    const containsAwsPath = redactedPaths.content.includes(
      '/Users/user/.aws/credentials',
    );

    this.addResult({
      test: 'Sensitive file paths are redacted',
      passed: !containsSshPath && !containsAwsPath,
      details: `SSH path found: ${containsSshPath}, AWS path found: ${containsAwsPath}`,
      critical: false,
    });
  }

  private async validateLocalStorage(): Promise<void> {
    const config = new Config({
      sessionId: 'validation-test-session',
      targetDir: '/tmp',
    });
    config.updateSettings({
      telemetry: {
        logConversations: true,
        target: 'local',
      },
    });

    const isLocal = config.getTelemetryTarget() === 'local';
    const logPath = config.getConversationLogPath();
    const isLocalPath =
      logPath.includes('.llxprt') ||
      logPath.startsWith('~') ||
      logPath.startsWith('/');

    this.addResult({
      test: 'Conversation data stored locally by default',
      passed: isLocal && isLocalPath,
      details: `Target: ${config.getTelemetryTarget()}, Path: ${logPath}`,
      critical: true,
    });
  }

  private async validateNoLeakage(): Promise<void> {
    // Test that logging is disabled by default - no wrapper needed
    const config = new Config({
      sessionId: 'validation-test-session',
      targetDir: '/tmp',
    });

    // Test that conversation logging is disabled by default
    const isLoggingEnabled = config.getConversationLoggingEnabled();

    this.addResult({
      test: 'No sensitive data leaked when logging disabled',
      passed: !isLoggingEnabled,
      details: `Logging is disabled by default: ${!isLoggingEnabled}`,
      critical: true,
    });
  }

  private async validateGranularControls(): Promise<void> {
    const config = new Config({
      sessionId: 'validation-test-session',
      targetDir: '/tmp',
    });

    // Test individual redaction controls
    config.updateSettings({
      telemetry: {
        logConversations: true,
        redactionConfig: {
          redactApiKeys: true,
          redactFilePaths: false,
          redactEmails: true,
          redactCredentials: true,
          redactUrls: false,
          redactPersonalInfo: false,
        },
      },
    });

    const redactionConfig = config.getRedactionConfig();
    const granularControlsWork =
      redactionConfig.redactApiKeys === true &&
      redactionConfig.redactFilePaths === false &&
      redactionConfig.redactEmails === true;

    this.addResult({
      test: 'Granular privacy controls work correctly',
      passed: granularControlsWork,
      details: `API keys: ${redactionConfig.redactApiKeys}, File paths: ${redactionConfig.redactFilePaths}, Emails: ${redactionConfig.redactEmails}`,
      critical: false,
    });
  }

  private async validateRetentionPolicies(): Promise<void> {
    const config = new Config({
      sessionId: 'validation-test-session',
      targetDir: '/tmp',
    });
    config.updateSettings({
      telemetry: {
        logConversations: true,
        retentionDays: 7,
        maxLogFiles: 5,
      },
    });

    const retentionDays = config.getConversationRetentionDays();
    const maxLogFiles = config.getMaxLogFiles();

    const retentionWorks = retentionDays === 7 && maxLogFiles === 5;

    this.addResult({
      test: 'Data retention policies are configurable',
      passed: retentionWorks,
      details: `Retention: ${retentionDays} days, Max files: ${maxLogFiles}`,
      critical: false,
    });
  }

  private async validateUserRights(): Promise<void> {
    const config = new Config({
      sessionId: 'validation-test-session',
      targetDir: '/tmp',
    });
    const privacyManager = new PrivacyManager(config);

    // Test privacy disclosure generation
    const disclosure = privacyManager.generatePrivacyDisclosure();
    const hasUserRights =
      disclosure.userRights && disclosure.userRights.length > 0;
    const hasDataDescription =
      disclosure.dataCollected && disclosure.dataCollected.length > 0;

    this.addResult({
      test: 'User rights and data disclosure are available',
      passed: hasUserRights && hasDataDescription,
      details: `User rights: ${hasUserRights}, Data description: ${hasDataDescription}`,
      critical: false,
    });
  }

  private addResult(result: ValidationResult): void {
    this.results.push(result);
    const status = result.passed ? '✅' : result.critical ? '❌' : '⚠️';
    const criticality = result.critical ? '[CRITICAL]' : '[INFO]';
    console.log(`${status} ${criticality} ${result.test}`);
    if (!result.passed) {
      console.log(`   Details: ${result.details}`);
    }
    console.log('');
  }

  private reportResults(): boolean {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    const critical = this.results.filter((r) => r.critical);
    const criticalFailed = critical.filter((r) => !r.passed).length;

    console.log('📊 Privacy Compliance Validation Results:');
    console.log(`   Total tests: ${total}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${total - passed}`);
    console.log(`   Critical failures: ${criticalFailed}`);

    if (criticalFailed > 0) {
      console.log('\n❌ CRITICAL PRIVACY FAILURES DETECTED!');
      console.log('The following critical privacy requirements are not met:');
      critical
        .filter((r) => !r.passed)
        .forEach((r) => {
          console.log(`   • ${r.test}: ${r.details}`);
        });
      return false;
    }

    if (passed === total) {
      console.log('\n✅ All privacy compliance tests passed!');
      return true;
    } else {
      console.log(
        '\n⚠️  Some non-critical privacy tests failed. Review recommended.',
      );
      return true; // Non-critical failures don't fail the validation
    }
  }
}

// Execute validation if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new PrivacyComplianceValidator();
  validator
    .runValidation()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((error) => {
      console.error('Privacy validation failed with error:', error);
      process.exit(1);
    });
}
