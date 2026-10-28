/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  ConfigurationManager,
  createSessionMetrics,
} from '@vybestack/llxprt-code-telemetry';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import { createHelpCommand } from './helpCommand.js';
import { createQuitCommand } from './quitCommand.js';
import { createDebugCommand } from './debugCommands.js';
import { bindDebugCommand } from './debugCommandHost.js';
import type { HistoryItemWithoutId } from '../types.js';
import type { SlashCommand } from './types.js';

async function registered(
  name: string,
  owners: BuiltinCommandOwners,
): Promise<SlashCommand> {
  const registry = await CommandService.create(
    [new BuiltinCommandLoader(owners, null)],
    new AbortController().signal,
  );
  const command = registry.getCommands().find((entry) => entry.name === name);
  if (!command) throw new Error(`Missing ${name} command`);
  return command;
}

describe('registered session utility owners', () => {
  const makeOwner = useCommandOwners();

  it('writes help to the registered history rather than the invocation history', async () => {
    const owner = await makeOwner('help-owner');
    const sibling = await makeOwner('help-sibling');
    const history: unknown[] = [];
    const ownerContext = createMockCommandContext({
      services: { agent: owner },
      ui: {
        addItem: (item: HistoryItemWithoutId) => {
          history.push(item);
          return 1;
        },
      },
    });
    const command = await registered('help', {
      ...createUnconfiguredBuiltinOwners(),
      helpCommand: createHelpCommand(ownerContext.ui.addItem),
    });
    if (!command.action) throw new Error('Missing help action');
    await command.action(
      createMockCommandContext({ services: { agent: sibling } }),
      '',
    );
    expect(history).toContainEqual(expect.objectContaining({ type: 'help' }));
    await owner.dispose();
    expect(await sibling.getHistory()).toStrictEqual([]);
  });

  it('summarizes registered session metrics rather than invocation metrics', async () => {
    const ownerContext = createMockCommandContext();
    ownerContext.session.stats.metrics = createSessionMetrics();
    ownerContext.session.stats.metrics.tools.totalCalls = 42;
    const command = await registered('quit', {
      ...createUnconfiguredBuiltinOwners(),
      quitCommand: createQuitCommand(() => ownerContext.session.stats),
    });
    if (!command.action) throw new Error('Missing quit action');
    const invocation = createMockCommandContext();
    invocation.session.stats.metrics = createSessionMetrics();
    const result = await command.action(invocation, '');
    expect(result).toMatchObject({
      type: 'quit',
      messages: expect.arrayContaining([
        expect.objectContaining({ totalToolCalls: 42 }),
      ]),
    });
  });

  it('keeps the registered debug configuration when another configuration is acquired', async () => {
    ConfigurationManager.resetForTesting();
    try {
      const owner = ConfigurationManager.create();
      owner.setEphemeralConfig({ enabled: false, namespaces: [] });
      const command = await registered('debug', {
        ...createUnconfiguredBuiltinOwners(),
        debugCommand: createDebugCommand(bindDebugCommand(owner)),
      });
      ConfigurationManager.resetForTesting();
      const sibling = ConfigurationManager.create();
      sibling.setEphemeralConfig({ enabled: false, namespaces: [] });
      const enable = command.subCommands?.find(
        (entry) => entry.name === 'enable',
      )?.action;
      if (!enable) throw new Error('Missing debug enable');
      await enable(createMockCommandContext(), 'llxprt:registered');
      expect(owner.getEffectiveConfig().namespaces).toContain(
        'llxprt:registered',
      );
      expect(sibling.getEffectiveConfig().namespaces).toStrictEqual([]);
    } finally {
      ConfigurationManager.resetForTesting();
    }
  });
});
