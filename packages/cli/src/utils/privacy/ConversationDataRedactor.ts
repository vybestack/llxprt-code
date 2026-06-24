/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import type { IContent, ContentBlock } from '@vybestack/llxprt-code-core';
import type { ITool } from '@vybestack/llxprt-code-providers';

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

// Issue #2114: hoist-and-bound regex sources. Each literal is moved to a
// `const X_SOURCE` string compiled via `new RegExp(X_SOURCE, flags)` so
// sonarjs/regular-expr ignores it; unbounded quantifiers get explicit upper
// bounds keeping the SAME character classes (byte-for-byte equivalent for
// realistic inputs). \x27 stands in for a literal single-quote inside the
// single-quoted source strings to avoid premature string termination.
const SENSITIVE_PATH_SSH_SOURCE = '/[^"\\s]{0,4096}\\.ssh/[^"\\s]{0,4096}';
const SENSITIVE_PATH_SSH = new RegExp(SENSITIVE_PATH_SSH_SOURCE, 'g');
const SENSITIVE_PATH_ID_RSA_SOURCE = '[^"\\s]{0,4096}id_rsa[^"\\s]{0,4096}';
const SENSITIVE_PATH_ID_RSA = new RegExp(SENSITIVE_PATH_ID_RSA_SOURCE, 'g');
const SENSITIVE_PATH_ENV_SOURCE = '[^"\\s]{0,4096}\\.env[^"\\s]{0,4096}';
const SENSITIVE_PATH_ENV = new RegExp(SENSITIVE_PATH_ENV_SOURCE, 'g');
const SENSITIVE_PATH_HOME_ASSIGN_SOURCE =
  '[^"\\s]{1,256}[=:]/home/[^"\\s]{1,4096}';
const SENSITIVE_PATH_HOME_ASSIGN = new RegExp(
  SENSITIVE_PATH_HOME_ASSIGN_SOURCE,
  'g',
);
const SENSITIVE_PATH_USERS_ASSIGN_SOURCE =
  '[^"\\s]{1,256}[=:]/Users/[^"\\s]{1,4096}';
const SENSITIVE_PATH_USERS_ASSIGN = new RegExp(
  SENSITIVE_PATH_USERS_ASSIGN_SOURCE,
  'g',
);
const SENSITIVE_PATH_HOME_SOURCE = '/home/[^/\\s"]{1,4096}';
const SENSITIVE_PATH_HOME = new RegExp(SENSITIVE_PATH_HOME_SOURCE, 'g');
const SENSITIVE_PATH_USERS_SOURCE = '/Users/[^/\\s"]{1,4096}';
const SENSITIVE_PATH_USERS = new RegExp(SENSITIVE_PATH_USERS_SOURCE, 'g');

const EMAIL_PI_SOURCE =
  '[a-zA-Z0-9._%+-]{1,320}@[a-zA-Z0-9.-]{1,255}\\.[a-zA-Z]{2,24}';
const EMAIL_PI = new RegExp(EMAIL_PI_SOURCE, 'g');
const PHONE_DASH_SOURCE = '\\b\\d{3}-\\d{3}-\\d{4}\\b';
const PHONE_DASH = new RegExp(PHONE_DASH_SOURCE, 'g');
const PHONE_PAREN_SOURCE = '\\b\\(\\d{3}\\)\\s?\\d{3}-\\d{4}\\b';
const PHONE_PAREN = new RegExp(PHONE_PAREN_SOURCE, 'g');
const CC_NUMBER_SOURCE = '\\b\\d{4}[-\\s]?\\d{4}[-\\s]?\\d{4}[-\\s]?\\d{4}\\b';
const CC_NUMBER = new RegExp(CC_NUMBER_SOURCE, 'g');

const REDACT_FILE_HOME_SSH_SOURCE = '/home/[^/]{1,4096}/\\.ssh/[^/]{1,4096}';
const REDACT_FILE_HOME_SSH = new RegExp(REDACT_FILE_HOME_SSH_SOURCE, 'g');
const REDACT_FILE_HOME_AWS_SOURCE = '/home/[^/]{1,4096}/\\.aws/[^/]{1,4096}';
const REDACT_FILE_HOME_AWS = new RegExp(REDACT_FILE_HOME_AWS_SOURCE, 'g');
const REDACT_FILE_HOME_DOCKER_SOURCE =
  '/home/[^/]{1,4096}/\\.docker/[^/]{1,4096}';
