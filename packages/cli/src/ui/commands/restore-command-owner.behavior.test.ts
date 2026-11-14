import { readJournalItems } from '../stores/turn/read-journal-items.js';
import { collectResumeRows } from '../../__tests__/resumeRows.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createRestoreCommand } from './restoreCommand.js';

describe('registered restore command owner', () => {
  const makeOwner = useCommandOwners();

  it('restores the registered Agent history instead of the invocation Agent history', async () => {
    const owner = await makeOwner('owner');
    const decoy = await makeOwner('decoy');
    await owner.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'owner before' }] },
    ]);
    await decoy.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'decoy history' }] },
    ]);
    const decoyBefore = await collectResumeRows(decoy.streamHistory());
    expect(decoyBefore).toMatchObject([
      { speaker: 'human', blocks: [{ type: 'text', text: 'decoy history' }] },
    ]);
    const checkpointDirectory = await mkdtemp(join(tmpdir(), 'restore-owner-'));
    const restoredUiHistory = [
      { type: 'user' as const, text: 'owner restored' },
    ];
    const restoredHistory = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'owner restored' }],
      },
    ];

    await owner.session.setRecording({ enabled: true });
    try {
      await mkdir(checkpointDirectory, { recursive: true });
      await writeFile(
        join(checkpointDirectory, 'owner-state.json'),
        JSON.stringify({
          history: restoredUiHistory,
          clientHistory: restoredHistory,
          toolCall: { name: 'read_file', args: { file_path: 'notes.txt' } },
        }),
      );
      const command = createRestoreCommand(
        {
          enabled: true,
          checkpointDirectory,
          replaceHistoryFromSource: owner.session.replaceHistoryFromSource.bind(
            owner.session,
          ),
          git: undefined,
        },
        () => true,
      );
      if (!command?.action) throw new Error('Restore command is unavailable');
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            { ...createUnconfiguredBuiltinOwners(), restoreCommand: command },
            null,
          ),
        ],
        new AbortController().signal,
      );
      const registered = registry
        .getCommands()
        .find((item) => item.name === 'restore');
      if (!registered?.action)
        throw new Error('Restore command is unavailable');

      const result = await registered.action(
        createMockCommandContext({ services: { agent: decoy } }),
        'owner-state',
      );

      expect(result).toStrictEqual({
        type: 'tool',
        toolName: 'read_file',
        toolArgs: { file_path: 'notes.txt' },
      });
      expect(await collectResumeRows(owner.streamHistory())).toMatchObject([
        { blocks: [{ text: 'owner restored' }] },
      ]);
      const ownerUiHistory = (await readJournalItems(owner, 64, true)).map(
        (item) => ({
          type: item.type,
          ...('text' in item ? { text: item.text } : {}),
        }),
      );
      expect(ownerUiHistory).toStrictEqual(restoredUiHistory);
      expect(await collectResumeRows(decoy.streamHistory())).toStrictEqual(
        decoyBefore,
      );
    } finally {
      await rm(checkpointDirectory, { recursive: true, force: true });
    }
  });
});
