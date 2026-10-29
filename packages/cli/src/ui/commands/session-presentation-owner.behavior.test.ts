import { collectResumeRows } from '../../__tests__/resumeRows.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createClearCommand } from './clearCommand.js';
import { bindClearSession } from './simpleCommandHost.js';
import { createVimCommand } from './vimCommand.js';
import { createAboutCommand } from './aboutCommand.js';

describe('registered session and presentation commands', () => {
  const makeOwner = useCommandOwners();

  it('clears the registered session while preserving the invocation session and its history', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    const initialSessionId = 'same-command-owner-label';
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'registered question' }],
      },
    ]);
    await sibling.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'retained question' }],
      },
    ]);
    const events: string[] = [];
    const command = createClearCommand(
      bindClearSession(
        owner.hooks.triggerSessionEnd.bind(owner.hooks),
        owner.session.startNewSession.bind(owner.session),
        owner.hooks.triggerSessionStart.bind(owner.hooks),
      ),
      (message) => events.push(message),
      () => 0,
      (count) => events.push(`tokens:${count}`),
      () => events.push('clear'),
    );
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), clearCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const clear = registry
      .getCommands()
      .find((entry) => entry.name === 'clear');
    if (!clear?.action) throw new Error('Clear unavailable');
    const invocation = createMockCommandContext({
      services: { agent: sibling },
    });
    await clear.action(invocation, '');
    expect(owner.session.getSessionId()).not.toBe(initialSessionId);
    expect(await collectResumeRows(owner.streamHistory())).toStrictEqual([]);
    expect(sibling.session.getSessionId()).toBe(initialSessionId);
    expect(
      (await collectResumeRows(sibling.streamHistory())).flatMap(
        (item) => item.blocks,
      ),
    ).toStrictEqual([{ type: 'text', text: 'retained question' }]);
    expect(events.slice(-2)).toStrictEqual(['tokens:0', 'clear']);
  });

  it('renders about data and awaits Vim toggling from registered operations', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    const history: Array<Parameters<CommandOwnerFixture['ui']['addItem']>[0]> =
      [];
    let vim = false;
    const commands = {
      ...createUnconfiguredBuiltinOwners(),
      aboutCommand: createAboutCommand(
        async () => ({
          modelVersion: owner.getModel(),
          provider: owner.getProvider(),
          baseURL: '',
          ideClient: '',
          keyfile: '',
        }),
        (item) => {
          history.push(item);
          return history.length;
        },
      ),
      vimCommand: createVimCommand(async () => {
        vim = !vim;
        return vim;
      }),
    };
    const registry = await CommandService.create(
      [new BuiltinCommandLoader(commands, null)],
      new AbortController().signal,
    );
    const about = registry
      .getCommands()
      .find((entry) => entry.name === 'about');
    const toggle = registry.getCommands().find((entry) => entry.name === 'vim');
    if (!about?.action || !toggle?.action)
      throw new Error('Presentation commands unavailable');
    const invocation = createMockCommandContext({
      services: { agent: sibling },
      ui: {
        toggleVimEnabled: async () => {
          throw new Error('Invocation selected');
        },
      },
    });
    await about.action(invocation, '');
    expect(history).toContainEqual(
      expect.objectContaining({
        type: 'about',
        modelVersion: owner.getModel(),
      }),
    );
    const result = await toggle.action(invocation, '');
    expect(result).toMatchObject({
      type: 'message',
      messageType: 'info',
      content: 'Entered Vim mode. Run /vim again to exit.',
    });
    expect(vim).toBe(true);
  });
});
