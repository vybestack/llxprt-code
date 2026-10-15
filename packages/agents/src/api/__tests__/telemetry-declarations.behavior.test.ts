/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { AgentConfigSchema } from '../config-schema.js';
import { toConfigParameters } from '../agentConfig.adapter.js';

describe('preferred host telemetry declarations', () => {
  it('captures complete privacy, file and performance policy without losing executable regular-expression data', () => {
    const input = {
      provider: 'openai',
      model: 'declaration-model',
      telemetry: {
        enabled: false,
        logApiBodies: true,
        logApiBodyMaxChars: 1024,
        outfileMaxBytes: 2048,
        outfileMaxFiles: 3,
        logConversations: true,
        logResponses: true,
        redactFilePaths: true,
        redactUrls: true,
        redactEmails: true,
        redactPersonalInfo: true,
        maxConversationHistory: 4,
        conversationLogPath: 'private-log',
        maxLogFiles: 5,
        maxLogSizeMB: 6,
        retentionDays: 7,
        enableDataRetention: true,
        conversationExpirationDays: 8,
        maxConversationsStored: 9,
        customRedactionPatterns: [
          {
            name: 'account',
            pattern: /account-\d+/gi,
            replacement: '[private]',
            enabled: true,
          },
        ],
        perf: { enabled: true, memory: true },
      },
    };
    const parsed = AgentConfigSchema.parse(input);
    const params = toConfigParameters({
      provider: parsed.provider,
      model: parsed.model,
      telemetry: parsed.telemetry,
    });
    input.telemetry.perf.memory = false;
    input.telemetry.customRedactionPatterns[0].replacement = '[later]';
    expect(params.telemetry?.perf).toStrictEqual({
      enabled: true,
      memory: true,
    });
    expect(params.telemetry?.logApiBodyMaxChars).toBe(1024);
    expect(params.telemetry?.redactFilePaths).toBe(true);
    expect(params.telemetry?.conversationExpirationDays).toBe(8);
    const captured = params.telemetry?.customRedactionPatterns?.[0];
    if (!captured) throw new Error('Missing captured redaction');
    expect(
      'Account-123 public'.replace(captured.pattern, captured.replacement),
    ).toBe('[private] public');
  });
});