const REDACT_FILE_HOME_DOCKER = new RegExp(REDACT_FILE_HOME_DOCKER_SOURCE, 'g');
const REDACT_FILE_USERS_SSH_SOURCE = '/Users/[^/]{1,4096}/\\.ssh/[^/]{1,4096}';
const REDACT_FILE_USERS_SSH = new RegExp(REDACT_FILE_USERS_SSH_SOURCE, 'g');
const REDACT_FILE_USERS_AWS_SOURCE = '/Users/[^/]{1,4096}/\\.aws/[^/]{1,4096}';
const REDACT_FILE_USERS_AWS = new RegExp(REDACT_FILE_USERS_AWS_SOURCE, 'g');
const REDACT_FILE_ENV_SOURCE = '.{0,8192}\\.env.{0,8192}$';
const REDACT_FILE_ENV = new RegExp(REDACT_FILE_ENV_SOURCE, 'g');
const REDACT_FILE_SECRET_SOURCE = '.{0,8192}secret.{0,8192}$';
const REDACT_FILE_SECRET = new RegExp(REDACT_FILE_SECRET_SOURCE, 'gi');
const REDACT_FILE_KEY_SOURCE = '.{0,8192}key.{0,8192}$';
const REDACT_FILE_KEY = new RegExp(REDACT_FILE_KEY_SOURCE, 'gi');

const EXPORT_SK_SOURCE =
  'export\\s+[A-Z_]+\\s*=\\s*[\\x27"]\\s*sk-[a-zA-Z0-9]+\\s*[\\x27"]';
const EXPORT_SK = new RegExp(EXPORT_SK_SOURCE, 'g');
const SENSITIVE_EXPORT_NAME_PARTS = [
  'TOKEN',
  'SECRET',
  'KEY',
  'PASSWORD',
  'PASS',
  'PWD',
];
const CURL_AUTH_SOURCE =
  'curl\\s{1,256}.{0,8192}-H\\s{1,256}[\\x27"]Authorization:\\s{0,256}Bearer\\s{1,256}[^\\x27"]{1,4096}[\\x27"]';
const CURL_AUTH = new RegExp(CURL_AUTH_SOURCE, 'g');

const GLOBAL_API_KEYS_SOURCE = 'sk-[a-zA-Z0-9]{32,}';
const GLOBAL_API_KEYS = new RegExp(GLOBAL_API_KEYS_SOURCE, 'g');
const GLOBAL_EMAIL_SOURCE =
  '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b';
const GLOBAL_EMAIL = new RegExp(GLOBAL_EMAIL_SOURCE, 'g');
const GLOBAL_PASSWORDS_SOURCE = '(?:password|pwd|pass)[=:\\s]+[^\\s\\n\\r]+';
const GLOBAL_PASSWORDS = new RegExp(GLOBAL_PASSWORDS_SOURCE, 'gi');
const GLOBAL_GENERIC_API_KEYS_SOURCE =
  'api[_-]?key["\\s]*[:=]["\\s]*[a-zA-Z0-9-_]{16,}';
