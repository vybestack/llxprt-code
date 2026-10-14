/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createMemoryCommand } from './memoryCommand.js';

describe('registered memory command owner', () => {
  it('shows memory from its bound runtime, not the invocation context', async () => {
    const history: Array<{ text: string }> = [];
    const command = createMemoryCommand({
      isConfigured: true,
      getUserMemory: () => 'registered memory',
      getLlxprtMdFileCount: () => 3,
      getLlxprtMdFilePaths: () => [],
      refreshMemory: async () => ({
        memoryContent: 'registered memory',
        fileCount: 3,
        filePaths: [],
      }),
      updateSystemInstruction: async () => {},
      addItem: (item) => history.push({ text: item.text ?? '' }),
      setMemoryFileCount: () => {},
      saveCoreMemory: async () => {},
    });
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), memoryCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const memory = registry
      .getCommands()
      .find((candidate) => candidate.name === 'memory');
    const show = memory?.subCommands?.find(
      (candidate) => candidate.name === 'show',
    );
    if (!show?.action) throw new Error('Memory show command is unavailable');

    await show.action(
      createMockCommandContext({
        services: {
          config: {
            getUserMemory: () => 'invocation memory',
            getLlxprtMdFileCount: () => 99,
          },
        },
      }),
      '',
    );

    expect(history).toStrictEqual([
      {
        text: 'Current memory content from 3 file(s):\n\n---\nregistered memory\n---',
      },
    ]);
  });
});
