/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { withRecordingLifetimeFixture } from './helpers/recording-owner-lifetime-fixture.js';

function requirePath(path: string | undefined): string {
  if (path === undefined) throw new Error('Recording path missing');
  return path;
}

describe('borrowed facade lifecycle hook transcript routing', () => {
  it('routes manual PreCompress command input through the current facade owner', async () => {
    const output = join(tmpdir(), `recording-hook-owner-${randomUUID()}.jsonl`);
    try {
      await withRecordingLifetimeFixture(
        async ({ agent, borrow }) => {
          const sibling = await borrow();
          await agent.setHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'seed compression hook' }],
            },
          ]);
          await agent.session.setRecording({ enabled: true });
          const aPath = requirePath(agent.session.getRecording().path);
          await sibling.session.setRecording({ enabled: true });
          const bPath = requirePath(sibling.session.getRecording().path);
          await agent.compress();
          await sibling.compress();
          const inputs: Array<{ session_id: string; transcript_path: string }> =
            (await readFile(output, 'utf8'))
              .trim()
              .split('\n')
              .map((line) => JSON.parse(line));
          expect(inputs.map((input) => input.transcript_path)).toStrictEqual([
            aPath,
            bPath,
          ]);
          expect(inputs[0].session_id).not.toBe(inputs[1].session_id);
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
      );
    } finally {
      await rm(output, { force: true });
    }
  }, 30000);

  it('routes model command hook input through the executing facade even with a shared chat', async () => {
    const output = join(tmpdir(), `recording-hook-owner-${randomUUID()}.jsonl`);
    const run = async (
      agent: { stream(input: string): AsyncIterable<unknown> },
      input: string,
    ): Promise<void> => {
      for await (const _event of agent.stream(input)) {
        void _event;
      }
    };
    try {
      await withRecordingLifetimeFixture(
        async ({ agent, borrow }) => {
          const sibling = await borrow();
          await agent.setHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'seed model hook' }],
            },
          ]);
          await agent.session.setRecording({ enabled: true });
          const aPath = requirePath(agent.session.getRecording().path);
          await sibling.session.setRecording({ enabled: true });
          const bPath = requirePath(sibling.session.getRecording().path);
          await run(agent, 'A model turn');
          await run(sibling, 'B model turn');
          const inputs: Array<{ session_id: string; transcript_path: string }> =
            (await readFile(output, 'utf8'))
              .trim()
              .split('\n')
              .map((line) => JSON.parse(line));
          expect(inputs.map((input) => input.transcript_path)).toStrictEqual([
            aPath,
            bPath,
          ]);
          expect(inputs[0].session_id).not.toBe(inputs[1].session_id);
        },
        undefined,
        {
          hooks: {
            [HookEventName.BeforeModel]: [
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
      );
    } finally {
      await rm(output, { force: true });
    }
  }, 30000);

  it('routes real command hook input through each facade after stop and resume', async () => {
    const output = join(tmpdir(), `recording-hook-owner-${randomUUID()}.jsonl`);
    const readInputs = async (): Promise<
      Array<{
        session_id: string;
        transcript_path: string;
        hook_event_name: string;
      }>
    > =>
      (await readFile(output, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    try {
      await withRecordingLifetimeFixture(
        async ({ agent, borrow }) => {
          const sibling = await borrow();
          await agent.setHistory([
            { speaker: 'human', blocks: [{ type: 'text', text: 'seed A' }] },
          ]);
          await agent.session.setRecording({ enabled: true });
          const aPath = requirePath(agent.session.getRecording().path);
          await sibling.session.setRecording({ enabled: true });
          const bPath = requirePath(sibling.session.getRecording().path);
          expect(aPath).not.toBe(bPath);
          await agent.hooks.triggerSessionEnd();
          await sibling.hooks.triggerSessionEnd();
          expect(
            (await readInputs()).map((input) => input.transcript_path),
          ).toStrictEqual([aPath, bPath]);

          await agent.session.setRecording({ enabled: false });
          await agent.hooks.triggerSessionEnd();
          await sibling.hooks.triggerSessionEnd();
          expect(
            (await readInputs()).map((input) => input.transcript_path),
          ).toStrictEqual([aPath, bPath, '', bPath]);

          await agent.session.resume('latest');
          const resumed = requirePath(agent.session.getRecording().path);
          await agent.hooks.triggerSessionEnd();
          await sibling.hooks.triggerSessionEnd();
          const inputs = await readInputs();
          expect(inputs.map((input) => input.transcript_path)).toStrictEqual([
            aPath,
            bPath,
            '',
            bPath,
            resumed,
            bPath,
          ]);
          expect(
            inputs.every(
              (input) => input.hook_event_name === HookEventName.SessionEnd,
            ),
          ).toBe(true);
          expect(inputs[0].session_id).not.toBe(inputs[1].session_id);
          expect(inputs[0].session_id).toBe(inputs[2].session_id);
          expect(inputs[1].session_id).toBe(inputs[3].session_id);
        },
        undefined,
        {
          hooks: {
            [HookEventName.SessionEnd]: [
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
      );
    } finally {
      await rm(output, { force: true });
    }
  }, 30000);

  it('reads each exact owner after start, stop and resume even when Config and client are borrowed', async () => {
    await withRecordingLifetimeFixture(async ({ agent, borrow }) => {
      const sibling = await borrow();
      const a: string[] = [];
      const b: string[] = [];
      agent.hooks.onHookExecution((request) => {
        if (request.event === HookEventName.SessionEnd)
          a.push(request.input.transcript_path);
      });
      sibling.hooks.onHookExecution((request) => {
        if (request.event === HookEventName.SessionEnd)
          b.push(request.input.transcript_path);
      });

      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'owner A seed' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const original = requirePath(agent.session.getRecording().path);
      await agent.hooks.triggerSessionEnd();
      await sibling.hooks.triggerSessionEnd();
      expect(a).toStrictEqual([original]);
      expect(b).toStrictEqual(['']);

      await agent.session.setRecording({ enabled: false });
      await agent.hooks.triggerSessionEnd();
      await sibling.hooks.triggerSessionEnd();
      expect(a).toStrictEqual([original, '']);
      expect(b).toStrictEqual(['', '']);

      await agent.session.resume('latest');
      const resumed = requirePath(agent.session.getRecording().path);
      await agent.hooks.triggerSessionEnd();
      await sibling.hooks.triggerSessionEnd();
      expect(a).toStrictEqual([original, '', resumed]);
      expect(b).toStrictEqual(['', '', '']);
    });
  }, 30000);
});
