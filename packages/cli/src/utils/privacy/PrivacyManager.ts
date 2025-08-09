/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ConversationDataRedactor,
  RedactionConfig,
} from './ConversationDataRedactor.js';

// Define interface for config dependency to avoid circular imports
export interface PrivacyConfig {
  getConversationLoggingEnabled(): boolean;
  getResponseLoggingEnabled(): boolean;
  getTelemetryLogPromptsEnabled(): boolean;
  getTelemetryTarget(): 'local' | 'remote' | string;
  getConversationLogPath(): string;
  getConversationRetentionDays(): number;
  getMaxConversationsStored(): number;
  getRedactionConfig(): RedactionConfig;
  getTelemetrySettings(): {
    remoteConsentGiven?: boolean;
    [key: string]: unknown;
  };
}

export class PrivacyManager {
  private redactor: ConversationDataRedactor;
  private config: PrivacyConfig;

  constructor(config: PrivacyConfig) {
    this.config = config;
    this.redactor = new ConversationDataRedactor(config.getRedactionConfig());
  }

  /**
   * Check if conversation logging is permitted based on privacy settings
   */
  isLoggingPermitted(): boolean {
    // Must be explicitly enabled
    if (!this.config.getConversationLoggingEnabled()) {
      return false;
    }

    // Check for privacy constraints
    if (
      this.config.getTelemetryTarget() === 'remote' &&
      !this.hasRemoteConsent()
    ) {
      return false;
    }

    return true;
  }

  /**
   * Get appropriate redactor for current privacy settings
   */
  getRedactor(): ConversationDataRedactor {
    // Update redactor config in case settings changed
    this.redactor.updateConfig(this.config.getRedactionConfig());
    return this.redactor;
  }

  /**
   * Validate privacy compliance for conversation data
   */
  validatePrivacyCompliance(
    conversationData: unknown,
  ): PrivacyValidationResult {
    const result: PrivacyValidationResult = {
      isCompliant: true,
      violations: [],
    };

    // Check for sensitive data that should have been redacted
    if (typeof conversationData === 'string') {
      const stats = this.redactor.getRedactionStats(conversationData, 'global');
      if (stats.totalRedactions > 0) {
        result.isCompliant = false;
        result.violations.push(
          `Found ${stats.totalRedactions} instances of sensitive data`,
        );
      }
    }

    return result;
  }

  /**
   * Generate privacy disclosure for user consent
   */
  generatePrivacyDisclosure(): PrivacyDisclosure {
    return {
      dataCollected: this.getDataCollectionDescription(),
      storageLocation: this.getStorageDescription(),
      retentionPolicy: this.getRetentionDescription(),
      redactionPolicy: this.getRedactionDescription(),
      userRights: this.getUserRightsDescription(),
    };
  }

  private hasRemoteConsent(): boolean {
    // Check if user has explicitly consented to remote data transmission
    return this.config.getTelemetrySettings().remoteConsentGiven ?? false;
  }

  private getDataCollectionDescription(): string[] {
    const collected = [];

    if (this.config.getConversationLoggingEnabled()) {
      collected.push('Conversation messages (with redaction)');
    }

    if (this.config.getResponseLoggingEnabled()) {
      collected.push('AI response content (with redaction)');
    }

    if (this.config.getTelemetryLogPromptsEnabled()) {
      collected.push('User prompts (with redaction)');
    }

    collected.push('Provider usage metadata');
    collected.push('Tool call information');
    collected.push('Performance metrics');

    return collected;
  }

  private getStorageDescription(): string {
    const target = this.config.getTelemetryTarget();
    switch (target) {
      case 'local':
        return `Data stored locally on your machine at ${this.config.getConversationLogPath()}`;
      case 'remote':
        return 'Data transmitted to configured remote telemetry service';
      default:
        return 'Data stored according to your telemetry configuration';
    }
  }

  private getRetentionDescription(): string {
    const days = this.config.getConversationRetentionDays();
    const maxConversations = this.config.getMaxConversationsStored();

    return `Data retained for ${days} days or up to ${maxConversations} conversations, whichever comes first`;
  }

  private getRedactionDescription(): string {
    const config = this.config.getRedactionConfig();
    const redactions = [];

    if (config.redactApiKeys) redactions.push('API keys and tokens');
    if (config.redactCredentials) redactions.push('Passwords and credentials');
    if (config.redactEmails) redactions.push('Email addresses');
    if (config.redactFilePaths) redactions.push('File system paths');
    if (config.redactUrls) redactions.push('URLs with sensitive parameters');
    if (config.redactPersonalInfo)
      redactions.push('Personal identifiable information');

    if (redactions.length === 0) {
      return 'No automatic redaction enabled';
    }

    return `Automatic redaction of: ${redactions.join(', ')}`;
  }

  private getUserRightsDescription(): string[] {
    return [
      'You can disable conversation logging at any time',
      'You can view and export your conversation data',
      'You can delete stored conversation data',
      'You control what types of data are redacted',
      'Local data remains on your machine unless explicitly shared',
    ];
  }
}

export interface PrivacyValidationResult {
  isCompliant: boolean;
  violations: string[];
}

export interface PrivacyDisclosure {
  dataCollected: string[];
  storageLocation: string;
  retentionPolicy: string;
  redactionPolicy: string;
  userRights: string[];
}
