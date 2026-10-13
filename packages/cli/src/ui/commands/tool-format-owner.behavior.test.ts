/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  createUnconfiguredModelCommand,
  createUnconfiguredSetCommand,
} from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createToolFormatCommand } from './toolformatCommand.js';
import type { SlashCommand } from './types.js';

describe('registered tool-format command ownership', () => {
  const owner = useCommandOwners();

  function loader(agent: Agent): BuiltinCommandLoader {
    return new BuiltinCommandLoader(
      createUnconfiguredModelCommand(),
      createToolFormatCommand(
        () => agent.toolFormat.getState(),
        (format) => agent.toolFormat.setOverride(format),
      ),
      createUnconfiguredSetCommand(),
      null,
      'agent',
    );
  }

  async function registered(agent: Agent): Promise<SlashCommand> {
    const registry = await CommandService.create(
      [loader(agent)],
      new AbortController().signal,
    );
    const command = registry
      .getCommands()
      .find((item) => item.name === 'toolformat');
    if (!command?.action)
      throw new Error('Registered tool-format command is unavailable');
    return command;
  }

  async function execute(
    command: SlashCommand,
    args: string,
    decoy: Agent,
  ): Promise<unknown> {
    if (!command.action) throw new Error('Tool-format action is unavailable');
    return command.action(
      createMockCommandContext({ services: { agent: decoy } }),
      args,
    );
  }

  it('keeps independent overrides with the registered owners despite decoy invocation owners', async () => {
    const left = await owner('left');
    const right = await owner('right');
    const leftCommand = await registered(left);
    const rightCommand = await registered(right);
    const results = await Promise.all([
      execute(leftCommand, 'hermes', right),
      execute(rightCommand, 'xml', left),
    ]);
    expect(results).toStrictEqual([
      {
        type: 'message',
        messageType: 'info',
        content: "Tool format override set to 'hermes' for provider 'fake'.",
      },
      {
        type: 'message',
        messageType: 'info',
        content: "Tool format override set to 'xml' for provider 'fake'.",
      },
    ]);
    expect((await left.toolFormat.getState()).override).toBe('hermes');
    expect((await right.toolFormat.getState()).override).toBe('xml');
    const cleared = await execute(leftCommand, 'auto', right);
    expect(cleared).toMatchObject({
      messageType: 'info',
      content:
        "Tool format override cleared for provider 'fake'. Using auto-detection.",
    });
    expect((await left.toolFormat.getState()).override).toBeNull();
    expect((await right.toolFormat.getState()).override).toBe('xml');
  }, 30000);

  it('renders current state from the registered owner without mutating it', async () => {
    const left = await owner('display');
    const right = await owner('decoy');
    await left.toolFormat.setOverride('hermes');
    await right.toolFormat.setOverride('xml');
    const result = await execute(await registered(left), '', right);
    expect(result).toMatchObject({ messageType: 'info' });
    if (
      typeof result !== 'object' ||
      result === null ||
      !('content' in result) ||
      typeof result.content !== 'string'
    )
      throw new Error('Expected display message');
    expect(result.content).toContain(
      'Current tool format: hermes (manual override)',
    );
    expect(result.content).toContain(
      'Structured: openai, anthropic, deepseek, qwen, kimi, gemma',
    );
    expect(result.content).toContain('Text-based: hermes, xml, llama');
    expect((await left.toolFormat.getState()).override).toBe('hermes');
    expect((await right.toolFormat.getState()).override).toBe('xml');
  }, 30000);

  it('rejects unsupported formats without changing either owner', async () => {
    const left = await owner('invalid');
    const right = await owner('unchanged');
    await left.toolFormat.setOverride('hermes');
    await right.toolFormat.setOverride('xml');
    const result = await execute(await registered(left), 'not-a-format', right);
    expect(result).toMatchObject({ messageType: 'error' });
    expect((await left.toolFormat.getState()).override).toBe('hermes');
    expect((await right.toolFormat.getState()).override).toBe('xml');
  }, 30000);

  it('runs the synchronously loaded command through its registered operations', async () => {
    const agent = await owner('sync');
    const command = loader(agent)
      .loadCommandsSync()
      .find((item) => item.name === 'toolformat');
    if (!command) throw new Error('Sync registry did not load toolformat');
    expect(await execute(command, 'kimi', agent)).toMatchObject({
      messageType: 'info',
    });
    expect((await agent.toolFormat.getState()).override).toBe('kimi');
  }, 30000);

  it('does not reroute a closed owner to the surviving invocation owner', async () => {
    const left = await owner('closed');
    const right = await owner('surviving');
    const leftCommand = await registered(left);
    const rightCommand = await registered(right);
    await right.toolFormat.setOverride('xml');
    await left.dispose();
    expect(await execute(leftCommand, 'hermes', right)).toMatchObject({
      messageType: 'error',
    });
    expect((await right.toolFormat.getState()).override).toBe('xml');
    expect(await execute(rightCommand, 'kimi', right)).toMatchObject({
      messageType: 'info',
    });
    expect((await right.toolFormat.getState()).override).toBe('kimi');
    expect(await right.generate('continue after peer disposal')).toContain(
      'reply',
    );
  }, 30000);
});
