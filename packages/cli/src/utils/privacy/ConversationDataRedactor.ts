/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IMessage, ITool } from '@vybestack/llxprt-code-core';

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
      ...config,
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

    // Content is always a string in IMessage
    redactedMessage.content = this.redactContent(
      redactedMessage.content,
      providerName,
    );

    // Redact tool_calls if present
    if (redactedMessage.tool_calls) {
      redactedMessage.tool_calls = redactedMessage.tool_calls.map((call) => ({
        ...call,
        function: {
          ...call.function,
          arguments: this.redactContent(call.function.arguments, providerName),
        },
      }));
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

    // Handle both ITool interface and test format
    if (
      redactedTool.function &&
      redactedTool.function.parameters &&
      tool.function.name
    ) {
      redactedTool.function.parameters = this.redactToolParameters(
        redactedTool.function.parameters,
        tool.function.name,
      ) as object;
    } else if (
      (redactedTool as unknown as Record<string, unknown>).parameters &&
      (tool as unknown as Record<string, unknown>).name
    ) {
      // Handle test format that doesn't match ITool interface
      (redactedTool as unknown as Record<string, unknown>).parameters =
        this.redactToolParameters(
          (redactedTool as unknown as Record<string, unknown>).parameters,
          (tool as unknown as Record<string, unknown>).name as string,
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
  redactConversation(messages: IMessage[], providerName: string): IMessage[] {
    return messages.map((message) => this.redactMessage(message, providerName));
  }

  /**
   * Redact API keys from content based on provider
   */
  redactApiKeys(content: string, providerName: string): string {
    let redacted = content;

    // Apply provider-specific and global API key patterns
    const providerPatterns = this.redactionPatterns.get(providerName) || [];
    const globalPatterns = this.redactionPatterns.get('global') || [];

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
    redacted = redacted.replace(
      /\/[^"\s]*\.ssh\/[^"\s]*/g,
      '[REDACTED-SSH-PATH]',
    );
    redacted = redacted.replace(
      /\/[^"\s]*\/id_rsa[^"\s]*/g,
      '[REDACTED-SSH-KEY-PATH]',
    );

    // Environment files
    redacted = redacted.replace(
      /\/[^"\s]*\.env[^"\s]*/g,
      '[REDACTED-ENV-FILE]',
    );

    // Configuration directories
    redacted = redacted.replace(/\/home\/[^/\s"]+/g, '[REDACTED-HOME-DIR]');
    redacted = redacted.replace(/\/Users\/[^/\s"]+/g, '[REDACTED-USER-DIR]');

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
    redacted = redacted.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '[REDACTED-EMAIL]',
    );

    // Phone numbers (basic patterns)
    redacted = redacted.replace(/\b\d{3}-\d{3}-\d{4}\b/g, '[REDACTED-PHONE]');
    redacted = redacted.replace(
      /\b\(\d{3}\)\s?\d{3}-\d{4}\b/g,
      '[REDACTED-PHONE]',
    );

    // Credit card numbers (basic pattern)
    redacted = redacted.replace(
      /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
      '[REDACTED-CC-NUMBER]',
    );

    return redacted;
  }

  private shouldRedact(): boolean {
    // Check if any redaction is enabled
    return Object.values(this.redactionConfig).some((value) => value === true);
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
      if (pattern.enabled) {
        redacted = redacted.replace(pattern.pattern, pattern.replacement);
      }
    }

    return redacted;
  }

  private redactContentPart(part: unknown, providerName: string): unknown {
    const redactedPart = { ...(part as Record<string, unknown>) };

    if (typeof part === 'object' && part !== null) {
      const partObj = part as Record<string, unknown>;
      if (partObj.text && typeof partObj.text === 'string') {
        redactedPart.text = this.redactContent(partObj.text, providerName);
      }

      if (partObj.functionCall) {
        const funcCall = partObj.functionCall as Record<string, unknown>;
        redactedPart.functionCall = {
          ...funcCall,
          args: this.redactToolParameters(
            funcCall.args,
            funcCall.name as string,
          ),
        };
      }
    }

    return redactedPart;
  }

  private redactToolParameters(params: unknown, toolName: string): unknown {
    if (!params || typeof params !== 'object') {
      return params;
    }

    const redacted = { ...(params as Record<string, unknown>) };

    // Apply tool-specific redaction rules
    switch (toolName) {
      case 'read_file':
      case 'write_file':
      case 'list_files':
        if (
          redacted.file_path &&
          typeof redacted.file_path === 'string' &&
          this.redactionConfig.redactFilePaths
        ) {
          redacted.file_path = this.redactFilePath(redacted.file_path);
        }
        break;

      case 'run_command':
      case 'shell':
        if (redacted.command && typeof redacted.command === 'string') {
          redacted.command = this.redactShellCommand(redacted.command);
        }
        break;

      case 'web_search':
      case 'fetch_url':
        if (
          redacted.url &&
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
        pattern: /\/home\/[^/]+\/\.ssh\/[^/]+/g,
        replacement: '[REDACTED-SSH-KEY-PATH]',
      },
      {
        pattern: /\/home\/[^/]+\/\.aws\/[^/]+/g,
        replacement: '[REDACTED-AWS-CONFIG-PATH]',
      },
      {
        pattern: /\/home\/[^/]+\/\.docker\/[^/]+/g,
        replacement: '[REDACTED-DOCKER-CONFIG-PATH]',
      },
      {
        pattern: /\/Users\/[^/]+\/\.ssh\/[^/]+/g,
        replacement: '[REDACTED-SSH-KEY-PATH]',
      },
      {
        pattern: /\/Users\/[^/]+\/\.aws\/[^/]+/g,
        replacement: '[REDACTED-AWS-CONFIG-PATH]',
      },
      { pattern: /.*\.env.*$/g, replacement: '[REDACTED-SENSITIVE-PATH]' },
      { pattern: /.*secret.*$/gi, replacement: '[REDACTED-SENSITIVE-PATH]' },
      { pattern: /.*key.*$/gi, replacement: '[REDACTED-SENSITIVE-PATH]' },
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
    redacted = redacted.replace(
      /export\s+[A-Z_]+\s*=\s*['"]\s*sk-[a-zA-Z0-9]+\s*['"]/g,
      'export [REDACTED-API-KEY]',
    );
    redacted = redacted.replace(
      /export\s+[A-Z_]+\s*=\s*['"]\s*[a-zA-Z0-9+/]+=*\s*['"]/g,
      'export [REDACTED-TOKEN]',
    );

    // Redact curl commands with authorization headers
    redacted = redacted.replace(
      /curl\s+.*-H\s+['"]Authorization:\s*Bearer\s+[^'"]+['"]/g,
      'curl [REDACTED-AUTH-HEADER]',
    );

    return redacted;
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
        pattern: /sk-[a-zA-Z0-9]{32,}/g,
        replacement: '[REDACTED-API-KEY]',
        enabled: this.redactionConfig.redactApiKeys,
      },
      {
        name: 'email_addresses',
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        replacement: '[REDACTED-EMAIL]',
        enabled: this.redactionConfig.redactEmails,
      },
      {
        name: 'passwords',
        pattern: /(?:password|pwd|pass)[=:\s]+[^\s\n\r]+/gi,
        replacement: 'password=[REDACTED]',
        enabled: this.redactionConfig.redactCredentials,
      },
      {
        name: 'generic_api_keys',
        pattern: /api[_-]?key["\s]*[:=]["\s]*[a-zA-Z0-9-_]{16,}/gi,
        replacement: 'api_key: "[REDACTED-API-KEY]"',
        enabled: this.redactionConfig.redactApiKeys,
      },
      {
        name: 'bearer_tokens',
        pattern: /bearer [a-zA-Z0-9-_.]{16,}/gi,
        replacement: 'bearer [REDACTED-BEARER-TOKEN]',
        enabled: this.redactionConfig.redactCredentials,
      },
    ]);

    // OpenAI-specific patterns
    patterns.set('openai', [
      {
        name: 'openai_api_keys',
        pattern: /sk-[a-zA-Z0-9]{40,51}/g,
        replacement: '[REDACTED-OPENAI-KEY]',
        enabled: this.redactionConfig.redactApiKeys,
      },
      {
        name: 'openai_project_keys',
        pattern: /sk-proj-[a-zA-Z0-9]{48}/g,
        replacement: '[REDACTED-OPENAI-PROJECT-KEY]',
        enabled: this.redactionConfig.redactApiKeys,
      },
      {
        name: 'openai_org_ids',
        pattern: /org-[a-zA-Z0-9]{24}/g,
        replacement: '[REDACTED-ORG-ID]',
        enabled: this.redactionConfig.redactCredentials,
      },
    ]);

    // Anthropic-specific patterns
    patterns.set('anthropic', [
      {
        name: 'anthropic_api_keys',
        pattern: /sk-ant-[a-zA-Z0-9\-_]{95}/g,
        replacement: '[REDACTED-ANTHROPIC-KEY]',
        enabled: this.redactionConfig.redactApiKeys,
      },
    ]);

    // Gemini/Google-specific patterns
    patterns.set('gemini', [
      {
        name: 'google_api_keys',
        pattern: /AIza[0-9A-Za-z\-_]{35}/g,
        replacement: '[REDACTED-GOOGLE-KEY]',
        enabled: this.redactionConfig.redactApiKeys,
      },
      {
        name: 'google_tokens',
        pattern: /ya29\.[0-9A-Za-z\-_]+/g,
        replacement: '[REDACTED-GOOGLE-TOKEN]',
        enabled: this.redactionConfig.redactCredentials,
      },
    ]);

    return patterns;
  }

  private isPatternEnabled(patternName: string): boolean {
    switch (patternName) {
      case 'api_keys':
      case 'generic_api_keys':
      case 'openai_api_keys':
      case 'openai_project_keys':
      case 'anthropic_api_keys':
      case 'google_api_keys':
        return this.redactionConfig.redactApiKeys;
      case 'email_addresses':
        return this.redactionConfig.redactEmails;
      case 'passwords':
      case 'bearer_tokens':
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
      redactionsByType: {},
    };

    const patterns = [
      ...(this.redactionPatterns.get('global') || []),
      ...(this.redactionPatterns.get(providerName) || []),
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
