# Task 03: Privacy Controls & Data Redaction

**Phase:** Privacy Implementation  
**Duration:** 2-3 days  
**Assignee:** Privacy/Security Specialist Subagent  
**Dependencies:** Task 02 (Core Logging Infrastructure) must be complete and tested

## Objective

Implement comprehensive privacy controls and data redaction systems to ensure conversation logging is privacy-conscious by default. Create robust data redaction capabilities that automatically detect and redact sensitive information while maintaining conversation structure and usefulness for debugging.

## Privacy Requirements

### 1. Privacy-First Design Principles
- **Disabled by default**: All conversation logging must be explicitly enabled
- **Granular controls**: Users can control what types of data are logged
- **Automatic redaction**: Sensitive data is automatically detected and redacted
- **Local storage**: Data remains on user's machine unless explicitly configured otherwise
- **Clear consent**: Users understand what data is being collected and why

### 2. Data Classification
- **Always Redact**: API keys, passwords, tokens, private keys
- **Configurable**: File paths, URLs, email addresses, personal information
- **Preserve**: Non-sensitive debugging information, conversation structure
- **Provider-Specific**: Each provider has specific sensitive data patterns

## Implementation Requirements

### 1. Create ConversationDataRedactor Class
**File:** `packages/core/src/privacy/ConversationDataRedactor.ts` (NEW FILE)

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IMessage } from '../providers/IMessage.js';
import { ITool } from '../providers/ITool.js';

export interface RedactionPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
  enabled: boolean;
}

export interface RedactionConfig {
  redactApiKeys: boolean;
  redactCredentials: boolean;
  redactFilePaths: boolean;
  redactUrls: boolean;
  redactEmails: boolean;
  redactPersonalInfo: boolean;
  customPatterns?: RedactionPattern[];
}

export class ConversationDataRedactor {
  private redactionConfig: RedactionConfig;
  private redactionPatterns: Map<string, RedactionPattern[]>;

  constructor(config?: Partial<RedactionConfig>) {
    this.redactionConfig = {
      redactApiKeys: true,
      redactCredentials: true,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
      ...config
    };

    this.redactionPatterns = this.initializeRedactionPatterns();
  }

  /**
   * Redact sensitive data from a conversation message
   */
  redactMessage(message: IMessage, providerName: string): IMessage {
    if (!this.shouldRedact()) {
      return message;
    }

    const redactedMessage = { ...message };
    
    if (typeof redactedMessage.content === 'string') {
      redactedMessage.content = this.redactContent(redactedMessage.content, providerName);
    } else if (Array.isArray(redactedMessage.content)) {
      // Handle structured content (e.g., Gemini's Content array)
      redactedMessage.content = redactedMessage.content.map(part => 
        this.redactContentPart(part, providerName)
      );
    }

    return redactedMessage;
  }

  /**
   * Redact sensitive data from tool definitions
   */
  redactToolCall(tool: ITool): ITool {
    if (!this.shouldRedact()) {
      return tool;
    }

    const redactedTool = { ...tool };
    
    if (redactedTool.parameters) {
      redactedTool.parameters = this.redactToolParameters(redactedTool.parameters, tool.name);
    }

    return redactedTool;
  }

  /**
   * Redact sensitive data from response content
   */
  redactResponseContent(content: string, providerName: string): string {
    if (!this.shouldRedact()) {
      return content;
    }

    return this.redactContent(content, providerName);
  }

  private shouldRedact(): boolean {
    // Check if any redaction is enabled
    return Object.values(this.redactionConfig).some(value => value === true);
  }

  private redactContent(content: string, providerName: string): string {
    let redacted = content;

    // Apply provider-specific patterns
    const providerPatterns = this.redactionPatterns.get(providerName) || [];
    for (const pattern of providerPatterns) {
      if (pattern.enabled) {
        redacted = redacted.replace(pattern.pattern, pattern.replacement);
      }
    }

    // Apply global patterns
    const globalPatterns = this.redactionPatterns.get('global') || [];
    for (const pattern of globalPatterns) {
      if (pattern.enabled && this.isPatternEnabled(pattern.name)) {
        redacted = redacted.replace(pattern.pattern, pattern.replacement);
      }
    }

    return redacted;
  }

