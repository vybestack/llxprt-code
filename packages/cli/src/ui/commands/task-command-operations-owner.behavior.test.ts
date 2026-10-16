/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core';
import { TasksControl } from '../../../../agents/src/api/control/tasksControl.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createTaskCommand } from './tasksCommand.js';

describe('task command independent operations', () => {
  const makeOwner = useCommandOwners();
  it('cancels only the registered task when its identifier is shared with a sibling', async () => {
    const owner = await makeOwner('task-operation-owner');
    const sibling = await makeOwner('task-operation-sibling');
    const manager = new AsyncTaskManager(5);
    const siblingManager = new AsyncTaskManager(5);
    const ownedAbort = new AbortController();
    const siblingAbort = new AbortController();
    manager.registerTask({
      id: 'shared-task',
      subagentName: 'reviewer',
      goalPrompt: 'owned task',
      abortController: ownedAbort,
    });
    siblingManager.registerTask({
      id: 'shared-task',
      subagentName: 'reviewer',
      goalPrompt: 'sibling task',
      abortController: siblingAbort,
    });
    const tasks = new TasksControl({ getManager: () => manager });
    const decoyTasks = new TasksControl({ getManager: () => siblingManager });
    const list = Object.assign(() => tasks.list(), { tasks: decoyTasks });
    const command = createTaskCommand(
      {
        list,
        listRunning: tasks.listRunning.bind(tasks),
        get: tasks.get.bind(tasks),
        cancel: tasks.cancel.bind(tasks),
      },
      () => 0,
    );
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), taskCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const end = registry
      .getCommands()
      .find((entry) => entry.name === 'task')
      ?.subCommands?.find((entry) => entry.name === 'end');
    if (!end?.action) throw new Error('Missing task end command');
    await end.action(
      createMockCommandContext({ services: { agent: sibling } }),
      'shared-task',
    );
    expect(manager.getTask('shared-task')?.status).toBe('cancelled');
    expect(ownedAbort.signal.aborted).toBe(true);
    expect(siblingAbort.signal.aborted).toBe(false);
    await owner.dispose();
    expect(siblingManager.getTask('shared-task')?.status).toBe('running');
    const siblingCommand = createTaskCommand(
      {
        list: decoyTasks.list.bind(decoyTasks),
        listRunning: decoyTasks.listRunning.bind(decoyTasks),
        get: decoyTasks.get.bind(decoyTasks),
        cancel: decoyTasks.cancel.bind(decoyTasks),
      },
      () => 0,
    );
    const siblingEnd = siblingCommand.subCommands?.find(
      (entry) => entry.name === 'end',
    );
    if (!siblingEnd?.action)
      throw new Error('Missing sibling task end command');
    await siblingEnd.action(createMockCommandContext(), 'shared-task');
    expect(siblingManager.getTask('shared-task')?.status).toBe('cancelled');
    expect(siblingAbort.signal.aborted).toBe(true);
  });
});
