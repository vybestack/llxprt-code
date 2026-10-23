/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { createAgentProviderCommand } from '../../__tests__/provider-command-test-owner.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import type { SlashCommand } from './types.js';

describe('registered provider command ownership', () => {
  const owner = useCommandOwners();
  const saved: Array<{ alias: string; baseProvider: string }> = [];
  const refreshes: string[] = [];

  function loader(agent: Agent, label: string): BuiltinCommandLoader {
    return new BuiltinCommandLoader(
      {
        ...createUnconfiguredBuiltinOwners(),
        providerCommand: createAgentProviderCommand(agent, {
          resolve: () => ({
            ok: true,
            config: {
              baseProvider: agent.getProvider(),
              'base-url': `https://${label}.example.test/v1`,
              defaultModel: agent.getModel(),
            },
          }),
          write: (alias, config) =>
            saved.push({ alias, baseProvider: config.baseProvider }),
          refresh: async () => {
            refreshes.push(label);
          },
        }),
      },
      null,
    );
  }

  async function registered(
    agent: Agent,
    label = 'owner',
  ): Promise<SlashCommand> {
    const registry = await CommandService.create(
      [loader(agent, label)],
      new AbortController().signal,
    );
    const command = registry
      .getCommands()
      .find((item) => item.name === 'provider');
    if (!command?.action)
      throw new Error('Registered provider command is unavailable');
    return command;
  }

  async function execute(
    command: SlashCommand,
    args: string,
    decoy: Agent,
  ): Promise<unknown> {
    if (!command.action) throw new Error('Provider action is unavailable');
    return command.action(
      createMockCommandContext({ services: { agent: decoy } }),
      args,
    );
  }

  it('switches and records on the registered owner despite decoy invocation owners', async () => {
    const left = await owner('left');
    const right = await owner('right');
    const leftCommand = await registered(left);
    await registered(right);
    await Promise.all([
      left.chat('materialize the left recording', { mcpDiscovery: 'skip' }),
      right.chat('materialize the right recording', { mcpDiscovery: 'skip' }),
    ]);
    await Promise.all([
      left.session.setRecording({ enabled: true }),
      right.session.setRecording({ enabled: true }),
    ]);

    const result = await execute(leftCommand, 'openai', right);

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Switched from fake to openai',
    });
    expect(left.getProvider()).toBe('openai');
    expect(right.getProvider()).toBe('fake');
    const leftPath = left.session.getRecording().path;
    const rightPath = right.session.getRecording().path;
    if (!leftPath || !rightPath)
      throw new Error('Owner recording paths are unavailable');
    const [leftLog, rightLog] = await Promise.all([
      readFile(leftPath, 'utf8'),
      readFile(rightPath, 'utf8'),
    ]);
    expect(leftLog).toContain('provider_switch');
    expect(rightLog).not.toContain('provider_switch');
  }, 30000);

  it('reports an unchanged provider without switching', async () => {
    const agent = await owner('same');
    const result = await execute(await registered(agent), 'fake', agent);
    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Already using provider: fake',
    });
    expect(agent.getProvider()).toBe('fake');
  }, 30000);

  it('opens the provider dialog without arguments', async () => {
    const agent = await owner('dialog');
    expect(await execute(await registered(agent), '  ', agent)).toStrictEqual({
      type: 'dialog',
      dialog: 'provider',
    });
  }, 30000);

  it('saves aliases for the registered owner and refreshes its aliases', async () => {
    saved.length = 0;
    refreshes.length = 0;
    const left = await owner('alias-left');
    const right = await owner('alias-right');
    await right.setProvider('openai');
    const result = await execute(
      await registered(left, 'left'),
      'save mine',
      right,
    );
    expect(result).toMatchObject({
      messageType: 'info',
      content: "Saved provider alias 'mine'. Use /provider mine to switch.",
    });
    expect(saved).toStrictEqual([{ alias: 'mine', baseProvider: 'fake' }]);
    expect(refreshes).toStrictEqual(['left']);
  }, 30000);

  it('rejects invalid and reserved alias names before persisting', async () => {
    saved.length = 0;
    const agent = await owner('invalid-alias');
    const command = await registered(agent);
    expect(await execute(command, 'save', agent)).toMatchObject({
      messageType: 'error',
      content: 'Alias name is required. Usage: /provider save <alias>',
    });
    expect(await execute(command, 'save bad/name', agent)).toMatchObject({
      messageType: 'error',
    });
    expect(await execute(command, 'save unconfigured', agent)).toMatchObject({
      messageType: 'error',
      content: expect.stringContaining('reserved name'),
    });
    expect(saved).toStrictEqual([]);
  }, 30000);

  it('does not reroute a retired owner command to a surviving invocation owner', async () => {
    const left = await owner('retired');
    const right = await owner('surviving');
    const leftCommand = await registered(left);
    const rightCommand = await registered(right);
    await left.dispose();

    expect(await execute(leftCommand, 'openai', right)).toMatchObject({
      messageType: 'error',
    });
    expect(right.getProvider()).toBe('fake');
    expect(await execute(rightCommand, 'openai', right)).toMatchObject({
      messageType: 'info',
    });
    expect(right.getProvider()).toBe('openai');
    expect(await right.generate('continue after peer disposal')).toContain(
      'reply',
    );
  }, 30000);
});
