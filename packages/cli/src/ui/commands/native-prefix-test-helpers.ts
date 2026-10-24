/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  createLockedSessionRecorder,
  type AgentClientContract,
  type IContent,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { readRecordedRows } from '../../__tests__/journal-recording.js';
import {
  buildAgent,
  drain,
  internalAgentClient,
  type Agent,
} from '../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import type { HistoryItem } from '../types.js';
import { chatCommand } from './chatCommand.js';
import type { CommandContext } from './types.js';

export function row(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `cli prefix ${index}` }],
  };
}

export async function contents(
  source: AsyncIterable<IContent>,
): Promise<IContent[]> {
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

export interface LiveCLI {
  readonly agent: Agent;
  readonly client: AgentClientContract;
  readonly history: HistoryService;
  readonly context: CommandContext;
  readonly recording: SessionRecordingPort;
  readonly displayed: Array<Omit<HistoryItem, 'id'>>;
  uiTokens(): number;
}

export async function withCLI(
  root: string,
  size: number,
  execute: (cli: LiveCLI) => Promise<void>,
  seed?: readonly IContent[],
  beforeRecording?: (history: HistoryService) => Promise<void>,
): Promise<void> {
  const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
    workingDir: root,
  });
  let recording: SessionRecordingPort | undefined;
  try {
    await drain(agent.stream('initialize CLI'));
    await agent.setHistory(
      seed ?? Array.from({ length: size }, (_, i) => row(i)),
    );
    const client = internalAgentClient(agent);
    const history = client.getHistoryService();
    if (history === null) throw new Error('Missing initialized history');
    await beforeRecording?.(history);
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
    const displayed: Array<Omit<HistoryItem, 'id'>> = [];
    let tokens = -1;
    const context = createMockCommandContext({
      services: { agent },
      recordingSwapCallbacks: { getCurrentRecording: () => currentRecording },
    });
    context.ui.clear = () => {
      displayed.length = 0;
    };
    context.ui.addItem = (item) => {
      displayed.push(item);
      return displayed.length;
    };
    context.ui.updateHistoryTokenCount = (count) => {
      tokens = count;
    };
    await execute({
      agent,
      client,
      history,
      context,
      recording,
      displayed,
      uiTokens: () => tokens,
    });
  } finally {
    await cleanup();
    await recording?.dispose();
  }
}

export function blocks(rows: readonly IContent[]): Array<IContent['blocks']> {
  return rows.map((content) => content.blocks);
}

export async function persistedContents(
  recording: SessionRecordingPort,
): Promise<IContent[]> {
  const path = recording.getFilePath();
  if (path === null) throw new Error('Missing recording path');

  return readRecordedRows(path);
}

export { operationFileCreates } from '../../../../agents/src/compression/__tests__/support/operation-file-creates.js';
export { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
