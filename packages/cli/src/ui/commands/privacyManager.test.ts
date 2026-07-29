/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  PrivacyManager,
  type PrivacyConfig,
} from '../../utils/privacy/PrivacyManager.js';
import type { RedactionConfig } from '../../utils/privacy/ConversationDataRedactor.js';

interface PrivacyConfigOptions {
  loggingEnabled?: boolean;
  responseLoggingEnabled?: boolean;
  promptLoggingEnabled?: boolean;
  redactionConfig?: RedactionConfig;
  telemetryEnabled?: boolean;
  telemetryOutfile?: string | undefined;
}

const noRedaction: RedactionConfig = {
  redactApiKeys: false,
  redactCredentials: false,
  redactFilePaths: false,
  redactUrls: false,
  redactEmails: false,
  redactPersonalInfo: false,
};

function createConfig(options: PrivacyConfigOptions = {}): PrivacyConfig {
  return {
    getConversationLoggingEnabled: () => options.loggingEnabled ?? false,
    getResponseLoggingEnabled: () => options.responseLoggingEnabled ?? false,
    getTelemetryLogPromptsEnabled: () => options.promptLoggingEnabled ?? false,
    getConversationLogPath: () => '/tmp/conversations',
    getConversationRetentionDays: () => 30,
    getMaxConversationsStored: () => 100,
    getTelemetryOutfile: () => options.telemetryOutfile,
    getTelemetryEnabled: () => options.telemetryEnabled ?? false,
    getRedactionConfig: () => options.redactionConfig ?? noRedaction,
  };
}

describe('PrivacyManager local-only behavior', () => {
  it('permits only explicitly enabled conversation logging', () => {
    expect(new PrivacyManager(createConfig()).isLoggingPermitted()).toBe(false);
    expect(
      new PrivacyManager(
        createConfig({ loggingEnabled: true }),
      ).isLoggingPermitted(),
    ).toBe(true);
  });

  it('discloses local collection, retention, and redaction behavior', () => {
    const disclosure = new PrivacyManager(
      createConfig({
        loggingEnabled: true,
        responseLoggingEnabled: true,
        promptLoggingEnabled: true,
        redactionConfig: {
          redactApiKeys: true,
          redactCredentials: true,
          redactFilePaths: true,
          redactUrls: true,
          redactEmails: true,
          redactPersonalInfo: true,
        },
      }),
    ).generatePrivacyDisclosure();

    expect(disclosure.dataCollected).toStrictEqual([
      'Conversation messages (with redaction)',
      'AI response content (with redaction)',
      'User prompts (with redaction)',
      'Provider usage metadata',
      'Tool call information',
      'Performance metrics',
    ]);
    expect(disclosure.storageLocation).toBe(
      'Data stored locally on your machine: Conversation logs at /tmp/conversations',
    );
    expect(disclosure.storageLocation).not.toMatch(/remote|service/i);
    expect(disclosure.retentionPolicy).toBe(
      'Data retained for 30 days or up to 100 conversations, whichever comes first',
    );
    expect(disclosure.redactionPolicy).toBe(
      'Automatic redaction of: API keys and tokens, Passwords and credentials, Email addresses, File system paths, URLs with sensitive parameters, Personal identifiable information',
    );
    expect(disclosure.userRights).toContain(
      'Local data remains on your machine unless explicitly shared',
    );
  });

  it('reports when automatic redaction is disabled', () => {
    expect(
      new PrivacyManager(createConfig()).generatePrivacyDisclosure()
        .redactionPolicy,
    ).toBe('No automatic redaction enabled');
  });

  it('validates redacted and non-string conversation data', () => {
    const manager = new PrivacyManager(
      createConfig({
        redactionConfig: { ...noRedaction, redactApiKeys: true },
      }),
    );

    expect(
      manager.validatePrivacyCompliance('api_key: sk-1234567890abcdef'),
    ).toStrictEqual({
      isCompliant: false,
      violations: ['Found 1 instances of sensitive data'],
    });
    expect(manager.validatePrivacyCompliance('safe text')).toStrictEqual({
      isCompliant: true,
      violations: [],
    });
    expect(manager.validatePrivacyCompliance({ safe: true })).toStrictEqual({
      isCompliant: true,
      violations: [],
    });
  });

  it('refreshes the redactor from current configuration', () => {
    const options: PrivacyConfigOptions = { redactionConfig: noRedaction };
    const manager = new PrivacyManager(createConfig(options));
    const content = 'api_key: 1234567890abcdef';

    expect(manager.getRedactor().redactResponseContent(content, 'global')).toBe(
      content,
    );
    options.redactionConfig = { ...noRedaction, redactApiKeys: true };
    expect(
      manager.getRedactor().redactResponseContent(content, 'global'),
    ).toContain('[REDACTED-API-KEY]');
  });

  it('discloses telemetry file output when telemetry is enabled with outfile', () => {
    const disclosure = new PrivacyManager(
      createConfig({
        telemetryEnabled: true,
        telemetryOutfile: '/tmp/telemetry.jsonl',
      }),
    ).generatePrivacyDisclosure();

    expect(disclosure.storageLocation).toContain(
      'Telemetry at /tmp/telemetry.jsonl',
    );
    expect(disclosure.storageLocation).toContain('Conversation logs at');
  });

  it('discloses telemetry console output when telemetry is enabled without outfile', () => {
    const disclosure = new PrivacyManager(
      createConfig({
        telemetryEnabled: true,
        telemetryOutfile: undefined,
      }),
    ).generatePrivacyDisclosure();

    expect(disclosure.storageLocation).toContain('Telemetry to console output');
  });

  it('omits telemetry destination when telemetry is disabled', () => {
    const disclosure = new PrivacyManager(
      createConfig({
        telemetryEnabled: false,
        telemetryOutfile: '/tmp/telemetry.jsonl',
      }),
    ).generatePrivacyDisclosure();

    expect(disclosure.storageLocation).not.toContain('Telemetry');
    expect(disclosure.storageLocation).toContain('Conversation logs at');
  });
});
