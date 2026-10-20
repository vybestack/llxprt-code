/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  createAgent,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { createMockCommandContext } from '../mockCommandContext.js';
import { commandDeps } from '../native-command-fixture.js';
import { processSlashCommand } from '../../ui/hooks/slashCommandHandlers.js';
import type { HistoryItemWithoutId, Message } from '../../ui/types.js';

const environmentKeys = [
  'LLXPRT_HISTORY_BACKEND',
  'LLXPRT_FAKE_RESPONSES',
  'LLXPRT_LOG_HOME',
] as const;

export interface WholeProductFixture {
  readonly root: string;
  readonly live: Agent;
  readonly errors: Message[];
  agent(id: string): Promise<Agent>;
  command(text: string): Promise<void>;
  displayed(): readonly HistoryItemWithoutId[];
  close(): Promise<void>;
}

async function responseFixture(root: string): Promise<string> {
  const path = join(root, 'responses.jsonl');
  const reply = {
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: '<state_snapshot>The workspace receipt was created; continue from the saved checkpoint.</state_snapshot>',
          },
        ],
      },
    ],
  };
  const tool = {
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'receipt-write',
            name: 'write_file',
            parameters: {
              file_path: join(root, 'receipt.txt'),
              content: 'durable tool receipt\n',
            },
          },
        ],
      },
    ],
  };
  const task = {
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'lifecycle-child',
            name: 'task',
            parameters: {
              subagent_name: 'w24-child',
              goal_prompt: 'Create the child receipt and report completion.',
              tool_whitelist: ['write_file'],
            },
          },
        ],
      },
    ],
  };
  await writeFile(
    path,
    Array.from({ length: 32 }, (_, index): string => {
      if (index === 1) return JSON.stringify(tool);
      if (index === 6) return JSON.stringify(task);
      return JSON.stringify(reply);
    }).join('\n') + '\n',
  );
  return path;
}

function dispatcher(
  live: Agent,
): Pick<WholeProductFixture, 'errors' | 'command' | 'displayed'> {
  let displayed: readonly HistoryItemWithoutId[] = [];
  const errors: Message[] = [];
  const context = createMockCommandContext({
    recordingOwner: 'agent',
    services: { agent: live },
    ui: {
      loadHistory: (items: readonly HistoryItemWithoutId[]): void => {
        displayed = items;
      },
    },
  });
  const deps = commandDeps(context, errors);
  return {
    errors,
    displayed: (): readonly HistoryItemWithoutId[] => displayed,
    command: async (text: string): Promise<void> => {
      expect(
        await processSlashCommand(deps, text, undefined, undefined, false),
      ).toStrictEqual({ type: 'handled' });
      expect(errors).toStrictEqual([]);
    },
  };
}

export async function wholeProductFixture(): Promise<WholeProductFixture> {
  const saved = { ...process.env };
  const base = resolve(
    import.meta.dir,
    '../../../../../tmp/854-notes/p4/w24/lifecycle-run-a/fixtures',
  );
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'whole-product-'));
  const responses = await responseFixture(root);
  process.env.LLXPRT_HISTORY_BACKEND = 'journal';
  process.env.LLXPRT_FAKE_RESPONSES = responses;
  process.env.LLXPRT_LOG_HOME = join(root, 'logs');
  const agents: Agent[] = [];
  const agent = async (sessionId: string): Promise<Agent> => {
    const created = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      sessionId,
      workingDir: root,
      interactive: true,
      folderTrust: true,
      coreTools: ['write_file', 'task'],
      approvalMode: ApprovalMode.YOLO,
      harness: { forceConfirmations: false, includeProcessCwd: false },
      telemetry: { enabled: false },
      compression: { strategy: 'one-shot' },
      settings: {
        profileDirectory: join(root, 'profiles'),
        subagentDirectory: join(root, 'subagents'),
      },
    });
    agents.push(created);
    return created;
  };
  const live = await agent('w24-source');
  return {
    root,
    live,
    agent,
    ...dispatcher(live),
    close: async (): Promise<void> => {
      try {
        for (const owned of agents) await owned.dispose();
      } finally {
        for (const key of environmentKeys) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      }
    },
  };
}

export async function send(
  agent: Agent,
  text: string,
): Promise<readonly AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of agent.stream(text)) {
    if (event.type === 'error') throw new Error(event.error.message);
    events.push(event);
  }
  expect(
    events
      .filter((event) => event.type === 'done')
      .map((event) => event.reason),
  ).toStrictEqual(['stop']);
  return events;
}