  private redactContentPart(part: any, providerName: string): any {
    const redactedPart = { ...part };
    
    if (part.text) {
      redactedPart.text = this.redactContent(part.text, providerName);
    }
    
    if (part.functionCall) {
      redactedPart.functionCall = {
        ...part.functionCall,
        args: this.redactToolParameters(part.functionCall.args, part.functionCall.name)
      };
    }

    return redactedPart;
  }

  private redactToolParameters(params: any, toolName: string): any {
    if (!params || typeof params !== 'object') {
      return params;
    }

    const redacted = { ...params };

    // Apply tool-specific redaction rules
    switch (toolName) {
      case 'read_file':
      case 'write_file':
      case 'list_files':
        if (redacted.file_path && this.redactionConfig.redactFilePaths) {
          redacted.file_path = this.redactFilePath(redacted.file_path);
        }
        break;
        
      case 'run_command':
      case 'shell':
        if (redacted.command) {
          redacted.command = this.redactShellCommand(redacted.command);
        }
        break;
        
      case 'web_search':
      case 'fetch_url':
        if (redacted.url && this.redactionConfig.redactUrls) {
          redacted.url = this.redactUrl(redacted.url);
        }
        break;
    }

    // Apply general parameter redaction
    for (const [key, value] of Object.entries(redacted)) {
      if (typeof value === 'string') {
        redacted[key] = this.redactContent(value, 'global');
      }
    }

    return redacted;
  }

  private redactFilePath(path: string): string {
    // Redact sensitive file paths
    const sensitivePatterns = [
      { pattern: /\/home\/[^/]+\/\.ssh\/[^/]+/g, replacement: '[REDACTED-SSH-KEY-PATH]' },
      { pattern: /\/home\/[^/]+\/\.aws\/[^/]+/g, replacement: '[REDACTED-AWS-CONFIG-PATH]' },
      { pattern: /\/home\/[^/]+\/\.docker\/[^/]+/g, replacement: '[REDACTED-DOCKER-CONFIG-PATH]' },
      { pattern: /\/Users\/[^/]+\/\.ssh\/[^/]+/g, replacement: '[REDACTED-SSH-KEY-PATH]' },
      { pattern: /\/Users\/[^/]+\/\.aws\/[^/]+/g, replacement: '[REDACTED-AWS-CONFIG-PATH]' },
    ];

    let redacted = path;
    for (const { pattern, replacement } of sensitivePatterns) {
      redacted = redacted.replace(pattern, replacement);
    }

    return redacted;
  }

