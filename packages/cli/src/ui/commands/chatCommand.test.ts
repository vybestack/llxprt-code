import { checkpointBindings } from '../../__tests__/recording-checkpoint-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  readJournalCheckpoints,
  readJournalFileFacts,
} from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';
import { readRecordedRows } from '../../__tests__/journal-recording.js';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';

import {
  LocalMediaStore,
  createLockedSessionRecorder,
  type SessionRecordingPort,
  type IContent,
} from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertDefined } from '../../__tests__/assertions.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { MessageType, type HistoryItemWithoutId } from '../types.js';
import { createChatCommand } from './chatCommand.js';
import { bindChatRecordingOperations } from './chatCommandHost.js';
import { NativeHistoryPrefixOwner } from '@vybestack/llxprt-code-core/services/history/native-history-prefix.js';
import { NativeJournalCursor } from '../stores/turn/native-journal-cursor.js';
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';
import { createCompletionHandler } from './schema/index.js';
import type { SlashCommand } from './types.js';

const PROJECT_HASH = 'chat-command-checkpoints';

function content(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function recordingPath(recording: SessionRecordingPort): string {
  return recording.getFilePath() ?? '';
}

let root: string;

let chatsDir: string;

let recording: SessionRecordingPort;

let mediaStore: LocalMediaStore;

let context: CommandOwnerFixture;

let mutationHistory: HistoryService | undefined;

let displayed: unknown[];

async function installHistory(rows: readonly IContent[]): Promise<void> {
  mutationHistory = new HistoryService();
  const history = mutationHistory;
  await history.replaceBatch(rows);
  displayed = [];
  context.ui.addItem = (item) => {
    displayed.push(item);
    return displayed.length;
  };
}

const registeredChat = (): SlashCommand =>
  createChatCommand(
    bindChatRecordingOperations(
      () => recording,
      () => PROJECT_HASH,
      () => chatsDir,
      ...checkpointBindings(
        () => recording,
        () => PROJECT_HASH,
        () => chatsDir,
        () => mediaStore,
      ),
      () => mutationHistory?.streamRawHistory() ?? null,
      async () => {
        const history = mutationHistory;
        if (!history) throw new Error('Missing raw history');
        await new NativeHistoryPrefixOwner(history).withPrefix(
          2,
          false,
          mediaStore,
          (prefix) => prefix.apply(history),
        );
      },
      async (turns) => {
        const history = mutationHistory;
        if (!history) throw new Error('Missing raw history');
        const itemsRemoved = await new NativeHistoryPrefixOwner(
          history,
        ).withPrefix(turns, true, mediaStore, async (prefix) => {
          await prefix.apply(history);
          return prefix.removed;
        });
        return { itemsRemoved };
      },
      () => context.services.config?.getModel() ?? null,
    ),
    () => true,
  );

async function displayedHistory(): Promise<HistoryItemWithoutId[]> {
  await recording.flush();
  const cursor = await NativeJournalCursor.open(recordingPath(recording), {
    emojiFilterMode: 'allowed',
  });
  try {
    const items: HistoryItemWithoutId[] = [];
    for (const entry of (await cursor.pageBack(64)).entries.reverse()) {
      if (entry.kind !== 'projected' || entry.contextState !== 'in-context')
        continue;
      const item = entry.item;
      if (item.type === MessageType.USER) {
        items.push({ type: item.type, text: item.text });
      } else if (item.type === MessageType.AI) {
        items.push({
          type: item.type,
          text: item.text,
          ...(item.thinkingBlocks === undefined
            ? {}
            : { thinkingBlocks: item.thinkingBlocks }),
        });
      } else {
        throw new Error('Unexpected active raw history item');
      }
    }
    return items;
  } finally {
    await cursor.close();
  }
}

const command = (name: string): SlashCommand => {
  const result = registeredChat().subCommands?.find(
    (item) => item.name === name,
  );
  assertDefined(result);
  return result;
};

const completionValues = async (
  commandName: string,
  partial: string,
): Promise<string[]> => {
  const schema = command(commandName).schema;
  assertDefined(schema);
  const handler = createCompletionHandler(schema, true);
  const result = await handler(
    context,
    {
      args: partial,
      completedArgs: [],
      partialArg: partial,
      commandPathLength: 2,
    },
    `/chat ${commandName} ${partial}`,
  );
  return result.suggestions.map((option) => option.value);
};

async function chatCommandCase0(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'chat-command-'));
  chatsDir = join(root, 'chats');
  mediaStore = new LocalMediaStore({
    rootDirectory: join(root, 'media'),
    quotaBytes: 1024 * 1024,
  });
  recording = await createLockedSessionRecorder({
    sessionId: crypto.randomUUID(),
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: [root],
    cwd: root,
    provider: 'fake',
    model: 'fake-model',
  });
  await recordRowsForTest(recording, [content('human', 'A')]);
  await recordRowsForTest(recording, [content('ai', 'B')]);
  await recording.flush();
  context = createMockCommandContext({
    recordingSwapCallbacks: {
      getCurrentRecording: () => recording,
    },
  });
  assertDefined(context.services.config);
  Object.assign(context.services.config, { getProjectRoot: () => root });
}

