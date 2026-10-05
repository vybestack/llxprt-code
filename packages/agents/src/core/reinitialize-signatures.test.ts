/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { transferHistoryToNewClient } from '@vybestack/llxprt-code-core/config/agentClientLifecycle.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { AgentClient } from './client.js';
import {
  withReinitializeHistory,
  reinitializeConfig,
} from './reinitialize-history-test-helpers.js';

function signatureRow(): IContent {
  return {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'reasoning bytes',
        signature: 'signed-history',
      },
      { type: 'text', text: 'visible bytes' },
      {
        type: 'media',
        encoding: 'url',
        mimeType: 'image/png',
        data: 'https://example.com/image.png',
        caption: 'media bytes',
      },
    ],
    metadata: {
      model: 'original-model',
      chronology: { seq: 1, userTurn: 1, step: 0, recordedAt: 0 },
    },
  };
}

async function firstSignatureRow(
  stream: AsyncGenerator<IContent, void, unknown>,
): Promise<IContent> {
  const first = await stream.next();
  if (first.done === true) throw new Error('Missing transferred signature row');
  return first.value;
}

for (const previousVertexai of [false, true]) {
  describe(`signature stream with previous Vertex=${previousVertexai}`, () => {
    it('removes signatures only for GenAI to Vertex and preserves all other row bytes', async () => {
      await withReinitializeHistory(
        1,
        async (_old, _source, owners, config) => {
          const receiver = new AgentClient(
            config,
            createAgentRuntimeState({
              runtimeId: randomUUID(),
              provider: 'fake',
              model: 'fake-model',
            }),
          );
          const row = signatureRow();
          async function* source(): AsyncGenerator<IContent, void, unknown> {
            yield row;
          }
          try {
            const transferred = await transferHistoryToNewClient(
              new DebugLogger('signature-test'),
              receiver,
              source(),
              null,
              { ...reinitializeConfig(config), vertexai: true },
              previousVertexai,
              { ownership: owners },
            );
            expect(transferred).toBe(1);
            const stream = receiver.streamHistory();
            try {
              const first = await firstSignatureRow(stream);
              expect(first).toStrictEqual({
                ...row,
                blocks: [
                  previousVertexai
                    ? row.blocks[0]
                    : { type: 'thinking', thought: 'reasoning bytes' },
                  row.blocks[1],
                  row.blocks[2],
                ],
              });
              expect((await stream.next()).done).toBe(true);
            } finally {
              await stream.return();
            }
            expect(row.blocks[0]).toStrictEqual({
              type: 'thinking',
              thought: 'reasoning bytes',
              signature: 'signed-history',
            });
            expect(owners.snapshot().liveRows).toBe(0);
          } finally {
            await receiver.dispose();
          }
        },
      );
    });
  });
}
