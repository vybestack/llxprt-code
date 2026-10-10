/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { CompressionStrategy } from '@vybestack/llxprt-code-core/core/compression/types.js';
import * as compressionFactory from '../../compression/compressionStrategyFactory.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

type HookInput = {
  hook_event_name: string;
  session_id: string;
  transcript_path: string;
};

function recordingPath(path: string | undefined): string {
  if (path === undefined) throw new Error('Missing recording path');
  return path;
}

async function readInputs(path: string): Promise<HookInput[]> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

async function verifyFacades(
  events: readonly HookEventName[],
  drive: (agent: Agent, input: string) => Promise<void>,
  verify: (matched: HookInput[], paths: string[]) => void,
): Promise<void> {
  const output = join(
    tmpdir(),
    `recording-remaining-hooks-${randomUUID()}.jsonl`,
  );
  try {
    await withRecordingLifetimeFixture(
      async ({ agent, borrow }) => {
        const sibling = await borrow();
        await agent.setHistory([
          { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
        ]);
        await agent.session.setRecording({ enabled: true });
        const aPath = recordingPath(agent.session.getRecording().path);
        await sibling.session.setRecording({ enabled: true });
        const bPath = recordingPath(sibling.session.getRecording().path);
        await drive(agent, 'A first');
        await drive(sibling, 'B first');
        await agent.session.setRecording({ enabled: false });
        await drive(agent, 'A stopped');
        await agent.session.resume('latest');
        const resumed = recordingPath(agent.session.getRecording().path);
        await drive(agent, 'A resumed');
        const inputs = await readInputs(output);
        for (const event of events) {
          const matched = inputs.filter(
            (entry) => entry.hook_event_name === event,
          );
          verify(matched, [aPath, bPath, '', resumed]);
        }
      },
      undefined,
      {
        hooks: Object.fromEntries(
          events.map((event) => [
            event,
            [
              {
                hooks: [
                  {
                    type: HookType.Command,
                    command: `cat >> '${output}'; printf '\\n' >> '${output}'`,
                  },
                ],
              },
            ],
          ]),
        ),
      },
      'recording-remaining-hooks.jsonl',
    );
  } finally {
    await rm(output, { force: true });
  }
}

describe('borrowed facade remaining hook producers', () => {
  it('attributes detached direct generation selection and model hooks to each executing facade', async () => {
    await verifyFacades(
      [
        HookEventName.BeforeToolSelection,
        HookEventName.BeforeModel,
        HookEventName.AfterModel,
      ],
      async (agent, input) => {
        await agent.generate(input);
      },
      (matched, paths) => {
        expect(matched.map((entry) => entry.transcript_path)).toStrictEqual(
          paths,
        );
        expect(matched[0].session_id).not.toBe(matched[1].session_id);
        expect(matched[0].session_id).toBe(matched[2].session_id);
        expect(matched[0].session_id).toBe(matched[3].session_id);
      },
    );
  }, 30000);

  it('attributes stream BeforeAgent and AfterAgent command hooks to each executing facade', async () => {
    await verifyFacades(
      [HookEventName.BeforeAgent, HookEventName.AfterAgent],
      async (agent, input) => {
        for await (const _event of agent.stream(input)) {
          void _event;
        }
      },
      (matched, paths) => {
        expect(matched.map((entry) => entry.transcript_path)).toStrictEqual(
          paths,
        );
        expect(matched[0].session_id).not.toBe(matched[1].session_id);
        expect(matched[0].session_id).toBe(matched[2].session_id);
        expect(matched[0].session_id).toBe(matched[3].session_id);
      },
    );
  }, 30000);

  it('routes automatic provider-content PreCompress after A stops and resumes', async () => {
    const output = join(
      tmpdir(),
      `recording-remaining-hooks-${randomUUID()}.jsonl`,
    );
    const strategy: CompressionStrategy = {
      name: 'one-shot',
      requiresLLM: false,
      trigger: { mode: 'threshold', defaultThreshold: 0.8 },
      compress: async (context) => ({
        kind: 'applied',
        newHistory: [
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'short summary' }],
            metadata: { reason: 'compression-state-snapshot' },
          },
        ],
        metadata: {
          originalMessageCount: context.history.length,
          compressedMessageCount: 1,
          strategyUsed: 'one-shot',
          llmCallMade: false,
        },
      }),
    };
    const strategySpy = spyOn(
      compressionFactory,
      'getCompressionStrategy',
    ).mockReturnValue(strategy);
    try {
      await withRecordingLifetimeFixture(
        async ({ agent, borrow }) => {
          const sibling = await borrow();
          agent.setEphemeralSetting('context-limit', 4096);
          await agent.setHistory([
            { speaker: 'human', blocks: [{ type: 'text', text: 'seed' }] },
          ]);
          await agent.session.setRecording({ enabled: true });
          const aPath = recordingPath(agent.session.getRecording().path);
          await sibling.session.setRecording({ enabled: true });
          const bPath = recordingPath(sibling.session.getRecording().path);
          const send = async (active: Agent): Promise<void> => {
            await active.setHistory([
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: 'history '.repeat(9000) }],
              },
            ]);
            for await (const _event of active.stream('short prompt'))
              void _event;
          };
          await send(agent);
          await send(sibling);
          await agent.session.setRecording({ enabled: false });
          await send(agent);
          await agent.session.resume('latest');
          const resumed = recordingPath(agent.session.getRecording().path);
          await send(agent);
          const inputs = (await readInputs(output)).filter(
            (input) => input.hook_event_name === HookEventName.PreCompress,
          );
          expect(inputs.map((input) => input.transcript_path)).toStrictEqual([
            aPath,
            bPath,
            '',
            resumed,
          ]);
          expect(inputs[0].session_id).not.toBe(inputs[1].session_id);
          expect(inputs[0].session_id).toBe(inputs[2].session_id);
          expect(inputs[0].session_id).toBe(inputs[3].session_id);
        },
        undefined,
        {
          hooks: {
            [HookEventName.PreCompress]: [
              {
                hooks: [
                  {
                    type: HookType.Command,
                    command: `cat >> '${output}'; printf '\\n' >> '${output}'`,
                  },
                ],
              },
            ],
          },
        },
        'recording-remaining-hooks.jsonl',
      );
    } finally {
      strategySpy.mockRestore();
      await rm(output, { force: true });
    }
  }, 30000);
});
