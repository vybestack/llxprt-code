/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createExtensionsCommand } from './extensionsCommand.js';
import { bindExtensionsCommand } from './extensionsCommandHost.js';
import type { HistoryItem } from '../types.js';

function extension(
  name: string,
  path: string,
  isActive: boolean,
): LlxprtExtension {
  return { name, path, isActive, version: '1.0.0', contextFiles: [] };
}

describe('registered extension command owner', () => {
  const makeOwner = useCommandOwners();

  it('restarts the registered catalog once and filters completion without invocation services', async () => {
    const owner = await makeOwner('owner');
    const directory = owner.workspace.getWorkingDirectory();
    const marker = join(directory, 'restart.txt');
    await writeFile(marker, '');
    const catalog = [
      extension('active-owner', directory, true),
      extension('inactive-owner', directory, false),
    ];
    const history: Array<Omit<HistoryItem, 'id'>> = [];
    const context = createMockCommandContext({
      services: {
        agent: owner,
        config: {
          getExtensions: () => catalog,
          restartExtension: async (entry: LlxprtExtension) => {
            const previous = await readFile(marker, 'utf8');
            await writeFile(marker, `${previous}${entry.name}\n`);
          },
        },
      },
    });
    const command = createExtensionsCommand(
      bindExtensionsCommand(
        context.services.config,
        (item) => history.push(item),
        () => {},
        () => {},
      ),
    );
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), extensionsCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const restart = registry
      .getCommands()
      .find((entry) => entry.name === 'extensions')
      ?.subCommands?.find((entry) => entry.name === 'restart');
    if (!restart?.action || !restart.completion)
      throw new Error('Restart command unavailable');
    const invocation = createMockCommandContext({
      services: { agent: null, config: null },
    });

    expect(await restart.completion(invocation, '')).toStrictEqual([
      'active-owner',
    ]);
    await restart.action(invocation, '--all');

    expect(await readFile(marker, 'utf8')).toBe('active-owner\n');
    expect(
      history.some(
        (item) => 'text' in item && item.text === 'Restarting 1 extension...',
      ),
    ).toBe(true);
  });
});
