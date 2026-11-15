/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4093 lifecycle guarantees of a timed-out stream attempt.
 *
 * A watchdog timeout abandons the attempt, but a provider stream does not have
 * to honour cancellation: its iterator can stay pending for as long as it
 * likes and may even deliver data or EOF afterwards. These scenarios drive the
 * public `agent.stream()` over a contributed provider whose stream ignores
 * every AbortSignal, and observe what the agent does while that old stream is
 * still alive: whether the resend and later prompts are admitted, and whether
 * anything the old stream delivers late reaches history.
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import type { Agent, AgentEvent } from '@vybestack/llxprt-code-agents';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useRecordingPrompts } from './helpers/recording-prompts.js';
import {
  collectStream,
  PNG_BASE64,
  withStallingAgent,
  within,
} from './helpers/stalling-agent.js';
import {
  createStallingProvider,
  type StallingProvider,
} from './helpers/stalling-provider.js';

setDefaultTimeout(90_000);

const DEADLINE_MS = 30_000;
const FIRST_RESPONSE = { 'stream-first-response-timeout-ms': 1000 } as const;
const IDLE = { 'stream-idle-timeout-ms': 1000 } as const;
const PURGE = { 'media.semantic-purge': 'remove' } as const;

type History = Awaited<ReturnType<Agent['getHistory']>>;

function texts(history: History, speaker: 'human' | 'ai'): string[] {
  return history
    .filter((message) => message.speaker === speaker)
    .flatMap((message) => message.blocks)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []));
}

function doneReasons(events: readonly AgentEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === 'done' ? [event.reason] : [],
  );
}

function answerWith(
  provider: StallingProvider,
  answers: Partial<Record<number, string>>,
) {
  provider.onAttempt = (attempt) => {
    const answer = answers[attempt.index];
    if (answer === undefined) return;
    attempt.emit(answer);
    attempt.finish();
  };
}

async function seedImage(agent: Agent): Promise<void> {
  await agent.setHistory([
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'what is in this picture' },
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: PNG_BASE64,
          caption: 'a single pixel',
        },
      ],
    },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'one pixel' }] },
  ]);
}

describe('stream attempts that ignore cancellation (issue #4093)', () => {
  useRecordingPrompts();
  const credentials = useOwnedCredentials();

  describe('timed-out stream whose iterator ignores cancellation', () => {
    describe.each([
      ['before any output', FIRST_RESPONSE, undefined],
      ['after partial output', IDLE, 'half an ans'],
    ] as const)(
      'stalled %s with a semantic media purge due',
      (_name, timeout, partial) => {
        it('sends the resend and every later prompt while the old stream is still pending', async () => {
          const provider = createStallingProvider('stall-lease');
          answerWith(provider, { 1: 'resent answer', 2: 'later answer' });
          const base = provider.onAttempt;
          provider.onAttempt = (attempt) => {
            if (attempt.index === 0 && partial !== undefined)
              attempt.emit(partial);
            base?.(attempt);
          };
          const cleanup = await withStallingAgent(
            credentials().authority,
            provider,
            { settings: { ...timeout, ...PURGE } },
            async (agent) => {
              await seedImage(agent);

              const first = await within(
                DEADLINE_MS,
                'resend of the timed-out request',
                collectStream(agent, 'describe it again'),
              );
              const oldStreamStillPending = provider.attempts.length === 2;
              const second = await within(
                DEADLINE_MS,
                'prompt after the timed-out request',
                collectStream(agent, 'and once more'),
              );
              const history = await agent.getHistory();

              expect({
                oldStreamStillPending,
                requests: provider.attempts.length,
                firstDone: doneReasons(first),
                secondDone: doneReasons(second),
                ai: texts(history, 'ai'),
                human: texts(history, 'human'),
              }).toStrictEqual({
                oldStreamStillPending: true,
                requests: 3,
                firstDone: ['stop'],
                secondDone: ['stop'],
                ai: ['one pixel', 'resent answer', 'later answer'],
                human: [
                  'what is in this picture',
                  'describe it again',
                  'and once more',
                ],
              });
            },
          );
          expect(cleanup).toStrictEqual([]);
        });
      },
    );
  });

  describe('late EOF from a timed-out stream', () => {
    it('cannot commit the partial answer once the replacement answered', async () => {
      const provider = createStallingProvider('stall-late-eof');
      provider.onAttempt = (attempt) => {
        if (attempt.index === 0) attempt.emit('half an ans');
        if (attempt.index === 1) {
          attempt.emit('whole answer');
          attempt.finish();
        }
        if (attempt.index === 2) {
          attempt.emit('next answer');
          attempt.finish();
        }
      };
      const cleanup = await withStallingAgent(
        credentials().authority,
        provider,
        { settings: IDLE },
        async (agent) => {
          const first = await within(
            DEADLINE_MS,
            'resend of the timed-out request',
            collectStream(agent, 'please summarise'),
          );
          const stale = provider.attempts[0];
          stale.finish();
          await within(DEADLINE_MS, 'late EOF delivery', stale.ended);
          // History mutations are queued in order, so a later turn's commit
          // lands after anything the stale stream published on EOF.
          const next = await within(
            DEADLINE_MS,
            'prompt after the late EOF',
            collectStream(agent, 'and then'),
          );
          const history = await agent.getHistory();

          expect({
            firstDone: doneReasons(first),
            nextDone: doneReasons(next),
            human: texts(history, 'human'),
            ai: texts(history, 'ai'),
          }).toStrictEqual({
            firstDone: ['stop'],
            nextDone: ['stop'],
            human: ['please summarise', 'and then'],
            ai: ['whole answer', 'next answer'],
          });
        },
      );
      expect(cleanup).toStrictEqual([]);
    });

    it('cannot commit the partial answer while the replacement is still streaming', async () => {
      const provider = createStallingProvider('stall-early-eof');
      provider.onAttempt = (attempt) => {
        if (attempt.index === 0) attempt.emit('half an ans');
        if (attempt.index === 1) attempt.emit('whole');
      };
      const cleanup = await withStallingAgent(
        credentials().authority,
        provider,
        { settings: IDLE },
        async (agent) => {
          const events: AgentEvent[] = [];
          const turn = collectStream(agent, 'please summarise', {
            onEvent: async (event) => {
              events.push(event);
              if (event.type === 'text' && event.text === 'whole') {
                const stale = provider.attempts[0];
                stale.finish();
                await within(DEADLINE_MS, 'late EOF delivery', stale.ended);
                provider.attempts[1].emit(' answer');
                provider.attempts[1].finish();
              }
            },
          });
          await within(DEADLINE_MS, 'turn', turn);
          const history = await agent.getHistory();

          expect({
            human: texts(history, 'human'),
            ai: texts(history, 'ai'),
          }).toStrictEqual({
            human: ['please summarise'],
            ai: ['whole answer'],
          });
        },
      );
      expect(cleanup).toStrictEqual([]);
    });
  });
});
