import { captureSessionOwner } from '../../../../../../agents/src/api/__tests__/helpers/capture-session-owner.js';
import { rawClientChatCommand } from '../../../../__tests__/raw-chat-command.fixture.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLockedSessionRecorder,
  type IContent,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '@vybestack/llxprt-code-core/journal/rowTreeReader.js';
import { readStoredRow } from '@vybestack/llxprt-code-core/journal/rowReads.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { StreamOnlyHistory } from '../../../../../../agents/src/api/__tests__/helpers/public-history-fixture.js';
import { buildAgent } from '../../../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import { createMockCommandContext } from '../../../../__tests__/mockCommandContext.js';
import type { CommandContext, SlashCommand } from '../../types.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

export interface ChatMutationFixture {
  readonly context: CommandContext;
  readonly chatCommand: SlashCommand;
  readonly history: HistoryService;
  readonly client: AgentClientContract;
  readonly recording: SessionRecordingPort;
  readonly reader: RowOwnership;
}

async function* readRecordedRows(
  session: Awaited<ReturnType<typeof openJournalReadOnly>>,
  root: NonNullable<ReturnType<typeof rowTreeRootOf>>,
): AsyncGenerator<IContent> {
  for await (const entry of iterateRowEntries(session, root))
    yield decodeStoredRow(await readStoredRow(session, entry));
}

export async function* recordedChatRows(
  recording: SessionRecordingPort,
  history: HistoryService,
): AsyncGenerator<IContent, void, unknown> {
  await history.waitForCommit();
  await recording.flush();
  const file = recording.getFilePath();
  if (file === null) throw new Error('Missing recording path');
  const session = await openJournalReadOnly(file);
  try {
    const root = rowTreeRootOf(session.trailer);
    if (root === undefined) return;
    yield* readRecordedRows(session, root);
  } finally {
    await session.close();
  }
}

export async function withChatMutationFixture<T>(
  size: number,
  execute: (fixture: ChatMutationFixture) => Promise<T>,
  bytes = 2048,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'chat-mutation-'));
  const recording = await createLockedSessionRecorder({
    sessionId: crypto.randomUUID(),
    projectHash: 'chat-stream',
    chatsDir: root,
    workspaceDirs: [root],
    cwd: root,
    provider: 'test',
    model: 'test',
  });
  try {
    return await withSuffixFixture(
      size,
      async (history, reader) => {
        const {
          value: { cleanup },
          owner,
        } = await captureSessionOwner(() => buildAgent('plain-text.jsonl'));
        const client = owner.clients.getAgentClient();
        const priorHistory = client.getHistoryService();
        client.storeHistoryServiceForReuse(history);
        try {
          await client.startChat([]);
          const context = createMockCommandContext({
            services: {
              config: { getEphemeralSetting: () => undefined },
              agent: null,
            },
          });
          context.recordingIntegration = undefined;
          context.recordingSwapCallbacks = {
            getCurrentRecording: () => recording,
            getCurrentIntegration: () => null,
            getCurrentLockHandle: () => null,
            getCurrentMetadata: () => null,
            setRecording: () => {},
          };
          await history.attachJournal(recording);
          const chatCommand = rawClientChatCommand(
            client,
            () => recording,
            () => 'fake-model',
          );
          return await execute({
            context,
            chatCommand,
            history,
            client,
            recording,
            reader,
          });
        } finally {
          await cleanup();
          if (priorHistory !== history) await priorHistory?.dispose();
        }
      },
      bytes,
      accountingRow,
      undefined,
      (options) => new StreamOnlyHistory(options),
    );
  } finally {
    await recording.dispose();
  }
}
