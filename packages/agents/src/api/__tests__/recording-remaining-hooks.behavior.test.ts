import {
  jsonlHookCommand,
  removeJsonlHook,
} from './helpers/jsonl-hook-command.js';
import { useRecordingPrompts } from './helpers/recording-prompts.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent, toConfigParameters } from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { fromConfig } from '../fromConfig.js';
import type { AgentHooks } from '../config-types.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { summaryOutput } from '../../compression/summaryOutput.js';
import { OneShotStrategy } from '../../compression/OneShotStrategy.js';

type HookInput = {
  hook_event_name: string;
  session_id: string;
  transcript_path: string;
};

const seed = [
  {
    speaker: 'human' as const,
    blocks: [{ type: 'text' as const, text: 'seed' }],
  },
];

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

interface HookedAgent {
  readonly agent: Agent;
  readonly config: Config;
}

/**
 * One agent built through `fromConfig` over the test's own `Config`
 * (`AgentConfig` carries no `enableHooks`).
 */
async function openHookedAgent(
  directory: string,
  hooks: AgentHooks,
  authority: CredentialAuthority,
): Promise<HookedAgent> {
  const parameters = {
    ...toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      workingDir: directory,
      hooks,
    }),
    interactive: true,
    enableHooks: true,
  };
  parameters.includeDirectories = [
    ...(parameters.includeDirectories ?? []),
    process.cwd(),
  ];
  const config = new Config(parameters);
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  try {
    const agent = await fromConfig(
      config,
      settings,
      { activation: { provider: 'fake', model: 'fake-model' } },
      authority,
    );
    return { agent, config };
  } catch (primary) {
    return cleanupAfterFailure(primary, () => config.dispose());
  }
}

/**
 * Two independent agents (own `Config`, client, history and journal) that
 * share one working directory, so one chats directory, and one hook command.
 */
async function withHookedPair(
  authority: CredentialAuthority,
  hooks: AgentHooks,
  scenario: (agent: Agent, sibling: Agent) => Promise<void>,
): Promise<void> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'recording-remaining-agents-')),
  );
  const opened: HookedAgent[] = [];
  try {
    opened.push(await openHookedAgent(directory, hooks, authority));
    opened.push(await openHookedAgent(directory, hooks, authority));
    await scenario(opened[0].agent, opened[1].agent);
  } finally {
    await runCleanupSteps([
      ...[...opened].reverse().map(
        ({ agent }) =>
          () =>
            agent.dispose(),
      ),
      ...[...opened].reverse().map(
        ({ config }) =>
          () =>
            config.dispose(),
      ),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  }
}

async function verifyFacades(
  authority: CredentialAuthority,
  events: readonly HookEventName[],
  drive: (agent: Agent, input: string) => Promise<void>,
  verify: (matched: HookInput[], paths: string[]) => void,
): Promise<void> {
  const output = join(
    tmpdir(),
    `recording-remaining-hooks-${randomUUID()}.jsonl`,
  );
  try {
    await withHookedPair(
      authority,
      Object.fromEntries(
        events.map((event) => [
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
      async (agent, sibling) => {
        await agent.setHistory(seed);
        await sibling.setHistory(seed);
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
    );
  } finally {
    await removeJsonlHook(output);
  }
}

describe('borrowed facade remaining hook producers', () => {
  useRecordingPrompts();
  useFakeResponsesReplay('recording-remaining-hooks.jsonl');
  const credentials = useOwnedCredentials();
  it('attributes detached direct generation selection and model hooks to each executing facade', async () => {
    await verifyFacades(
      credentials().authority,
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
      credentials().authority,
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
    const strategySpy = spyOn(
      OneShotStrategy.prototype,
      'prepareDisk',
    ).mockImplementation(async (context) =>
      summaryOutput(context.history, 0, context.history.length, [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'short summary' }],
          metadata: { reason: 'compression-state-snapshot' },
        },
      ]),
    );
    try {
      await withHookedPair(
        credentials().authority,
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
        async (agent, sibling) => {
          agent.setEphemeralSetting('context-limit', 4096);
          sibling.setEphemeralSetting('context-limit', 4096);
          await agent.setHistory(seed);
          await sibling.setHistory(seed);
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
      );
    } finally {
      strategySpy.mockRestore();
      await removeJsonlHook(output);
    }
  }, 30000);
});
