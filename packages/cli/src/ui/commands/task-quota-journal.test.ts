/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { NativeJournalCursor } from '../stores/turn/native-journal-cursor.js';
import { createTaskCommand } from './tasksCommand.js';
import { createQuotaCommand } from './quotaCommand.js';
import { journalCommandOutput } from '../../__tests__/journal-command-output-fixture.js';
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

interface CommandCase {
  readonly command: 'task' | 'quota';
  readonly subcommand: string;
  readonly args: string;
  readonly type: 'info' | 'error';
  readonly text: string;
}

const cases: readonly CommandCase[] = [
  {
    command: 'task',
    subcommand: 'list',
    args: '',
    type: 'info',
    text: 'No async tasks.',
  },
  {
    command: 'task',
    subcommand: 'end',
    args: '',
    type: 'error',
    text: 'Usage: /task end <task_id>',
  },
  {
    command: 'task',
    subcommand: 'end',
    args: 'missing-task',
    type: 'error',
    text: 'Task not found: missing-task',
  },
  {
    command: 'quota',
    subcommand: 'credits',
    args: '',
    type: 'info',
    text: 'No Codex reset credits available. Reset credits are earned via referrals or purchased.',
  },
  {
    command: 'quota',
    subcommand: 'reset',
    args: 'other',
    type: 'error',
    text: "Only 'codex' supports reset.",
  },
  {
    command: 'quota',
    subcommand: 'reset',
    args: 'codex extra',
    type: 'error',
    text: 'Too many arguments. Usage: /quota reset [codex]',
  },
  {
    command: 'quota',
    subcommand: 'reset',
    args: 'codex',
    type: 'info',
    text: 'Not authenticated with Codex. Run /auth codex to login.',
  },
];

function journalContext(agent: Agent): CommandOwnerFixture {
  const base = createMockCommandContext();
  return {
    ...base,
    recordingOwner: 'agent',
    services: { ...base.services, agent },
    ui: {
      ...base.ui,
      addItem: () => {
        throw new Error('Ledger write forbidden');
      },
    },
  };
}

async function readNotices(
  path: string,
): Promise<ReadonlyArray<{ type: string; text: string }>> {
  const cursor = await NativeJournalCursor.open(path, {}, 20);
  try {
    return (await cursor.pageBack(20)).entries.flatMap((entry) =>
      entry.kind === 'projected' &&
      'text' in entry.item &&
      typeof entry.item.text === 'string'
        ? [{ type: entry.item.type, text: entry.item.text }]
        : [],
    );
  } finally {
    await cursor.close();
  }
}

describe('task and quota journal presentation', () => {
  for (const scenario of cases) {
    it(`persists /${scenario.command} ${scenario.subcommand} ${scenario.args} before completion`, async () => {
      await withRecordingLifetimeFixture(async ({ agent }) => {
        await agent.session.setRecording({ enabled: true });
        const context = journalContext(agent);
        const output = journalCommandOutput(agent.session);
        context.ui.addItem = output.addItem;
        const registered =
          scenario.command === 'task'
            ? createTaskCommand(agent.tasks, output.addItem)
            : createQuotaCommand({
                oauthControl: {
                  isAvailable: () => true,
                  hasCodexToken: async () => false,
                  listBuckets: async () => [],
                  getAllCodexRateLimitResetCredits: async () => new Map(),
                  readCodexBucketToken: async () => null,
                },
                fetch: agent.sessionClient.fetch,
                baseUrlSetting: () => undefined,
                fetchQuotaLines: async () => [],
              });
        const action = registered.subCommands?.find(
          (command) => command.name === scenario.subcommand,
        )?.action;
        if (!action) throw new Error('Missing command action');
        await action(context, scenario.args);
        await output.settle();
        const path = agent.session.getRecording().path;
        if (!path) throw new Error('Missing journal path');
        await agent.session.setRecording({ enabled: false });
        expect(await readNotices(path)).toStrictEqual([
          { type: scenario.type, text: scenario.text },
        ]);
        expect(await agent.session.getHistory()).toStrictEqual([]);
      });
    }, 30000);
  }
});
