/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import * as recordingFs from 'node:fs/promises';
import { withOwners } from './turn-revision-capture.fixture.js';
import { useRecordingPrompts } from './helpers/recording-owner-lifetime-fixture.js';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import type { AgentConfig } from '../config-types.js';
import { fromConfig } from '../fromConfig.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { buildAgentFromContent } from './helpers/agentHarness.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteAAgent, type RouteAAgent } from './helpers/route-a-agent.js';
import { generationGate } from './helpers/generation-client-owner.js';
import { nativeHookInputCommand } from './helpers/native-hook-command.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type {
  InlineMediaBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * A replay file holding the numbered turns (1-based) of a fixture. Each agent
 * a host builds has its own provider with its own turn counter, so the turns
 * one shared provider would have answered to a facade, in call order, go to
 * that facade's own file.
 */
async function writeReplay(
  directory: string,
  name: string,
  fixture: string,
  turns: readonly number[],
): Promise<string> {
  const lines = (
    await readFile(join(import.meta.dir, 'fixtures', fixture), 'utf8')
  )
    .trim()
    .split('\n');
  const path = join(directory, name);
  await writeFile(path, turns.map((turn) => lines[turn - 1]).join('\n') + '\n');
  return path;
}

/**
 * Two independent Route A agents over one working directory (so one chats
 * directory), each built while the replay seam names its own turns.
 */
async function withRouteAPair(
  authority: CredentialAuthority,
  fixture: string,
  turns: {
    readonly agent: readonly number[];
    readonly peer: readonly number[];
  },
  scenario: (agent: Agent, peer: Agent) => Promise<void>,
): Promise<void> {
  const routes: RouteAAgent[] = [];
  const replays = await mkdtemp(join(tmpdir(), 'generate-history-replays-'));
  try {
    process.env.LLXPRT_FAKE_RESPONSES = await writeReplay(
      replays,
      'agent.jsonl',
      fixture,
      turns.agent,
    );
    const first = await openRouteAAgent({
      authority,
      config: { interactive: true },
    });
    routes.push(first);
    process.env.LLXPRT_FAKE_RESPONSES = await writeReplay(
      replays,
      'peer.jsonl',
      fixture,
      turns.peer,
    );
    routes.push(
      await openRouteAAgent({
        authority,
        config: { interactive: true, workingDir: first.directory },
      }),
    );
    await scenario(routes[0].agent, routes[1].agent);
  } finally {
    await runCleanupSteps([
      ...[...routes].reverse().map((route) => () => route.close()),
      () => rm(replays, { recursive: true, force: true }),
    ]);
  }
}

/**
 * Two independent agents a host builds with `fromConfig`, each from its own
 * `Config` with hooks enabled (`AgentConfig` carries no `enableHooks`, so the
 * test owns the `Config`s) over one working directory, each with its own
 * replayed turns.
 */
async function withHookedPair(
  authority: CredentialAuthority,
  fixture: string,
  turns: {
    readonly agent: readonly number[];
    readonly peer: readonly number[];
  },
  hooks: NonNullable<AgentConfig['hooks']>,
  scenario: (agent: Agent, peer: Agent) => Promise<void>,
): Promise<void> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'generate-history-hooked-')),
  );
  const configs: Config[] = [];
  const agents: Agent[] = [];
  const open = async (replay: string): Promise<Agent> => {
    const config = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
        hooks,
      }),
      interactive: true,
      enableHooks: true,
    });
    configs.push(config);
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    process.env.LLXPRT_FAKE_RESPONSES = replay;
    const agent = await fromConfig(
      config,
      settings,
      { activation: { provider: 'fake', model: 'fake-model' } },
      authority,
    );
    agents.push(agent);
    return agent;
  };
  try {
    const agent = await open(
      await writeReplay(directory, 'agent.jsonl', fixture, turns.agent),
    );
    const peer = await open(
      await writeReplay(directory, 'peer.jsonl', fixture, turns.peer),
    );
    await scenario(agent, peer);
  } finally {
    await runCleanupSteps([
      ...[...agents].reverse().map((agent) => async () => {
        if (agent.session.getRecording().enabled)
          await agent.session.setRecording({ enabled: false });
        await agent.dispose();
      }),
      ...configs.map((config) => () => config.dispose()),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  }
}

function textHistory(history: readonly IContent[]): object[] {
  return history.map(({ speaker, blocks }) => ({ speaker, blocks }));
}
const seed: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'seed-human' }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'seed-ai' }] },
];
const input: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'new-input' }],
};

