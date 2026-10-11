/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import type { ConversationRequestEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
import { logConversationRequestEntry } from './conversationLogger.js';

describe('conversation request tool persistence', () => {
  it('groups flat declarations only on output and preserves schemas and missing versus empty tools', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'issue3694-logger-'));
    resetConversationFileWriterForTesting();
    const events: ConversationRequestEvent[] = [];
    try {
      const config: ProviderRequestDiagnostics = {
        conversationLoggingEnabled: true,
        conversationLogPath: dir,
        redaction: {
          redactApiKeys: false,
          redactCredentials: false,
          redactFilePaths: false,
          redactUrls: false,
          redactEmails: false,
          redactPersonalInfo: false,
        },
        recordApiError: () => undefined,
        recordApiRequest: () => undefined,
        recordApiResponse: () => undefined,
        recordTokenUsage: () => undefined,
        recordConversationRequest: (event) => {
          events.push(event);
        },
        recordConversationResponse: () => undefined,
      };
      const ctx = {
        providerName: 'test',
        conversationId: 'conversation',
        turnNumber: 1,
        generatePromptId: (): string => 'prompt',
        redactor: null,
      };
      await logConversationRequestEntry(
        config,
        [],
        [
          {
            name: 'search',
            description: '',
            parametersJsonSchema: {
              type: 'object',
              properties: { q: { type: 'string' } },
            },
          },
          { name: 'denied', parametersJsonSchema: false },
        ],
        undefined,
        ctx,
      );
      await logConversationRequestEntry(config, [], [], undefined, ctx);
      await logConversationRequestEntry(config, [], undefined, undefined, ctx);
      const files = await readdir(dir);
      const logName = files.find((file) => file.endsWith('.jsonl'));
      if (logName === undefined)
        throw new Error('No conversation request was persisted');
      const entries: unknown[] = (await readFile(join(dir, logName), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(entries[0]).toMatchObject({
        type: 'request',
        context: {
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'search',
                  description: '',
                  parametersJsonSchema: {
                    type: 'object',
                    properties: { q: { type: 'string' } },
                  },
                },
                { name: 'denied', parametersJsonSchema: false },
              ],
            },
          ],
        },
      });
      expect(entries[1]).toMatchObject({
        context: { tools: [{ functionDeclarations: [] }] },
      });
      expect(events[1].redacted_tools).toStrictEqual([
        { functionDeclarations: [] },
      ]);
      expect(events[0].redacted_tools).toHaveLength(1);
      expect(events[0].redacted_tools?.[0].functionDeclarations).toHaveLength(
        2,
      );
      expect(entries[2]).toMatchObject({ context: { promptId: 'prompt' } });
      expect(entries[2]).not.toHaveProperty('context.tools');
      expect(events[2].redacted_tools).toBeUndefined();
    } finally {
      resetConversationFileWriterForTesting();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
