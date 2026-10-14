/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createHooksCommand } from './hooksCommand.js';
import { createTaskCommand } from './tasksCommand.js';
import { bindHooksCommand, bindTaskCommand } from './hookTaskCommandHost.js';
import type { HistoryItemWithoutId } from '../types.js';

describe('registered hook and task command owners', () => {
  const makeOwner = useCommandOwners();

  it('reads the bound session hooks and tasks with invocation services absent', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    const history: HistoryItemWithoutId[] = [];
    const addItem = (item: HistoryItemWithoutId): number => history.push(item);
    const config = createMockCommandContext({
      services: {
        config: {
          getEnableHooksUI: () => true,
          isSkillsSupportEnabled: () => false,
          getProjectTempDir: () => owner.workspace.getWorkingDirectory(),
        },
      },
    }).services.config;
    if (config === null) throw new Error('Fixture config unavailable');
    const loader = new BuiltinCommandLoader(
      {
        ...createUnconfiguredBuiltinOwners(),
        hooksCommand: createHooksCommand(
          bindHooksCommand(owner, true),
          addItem,
        ),
        taskCommand: createTaskCommand(bindTaskCommand(owner), addItem),
      },
      config,
    );
    loader.loadCommandsSync();
    const registry = await CommandService.create(
      [loader],
      new AbortController().signal,
    );
    const invocation = createMockCommandContext({
      services: { agent: null, config: null },
    });
    const commands = registry.getCommands();
    const task = commands.find((entry) => entry.name === 'task');
    const list = task?.subCommands?.find((entry) => entry.name === 'list');
    if (list?.action === undefined) throw new Error('Task command unavailable');
    await list.action(invocation, '');
    expect(history).toContainEqual({ type: 'info', text: 'No async tasks.' });
    const hooks = commands.find((entry) => entry.name === 'hooks');
    if (!hooks?.action) throw new Error('Hooks command unavailable');
    await hooks.action(invocation, '');
    expect(history).toContainEqual({
      type: 'info',
      text: 'No hooks registered.',
    });
    await owner.dispose();
    const siblingTask = createTaskCommand(bindTaskCommand(sibling), addItem);
    await siblingTask.subCommands
      ?.find((entry) => entry.name === 'list')
      ?.action?.(invocation, '');
    expect(
      history.filter(
        (entry) => 'text' in entry && entry.text === 'No async tasks.',
      ),
    ).toHaveLength(2);
  });
});