describe('Agent.generate independent history flags', () => {
  useRecordingPrompts();
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();
  it('preserves response blocks and usage from earlier chunks in the written AI entry', async () => {
    const media: InlineMediaBlock = {
      type: 'media',
      encoding: 'url',
      mimeType: 'image/png',
      data: 'https://example.test/output.png',
    };
    const built = await buildAgentFromContent(
      JSON.stringify({
        chunks: [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: 'kept reasoning',
                sourceField: 'reasoning_content',
              },
              media,
            ],
            metadata: {
              usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
            },
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'completed answer' }],
            metadata: { finishReason: 'stop' },
          },
        ],
      }),
    );
    try {
      expect(
        await built.agent.generate('write full response', {
          writeHistory: true,
          model: 'written-model',
        }),
      ).toBe('completed answer');
      const history = await built.agent.getHistory();
      expect(history[1].blocks).toStrictEqual([
        {
          type: 'thinking',
          thought: 'kept reasoning',
          sourceField: 'reasoning_content',
        },
        media,
        { type: 'text', text: 'completed answer' },
      ]);
      expect(history[1].metadata).toMatchObject({
        model: 'written-model',
        usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      });
    } finally {
      await built.cleanup();
    }
  });

  it('attributes option-bearing hooks to the executing facade and its live stopped or resumed transcript without writing a turn', async () => {
    const directory = await mkdtemp(join(tmpdir(), "generation hooks ' Ω-"));
    const output = join(directory, 'hooks.jsonl');
    const events = [
      HookEventName.BeforeToolSelection,
      HookEventName.BeforeModel,
      HookEventName.AfterModel,
    ];
    try {
      await withHookedPair(
        credentials().authority,
        'recording-remaining-hooks.jsonl',
        { agent: [1, 3, 4], peer: [2] },
        Object.fromEntries(
          events.map((event) => [
            event,
            [
              {
                hooks: [
                  {
                    type: HookType.Command,
                    command: nativeHookInputCommand(output, 'append'),
                  },
                ],
              },
            ],
          ]),
        ),
        async (agent, peer) => {
          await agent.setHistory(structuredClone(seed));
          await peer.setHistory(structuredClone(seed));
          await agent.session.setRecording({ enabled: true });
          const aPath = agent.session.getRecording().path;
          await peer.session.setRecording({ enabled: true });
          const bPath = peer.session.getRecording().path;
          if (aPath === undefined || bPath === undefined)
            throw new Error('Missing facade transcript');
          const options = {
            model: 'utility-model-x',
            config: { temperature: 0.3 },
            readHistory: false,
            writeHistory: false,
          };
          expect(await agent.generate('A options', options)).toBe(
            'first reply',
          );
          expect(await peer.generate('B options', options)).toBe(
            'second reply',
          );
          await agent.session.setRecording({ enabled: false });
          expect(await agent.generate('A stopped options', options)).toBe(
            'third reply',
          );
          await agent.session.resume('latest');
          const resumedPath = agent.session.getRecording().path;
          if (resumedPath === undefined)
            throw new Error('Missing resumed transcript');
          expect(await agent.generate('A resumed options', options)).toBe(
            'fourth reply',
          );
          const hooks: Array<{
            hook_event_name: string;
            transcript_path: string;
            session_id: string;
            llm_request?: { model?: string };
          }> = (await readFile(output, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
          for (const event of events) {
            const matching = hooks.filter(
              (hook) => hook.hook_event_name === event,
            );
            expect(matching.map((hook) => hook.transcript_path)).toStrictEqual([
              aPath,
              bPath,
              '',
              resumedPath,
            ]);
            expect(matching[0].session_id).not.toBe(matching[1].session_id);
            expect(matching[0].session_id).toBe(matching[2].session_id);
            expect(matching[0].session_id).toBe(matching[3].session_id);
          }
          for (const hook of hooks.filter(
            (hook) => hook.llm_request !== undefined,
          )) {
            expect(hook.llm_request?.model).toBe('utility-model-x');
          }
          expect(textHistory(await agent.getHistory())).toStrictEqual(seed);
        },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('records a requested generation exchange only in the invoking facade and keeps the other agent usable after facade disposal', async () => {
    await withRouteAPair(
      credentials().authority,
      'multi-turn-text.jsonl',
      { agent: [2], peer: [1] },
      async (agent, peer) => {
        await agent.setHistory(structuredClone(seed));
        await peer.setHistory(structuredClone(seed));
        await agent.session.setRecording({ enabled: true });
        const aPath = agent.session.getRecording().path;
        await peer.session.setRecording({ enabled: true });
        const bPath = peer.session.getRecording().path;
        if (aPath === undefined || bPath === undefined)
          throw new Error('Missing facade recording');
        expect(aPath).not.toBe(bPath);
        expect(
          await peer.generate('record only on B', {
            writeHistory: true,
            model: 'recorded-model',
          }),
        ).toBe('turn one reply');
        expect(await readFile(bPath, 'utf8')).toContain('record only on B');
        expect(await readFile(bPath, 'utf8')).toContain('recorded-model');
        expect(await readFile(aPath, 'utf8')).not.toContain('record only on B');
        await peer.dispose();
        expect(await agent.generate('primary survives borrower')).toBe(
          'turn two reply',
        );
      },
    );
  });

  it('joins the invoking facade recording append before generation returns', async () => {
    await withRouteAPair(
      credentials().authority,
      'multi-turn-text.jsonl',
      { agent: [2], peer: [1] },
      async (agent, peer) => {
        await agent.setHistory(structuredClone(seed));
        await peer.setHistory(structuredClone(seed));
        await agent.session.setRecording({ enabled: true });
        await peer.session.setRecording({ enabled: true });
        const aPath = agent.session.getRecording().path;
        const bPath = peer.session.getRecording().path;
        if (aPath === undefined || bPath === undefined)
          throw new Error('Missing facade recording');
        const entered = generationGate();
        const held = generationGate();
        const append = recordingFs.appendFile;
        const boundary = spyOn(recordingFs, 'appendFile').mockImplementation(
          async (...args) => {
            if (
              args[0] === bPath &&
              String(args[1]).includes('held B exchange')
            ) {
              entered.release();
              await held.promise;
            }
            return append(...args);
          },
        );
        const generation = peer.generate('held B exchange', {
          writeHistory: true,
          model: 'held-recording-model',
        });
        try {
          await entered.promise;
          const first = await Promise.race([
            generation.then(() => 'generation-returned'),
            readFile(bPath, 'utf8').then(() => 'append-still-held'),
          ]);
          expect(first).toBe('append-still-held');
          expect(await readFile(bPath, 'utf8')).not.toContain(
            'held B exchange',
          );
          expect(await readFile(aPath, 'utf8')).not.toContain(
            'held B exchange',
          );
          held.release();
          expect(await generation).toBe('turn one reply');
          const published = await readFile(bPath, 'utf8');
          expect(published).toContain('held B exchange');
          expect(published).toContain('held-recording-model');
          expect(published).toContain('turn one reply');
          expect(await readFile(aPath, 'utf8')).not.toContain(
            'held B exchange',
          );
          await peer.dispose();
          expect(await agent.generate('primary after accepted append')).toBe(
            'turn two reply',
          );
        } finally {
          held.release();
          try {
            await generation;
          } finally {
            boundary.mockRestore();
          }
        }
      },
    );
  });

  it.each([
    { readHistory: false, writeHistory: false },
    { readHistory: true, writeHistory: false },
    { readHistory: false, writeHistory: true },
    { readHistory: true, writeHistory: true },
  ])('uses detached read and append policy %j', async (policy) => {
    await withOwners(async (agent, _peer, transport) => {
      transport.release();
      await agent.setHistory(structuredClone(seed));
      expect(
        await agent.generate(input, { ...policy, model: 'utility-model-x' }),
      ).toBe('Transport completed.');
      const requestText = JSON.stringify(transport.requests()[0].messages);
      expect(requestText.includes('seed-human')).toBe(policy.readHistory);
      expect(requestText.includes('seed-ai')).toBe(policy.readHistory);
      expect(requestText.split('new-input')).toHaveLength(2);
      const history = await agent.getHistory();
      expect(textHistory(history)).toStrictEqual(
        policy.writeHistory
          ? [
              ...seed,
              input,
              {
                speaker: 'ai',
                blocks: [{ type: 'text', text: 'Transport completed.' }],
              },
            ]
          : seed,
      );
      expect(history[history.length - 1]?.metadata?.model).toBe(
        policy.writeHistory ? 'utility-model-x' : undefined,
      );
    });
  });

  it('appends to current history without replacing a concurrently added turn or duplicating the prefix', async () => {
    await withOwners(async (agent, _peer, transport) => {
      await agent.setHistory(structuredClone(seed));
      const pending = agent.generate(input, {
        readHistory: true,
        writeHistory: true,
      });
      await transport.entered;
      const unrelated: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'unrelated' }],
      };
      await agent.addHistory(unrelated);
      transport.release();
      await pending;
      expect(textHistory(await agent.getHistory())).toStrictEqual([
        ...seed,
        unrelated,
        input,
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Transport completed.' }],
        },
      ]);
    });
  });
});
