/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../__tests__/mockCommandContext.js';
import type { CommandContext } from '../ui/commands/types.js';
import { CommandService } from './CommandService.js';
import { bindShellPromptOperations } from './prompt-processors/shellPromptHost.js';
import { FileCommandLoader } from './FileCommandLoader.js';

function shellContext(
  agent: Agent,
  root: string,
  excluded: () => string[],
): CommandContext {
  return createMockCommandContext({
    invocation: { raw: '/where', name: 'where', args: '' },
    services: {
      agent,
      config: {
        getTargetDir: () => root,
        getProjectRoot: () => root,
        getApprovalMode: () => ApprovalMode.YOLO,
        getShouldUseNodePtyShell: () => false,
        getShellReplacement: () => 'allowlist',
        getCoreTools: () => undefined,
        getExcludeTools: excluded,
        getShellExecutionConfig: () => ({}),
        getFolderTrust: () => false,
      },
    },
  });
}

async function fileRegistry(
  root: string,
  context: CommandContext,
): Promise<CommandService> {
  return CommandService.create(
    [
      new FileCommandLoader(
        {
          userCommandsDir: join(root, 'absent'),
          projectCommandsDir: join(root, 'commands'),
          getProjectRoot: () => root,
          getExtensions: () => [],
          getFolderTrust: () => false,
          isTrustedFolder: () => true,
        },
        bindShellPromptOperations(context.services.config),
      ),
    ],
    new AbortController().signal,
  );
}

async function writeCommand(root: string, marker: string): Promise<void> {
  await writeFile(join(root, 'marker.txt'), marker);
  await mkdir(join(root, 'commands'));
  const prompt = `!{node -p "require('node:fs').readFileSync('marker.txt','utf8')"}`;
  await writeFile(
    join(root, 'commands', 'where.toml'),
    `prompt = ${JSON.stringify(prompt)}\n`,
  );
}

describe('registered file command shell owner', () => {
  const makeOwner = useCommandOwners();

  it('executes with registered workspace permissions and leaves its sibling usable', async () => {
    const owner = await makeOwner('owner');
    const sibling = await makeOwner('sibling');
    const ownerRoot = owner.workspace.getWorkingDirectory();
    const siblingRoot = sibling.workspace.getWorkingDirectory();
    await writeCommand(ownerRoot, 'registered output');
    await writeCommand(siblingRoot, 'sibling output');
    let denyOwner = false;
    const ownerContext = shellContext(owner, ownerRoot, () =>
      denyOwner ? ['run_shell_command'] : [],
    );
    const siblingContext = shellContext(sibling, siblingRoot, () => []);
    const registry = await fileRegistry(ownerRoot, ownerContext);
    const siblingRegistry = await fileRegistry(siblingRoot, siblingContext);
    const command = registry
      .getCommands()
      .find((command) => command.name === 'where');
    const siblingCommand = siblingRegistry
      .getCommands()
      .find((command) => command.name === 'where');
    if (!command?.action || !siblingCommand?.action)
      throw new Error('Missing file command');
    const result = await command.action(siblingContext, '');
    expect(result).toStrictEqual({
      type: 'submit_prompt',
      content: 'registered output',
    });
    denyOwner = true;
    await expect(command.action(siblingContext, '')).rejects.toThrow(
      'Blocked command:',
    );
    await owner.dispose();
    const siblingResult = await siblingCommand.action(siblingContext, '');
    expect(siblingResult).toStrictEqual({
      type: 'submit_prompt',
      content: 'sibling output',
    });
  });
});