async function chatCommandCase1(): Promise<void> {
  try {
    await mutationHistory?.dispose();
    mutationHistory = undefined;
    if (typeof recording !== 'undefined') await recording.dispose();
  } finally {
    if (typeof root !== 'undefined') {
      await rm(root, { recursive: true, force: true });
    }
  }
}

function chatCommandCase2(): void {
  describe('creates, lists, renames, and tombstones checkpoints in the active journal recording', () => {
    it('creates, lists, renames, and tombstones checkpoints in the active journal recording', async () => {
      expect(
        await command('save').action?.(context, 'milestone'),
      ).toMatchObject({
        type: 'message',
        messageType: 'info',
      });

      await command('list').action?.(context, '');
      expect(context.ui.addItem).toHaveBeenCalledWith({
        type: 'chat_list',
        chats: [expect.objectContaining({ name: 'milestone' })],
      });

      expect(
        await command('rename').action?.(context, 'milestone renamed'),
      ).toMatchObject({ type: 'message', messageType: 'info' });
      context.overwriteConfirmed = true;
      expect(
        await command('delete').action?.(context, 'renamed'),
      ).toMatchObject({
        type: 'message',
        messageType: 'info',
      });

      expect(
        await readJournalCheckpoints(recordingPath(recording)),
      ).toStrictEqual([]);
    });
  });
}

function chatCommandCase3(): void {
  describe('/chat resume emits the canonical continuation transition action', () => {
    it('/chat resume emits the canonical continuation transition action', async () => {
      expect(
        await command('resume').action?.(context, 'milestone'),
      ).toStrictEqual({
        type: 'perform_resume',
        sessionRef: 'milestone',
      });
    });
  });
}

function chatCommandCase4(): void {
  describe('names the active session without changing its title', () => {
    it('names the active session without changing its title', async () => {
      expect(
        await command('name').action?.(context, 'living-branch'),
      ).toMatchObject({
        type: 'message',
        messageType: 'info',
      });
      const facts = await readJournalFileFacts(recordingPath(recording));
      expect(facts).toBeDefined();
      expect(facts?.facts.name).toBe('living-branch');
      expect(facts?.facts.title).toBeUndefined();
    });
  });
}

function chatCommandCase5(): void {
  describe('exposes all recording-native subcommands', () => {
    it('exposes all recording-native subcommands', () => {
      expect(
        registeredChat().subCommands?.map((item) => item.name),
      ).toStrictEqual([
        'list',
        'save',
        'resume',
        'delete',
        'rename',
        'clear',
        'restore',
        'name',
        'debug',
      ]);
    });
  });
}

function chatCommandCase6(): void {
  describe('rejects /chat save without a tag', () => {
    it('rejects /chat save without a tag', async () => {
      expect(await command('save').action?.(context, '')).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat save <tag>',
      });
    });
  });
}

function chatCommandCase7(): void {
  describe('rejects /chat resume without a tag', () => {
    it('rejects /chat resume without a tag', async () => {
      expect(await command('resume').action?.(context, '   ')).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat resume <tag>',
      });
    });
  });
}

function chatCommandCase8(): void {
  describe('rejects /chat delete without a tag', () => {
    it('rejects /chat delete without a tag', async () => {
      expect(await command('delete').action?.(context, '')).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat delete <tag>',
      });
    });
  });
}

function chatCommandCase9(): void {
  describe('prompts for confirmation before deleting a checkpoint', () => {
    it('prompts for confirmation before deleting a checkpoint', async () => {
      expect(
        await command('delete').action?.(context, 'milestone'),
      ).toMatchObject({
        type: 'confirm_action',
      });
    });
  });
}

function chatCommandCase10(): void {
  describe('requests overwrite confirmation when saving a duplicate checkpoint name', () => {
    it('requests overwrite confirmation when saving a duplicate checkpoint name', async () => {
      await command('save').action?.(context, 'dupe');

      const result = await command('save').action?.(context, 'dupe');

      expect(result).toMatchObject({ type: 'confirm_action' });
    });
  });
}

function chatCommandCase11(): void {
  describe('replaces a duplicate checkpoint after overwrite confirmation', () => {
    it('replaces a duplicate checkpoint after overwrite confirmation', async () => {
      await command('save').action?.(context, 'dupe');
      context.overwriteConfirmed = true;

      const result = await command('save').action?.(context, 'dupe');
      const checkpoints = await readJournalCheckpoints(
        recordingPath(recording),
      );

      expect({
        result,
        checkpoints,
      }).toStrictEqual({
        result: {
          type: 'message',
          messageType: 'info',
          content: 'Checkpoint saved: dupe.',
        },
        checkpoints: [expect.objectContaining({ name: 'dupe' })],
      });
    });
  });
}

