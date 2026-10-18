/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { SubagentManager } from '@vybestack/llxprt-code-core';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { registerSubagentCommand } from '../../__tests__/subagent-command-test-owner.js';
import { createCompletionHandler } from './schema/index.js';

describe('registered subagent owner', () => {
  const makeOwner = useCommandOwners();

  it('persists the registered definition and completes its catalog without consulting invocation services', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    const profiles = new ProfileManager(
      join(owner.workspace.getWorkingDirectory(), 'profiles'),
    );
    const definitions = new SubagentManager(
      join(owner.workspace.getWorkingDirectory(), 'subagents'),
      profiles,
    );
    const otherProfiles = new ProfileManager(
      join(sibling.workspace.getWorkingDirectory(), 'profiles'),
    );
    const otherDefinitions = new SubagentManager(
      join(sibling.workspace.getWorkingDirectory(), 'subagents'),
      otherProfiles,
    );
    await profiles.saveProfile('registered', owner.captureProfile());
    const context = createMockCommandContext({
      services: {
        agent: owner,
        subagentManager: definitions,
        profileManager: profiles,
      },
    });
    const command = registerSubagentCommand(context);
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), subagentCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const registered = registry
      .getCommands()
      .find((entry) => entry.name === 'subagent');
    const save = registered?.subCommands?.find(
      (entry) => entry.name === 'save',
    );
    const edit = registered?.subCommands?.find(
      (entry) => entry.name === 'edit',
    );
    if (!save?.action || !edit?.schema)
      throw new Error('Subagent commands unavailable');
    const invocation = createMockCommandContext({
      services: {
        agent: sibling,
        subagentManager: otherDefinitions,
        profileManager: otherProfiles,
      },
    });
    const result = await save.action(
      invocation,
      'reviewer registered manual "Review ownership and disposal"',
    );
    expect(result).toMatchObject({ type: 'message', messageType: 'info' });
    expect(await definitions.loadSubagent('reviewer')).toMatchObject({
      profile: 'registered',
      systemPrompt: 'Review ownership and disposal',
    });
    expect(await otherDefinitions.listSubagents()).toStrictEqual([]);
    const completion = await createCompletionHandler(edit.schema, true)(
      invocation,
      { args: '', completedArgs: [], partialArg: '', commandPathLength: 2 },
      '/subagent edit ',
    );
    expect(completion.suggestions).toStrictEqual([
      { value: 'reviewer', description: 'Profile: registered' },
    ]);
  });
});
