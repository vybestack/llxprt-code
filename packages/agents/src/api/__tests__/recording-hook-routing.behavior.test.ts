import {
  jsonlHookCommand,
  removeJsonlHook,
} from './helpers/jsonl-hook-command.js';
import { useRecordingPrompts } from './helpers/recording-owner-lifetime-fixture.js';
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import type { AgentConfig } from '../config-types.js';
import { fromConfig } from '../fromConfig.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function requirePath(path: string | undefined): string {
  if (path === undefined) throw new Error('Recording path missing');
  return path;
}

interface RoutedPair {
  readonly agent: Agent;
  readonly sibling: Agent;
}

/**
 * Two independent agents a host builds with `fromConfig` from one `Config`
 * (`AgentConfig` carries no `enableHooks`, so the test owns the `Config` when
 * hooks are configured). Each has its own client, history, journal and hook
 * runner; both record into the one chats directory of the `Config`.
 */
async function withRoutedPair(
  authority: CredentialAuthority,
  scenario: (pair: RoutedPair) => Promise<void>,
  hooks?: AgentConfig['hooks'],
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'recording-hook-routing-home-'));
  const previousHome = process.env.LLXPRT_CONFIG_HOME;
  process.env.LLXPRT_CONFIG_HOME = home;
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'recording-hook-routing-')),
  );
  const config = new Config({
    ...toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      ...(hooks === undefined ? {} : { hooks }),
    }),
    interactive: true,
    ...(hooks === undefined ? {} : { enableHooks: true }),
  });
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const agents: Agent[] = [];
  const open = async (): Promise<Agent> => {
    const agent = await fromConfig(
      config,
      settings,
      { sessionId: randomUUID() + '-recording-hook-routing' },
      authority,
    );
    agents.push(agent);
    return agent;
  };
  try {
    const agent = await open();
    const sibling = await open();
    await scenario({ agent, sibling });
  } finally {
    await runCleanupSteps([
      ...[...agents].reverse().map((agent) => async () => {
        if (agent.session.getRecording().enabled)
          await agent.session.setRecording({ enabled: false });
        await agent.dispose();
      }),
      () => config.dispose(),
      () => rm(config.projectTempDir, { recursive: true, force: true }),
      () => rm(directory, { recursive: true, force: true }),
      () => {
        if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
        else process.env.LLXPRT_CONFIG_HOME = previousHome;
      },
      () => rm(home, { recursive: true, force: true }),
    ]);
  }
}

describe('borrowed facade lifecycle hook transcript routing', () => {
  useRecordingPrompts();
  const credentials = useOwnedCredentials();
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('routes manual PreCompress command input through the current facade owner', async () => {
    const output = join(tmpdir(), `recording-hook-owner-${randomUUID()}.jsonl`);
    try {
      await withRoutedPair(
        credentials().authority,
        async ({ agent, sibling }) => {
          const seed = [
            {
              speaker: 'human' as const,
              blocks: [
                { type: 'text' as const, text: 'seed compression hook' },
              ],
            },
          ];
          await agent.setHistory(seed);
          await sibling.setHistory(seed);
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
        {
          [HookEventName.PreCompress]: [
            {
              hooks: [
                {
                  type: HookType.Command,
                  command: jsonlHookCommand(output),
                },
              ],
            },
          ],
        },
      );
    } finally {
      await removeJsonlHook(output);
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
      await withRoutedPair(
        credentials().authority,
        async ({ agent, sibling }) => {
          const seed = [
            {
              speaker: 'human' as const,
              blocks: [{ type: 'text' as const, text: 'seed model hook' }],
            },
          ];
          await agent.setHistory(seed);
          await sibling.setHistory(seed);
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
        {
          [HookEventName.BeforeModel]: [
            {
              hooks: [
                {
                  type: HookType.Command,
                  command: jsonlHookCommand(output),
                },
              ],
            },
          ],
        },
      );
    } finally {
      await removeJsonlHook(output);
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
      await withRoutedPair(
        credentials().authority,
        async ({ agent, sibling }) => {
          const seed = [
            {
              speaker: 'human' as const,
              blocks: [{ type: 'text' as const, text: 'seed A' }],
            },
          ];
          await agent.setHistory(seed);
          await sibling.setHistory(seed);
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
        {
          [HookEventName.SessionEnd]: [
            {
              hooks: [
                {
                  type: HookType.Command,
                  command: jsonlHookCommand(output),
                },
              ],
            },
          ],
        },
      );
    } finally {
      await removeJsonlHook(output);
    }
  }, 30000);

  it('reads each exact owner after start, stop and resume even when Config and client are borrowed', async () => {
    await withRoutedPair(
      credentials().authority,
      async ({ agent, sibling }) => {
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
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'owner A seed' }],
          },
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
      },
    );
  }, 30000);
});
