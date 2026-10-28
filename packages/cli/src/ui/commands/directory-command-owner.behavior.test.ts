/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createDirectoryCommand } from './directoryCommand.js';

describe('registered directory command owner', () => {
  it('shows directories from its bound workspace, not the invocation context', async () => {
    const history: Array<{ text: string }> = [];
    const command = createDirectoryCommand({
      isConfigured: true,
      addDirectory: () => {},
      directories: () => ['/workspace/registered'],
      getFolderTrust: () => false,
      isRestrictiveSandbox: () => false,
      refreshMemory: async () => ({
        memoryContent: '',
        fileCount: 0,
        filePaths: [],
      }),
      shouldLoadMemoryFromIncludeDirectories: () => false,
      addItem: (item) => history.push({ text: item.text ?? '' }),
      setMemoryFileCount: () => {},
      addDirectoryContext: async () => {},
      recordDirectoriesChanged: () => {},
    });
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), directoryCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const directory = registry
      .getCommands()
      .find((candidate) => candidate.name === 'directory');
    const show = directory?.subCommands?.find(
      (candidate) => candidate.name === 'show',
    );
    if (!show?.action) throw new Error('Directory show command is unavailable');

    await show.action(
      createMockCommandContext({
        services: {
          config: {
            directories: () => ['/workspace/invocation'],
          },
        },
      }),
      '',
    );

    expect(history).toStrictEqual([
      { text: 'Current workspace directories:\n- /workspace/registered' },
    ]);
  });
});