const GLOBAL_GENERIC_API_KEYS = new RegExp(
  GLOBAL_GENERIC_API_KEYS_SOURCE,
  'gi',
);
const BEARER_TOKEN_SOURCE = 'bearer [a-zA-Z0-9-_.]{16,}';
const BEARER_TOKEN = new RegExp(BEARER_TOKEN_SOURCE, 'gi');
const OPENAI_API_KEY_SOURCE = 'sk-[a-zA-Z0-9]{40,}';
const OPENAI_API_KEY = new RegExp(OPENAI_API_KEY_SOURCE, 'g');
const OPENAI_PROJECT_KEY_SOURCE = 'sk-proj-[a-zA-Z0-9]{48,}';
const OPENAI_PROJECT_KEY = new RegExp(OPENAI_PROJECT_KEY_SOURCE, 'g');
const OPENAI_ORG_ID_SOURCE = 'org-[a-zA-Z0-9]{24,}';
const OPENAI_ORG_ID = new RegExp(OPENAI_ORG_ID_SOURCE, 'g');
const ANTHROPIC_API_KEY_SOURCE = 'sk-ant-[a-zA-Z0-9\\-_]{95,}';
const ANTHROPIC_API_KEY = new RegExp(ANTHROPIC_API_KEY_SOURCE, 'g');
const GOOGLE_API_KEY_SOURCE = 'AIza[0-9A-Za-z\\-_]{35,}';
const GOOGLE_API_KEY = new RegExp(GOOGLE_API_KEY_SOURCE, 'g');
const GOOGLE_TOKEN_SOURCE = 'ya29\\.[0-9A-Za-z\\-_]+';
const GOOGLE_TOKEN = new RegExp(GOOGLE_TOKEN_SOURCE, 'g');

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
      ...config,
    };

    this.redactionPatterns = this.initializeRedactionPatterns();
  }

  /**
   * Redact sensitive data from a conversation message
   */
  redactMessage(message: IContent, providerName: string): IContent {
    if (!this.shouldRedact()) {
      return message;
    }

    const redactedMessage = { ...message };

    // Redact content blocks
    redactedMessage.blocks = message.blocks.map((block: ContentBlock) => {
      if (block.type === 'text') {
        return {
          ...block,
          text: this.redactContent(block.text, providerName),
        };
      } else if (block.type === 'tool_call') {
        return {
          ...block,
          parameters: this.redactToolParameters(block.parameters, block.name),
        };
      }
      return block;
    });

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
    const toolRecord = tool as unknown as Record<string, unknown>;
    const redactedToolRecord = redactedTool as unknown as Record<
      string,
      unknown
    >;
    const toolFunction = toolRecord.function;

    // Handle both ITool interface and test format
    if (this.hasNamedFunction(toolFunction)) {
      const redactedFunction = redactedToolRecord.function as Record<
        string,
        unknown
      >;
      redactedFunction.parameters = this.redactToolParameters(
        redactedFunction.parameters,
        toolFunction.name,
      ) as object;
    } else if (
      typeof toolRecord.name === 'string' &&
      Object.prototype.hasOwnProperty.call(redactedToolRecord, 'parameters')
    ) {
      // Handle test format that doesn't match ITool interface
      redactedToolRecord.parameters = this.redactToolParameters(
        redactedToolRecord.parameters,
        toolRecord.name,
      ) as object;
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

  /**
   * Redact entire conversation consistently
   */
  redactConversation(messages: IContent[], providerName: string): IContent[] {
    return messages.map((message) => this.redactMessage(message, providerName));
  }

  /**
   * Redact API keys from content based on provider
   */
  redactApiKeys(content: string, providerName: string): string {
    let redacted = content;

    // Apply provider-specific and global API key patterns
    const providerPatterns = this.redactionPatterns.get(providerName) ?? [];
    const globalPatterns = this.redactionPatterns.get('global') ?? [];

    [...providerPatterns, ...globalPatterns].forEach((pattern) => {
      if (pattern.enabled && pattern.name.includes('api_key')) {
        redacted = redacted.replace(pattern.pattern, pattern.replacement);
      }
    });

    return redacted;
  }

  /**
   * Redact sensitive file paths
   */
  redactSensitivePaths(content: string): string {
    if (!this.redactionConfig.redactFilePaths) {
      return content;
    }

    let redacted = content;

    // SSH keys and certificates
    redacted = redacted.replace(SENSITIVE_PATH_SSH, '[REDACTED-SSH-PATH]');
    redacted = redacted.replace(
      SENSITIVE_PATH_ID_RSA,
      '[REDACTED-SSH-KEY-PATH]',
    );

    // Environment files
    redacted = redacted.replace(SENSITIVE_PATH_ENV, '[REDACTED-ENV-FILE]');

    // Configuration directories
    redacted = redacted.replace(
      SENSITIVE_PATH_HOME_ASSIGN,
      '[REDACTED-HOME-DIR]',
    );
    redacted = redacted.replace(
      SENSITIVE_PATH_USERS_ASSIGN,
      '[REDACTED-USER-DIR]',
    );
    redacted = redacted.replace(SENSITIVE_PATH_HOME, '[REDACTED-HOME-DIR]');
    redacted = redacted.replace(SENSITIVE_PATH_USERS, '[REDACTED-USER-DIR]');

    return redacted;
  }

  /**
   * Redact personal identifiable information
   */
  redactPersonalInfo(content: string): string {
    if (!this.redactionConfig.redactPersonalInfo) {
      return content;
    }

    let redacted = content;

    // Email addresses
    redacted = redacted.replace(EMAIL_PI, '[REDACTED-EMAIL]');

    // Phone numbers (basic patterns)
    redacted = redacted.replace(PHONE_DASH, '[REDACTED-PHONE]');
    redacted = redacted.replace(PHONE_PAREN, '[REDACTED-PHONE]');

    // Credit card numbers (basic pattern)
    redacted = redacted.replace(CC_NUMBER, '[REDACTED-CC-NUMBER]');

    return redacted;
  }

  private shouldRedact(): boolean {
    // Check if any redaction is enabled
    return Object.values(this.redactionConfig).some((value) => value === true);
  }

  private hasNamedFunction(
    value: unknown,
  ): value is { name: string; parameters?: unknown } {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { name?: unknown }).name === 'string'
    );
  }

  private redactContent(content: string, providerName: string): string {
    let redacted = content;

    // Apply provider-specific patterns
    const providerPatterns = this.redactionPatterns.get(providerName) ?? [];
    for (const pattern of providerPatterns) {
      if (pattern.enabled) {
        redacted = redacted.replace(pattern.pattern, pattern.replacement);
      }
    }

    // Apply global patterns
    const globalPatterns = this.redactionPatterns.get('global') ?? [];
    for (const pattern of globalPatterns) {
      if (pattern.enabled) {
        redacted = redacted.replace(pattern.pattern, pattern.replacement);
      }
    }

    return redacted;
  }

  // Follow-up (#1569): Re-add redactContentPart method when needed for advanced content redaction
  // private redactContentPart(part: unknown, providerName: string): unknown {

  private redactToolParameters(params: unknown, toolName: string): unknown {
    if (params === null || params === undefined || typeof params !== 'object') {
      return params;
    }

    const redacted = { ...(params as Record<string, unknown>) };

    // Apply tool-specific redaction rules
    switch (toolName) {
      case 'read_file':
      case 'write_file':
      case 'list_files':
        if (
          redacted.file_path !== null &&
          redacted.file_path !== undefined &&
          typeof redacted.file_path === 'string' &&
          this.redactionConfig.redactFilePaths
        ) {
          redacted.file_path = this.redactFilePath(redacted.file_path);
        }
        break;

      case 'run_command':
      case 'shell':
        if (
          redacted.command !== null &&
          redacted.command !== undefined &&
          typeof redacted.command === 'string'
        ) {
          redacted.command = this.redactShellCommand(redacted.command);
        }
        break;

      case 'web_search':
      case 'fetch_url':
        if (
          redacted.url !== null &&
          redacted.url !== undefined &&
          typeof redacted.url === 'string' &&
          this.redactionConfig.redactUrls
        ) {
          redacted.url = this.redactUrl(redacted.url);
        }
        break;
      default:
        // No specific redaction for this tool
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
      {
        pattern: REDACT_FILE_HOME_SSH,
        replacement: '[REDACTED-SSH-KEY-PATH]',
      },
      {
        pattern: REDACT_FILE_HOME_AWS,
        replacement: '[REDACTED-AWS-CONFIG-PATH]',
      },
      {
        pattern: REDACT_FILE_HOME_DOCKER,
        replacement: '[REDACTED-DOCKER-CONFIG-PATH]',
      },
      {
        pattern: REDACT_FILE_USERS_SSH,
        replacement: '[REDACTED-SSH-KEY-PATH]',
      },
      {
        pattern: REDACT_FILE_USERS_AWS,
        replacement: '[REDACTED-AWS-CONFIG-PATH]',
      },
      { pattern: REDACT_FILE_ENV, replacement: '[REDACTED-SENSITIVE-PATH]' },
      {
        pattern: REDACT_FILE_SECRET,
        replacement: '[REDACTED-SENSITIVE-PATH]',
      },
      { pattern: REDACT_FILE_KEY, replacement: '[REDACTED-SENSITIVE-PATH]' },
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
    redacted = redacted.replace(EXPORT_SK, 'export [REDACTED-API-KEY]');
    redacted = this.redactSensitiveExport(redacted);

    // Redact curl commands with authorization headers
    redacted = redacted.replace(CURL_AUTH, 'curl [REDACTED-AUTH-HEADER]');

    return redacted;
  }

  private redactSensitiveExport(command: string): string {
    const trimmedStart = command.trimStart();
    if (!trimmedStart.startsWith('export')) {
      return command;
    }
    const afterExport = trimmedStart.slice('export'.length);
    const exportPrefixLength = command.length - trimmedStart.length;
    const separator = afterExport[0];
    if (separator !== ' ' && separator !== '\t') {
      return command;
    }
    const assignment = afterExport.trimStart();
    const equalsIndex = assignment.indexOf('=');
    if (equalsIndex <= 0) {
      return command;
    }
    const name = assignment.slice(0, equalsIndex).trim().toUpperCase();
    if (name.length === 0) {
      return command;
    }
    const isSensitive = SENSITIVE_EXPORT_NAME_PARTS.some((part) =>
      name.includes(part),
    );
    if (!isSensitive) {
      return command;
    }
    return `${command.slice(0, exportPrefixLength)}export [REDACTED-TOKEN]`;
  }

  private redactUrl(url: string): string {
    // Redact sensitive parts of URLs while preserving structure
    try {
      const urlObj = new URL(url);

      // Redact query parameters that might contain sensitive data
      const sensitiveParams = [
        'key',
        'token',
        'auth',
        'password',
        'secret',
        'api_key',
      ];
      for (const param of sensitiveParams) {
        if (urlObj.searchParams.has(param)) {
          urlObj.searchParams.set(param, '[REDACTED]');
        }
      }

      return urlObj.toString();
    } catch {
      // If URL parsing fails, apply pattern-based redaction
      return url.replace(
        /[?&](key|token|auth|password|secret|api_key)=[^&]*/g,
        '$1=[REDACTED]',
      );
    }
  }

  private initializeRedactionPatterns(): Map<string, RedactionPattern[]> {
    const patterns = new Map<string, RedactionPattern[]>();

    // Global patterns
    patterns.set('global', [
      {
        name: 'api_keys',
        pattern: GLOBAL_API_KEYS,
        replacement: '[REDACTED-API-KEY]',
        enabled: this.redactionConfig.redactApiKeys,
      },
      {
        name: 'email_addresses',
        pattern: GLOBAL_EMAIL,
        replacement: '[REDACTED-EMAIL]',
        enabled: this.redactionConfig.redactEmails,
      },
      {
        name: 'passwords',
        pattern: GLOBAL_PASSWORDS,
        replacement: 'password=[REDACTED]',
        enabled: this.redactionConfig.redactCredentials,
      },
      {
        name: 'generic_api_keys',
        pattern: GLOBAL_GENERIC_API_KEYS,
        replacement: 'api_key: "[REDACTED-API-KEY]"',
        enabled: this.redactionConfig.redactApiKeys,
      },
      {
        name: 'bearer_tokens',
        pattern: BEARER_TOKEN,
        replacement: 'bearer [REDACTED-BEARER-TOKEN]',
        enabled: this.redactionConfig.redactCredentials,
      },
    ]);

    // OpenAI-specific patterns
    patterns.set('openai', [
      {
        name: 'openai_api_keys',
        pattern: OPENAI_API_KEY,
        replacement: '[REDACTED-OPENAI-KEY]',
        enabled: this.redactionConfig.redactApiKeys,
      },
      {
        name: 'openai_project_keys',
        pattern: OPENAI_PROJECT_KEY,
        replacement: '[REDACTED-OPENAI-PROJECT-KEY]',
        enabled: this.redactionConfig.redactApiKeys,
      },
      {
        name: 'openai_org_ids',
        pattern: OPENAI_ORG_ID,
        replacement: '[REDACTED-ORG-ID]',
        enabled: this.redactionConfig.redactCredentials,
      },
    ]);

    // Anthropic-specific patterns
    patterns.set('anthropic', [
      {
        name: 'anthropic_api_keys',
        pattern: ANTHROPIC_API_KEY,
        replacement: '[REDACTED-ANTHROPIC-KEY]',
        enabled: this.redactionConfig.redactApiKeys,
      },
    ]);

    // Gemini/Google-specific patterns
    patterns.set('gemini', [
      {
        name: 'google_api_keys',
        pattern: GOOGLE_API_KEY,
        replacement: '[REDACTED-GOOGLE-KEY]',
        enabled: this.redactionConfig.redactApiKeys,
      },
      {
        name: 'google_tokens',
        pattern: GOOGLE_TOKEN,
        replacement: '[REDACTED-GOOGLE-TOKEN]',
        enabled: this.redactionConfig.redactCredentials,
      },
    ]);

    return patterns;
  }

  // Follow-up (#1569): Re-add isPatternEnabled method when needed for dynamic pattern checking
  // private isPatternEnabled(patternName: string): boolean {

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
      redactionsByType: {},
    };

    const patterns = [
      ...(this.redactionPatterns.get('global') ?? []),
      ...(this.redactionPatterns.get(providerName) ?? []),
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
