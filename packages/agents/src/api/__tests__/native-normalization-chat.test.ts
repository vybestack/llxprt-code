/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import {
  buildAgent,
  drain,
  internalAgentClient,
} from './helpers/agentHarness.js';
import { collectAgentHistory } from './helpers/collect-agent-history.js';
import { useNativePrefixBackend } from './helpers/native-prefix-backend.js';
import { operationFileCreates } from '../../compression/__tests__/support/operation-file-creates.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';

describe('native normalization through public chat', () => {
  function normalizationCreationGuard(
    original: typeof fs.mkdtempSync,
  ): typeof fs.mkdtempSync {
    function guarded(prefix: string, options?: fs.EncodingOption): string;
    function guarded(
      prefix: string,
      options: fs.BufferEncodingOption,
    ): Buffer<ArrayBuffer>;
    function guarded(
      prefix: string,
      options?: fs.EncodingOption | fs.BufferEncodingOption,
    ): string | Buffer<ArrayBuffer> {
      if (String(prefix).includes('provider-normalization-'))
        throw new Error('Native normalization allocated scratch');
      const encoding =
        typeof options === 'object' ? options?.encoding : options;
      return encoding === 'buffer'
        ? original(prefix, 'buffer')
        : original(prefix, encoding);
    }
    return guarded;
  }

  useNativePrefixBackend();
  const directory = useTempDir('native-normalization-chat-');
  it.each([false, true])(
    'commits the model response without normalization files with purge=%s',
    async (purge) => {
      const { agent, cleanup } = await buildAgent('multi-turn-text.jsonl', {
        workingDir: directory(),
      });
      try {
        await drain(agent.stream('initialize session'));
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'question' },
              {
                type: 'media',
                mimeType: 'image/png',
                encoding: 'base64',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=',
              },
              { type: 'tool_call', id: 'cross', name: 'read', parameters: {} },
            ],
          },
          {
            speaker: 'ai',
            blocks: [
              { type: 'tool_call', id: 'cross', name: 'read', parameters: {} },
              { type: 'tool_call', id: 'orphan', name: 'read', parameters: {} },
            ],
          },
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'cross',
                toolName: 'read',
                result: 'answer',
                isComplete: true,
              },
            ],
          },
        ]);
        if (purge) {
          await agent.session.setRecording({ enabled: true });
          agent.setEphemeralSetting('media.semantic-purge', 'remove');
        }
        const history = internalAgentClient(agent).getHistoryService();
        if (history === null) throw new Error('Missing native public history');
        const createDirectory = fs.mkdtempSync;
        const denyNormalization = spyOn(fs, 'mkdtempSync').mockImplementation(
          normalizationCreationGuard(createDirectory),
        );
        try {
          const receipt = await operationFileCreates(async () => {
            await drain(agent.stream('continue'));
            await history.waitForCommit();
          });
          expect(
            receipt.files.map((path) =>
              /\/media-live\/[^/]+\/locks\/store\.lock$/.test(path),
            ),
          ).toStrictEqual(purge ? [true] : []);
          expect(
            receipt.directories.filter((path) =>
              path.includes('provider-normalization-'),
            ),
          ).toStrictEqual([]);
        } finally {
          denyNormalization.mockRestore();
        }
        const rows = await collectAgentHistory(agent);
        expect(rows[0].blocks.some((block) => block.type === 'media')).toBe(
          !purge,
        );
        expect(rows[0].metadata?.semanticMediaPurgeFrontier !== undefined).toBe(
          purge,
        );
        const last = rows[rows.length - 1];
        expect(last.speaker).toBe('ai');
        expect(
          last.blocks.some(
            (block) => block.type === 'text' && block.text.length > 0,
          ),
        ).toBe(true);
      } finally {
        await cleanup();
      }
    },
  );
});
