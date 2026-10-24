/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { RecordingIntegration } from '@vybestack/llxprt-code-core/recording/RecordingIntegration.js';
import {
  JournalResumeBoot,
  resumePointOf,
} from '@vybestack/llxprt-code-core/recording/journalResume.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentImpl } from '../../../api/agentImpl.js';
import { createAgent } from '../../../api/createAgent.js';
import { recordCompletedToolHistory } from '../../agenticLoop/loopHelpers.js';
import { callerRecording } from './next-request-recorders.js';
import { diskToolState, recordingFile } from './service-tool-recorders.js';
import { requestFacts, toolGate } from './service-tool-runtime.js';

export type Variant =
  | 'directory'
  | 'ide'
  | 'turn'
  | 'client'
  | 'pause'
  | 'two-group';
export type Ending = 'failure' | 'cancel';
const pauseCall = {
  type: 'tool_call' as const,
  id: 'w21-pause',
  name: 'todo_pause',
  parameters: { reason: 'durability boundary' },
};

async function fixtureAgent(
  directory: string,
  variant: Variant,
): Promise<AgentImpl> {
  const fixture = join(directory, 'responses.jsonl');
  let blocks: ContentBlock[] = [
    { type: 'text', text: 'completed initial turn' },
  ];
  if (variant === 'pause') blocks = [pauseCall];
  if (variant === 'client')
    blocks = [
      {
        type: 'tool_call',
        id: 'w21-client',
        name: 'read_file',
        parameters: { absolute_path: join(directory, 'payload.txt') },
      },
    ];
  await writeFile(
    fixture,
    [
      { chunks: [{ speaker: 'ai', blocks }] },
      {
        chunks: [
          { speaker: 'ai', blocks: [{ type: 'text', text: 'next response' }] },
        ],
      },
    ]
      .map((turn) => JSON.stringify(turn))
      .join('\n'),
  );
  process.env.LLXPRT_FAKE_RESPONSES = fixture;

  const agent = await createAgent({
    provider: 'fake',
    model: 'fake-model',
    workingDir: directory,
    sessionId: 'w21-variants',
    folderTrust: true,
    recording: { enabled: false },
    telemetry: { enabled: false },
    skillsSupport: false,
    mcpEnabled: false,
    extensionsEnabled: false,
    lsp: false,
    harness: { forceConfirmations: false },
    tools: ['todo_pause', 'read_file'],
  });
  if (!(agent instanceof AgentImpl)) throw new Error('Expected live AgentImpl');
  return agent;
}
function providerBoundary(provider: RuntimeProvider, ending: Ending) {
  if (provider.name !== 'fake')
    throw new Error('Expected fake provider runtime adapter');
  const generate = provider.generateChatCompletion.bind(provider);
  const response = toolGate();
  let entries = 0;
  let request: Awaited<ReturnType<typeof requestFacts>> | undefined;
  let rows: IContent[] = [];
  provider.generateChatCompletion = (options) => {
    if (!('contents' in options)) throw new Error('Expected provider options');
    entries++;
    const entry = entries;
    return (async function* (): AsyncGenerator<IContent> {
      if (entry === 2) {
        rows = await Array.fromAsync(options.contents);
        request = await requestFacts(
          (async function* () {
            yield* rows;
          })(),
        );
        await response.promise;
        if (ending === 'cancel')
          throw new DOMException(
            'Controlled next request cancellation',
            'AbortError',
          );
        throw new Error('Controlled next request failure');
      }
      yield* generate(options);
    })();
  };
  return {
    response,
    entries: () => entries,
    request: () => request,
    providerRows: () => rows,
  };
}
async function admitTwoGroups(client: AgentClientContract): Promise<void> {
  await recordCompletedToolHistory(
    [
      {
        status: 'error',
        request: {
          callId: pauseCall.id,
          name: pauseCall.name,
          args: pauseCall.parameters,
          isClientInitiated: false,
          prompt_id: 'two-group',
        },
        response: {
          callId: pauseCall.id,
          responseParts: [
            pauseCall,
            {
              type: 'tool_response',
              callId: pauseCall.id,
              toolName: pauseCall.name,
              result: { output: 'paused\n雪\u0000' },
            },
          ],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
        },
      },
    ],
    client,
  );
}
async function admitContext(
  agent: AgentImpl,
  directory: string,
  variant: Variant,
): Promise<void> {
  const client = agent.agentClient;
  if (variant === 'directory') await agent.addDirectoryContext();
  if (variant === 'ide') {
    if (client.bindIdeContext === undefined)
      throw new Error('Missing IDE binding');
    client.bindIdeContext(
      () => ({
        workspaceState: {
          openFiles: [
            {
              path: join(directory, 'editor.ts'),
              timestamp: 1,
              isActive: true,
              selectedText: 'native selection 雪',
              cursor: { line: 7, character: 3 },
            },
          ],
        },
      }),
      () => true,
    );
  }
  if (variant === 'two-group') await admitTwoGroups(client);
}
export async function nextRequestRuntime(
  directory: string,
  variant: Variant,
  ending: Ending,
) {
  const agent = await fixtureAgent(directory, variant);
  const client = agent.agentClient;
  const history = client.getHistoryService();
  if (history === null) throw new Error('Missing initialized history');
  const primary = await callerRecording(directory, 'primary');
  await history.adoptResumeBoot(
    primary.recording,
    new JournalResumeBoot(
      primary.recording,
      await resumePointOf(primary.recording),
    ),
  );
  const integrations = [new RecordingIntegration(primary.recording)];
  for (const integration of integrations)
    await integration.subscribeToJournal(history, agent.session);
  const sessions = [await primary.recording.session()];
  const files = [recordingFile(primary.recording)];
  const provider = agent.providerManager.getActiveProvider();
  if (provider === undefined) throw new Error('Missing provider');
  const boundary = providerBoundary(provider, ending);
  const facts = () => ({
    entries: boundary.entries(),
    seqs: sessions.map((session) => session.store.published?.commitSeq ?? 0),
    flushes: [primary.flushes()],
  });
  const disk = () => Promise.all(files.map(diskToolState));
  const send = async (text: string): Promise<void> => {
    for await (const event of agent.stream(text)) {
      if (event.type === 'error')
        throw new Error(`Unexpected Agent error: ${JSON.stringify(event)}`);
    }
  };
  return {
    agent,
    client,
    history,
    primary,
    files,
    facts,
    disk,
    send,
    ...boundary,
    admit: () => admitContext(agent, directory, variant),
    async close(): Promise<void> {
      primary.release();
      boundary.response.resolve();
      for (const integration of integrations) await integration.dispose();
      await agent.dispose();
      await primary.recording.dispose();
    },
  };
}
