/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import * as telemetryLoggers from '@vybestack/llxprt-code-core/telemetry/loggers.js';
import type { ConversationRequestEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
import {
  logConversationRequestEntry,
  type ConversationLogContext,
} from './conversationLogger.js';

async function logToolCases(
  config: Config,
  ctx: ConversationLogContext,
): Promise<void> {
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
}

function assertToolSchemas(
  entries: unknown[],
  events: ConversationRequestEvent[],
): void {
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
  expect(events[0].redacted_tools?.[0].functionDeclarations).toHaveLength(2);
  expect(entries[2]).toMatchObject({ context: { promptId: 'prompt' } });
  expect(entries[2]).not.toHaveProperty('context.tools');
  expect(events[2].redacted_tools).toBeUndefined();
}

describe('conversation request tool persistence', () => {
  it('groups flat declarations only on output and preserves schemas and missing versus empty tools', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'issue3694-logger-'));
    resetConversationFileWriterForTesting();
    const events: ConversationRequestEvent[] = [];
    const sink = vi
      .spyOn(telemetryLoggers, 'logConversationRequest')
      .mockImplementation(async (_config, event): Promise<void> => {
        events.push(event);
      });
    try {
      const config = new Config({
        cwd: dir,
        targetDir: dir,
        debugMode: false,
        sessionId: 'logger-test',
        model: 'test-model',
        telemetry: { enabled: false, conversationLogPath: dir },
      });
      const ctx = {
        providerName: 'test',
        conversationId: 'conversation',
        turnNumber: 1,
        generatePromptId: (): string => 'prompt',
        redactor: null,
      };
      await logToolCases(config, ctx);
      const files = await readdir(dir);
      const logName = files.find(
        (file) => file.startsWith('conversation-') && file.endsWith('.jsonl'),
      );
      if (logName === undefined)
        throw new Error('No conversation request was persisted');
      const entries: unknown[] = (await readFile(join(dir, logName), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(entries).toHaveLength(3);
      assertToolSchemas(entries, events);
      for (const event of events) {
        const artifact = event.request_artifact;
        const bytes = await readFile(artifact.artifact_path);
        expect(JSON.parse(bytes.toString('utf8'))).toMatchObject({
          messages: [],
          context: {
            promptId: 'prompt',
            conversationId: 'conversation',
            turnNumber: 1,
          },
        });
        expect(
          bytes
            .subarray(
              artifact.content_offset,
              artifact.content_offset + artifact.content_bytes,
            )
            .toString('utf8'),
        ).toBe('[]');
        expect(artifact.row_count).toBe(0);
      }
    } finally {
      sink.mockRestore();
      resetConversationFileWriterForTesting();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
