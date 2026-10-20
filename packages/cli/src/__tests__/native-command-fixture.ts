/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import {
  DebugLogger,
  type MediaReferenceBlock,
} from '@vybestack/llxprt-code-core';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { createMockCommandContext } from './mockCommandContext.js';
import { chatOwnerCommand } from '../ui/commands/chatOwnerCommand.js';
import { continueCommand } from '../ui/commands/continueCommand.js';
import type { HistoryItemWithoutId, Message } from '../ui/types.js';
import type { SlashCommandProcessorActions } from '../ui/hooks/slashCommandProcessor.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from '../ui/hooks/slashCommandHandlers.js';
const actions: SlashCommandProcessorActions = {
  openAuthDialog: () => {},
  openThemeDialog: () => {},
  openEditorDialog: () => {},
  openPrivacyNotice: () => {},
  openSettingsDialog: () => {},
  openLoggingDialog: () => {},
  openSubagentDialog: () => {},
  openModelsDialog: () => {},
  openPermissionsDialog: () => {},
  openPoliciesDialog: () => {},
  openProviderDialog: () => {},
  openLoadProfileDialog: () => {},
  openCreateProfileDialog: () => {},
  openProfileListDialog: () => {},
  viewProfileDetail: () => {},
  openProfileEditor: () => {},
  quit: () => {},
  setDebugMessage: () => {},
  toggleCorgiMode: () => {},
  toggleDebugProfiler: () => {},
  dispatchExtensionStateUpdate: () => {},
  addConfirmUpdateExtensionRequest: () => {},
  openWelcomeDialog: () => {},
  openSessionBrowserDialog: () => {},
};

export async function durable(path: string): Promise<{
  count: number;
  digest: string;
  media: MediaReferenceBlock | undefined;
}> {
  const journal = await JournalSession.open(path);
  const hash = createHash('sha256');
  let count = 0;
  let media: MediaReferenceBlock | undefined;
  try {
    for await (const row of journal.rows()) {
      count++;
      hash.update(JSON.stringify(row.content));
      const reference = row.content.blocks.find(
        (block) => block.type === 'media' && block.encoding === 'reference',
      );
      if (reference !== undefined) media = reference;
    }
    return { count, digest: hash.digest('hex'), media };
  } finally {
    await journal.close();
  }
}

export async function recording(agent: Agent): Promise<string> {
  await agent.session.flushRecording();
  const path = agent.session.getRecording().path;
  if (path === undefined) throw new Error('Missing native CLI recording');
  return path;
}

export async function turn(
  agent: Agent,
  text: string,
  media?: MediaReferenceBlock,
): Promise<void> {
  let done = false;
  for await (const event of agent.stream({
    speaker: 'human',
    blocks: [{ type: 'text', text }, ...(media === undefined ? [] : [media])],
  })) {
    if (event.type === 'error') throw new Error(event.error.message);
    if (event.type === 'done') done = event.reason === 'stop';
  }
  expect(done).toBe(true);
}

export interface NativeCommandFixture {
  readonly root: string;
  readonly live: Agent;
  readonly errors: Message[];
  readonly items: HistoryItemWithoutId[];
  agent(sessionId: string): Promise<Agent>;
  displayed(): readonly HistoryItemWithoutId[];
  command(text: string): Promise<void>;
  close(): Promise<void>;
}

export async function nativeCommandFixture(): Promise<NativeCommandFixture> {
  const saved = { ...process.env };
  const root = await mkdtemp(join(tmpdir(), 'w23-cli-fault-'));
  const fixture = join(root, 'turns.jsonl');
  await writeFile(
    fixture,
    (
      JSON.stringify({
        chunks: [
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'A recorded reply.' }],
          },
        ],
      }) + '\n'
    ).repeat(6),
  );
  process.env.LLXPRT_HISTORY_BACKEND = 'journal';
  process.env.LLXPRT_FAKE_RESPONSES = fixture;
  process.env.LLXPRT_LOG_HOME = join(root, 'logs');
  async function agent(sessionId: string): Promise<Agent> {
    return createAgent({
      provider: 'fake',
      model: 'fake-model',
      sessionId,
      workingDir: root,
      interactive: true,
      folderTrust: true,
      coreTools: [],
    });
  }
  const live = await agent('cli-fault-current');
  let displayed: readonly HistoryItemWithoutId[] = [];
  const errors: Message[] = [];
  const items: HistoryItemWithoutId[] = [];
  const context = createMockCommandContext({
    recordingOwner: 'agent',
    services: { agent: live },
    ui: {
      loadHistory: (history: readonly HistoryItemWithoutId[]): void => {
        displayed = history;
      },
      addItem: (item: HistoryItemWithoutId): number => {
        items.push(item);
        return items.length;
      },
      clear: (): void => {
        displayed = [];
      },
    },
  });
  const deps = commandDeps(context, errors);
  return {
    root,
    live,
    agent,
    errors,
    items,
    displayed: (): readonly HistoryItemWithoutId[] => displayed,
    command: async (text: string): Promise<void> => {
      expect(
        await processSlashCommand(deps, text, undefined, undefined, false),
      ).toStrictEqual({ type: 'handled' });
    },
    close: async (): Promise<void> => {
      try {
        await live.dispose();
      } finally {
        for (const key of [
          'LLXPRT_HISTORY_BACKEND',
          'LLXPRT_FAKE_RESPONSES',
          'LLXPRT_LOG_HOME',
        ]) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      }
    },
  };
}

export function commandDeps(
  context: ReturnType<typeof createMockCommandContext>,
  errors: Message[],
): SlashCommandHandlerDeps {
  return {
    commands: [chatOwnerCommand, continueCommand],
    config: context.services.config,
    commandContext: context,
    actions,
    addItem: context.ui.addItem,
    addMessage: (message): void => {
      errors.push(message);
    },
    setIsProcessing: (): void => {},
    setLocalIsProcessing: (): void => {},
    setPendingItem: (): void => {},
    setSessionShellAllowlist: (): void => {},
    setConfirmationRequest: (): void => {},
    confirmationLogger: new DebugLogger('native-cli-fault-confirmation'),
    slashCommandLogger: new DebugLogger('native-cli-fault'),
    beginSlashCommandAction: (): AbortController => new AbortController(),
    endSlashCommandAction: (): void => {},
  };
}

export async function finishFaultTest(
  fixture: NativeCommandFixture,
  target: Agent,
  primaryFailure: unknown,
): Promise<void> {
  const cleanup = await Promise.allSettled([target.dispose(), fixture.close()]);
  const failures = cleanup.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(
      [primaryFailure, ...failures],
      'CLI fault test and cleanup failed',
    );
}
