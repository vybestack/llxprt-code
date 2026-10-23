/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createAgentSetCommand } from '../../__tests__/set-command-test-owner.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import type { SlashCommand } from './types.js';

describe('registered set command ownership', () => {
  const owner = useCommandOwners();

  function loader(agent: Agent): BuiltinCommandLoader {
    return new BuiltinCommandLoader(
      {
        ...createUnconfiguredBuiltinOwners(),
        setCommand: createAgentSetCommand(agent),
      },
      null,
    );
  }

  async function registered(agent: Agent): Promise<SlashCommand> {
    const registry = await CommandService.create(
      [loader(agent)],
      new AbortController().signal,
    );
    const command = registry.getCommands().find((item) => item.name === 'set');
    if (!command?.action)
      throw new Error('Registered set command is unavailable');
    return command;
  }

  it('writes ephemeral values to the registered owner, not the invocation owner', async () => {
    const left = await owner('left');
    const right = await owner('right');
    const leftCommand = await registered(left);
    const rightCommand = await registered(right);
    const result = await leftCommand.action!(
      createMockCommandContext({ services: { agent: right } }),
      'context-limit 17001',
    );

    expect(result).toMatchObject({ messageType: 'info' });
    expect(left.getEphemeralSetting('context-limit')).toBe(17001);
    expect(right.getEphemeralSetting('context-limit')).toBeUndefined();
    const rightResult = await rightCommand.action!(
      createMockCommandContext({ services: { agent: left } }),
      'modelparam temperature 0.7',
    );
    expect(rightResult).toMatchObject({ messageType: 'info' });
    expect(right.providerReads.getActiveModelParams()).toMatchObject({
      temperature: 0.7,
    });
    expect(left.providerReads.getActiveModelParams()).toStrictEqual({});
  }, 30000);

  it('completes model parameters from the registered owner', async () => {
    const left = await owner('completion-left');
    const right = await owner('completion-right');
    const leftCommand = await registered(left);
    await leftCommand.action!(
      createMockCommandContext({ services: { agent: right } }),
      'modelparam left_only 0.1',
    );
    await (
      await registered(right)
    ).action!(
      createMockCommandContext({ services: { agent: left } }),
      'modelparam right_only 0.2',
    );

    const modelParam = leftCommand.schema?.find(
      (node) => node.kind === 'literal' && node.value === 'modelparam',
    );
    const parameterName = modelParam?.next?.find(
      (node) => node.kind === 'value' && node.name === 'param-name',
    );
    if (parameterName?.kind !== 'value' || !parameterName.completer) {
      throw new Error('Model parameter completer is unavailable');
    }

    const suggestions = await parameterName.completer(
      createMockCommandContext({ services: { agent: right } }),
      'left_',
      {
        tokens: ['modelparam'],
        partialToken: 'left_',
        hasTrailingSpace: true,
        position: 2,
      },
    );

    expect(suggestions.map(({ value }) => value)).toStrictEqual(['left_only']);
  }, 30000);

  it('unsets values only on the registered owner', async () => {
    const left = await owner('unset-left');
    const right = await owner('unset-right');
    const leftCommand = await registered(left);
    left.setEphemeralSetting('context-limit', 18001);
    right.setEphemeralSetting('context-limit', 28002);

    const result = await leftCommand.action!(
      createMockCommandContext({ services: { agent: right } }),
      'unset context-limit',
    );

    expect(result).toMatchObject({ messageType: 'info' });
    expect(left.getEphemeralSetting('context-limit')).toBeUndefined();
    expect(right.getEphemeralSetting('context-limit')).toBe(28002);
  }, 30000);

  it('does not reroute a retired owner command to a surviving invocation owner', async () => {
    const left = await owner('retired');
    const right = await owner('surviving');
    const leftCommand = await registered(left);
    const rightCommand = await registered(right);
    await left.dispose();

    await expect(
      leftCommand.action!(
        createMockCommandContext({ services: { agent: right } }),
        'context-limit 19003',
      ),
    ).rejects.toThrow('Session settings owner is closed');
    expect(right.getEphemeralSetting('context-limit')).toBeUndefined();

    const result = await rightCommand.action!(
      createMockCommandContext({ services: { agent: left } }),
      'context-limit 29004',
    );
    expect(result).toMatchObject({ messageType: 'info' });
    expect(right.getEphemeralSetting('context-limit')).toBe(29004);
  }, 30000);
});
