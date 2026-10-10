/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

type ToolConfirmation = Extract<AgentEvent, { type: 'tool-confirmation' }>;

async function nextConfirmation(
  iterator: AsyncIterator<AgentEvent>,
): Promise<ToolConfirmation> {
  const seen: AgentEvent[] = [];
  for (;;) {
    const event = await iterator.next();
    if (event.done === true)
      throw new Error(
        `Stream ended before tool confirmation: ${seen.map((item) => item.type).join(', ')}`,
      );
    seen.push(event.value);
    if (event.value.type === 'tool-confirmation') return event.value;
  }
}

async function finish(iterator: AsyncIterator<AgentEvent>): Promise<void> {
  for (;;) {
    if ((await iterator.next()).done === true) return;
  }
}

function pathOf(agent: Agent): string {
  const path = agent.session.getRecording().path;
  if (!path) throw new Error('Recording path missing');
  return path;
}

interface CommandInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
  tool_name?: string;
}

describe('borrowed facade tool hook owner routing', () => {
  it('retains A and B at deferred confirmation and reads the current recording path when each tool executes', async () => {
    const evidenceDir = join(process.cwd(), 'tmp', 'recording-tool-hook-owner');
    const output = join(
      process.cwd(),
      'tmp',
      'recording-tool-hook-owner',
      `${randomUUID()}.jsonl`,
    );
    try {
      await withRecordingLifetimeFixture(
        async ({ agent: a, borrow }) => {
          const b = await borrow();
          expect(a.getMessageBus()).toBe(b.getMessageBus());
          expect(a.agentClient).toBeDefined();
          await a.setHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'seed tools' }],
            },
          ]);
          await a.session.setRecording({ enabled: true });
          const aPath = pathOf(a);
          await b.session.setRecording({ enabled: true });
          const bPath = pathOf(b);
          expect(aPath).not.toBe(bPath);
          const aIterator = a.stream('A tool')[Symbol.asyncIterator]();
          const aApproval = await nextConfirmation(aIterator);
          const bIterator = b.stream('B tool')[Symbol.asyncIterator]();
          const bApproval = await nextConfirmation(bIterator);

          await a.session.setRecording({ enabled: false });
          a.tools.respondToConfirmation(
            aApproval.confirmation.confirmationId,
            ToolConfirmationOutcome.ProceedOnce,
          );
          await finish(aIterator);
          b.tools.respondToConfirmation(
            bApproval.confirmation.confirmationId,
            ToolConfirmationOutcome.ProceedOnce,
          );
          await finish(bIterator);

          await a.session.resume('latest');
          const resumedPath = pathOf(a);
          const resumed = a.stream('A resumed tool')[Symbol.asyncIterator]();
          const resumedApproval = await nextConfirmation(resumed);
          a.tools.respondToConfirmation(
            resumedApproval.confirmation.confirmationId,
            ToolConfirmationOutcome.ProceedOnce,
          );
          await finish(resumed);
          expect(await readFile(join(evidenceDir, 'a.txt'), 'utf8')).toBe('A');
          expect(await readFile(join(evidenceDir, 'b.txt'), 'utf8')).toBe('B');
          expect(await readFile(join(evidenceDir, 'resumed.txt'), 'utf8')).toBe(
            'resumed',
          );

          const inputs: CommandInput[] = (await readFile(output, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
          const toolInputs = inputs.filter(
            (input) =>
              input.hook_event_name === HookEventName.BeforeTool ||
              input.hook_event_name === HookEventName.AfterTool,
          );
          expect(
            toolInputs.map((input) => [
              input.hook_event_name,
              input.transcript_path,
              input.session_id,
            ]),
          ).toStrictEqual([
            [HookEventName.BeforeTool, '', a.getRuntimeId()],
            [HookEventName.AfterTool, '', a.getRuntimeId()],
            [HookEventName.BeforeTool, bPath, b.getRuntimeId()],
            [HookEventName.AfterTool, bPath, b.getRuntimeId()],
            [HookEventName.BeforeTool, resumedPath, a.getRuntimeId()],
            [HookEventName.AfterTool, resumedPath, a.getRuntimeId()],
          ]);
          expect(a.getRuntimeId()).not.toBe(b.getRuntimeId());
          expect(
            inputs
              .filter(
                (input) => input.hook_event_name === HookEventName.Notification,
              )
              .map((input) => [input.transcript_path, input.session_id]),
          ).toStrictEqual([
            [aPath, a.getRuntimeId()],
            [bPath, b.getRuntimeId()],
            [resumedPath, a.getRuntimeId()],
          ]);
        },
        undefined,
        {
          hooks: Object.fromEntries(
            [
              HookEventName.BeforeTool,
              HookEventName.AfterTool,
              HookEventName.Notification,
            ].map((event) => [
              event,
              [
                {
                  hooks: [
                    {
                      type: HookType.Command,
                      command: `node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>require("fs").appendFileSync(process.argv[1],JSON.stringify(JSON.parse(s))+"\\n"))' '${output}'`,
                    },
                  ],
                },
              ],
            ]),
          ),
        },
        'recording-tool-owner.jsonl',
      );
    } finally {
      await rm(output, { force: true });
      await Promise.all(
        ['a.txt', 'b.txt', 'resumed.txt'].map((name) =>
          rm(join(evidenceDir, name), { force: true }),
        ),
      );
    }
  }, 30000);
});
