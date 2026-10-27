/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';
import { makeScratchDir } from './helpers/scratch-dir.js';
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';

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

async function presentations(path: string): Promise<string[]> {
  const reader = await NativeJournalPageReader.open(path);
  const result: string[] = [];
  try {
    for await (const row of reader.entries()) {
      const presentation = await reader.presentation(row);
      if (
        presentation?.descriptor.type === 'tool-approval' ||
        presentation?.descriptor.type === 'tool-result'
      )
        result.push(
          `${presentation.descriptor.type}:${presentation.descriptor.callId}`,
        );
    }
    return result;
  } finally {
    await reader.close();
  }
}

interface CommandInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
  tool_name?: string;
}

describe('borrowed facade tool hook owner routing', () => {
  it('retains A and B at deferred confirmation and reads the current recording path when each tool executes', async () => {
    const evidenceDir = await makeScratchDir('recording-tool-hook-owner-');
    const output = join(evidenceDir, 'hooks.jsonl');
    const fixture = join(evidenceDir, 'responses.jsonl');
    try {
      expect(evidenceDir).not.toContain(resolve(import.meta.dir, '../../..'));
      const template = await readFile(
        join(import.meta.dir, 'fixtures/recording-tool-owner.jsonl'),
        'utf8',
      );
      await writeFile(
        fixture,
        template.replaceAll(
          '{{CWD}}/tmp/recording-tool-hook-owner',
          JSON.stringify(evidenceDir).slice(1, -1),
        ),
      );
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

          expect(await presentations(bPath)).toStrictEqual([
            'tool-approval:owner-b-1',
            'tool-approval:owner-b-1',
            'tool-result:owner-b-1',
          ]);
          expect(resumedPath).toBe(aPath);
          expect(await presentations(aPath)).toStrictEqual([
            'tool-approval:owner-a-1',
            'tool-approval:owner-a-2',
            'tool-approval:owner-a-2',
            'tool-result:owner-a-2',
          ]);
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
          workingDir: evidenceDir,
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
        fixture,
      );
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  }, 30000);
});
