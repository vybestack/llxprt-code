import { jsonlHookCommand } from './helpers/jsonl-hook-command.js';
import { useRecordingPrompts } from './helpers/recording-prompts.js';
import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import type { AgentConfig } from '../config-types.js';
import { fromConfig } from '../fromConfig.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { makeScratchDir } from './helpers/scratch-dir.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

interface HookedPair {
  readonly a: Agent;
  readonly b: Agent;
}

/**
 * Two agents a host builds with `fromConfig` from one `Config` that has hooks
 * enabled (`AgentConfig` carries no `enableHooks`, so the test owns the
 * `Config`). Each agent has its own fake provider, so each is built while
 * `LLXPRT_FAKE_RESPONSES` names the replay file of its own turns.
 */
async function withHookedPair(
  authority: CredentialAuthority,
  directory: string,
  replays: { readonly a: string; readonly b: string },
  hooks: NonNullable<AgentConfig['hooks']>,
  scenario: (pair: HookedPair) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'recording-tool-hook-home-'));
  const previousHome = process.env.LLXPRT_CONFIG_HOME;
  process.env.LLXPRT_CONFIG_HOME = home;
  const config = new Config({
    ...toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      hooks,
    }),
    interactive: true,
    enableHooks: true,
  });
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const agents: Agent[] = [];
  const open = async (replay: string): Promise<Agent> => {
    process.env.LLXPRT_FAKE_RESPONSES = replay;
    const agent = await fromConfig(
      config,
      settings,
      { sessionId: randomUUID() + '-recording-tool-hook' },
      authority,
    );
    agents.push(agent);
    return agent;
  };
  try {
    const a = await open(replays.a);
    const b = await open(replays.b);
    await scenario({ a, b });
  } finally {
    await runCleanupSteps([
      ...[...agents].reverse().map((agent) => async () => {
        if (agent.session.getRecording().enabled)
          await agent.session.setRecording({ enabled: false });
        await agent.dispose();
      }),
      () => config.dispose(),
      () => rm(config.projectTempDir, { recursive: true, force: true }),
      () => {
        if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
        else process.env.LLXPRT_CONFIG_HOME = previousHome;
      },
      () => rm(home, { recursive: true, force: true }),
    ]);
  }
}

describe('borrowed facade tool hook owner routing', () => {
  useRecordingPrompts();
  const credentials = useOwnedCredentials();
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('retains A and B at deferred confirmation and reads the current recording path when each tool executes', async () => {
    const evidenceDir = await realpath(
      await makeScratchDir('recording-tool-hook-owner-'),
    );
    const output = join(evidenceDir, 'hooks.jsonl');
    const replays = {
      a: join(evidenceDir, 'responses-a.jsonl'),
      b: join(evidenceDir, 'responses-b.jsonl'),
    };
    try {
      expect(evidenceDir).not.toContain(resolve(import.meta.dir, '../../..'));
      const turns = (
        await readFile(
          join(import.meta.dir, 'fixtures/recording-tool-owner.jsonl'),
          'utf8',
        )
      )
        .replaceAll(
          '{{CWD}}/tmp/recording-tool-hook-owner',
          JSON.stringify(evidenceDir).slice(1, -1),
        )
        .trim()
        .split('\n');
      await writeFile(
        replays.a,
        [turns[0], turns[2], turns[4], turns[5]].join('\n') + '\n',
      );
      await writeFile(replays.b, [turns[1], turns[3]].join('\n') + '\n');
      await withHookedPair(
        credentials().authority,
        evidenceDir,
        replays,
        Object.fromEntries(
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
                    command: jsonlHookCommand(output),
                  },
                ],
              },
            ],
          ]),
        ),
        async ({ a, b }) => {
          const seed = [
            {
              speaker: 'human' as const,
              blocks: [{ type: 'text' as const, text: 'seed tools' }],
            },
          ];
          await a.setHistory(seed);
          await b.setHistory(seed);
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
      );
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  }, 30000);
});