  private redactShellCommand(command: string): string {
    // Redact potentially sensitive shell commands
    let redacted = command;

    // Redact export statements with sensitive values
    redacted = redacted.replace(/export\s+[A-Z_]+\s*=\s*['"]\s*sk-[a-zA-Z0-9]+\s*['"]/g, 'export [REDACTED-API-KEY]');
    redacted = redacted.replace(/export\s+[A-Z_]+\s*=\s*['"]\s*[a-zA-Z0-9+/]+=*\s*['"]/g, 'export [REDACTED-TOKEN]');

    // Redact curl commands with authorization headers
    redacted = redacted.replace(/curl\s+.*-H\s+['"]Authorization:\s*Bearer\s+[^'"]+['"]/g, 'curl [REDACTED-AUTH-HEADER]');
    
    return redacted;
  }

  private redactUrl(url: string): string {
    // Redact sensitive parts of URLs while preserving structure
    try {
      const urlObj = new URL(url);
      
      // Redact query parameters that might contain sensitive data
      const sensitiveParams = ['key', 'token', 'auth', 'password', 'secret', 'api_key'];
      for (const param of sensitiveParams) {
        if (urlObj.searchParams.has(param)) {
          urlObj.searchParams.set(param, '[REDACTED]');
        }
      }
      
      return urlObj.toString();
    } catch {
      // If URL parsing fails, apply pattern-based redaction
      return url.replace(/[?&](key|token|auth|password|secret|api_key)=[^&]*/g, '$1=[REDACTED]');
    }
  }

  private initializeRedactionPatterns(): Map<string, RedactionPattern[]> {
    const patterns = new Map<string, RedactionPattern[]>();

    // Global patterns
    patterns.set('global', [
      {
        name: 'api_keys',
        pattern: /sk-[a-zA-Z0-9]{32,}/g,
        replacement: '[REDACTED-API-KEY]',
        enabled: this.redactionConfig.redactApiKeys
      },
      {
        name: 'email_addresses',
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        replacement: '[REDACTED-EMAIL]',
        enabled: this.redactionConfig.redactEmails
      },
      {
        name: 'passwords',
        pattern: /(?:password|pwd|pass)[=:\s]+[^\s\n\r]+/gi,
        replacement: 'password=[REDACTED]',
        enabled: this.redactionConfig.redactCredentials
      }
    ]);

    // OpenAI-specific patterns
    patterns.set('openai', [
      {
        name: 'openai_api_keys',
        pattern: /sk-[a-zA-Z0-9]{32,}/g,
        replacement: '[REDACTED-OPENAI-KEY]',
        enabled: this.redactionConfig.redactApiKeys
      },
      {
        name: 'openai_org_ids',
        pattern: /org-[a-zA-Z0-9]{24}/g,
        replacement: '[REDACTED-ORG-ID]',
        enabled: this.redactionConfig.redactCredentials
      }
    ]);

    // Anthropic-specific patterns
    patterns.set('anthropic', [
      {
        name: 'anthropic_api_keys',
        pattern: /sk-ant-[a-zA-Z0-9\-_]{95}/g,
        replacement: '[REDACTED-ANTHROPIC-KEY]',
        enabled: this.redactionConfig.redactApiKeys
      }
    ]);

    // Gemini/Google-specific patterns
    patterns.set('gemini', [
      {
        name: 'google_api_keys',
        pattern: /AIza[0-9A-Za-z\-_]{35}/g,
        replacement: '[REDACTED-GOOGLE-KEY]',
        enabled: this.redactionConfig.redactApiKeys
      },
      {
        name: 'google_tokens',
        pattern: /ya29\.[0-9A-Za-z\-_]+/g,
        replacement: '[REDACTED-GOOGLE-TOKEN]',
        enabled: this.redactionConfig.redactCredentials
      }
    ]);

    return patterns;
  }

  private isPatternEnabled(patternName: string): boolean {
    switch (patternName) {
      case 'api_keys':
      case 'openai_api_keys':
      case 'anthropic_api_keys':
      case 'google_api_keys':
        return this.redactionConfig.redactApiKeys;
      case 'email_addresses':
        return this.redactionConfig.redactEmails;
      case 'passwords':
      case 'openai_org_ids':
      case 'google_tokens':
        return this.redactionConfig.redactCredentials;
      default:
        return true;
    }
  }

  /**
   * Update redaction configuration
   */
  updateConfig(config: Partial<RedactionConfig>): void {
    this.redactionConfig = { ...this.redactionConfig, ...config };
    this.redactionPatterns = this.initializeRedactionPatterns();
  }

  /**
   * Get current redaction statistics
   */
  getRedactionStats(content: string, providerName: string): RedactionStats {
    const stats: RedactionStats = {
      totalRedactions: 0,
      redactionsByType: {}
    };

    const patterns = [
      ...(this.redactionPatterns.get('global') || []),
      ...(this.redactionPatterns.get(providerName) || [])
    ];

    for (const pattern of patterns) {
      if (pattern.enabled) {
        const matches = content.match(pattern.pattern);
        if (matches) {
          stats.totalRedactions += matches.length;
          stats.redactionsByType[pattern.name] = matches.length;
        }
      }
    }

    return stats;
  }
}

export interface RedactionStats {
  totalRedactions: number;
  redactionsByType: Record<string, number>;
}
```

### 2. Enhance Config Class for Privacy Settings
**File:** `packages/core/src/config/config.ts`

Add privacy-specific configuration methods to existing Config class:

```typescript
// Add to existing Config class

  // Privacy configuration methods
  getRedactionConfig(): RedactionConfig {
    return {
      redactApiKeys: this.telemetrySettings.redactSensitiveData ?? true,
      redactCredentials: this.telemetrySettings.redactSensitiveData ?? true,
      redactFilePaths: this.telemetrySettings.redactFilePaths ?? false,
      redactUrls: this.telemetrySettings.redactUrls ?? false,
      redactEmails: this.telemetrySettings.redactEmails ?? false,
      redactPersonalInfo: this.telemetrySettings.redactPersonalInfo ?? false,
      customPatterns: this.telemetrySettings.customRedactionPatterns
    };
  }

  getDataRetentionEnabled(): boolean {
    return this.telemetrySettings.enableDataRetention ?? true;
  }

  getConversationExpirationDays(): number {
    return this.telemetrySettings.conversationExpirationDays ?? 30;
  }

  getMaxConversationsStored(): number {
    return this.telemetrySettings.maxConversationsStored ?? 1000;
  }

  // Update TelemetrySettings interface
interface TelemetrySettings {
  // ... existing properties ...
  redactFilePaths?: boolean;
  redactUrls?: boolean;
  redactEmails?: boolean;
  redactPersonalInfo?: boolean;
  customRedactionPatterns?: RedactionPattern[];
  enableDataRetention?: boolean;
  conversationExpirationDays?: number;
  maxConversationsStored?: number;
}
```

### 3. Create Privacy Control Utilities
**File:** `packages/core/src/privacy/privacyUtils.ts` (NEW FILE)

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';
import { ConversationDataRedactor, RedactionConfig } from './ConversationDataRedactor.js';

export class PrivacyManager {
  private redactor: ConversationDataRedactor;
  private config: Config;

  constructor(config: Config) {
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
    if (this.config.getTelemetryTarget() === 'remote' && !this.hasRemoteConsent()) {
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
  validatePrivacyCompliance(conversationData: unknown): PrivacyValidationResult {
    const result: PrivacyValidationResult = {
      isCompliant: true,
      violations: []
    };

    // Check for sensitive data that should have been redacted
    if (typeof conversationData === 'string') {
      const stats = this.redactor.getRedactionStats(conversationData, 'global');
      if (stats.totalRedactions > 0) {
        result.isCompliant = false;
        result.violations.push(`Found ${stats.totalRedactions} instances of sensitive data`);
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
      userRights: this.getUserRightsDescription()
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
    
    return `Automatic redaction of: ${redactions.join(', ')}`;
  }

  private getUserRightsDescription(): string[] {
    return [
      'You can disable conversation logging at any time',
      'You can view and export your conversation data',
      'You can delete stored conversation data',
      'You control what types of data are redacted',
      'Local data remains on your machine unless explicitly shared'
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
```

### 4. Create CLI Privacy Commands
**File:** `packages/cli/src/ui/commands/privacyCommand.ts` (NEW FILE)

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@llxprt/core/config/config.js';
import { PrivacyManager } from '@llxprt/core/privacy/privacyUtils.js';
import { CommandResult } from '../types.js';

export interface PrivacyCommandContext {
  config: Config;
}

export async function handlePrivacyCommand(
  args: string[],
  context: PrivacyCommandContext,
): Promise<CommandResult> {
  const subcommand = args[0];
  const privacyManager = new PrivacyManager(context.config);

  switch (subcommand) {
    case 'status':
      return handlePrivacyStatus(privacyManager);
    
    case 'disclosure':
      return handlePrivacyDisclosure(privacyManager);
    
    case 'enable':
      return handleEnableLogging(args.slice(1), context.config);
    
    case 'disable':
      return handleDisableLogging(context.config);
    
    case 'redaction':
      return handleRedactionSettings(args.slice(1), context.config);
    
    default:
      return {
        type: 'error',
        message: `Unknown privacy subcommand: ${subcommand}. Available: status, disclosure, enable, disable, redaction`
      };
  }
}

async function handlePrivacyStatus(privacyManager: PrivacyManager): Promise<CommandResult> {
  const isLoggingPermitted = privacyManager.isLoggingPermitted();
  const disclosure = privacyManager.generatePrivacyDisclosure();

  const status = [
    `📋 Conversation Logging Status: ${isLoggingPermitted ? '✅ Enabled' : '❌ Disabled'}`,
    '',
    '🔒 Data Collection:',
    ...disclosure.dataCollected.map(item => `  • ${item}`),
    '',
    '💾 Storage:',
    `  ${disclosure.storageLocation}`,
    '',
    '🕒 Retention:',
    `  ${disclosure.retentionPolicy}`,
    '',
    '🛡️ Privacy Protection:',
    `  ${disclosure.redactionPolicy}`,
  ].join('\n');

  return {
    type: 'success',
    message: status
  };
}

async function handlePrivacyDisclosure(privacyManager: PrivacyManager): Promise<CommandResult> {
  const disclosure = privacyManager.generatePrivacyDisclosure();

  const disclosureText = [
    '🔐 LLxprt Privacy Disclosure',
    '================================',
    '',
    '📊 Data We May Collect (when enabled):',
    ...disclosure.dataCollected.map(item => `  • ${item}`),
    '',
    '💾 Where Data is Stored:',
    `  ${disclosure.storageLocation}`,
    '',
    '🕒 How Long Data is Kept:',
    `  ${disclosure.retentionPolicy}`,
    '',
    '🛡️ How We Protect Your Privacy:',
    `  ${disclosure.redactionPolicy}`,
    '',
    '✋ Your Rights:',
    ...disclosure.userRights.map(right => `  • ${right}`),
    '',
    '⚠️  Important: Conversation logging is DISABLED by default.',
    '   You must explicitly enable it to collect conversation data.',
  ].join('\n');

  return {
    type: 'info',
    message: disclosureText
  };
}

async function handleEnableLogging(args: string[], config: Config): Promise<CommandResult> {
  const confirmFlag = args.includes('--confirm');
  
  if (!confirmFlag) {
    return {
      type: 'error',
      message: [
        'Conversation logging requires explicit consent.',
        '',
        'To enable logging, run:',
        '  llxprt privacy enable --confirm',
        '',
        'First, review the privacy disclosure:',
        '  llxprt privacy disclosure'
      ].join('\n')
    };
  }

  // Enable conversation logging
  config.updateSettings({
    telemetry: {
      logConversations: true
    }
  });

  return {
    type: 'success',
    message: '✅ Conversation logging enabled. Data will be stored locally with automatic redaction.'
  };
}

async function handleDisableLogging(config: Config): Promise<CommandResult> {
  config.updateSettings({
    telemetry: {
      logConversations: false
    }
  });

  return {
    type: 'success',
    message: '❌ Conversation logging disabled. No conversation data will be collected.'
  };
}

async function handleRedactionSettings(args: string[], config: Config): Promise<CommandResult> {
  if (args.length === 0) {
    // Show current redaction settings
    const redactionConfig = config.getRedactionConfig();
    
    const settings = [
      '🛡️  Current Redaction Settings:',
      `  • API Keys: ${redactionConfig.redactApiKeys ? '✅' : '❌'}`,
      `  • Credentials: ${redactionConfig.redactCredentials ? '✅' : '❌'}`,
      `  • File Paths: ${redactionConfig.redactFilePaths ? '✅' : '❌'}`,
      `  • URLs: ${redactionConfig.redactUrls ? '✅' : '❌'}`,
      `  • Email Addresses: ${redactionConfig.redactEmails ? '✅' : '❌'}`,
      `  • Personal Info: ${redactionConfig.redactPersonalInfo ? '✅' : '❌'}`,
      '',
      'To modify settings:',
      '  llxprt privacy redaction --api-keys=false',
      '  llxprt privacy redaction --file-paths=true',
    ].join('\n');

    return {
      type: 'info',
      message: settings
    };
  }

  // Parse redaction setting changes
  const updates: Record<string, boolean> = {};
  
  for (const arg of args) {
    const [key, value] = arg.replace('--', '').split('=');
    const boolValue = value === 'true';
    
    switch (key) {
      case 'api-keys':
        updates.redactApiKeys = boolValue;
        break;
      case 'credentials':
        updates.redactCredentials = boolValue;
        break;
      case 'file-paths':
        updates.redactFilePaths = boolValue;
        break;
      case 'urls':
        updates.redactUrls = boolValue;
        break;
      case 'emails':
        updates.redactEmails = boolValue;
        break;
      case 'personal-info':
        updates.redactPersonalInfo = boolValue;
        break;
    }
  }

  if (Object.keys(updates).length === 0) {
    return {
      type: 'error',
      message: 'No valid redaction settings provided. Use format: --api-keys=true'
    };
  }

  // Update telemetry settings
  config.updateSettings({
    telemetry: updates
  });

  const changes = Object.entries(updates)
    .map(([key, value]) => `  • ${key}: ${value ? 'enabled' : 'disabled'}`)
    .join('\n');

  return {
    type: 'success',
    message: `🛡️  Redaction settings updated:\n${changes}`
  };
}
```

### 5. Update LoggingProviderWrapper Integration
**File:** `packages/core/src/providers/LoggingProviderWrapper.ts`

Update the existing LoggingProviderWrapper to use the privacy controls:

```typescript
// Update the constructor and imports
import { PrivacyManager } from '../privacy/privacyUtils.js';

export class LoggingProviderWrapper implements IProvider {
  private conversationId: string;
  private turnNumber: number = 0;
  private privacyManager: PrivacyManager;

  constructor(
    private readonly wrapped: IProvider,
    private readonly config: Config,
  ) {
    this.conversationId = this.generateConversationId();
    this.privacyManager = new PrivacyManager(config);
  }

  // Update the generateChatCompletion method
  async *generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    toolFormat?: string,
  ): AsyncIterableIterator<unknown> {
    const promptId = this.generatePromptId();
    this.turnNumber++;

    // Check if logging is permitted
    if (this.privacyManager.isLoggingPermitted()) {
      await this.logRequest(messages, tools, toolFormat, promptId);
    }

    // ... rest of the method unchanged ...
  }

  private async logRequest(
    messages: IMessage[],
    tools?: ITool[],
    toolFormat?: string,
    promptId?: string
  ): Promise<void> {
    try {
      const redactor = this.privacyManager.getRedactor();
      
      // Use privacy-aware redaction
      const redactedMessages = messages.map(msg => 
        redactor.redactMessage(msg, this.wrapped.name)
      );
      
      const redactedTools = tools?.map(tool => 
        redactor.redactToolCall(tool)
      );

      const event = new ConversationRequestEvent(
        this.wrapped.name,
        this.conversationId,
        this.turnNumber,
        promptId || this.generatePromptId(),
        redactedMessages,
        redactedTools,
        toolFormat
      );

      logConversationRequest(this.config, event);
    } catch (error) {
      console.warn('Failed to log conversation request:', error);
    }
  }

  // ... rest of the class unchanged ...
}
```

## Testing Integration

### Ensure Privacy Tests Pass
All tests from Task 01 related to privacy should now pass:

```bash
npm test packages/core/src/privacy/
npm test packages/core/src/telemetry/conversation-logging.test.ts
```

### Privacy Compliance Testing
Create additional privacy-specific tests:

```bash
npm test packages/core/src/privacy/ConversationDataRedactor.test.ts
npm test packages/core/src/config/conversation-logging-config.test.ts
```

## File Organization Summary

### New Files Created
- `packages/core/src/privacy/ConversationDataRedactor.ts` - Core redaction engine
- `packages/core/src/privacy/privacyUtils.ts` - Privacy management utilities
- `packages/cli/src/ui/commands/privacyCommand.ts` - CLI privacy commands

### Files Modified
- `packages/core/src/config/config.ts` - Add privacy configuration methods
- `packages/core/src/providers/LoggingProviderWrapper.ts` - Integrate privacy controls

## CLI Integration Examples

```bash
# Check privacy status
llxprt privacy status

# View privacy disclosure
llxprt privacy disclosure

# Enable conversation logging (requires confirmation)
llxprt privacy enable --confirm

# Disable conversation logging
llxprt privacy disable

# Configure redaction settings
llxprt privacy redaction --api-keys=true --file-paths=false
llxprt privacy redaction  # Show current settings

# Use privacy-conscious logging in conversation
llxprt --log-conversations "Help me debug this issue"
```

## Acceptance Criteria

### Privacy Compliance
- [ ] Conversation logging disabled by default
- [ ] Explicit user consent required before enabling
- [ ] Comprehensive data redaction for sensitive information
- [ ] Clear privacy disclosure and user rights information
- [ ] Local-first storage with configurable retention

### Data Protection
- [ ] API keys automatically redacted from all content
- [ ] Provider-specific sensitive data patterns handled
- [ ] Tool parameters sanitized appropriately
- [ ] File paths and URLs redacted based on configuration
- [ ] Shell commands with credentials properly sanitized

### User Control
- [ ] Granular control over what data is redacted
- [ ] Easy enable/disable of conversation logging
- [ ] Clear status reporting of privacy settings
- [ ] Configuration persists across sessions
- [ ] CLI commands provide immediate feedback

### Integration
- [ ] Privacy controls work seamlessly with logging infrastructure
- [ ] No performance impact when privacy features are enabled
- [ ] All existing functionality preserved
- [ ] Provider wrapper integrates privacy manager correctly

## Task Completion Criteria

This task is complete when:

1. **Privacy Infrastructure Complete**: All privacy classes and utilities implemented
2. **Tests Pass**: All privacy-related behavioral tests pass
3. **CLI Commands Work**: Privacy commands provide expected functionality
4. **Integration Clean**: Privacy controls integrate with logging infrastructure
5. **Default Privacy**: Conversation logging remains disabled by default
6. **Comprehensive Redaction**: All sensitive data patterns properly handled

The next task (04-provider-integration) should not begin until privacy controls are fully implemented and tested.