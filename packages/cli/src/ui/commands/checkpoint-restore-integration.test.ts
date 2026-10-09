/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import { writeFile, readFile } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import {
  withCheckpoint,
  saveCheckpoint,
  savedCheckpoint,
  checkpointTool,
} from '../hooks/agentStream/checkpoint-disk-test-helpers.js';
import { restoreCommand } from './restoreCommand.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { GitService } from '@vybestack/llxprt-code-core/services/gitService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';

async function oversized(): Promise<number> {
  return withCheckpoint(
    1,
    false,
    async (fixture, dir) => {
      await saveCheckpoint(fixture, dir);
      const saved = await savedCheckpoint(dir);
      vi.spyOn(
        fixture.config.storage,
        'getProjectTempCheckpointsDir',
      ).mockReturnValue(dir);
      vi.spyOn(fixture.config, 'getCheckpointingEnabled').mockReturnValue(true);
      const client = fixture.config.getAgentClient();
      const owners = new RowOwnership();
      const admit = client.setHistoryFromSource.bind(client);
      vi.spyOn(client, 'setHistoryFromSource').mockImplementation(
        (source, options) => admit(source, { ...options, ownership: owners }),
      );
      const context = createMockCommandContext();
      context.services.config = fixture.config;
      try {
        expect(
          await restoreCommand(fixture.config)?.action?.(
            context,
            basename(saved.path),
          ),
        ).toMatchObject({
          type: 'tool',
          toolName: checkpointTool.request.name,
        });
        let count = 0;
        for await (const row of client.streamHistory()) {
          const block = row.blocks[0];
          if (block.type !== 'text')
            throw new Error('Expected large text block');
          expect(block.text.length).toBe(9 * 1024 * 1024 + 2);
          count++;
        }
        expect(owners.snapshot().peakRows).toBeLessThanOrEqual(2);
        expect(owners.snapshot().peakSerializedBytes).toBeGreaterThan(
          9 * 1024 * 1024,
        );
        expect(owners.snapshot().liveRows).toBe(0);
        expect(await readFile(saved.path, 'utf8')).toBe(saved.bytes);
        return count;
      } finally {
        vi.restoreAllMocks();
      }
    },
    9 * 1024 * 1024,
  );
}

async function compatibleRestore(active: boolean): Promise<string> {
  return withCheckpoint(2, active, async (fixture, dir) => {
    const row: IContent = {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'legacy native text\n雪🐈\ud800' },
        {
          type: 'thinking',
          thought: 'reasoning',
          signature: 'saved-signature',
        },
      ],
      metadata: {
        model: 'old-model',
        provider: 'old-provider',
        chronology: { seq: 99, userTurn: 20, step: 2, recordedAt: 101 },
      },
    };
    const history = [{ type: 'user', text: 'do a thing' }];
    const checkpoint = {
      version: 1,
      history,
      clientHistory: [row],
      messageId: 'old-message-id',
      filePath: '/project/old.ts',
      commitHash: 'abcdef123',
      toolCall: { name: 'run_shell_command', args: 'ls' },
    };
    const path = join(dir, 'legacy.json');
    const encoded = JSON.stringify(checkpoint, null, 2);
    await writeFile(path, encoded);
    vi.spyOn(
      fixture.config.storage,
      'getProjectTempCheckpointsDir',
    ).mockReturnValue(dir);
    vi.spyOn(fixture.config, 'getCheckpointingEnabled').mockReturnValue(true);
    const context = createMockCommandContext();
    context.services.config = fixture.config;
    let loaded: unknown;
    context.ui.loadHistory = (rows) => {
      loaded = rows;
    };
    const snapshots: string[] = [];
    const git = new GitService(fixture.root, fixture.config.storage);
    vi.spyOn(git, 'restoreProjectFromSnapshot').mockImplementation(
      async (hash) => {
        snapshots.push(hash);
      },
    );
    context.services.git = git;
    const cwd = resolve(import.meta.dir, '../../..');
    try {
      const outcome: unknown = await restoreCommand(fixture.config)?.action?.(
        context,
        'legacy',
      );
      expect(outcome).toStrictEqual({
        type: 'tool',
        toolName: 'run_shell_command',
        toolArgs: 'ls',
      });
      expect(loaded).toStrictEqual(history);
      expect(snapshots.length).toBe(1);
      const actual: IContent[] = [];
      for await (const restored of fixture.config
        .getAgentClient()
        .streamHistory())
        actual.push(restored);
      expect(actual).toStrictEqual([row]);
      expect(process.cwd()).toBe(cwd);
      expect(await readFile(path, 'utf8')).toBe(encoded);
      return snapshots[0];
    } finally {
      vi.restoreAllMocks();
    }
  });
}

describe('CLI checkpoint restoration compatibility contracts', () => {
  it('restores a saved nine-MiB native row without a byte gate or uncharged ownership', async () => {
    expect(await oversized()).toBe(1);
  }, 180000);
  it.each([false, true])(
    'preserves old snapshot metadata, string tool arguments, signatures and project cwd, active=%s',
    async (active) => {
      expect(await compatibleRestore(active)).toBe('abcdef123');
    },
    180000,
  );
});