function chatCommandCase12(): void {
  describe('reports an error when saving an empty recording', () => {
    it('reports an error when saving an empty recording', async () => {
      await recording.dispose();
      recording = await createLockedSessionRecorder({
        sessionId: crypto.randomUUID(),
        projectHash: PROJECT_HASH,
        chatsDir,
        workspaceDirs: [root],
        cwd: root,
        provider: 'fake',
        model: 'fake-model',
      });

      expect(await command('save').action?.(context, 'empty')).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Failed to save checkpoint: Cannot create checkpoint: conversation has no content yet',
      });
    });
  });
}

function chatCommandCase13(): void {
  describe('treats an initialized empty history as having nothing to clear', () => {
    it('treats an initialized empty history as having nothing to clear', async () => {
      await installHistory([]);

      expect(await command('clear').action?.(context, '')).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: 'No conversation to clear.',
      });
    });
  });
}

function chatCommandCase14(): void {
  describe('restores the requested human turn and persists its rewind', () => {
    it('restores the requested human turn and persists its rewind', async () => {
      const history = [
        content('human', 'A'),
        content('ai', 'B'),
        content('human', 'C'),
        content('ai', 'D'),
      ];
      await installHistory(history);
      await mutationHistory?.attachJournal(recording, true);

      const result = await command('restore').action?.(context, '1');

      expect(result).toBeUndefined();
      expect(await displayedHistory()).toStrictEqual([
        { type: MessageType.USER, text: 'A' },
        { type: MessageType.AI, text: 'B' },
      ]);
      const remaining: IContent[] = [];
      for await (const row of mutationHistory?.streamRawHistory() ?? [])
        remaining.push(row);
      expect(remaining.map((row) => row.blocks)).toStrictEqual(
        history.slice(0, 2).map((row) => row.blocks),
      );
      expect(await readRecordedRows(recordingPath(recording))).toMatchObject([
        content('human', 'A'),
        content('ai', 'B'),
      ]);
    });
  });
}

function chatCommandCase15(): void {
  describe('restore payload carries model thinking blocks through to replay (#2888)', () => {
    it('restore payload carries model thinking blocks through to replay (#2888)', async () => {
      const aiTurn: IContent = {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'pondering \u2705' },
          { type: 'text', text: 'B' },
        ],
      };
      const history = [
        content('human', 'A'),
        aiTurn,
        content('human', 'C'),
        content('ai', 'D'),
      ];
      await installHistory(history);
      await mutationHistory?.attachJournal(recording, true);

      const result = await command('restore').action?.(context, '1');

      expect(result).toBeUndefined();
      expect(await displayedHistory()).toStrictEqual([
        { type: MessageType.USER, text: 'A' },
        {
          type: MessageType.AI,
          text: 'B',
          thinkingBlocks: [{ type: 'thinking', thought: 'pondering \u2705' }],
        },
      ] satisfies HistoryItemWithoutId[]);
      const remaining: IContent[] = [];
      for await (const row of mutationHistory?.streamRawHistory() ?? [])
        remaining.push(row);
      expect(remaining.map((row) => row.blocks)).toStrictEqual(
        history.slice(0, 2).map((row) => row.blocks),
      );
    });
  });
}

function chatCommandCase16(): void {
  describe('completes checkpoint names for /chat resume', () => {
    it('completes checkpoint names for /chat resume', async () => {
      await command('save').action?.(context, 'alpha');
      await command('save').action?.(context, 'beta');

      expect(await completionValues('resume', 'alph')).toStrictEqual(['alpha']);
    });
  });
}

function chatCommandCase17(): void {
  describe('completes checkpoint names for /chat delete', () => {
    it('completes checkpoint names for /chat delete', async () => {
      await command('save').action?.(context, 'alpha');
      await command('save').action?.(context, 'beta');

      expect(await completionValues('delete', 'b')).toStrictEqual(['beta']);
    });
  });
}

function chatCommandCase18(): void {
  describe('reports recording-native debug information', () => {
    it('reports recording-native debug information', async () => {
      assertDefined(context.services.config);
      Object.assign(context.services.config, {
        getModel: () => {
          throw new Error('No model configured for the recording fixture');
        },
      });
      const result = await command('debug').action?.(context, '');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: `Chat Debug Information:
• Chat initialized: false
• History entries: 0 (chat not initialized)
• Current model: unavailable
• Recording file: ${recording.getFilePath()}
• Session ID: ${recording.getSessionId()}`,
      });
    });
  });
}

describe('chatCommand recording-native checkpoints @plan:2026-07-28-issue-2625', () => {
  beforeEach(chatCommandCase0);
  afterEach(chatCommandCase1);
  chatCommandCase2();
  chatCommandCase3();
  chatCommandCase4();
  chatCommandCase5();
  chatCommandCase6();
  chatCommandCase7();
  chatCommandCase8();
  chatCommandCase9();
  chatCommandCase10();
  chatCommandCase11();
  chatCommandCase12();
  chatCommandCase13();
  chatCommandCase14();
  chatCommandCase15();
  chatCommandCase16();
  chatCommandCase17();
  chatCommandCase18();
});
