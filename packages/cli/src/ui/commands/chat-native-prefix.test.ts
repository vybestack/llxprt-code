/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import {
  createLockedSessionRecorder,
  type IContent,
  type AgentClientContract,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import {
  buildAgent,
  drain,
  internalAgentClient,
} from '../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { operationFileCreates } from '../../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { pinHistoryBackend } from '../../services/__tests__/support/pinHistoryBackend.js';
import { chatCommand } from './chatCommand.js';
import type { CommandContext } from './types.js';

function row(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `cli prefix ${index}` }],
  };
}

async function contents(source: AsyncIterable<IContent>): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const content of source) result.push(content);
  return result;
}

export async function runCommand(
  context: CommandContext,
  name: string,
  args = '',
): Promise<unknown> {
  const command = chatCommand.subCommands?.find((item) => item.name === name);
  if (command?.action === undefined) throw new Error('Missing chat command');
  return command.action(context, args);
}

interface LiveCLI {
  readonly client: AgentClientContract;
  readonly context: CommandContext;
  readonly recording: SessionRecordingPort;
}

async function withCLI(
  root: string,
  size: number,
  execute: (cli: LiveCLI) => Promise<void>,
): Promise<void> {
  const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
    workingDir: root,
  });
  let recording: SessionRecordingPort | undefined;
  try {
    await drain(agent.stream('initialize CLI'));
    await agent.setHistory(Array.from({ length: size }, (_, i) => row(i)));
    const client = internalAgentClient(agent);
    const history = client.getHistoryService();
    if (history === null) throw new Error('Missing initialized history');
    recording = await createLockedSessionRecorder({
      sessionId: crypto.randomUUID(),
      projectHash: 'cli-native-prefix',
      chatsDir: `${root}/chats`,
      workspaceDirs: [root],
      cwd: root,
      provider: 'fake',
      model: 'fake-model',
    });
    await history.attachJournal(recording, true);
    await history.waitForCommit();
    const currentRecording = recording;
    const context = createMockCommandContext({
      services: { agent },
      recordingSwapCallbacks: {
        getCurrentRecording: () => currentRecording,
      },
    });
    await execute({ client, context, recording });
  } finally {
    await cleanup();
    await recording?.dispose();
  }
}

function blocks(rows: readonly IContent[]): Array<IContent['blocks']> {
  return rows.map((content) => content.blocks);
}

async function persistedContents(path: string): Promise<IContent[]> {
  const replay = await JournalSession.open(path);
  try {
    const persisted: IContent[] = [];
    for await (const entry of replay.rows()) persisted.push(entry.content);
    return persisted;
  } finally {
    await replay.close();
  }
}

describe('actual native CLI clear and restore', () => {
  pinHistoryBackend('journal');
  const directory = useTempDir('cli-native-prefix-');
  for (const size of [3, 64, 65, 5000]) {
    for (const command of ['clear', 'restore']) {
      it(`${command} selects the original owners over ${size} rows without scratch files`, async () => {
        await withCLI(
          directory(),
          size,
          async ({ client, context, recording }) => {
            const restoreCut = size % 2 === 0 ? size - 2 : size - 1;
            const cut = command === 'clear' ? 2 : restoreCut;
            const receipt = await operationFileCreates(async () => {
              expect(
                await runCommand(
                  context,
                  command,
                  command === 'restore' ? '1' : '',
                ),
              ).toBeUndefined();
            });
            expect(receipt).toStrictEqual({ directories: [], files: [] });
            expect(blocks(await contents(client.getHistory()))).toStrictEqual(
              Array.from({ length: cut }, (_, i) => row(i).blocks),
            );
            const path = recording.getFilePath();
            if (path === null) throw new Error('Missing recording path');
            expect(blocks(await persistedContents(path))).toStrictEqual(
              Array.from({ length: cut }, (_, i) => row(i).blocks),
            );
          },
        );
      });
    }
  }
});
