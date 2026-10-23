/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import * as recordingFs from 'node:fs/promises';
import { withOwners } from './turn-revision-capture.fixture.js';
import {
  useRecordingPrompts,
  withRecordingLifetimeFixture,
} from './helpers/recording-owner-lifetime-fixture.js';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgentFromContent } from './helpers/agentHarness.js';
import { generationGate } from './helpers/generation-owner-fixture.js';
import { nativeHookInputCommand } from './helpers/native-hook-command.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { AggregateDisposeError } from '../disposeErrors.js';
import type {
  InlineMediaBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

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
  it('propagates failed history publication without a partial exchange or a successful text result', async () => {
    await withRecordingLifetimeFixture(
      async (
        agent,
        _config,
        _owner,
        _settings,
        _oauth,
        _borrow,
        _chats,
        history,
      ) => {
        await agent.setHistory(structuredClone(seed));
        await agent.session.setRecording({ enabled: true });
        const path = agent.session.getRecording().path;
        if (path === undefined) throw new Error('Missing generation recording');
        const failure = new Error('history publication rejected');
        const release = history.registerBatchParticipant(async () => {
          throw failure;
        });
        try {
          await expect(
            agent.generate('must roll back', { writeHistory: true }),
          ).rejects.toBe(failure);
          expect(textHistory(await agent.getHistory())).toStrictEqual(seed);
          expect(await readFile(path, 'utf8')).not.toContain('must roll back');
        } finally {
          release();
        }
        expect(await agent.generate('owner still usable')).toBe(
          'turn two reply',
        );
      },
    );
  });
  it('joins a held history publication before recording release and rolls back a cancelled exchange', async () => {
    let shutdownFailure: unknown;
    const fixtureResult = withRecordingLifetimeFixture(
      async (
        agent,
        _config,
        _owner,
        _settings,
        _oauth,
        _borrow,
        _chats,
        history,
      ) => {
        await agent.setHistory(structuredClone(seed));
        await agent.session.setRecording({ enabled: true });
        const recording = agent.session.getRecording().path;
        if (recording === undefined) throw new Error('Missing recording path');
        const entered = generationGate();
        const held = generationGate();
        const releaseParticipant = history.registerBatchParticipant(
          async () => {
            entered.release();
            await held.promise;
            return { publish: () => {}, rollback: () => {} };
          },
        );
        const pending = agent.generate('cancelled publication', {
          writeHistory: true,
        });
        const result = pending.then(
          () => undefined,
          (error: unknown) => error,
        );
        await entered.promise;
        let disposed = false;
        const closing = agent.dispose().then(
          () => {
            disposed = true;
          },
          (error: unknown) => {
            shutdownFailure = error;
            disposed = true;
          },
        );
        try {
          expect(disposed).toBe(false);
          expect(agent.session.getRecording().enabled).toBe(true);
          held.release();
          expect(await result).toMatchObject({ name: 'AbortError' });
          await closing;
          expect(textHistory(history.getAll())).toStrictEqual(seed);
          expect(await readFile(recording, 'utf8')).not.toContain(
            'cancelled publication',
          );
          expect(agent.session.getRecording().enabled).toBe(false);
        } finally {
          held.release();
          releaseParticipant();
        }
      },
    );
    const failure = await fixtureResult.then(
      () => undefined,
      (error: unknown) => error,
    );
    if (!(failure instanceof AggregateError))
      throw new Error('Expected fixture shutdown failure');
    expect(shutdownFailure).toBeInstanceOf(AggregateDisposeError);
    expect(failure.errors).toHaveLength(1);
    const cleanup = failure.errors[0];
    if (!(cleanup instanceof AggregateError))
      throw new Error('Expected fixture cleanup aggregate');
    expect(cleanup.errors).toStrictEqual([shutdownFailure]);
  });

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
      await withRecordingLifetimeFixture(
        async (agent, _config, _owner, _settings, _oauth, borrow) => {
          const peer = await borrow();
          await agent.setHistory(structuredClone(seed));
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
                      command: nativeHookInputCommand(output, 'append'),
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
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('records a requested generation exchange only in the invoking facade and keeps a borrowed primary usable after facade disposal', async () => {
    await withRecordingLifetimeFixture(
      async (agent, _config, _owner, _settings, _oauth, borrow) => {
        const peer = await borrow();
        await agent.setHistory(structuredClone(seed));
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
    await withRecordingLifetimeFixture(
      async (agent, _config, _owner, _settings, _oauth, borrow) => {
        const peer = await borrow();
        await agent.setHistory(structuredClone(seed));
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
