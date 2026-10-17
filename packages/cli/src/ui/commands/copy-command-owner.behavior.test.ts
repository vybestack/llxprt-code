/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { bindCopyCommandHistoryRead } from './copyCommandHost.js';
import { createCopyCommand } from './copyCommand.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

async function latestOutput(agent: Agent) {
  return bindCopyCommandHistoryRead(
    () => agent.agentClient.hasChatInitialized(),
    () => agent.getHistory(),
  )();
}

describe('registered copy command owner', () => {
  const makeOwner = useCommandOwners();

  it('copies the registered Agent output instead of the invocation Agent output', async () => {
    const owner = await makeOwner('owner');
    const decoy = await makeOwner('decoy');
    await owner.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'owner prompt' }] },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'registered owner output' }],
      },
    ]);
    await decoy.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'decoy prompt' }] },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'invocation decoy output' }],
      },
    ]);
    await owner.agentClient.startChat(await owner.agentClient.getHistory());
    await decoy.agentClient.startChat(await decoy.agentClient.getHistory());
    const outputDirectory = await mkdtemp(join(tmpdir(), 'copy-owner-'));
    const copiedOutput = join(outputDirectory, 'clipboard.txt');

    try {
      const command = createCopyCommand(
        bindCopyCommandHistoryRead(
          () => owner.agentClient.hasChatInitialized(),
          () => owner.getHistory(),
        ),
        (text) => writeFile(copiedOutput, text, 'utf8'),
      );
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            { ...createUnconfiguredBuiltinOwners(), copyCommand: command },
            null,
          ),
        ],
        new AbortController().signal,
      );
      const registered = registry
        .getCommands()
        .find((item) => item.name === 'copy');
      if (!registered?.action) throw new Error('Copy command is unavailable');

      const result = await registered.action(
        createMockCommandContext({ services: { agent: decoy } }),
        '',
      );

      expect(result).toMatchObject({
        type: 'message',
        messageType: 'info',
        content: 'Last output copied to the clipboard',
      });
      expect(await readFile(copiedOutput, 'utf8')).toBe(
        'registered owner output',
      );
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it('extracts text blocks from the latest AI message only', async () => {
    const owner = await makeOwner('owner');
    await owner.setHistory([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'earlier answer' }] },
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'latest ' },
          {
            type: 'media',
            mimeType: 'image/jpeg',
            encoding: 'base64',
            data: 'Zml4dHVyZQ==',
          },
          { type: 'text', text: 'answer' },
        ],
      },
    ]);
    await owner.agentClient.startChat(await owner.agentClient.getHistory());

    expect(await latestOutput(owner)).toStrictEqual({
      kind: 'text',
      text: 'latest answer',
    });
  });

  it('reports an uninitialized owner without an invocation context', async () => {
    const owner = await makeOwner('owner');

    expect(await latestOutput(owner)).toStrictEqual({ kind: 'no-chat' });
  });
});
