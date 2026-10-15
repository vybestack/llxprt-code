/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createRestoreCommand } from './restoreCommand.js';
import { createCompletionHandler } from './schema/index.js';
import type { SlashCommand } from './types.js';

async function register(command: SlashCommand | null): Promise<SlashCommand> {
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
    .find((entry) => entry.name === 'restore');
  if (!registered) throw new Error('Missing registered restore command');
  return registered;
}

describe('registered completion filtering owner', () => {
  const makeOwner = useCommandOwners();

  it('filters static schema choices with the captured policy', async () => {
    const invocation = createMockCommandContext();
    const handler = createCompletionHandler(
      [{ kind: 'literal', value: 'production' }],
      false,
    );
    invocation.services.settings.merged.enableFuzzyFiltering = true;
    expect(
      (await handler(invocation, undefined, '/command prd')).suggestions,
    ).toStrictEqual([]);
  });

  it('keeps each registered filtering policy when invocation settings disagree', async () => {
    const owner = await makeOwner('prefix');
    const sibling = await makeOwner('fuzzy');
    const prefixDir = join(
      owner.workspace.getWorkingDirectory(),
      'checkpoints',
    );
    const fuzzyDir = join(
      sibling.workspace.getWorkingDirectory(),
      'checkpoints',
    );
    await Promise.all(
      [prefixDir, fuzzyDir].map(async (directory) => {
        await mkdir(directory);
        await writeFile(join(directory, 'production.json'), '{}');
      }),
    );
    const prefix = await register(
      createRestoreCommand(
        {
          enabled: true,
          restoreProjectSnapshot: undefined,
          checkpointDirectory: prefixDir,
          setClientHistory: (history) => owner.setHistory(history),
        },
        () => false,
        () => {},
        () => 0,
      ),
    );
    const fuzzy = await register(
      createRestoreCommand(
        {
          enabled: true,
          restoreProjectSnapshot: undefined,
          checkpointDirectory: fuzzyDir,
          setClientHistory: (history) => sibling.setHistory(history),
        },
        () => true,
        () => {},
        () => 0,
      ),
    );
    if (!prefix.schema || !fuzzy.schema)
      throw new Error('Missing restore schema');
    const invocation = createMockCommandContext();
    invocation.services.settings.merged.enableFuzzyFiltering = true;
    const prefixResult = await createCompletionHandler(prefix.schema, true)(
      invocation,
      undefined,
      '/restore prd',
    );
    expect(prefixResult.suggestions).toStrictEqual([]);
    await owner.dispose();
    invocation.services.settings.merged.enableFuzzyFiltering = false;
    const fuzzyResult = await createCompletionHandler(fuzzy.schema, true)(
      invocation,
      undefined,
      '/restore prd',
    );
    expect(fuzzyResult.suggestions.map((entry) => entry.value)).toContain(
      'production',
    );
    expect(await sibling.agentClient.getHistory()).toStrictEqual([]);
  });
});
