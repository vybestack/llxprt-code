/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4093: a watchdog timeout abandons a stream attempt, but nothing makes
 * the provider's stream honour that. These scenarios run a real Turn over a
 * real ChatSession and HistoryService whose provider is a bare IProvider with
 * a stream that ignores every AbortSignal, and observe what the agent does
 * while the abandoned stream is still pending, and what it does if that
 * stream delivers data or EOF later.
 */

import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentEventType, DEFAULT_AGENT_ID, Turn } from './turn.js';
import type { ServerAgentStreamEvent } from './turn.js';
import { PNG_BASE64, within } from '../api/__tests__/helpers/stalling-agent.js';
import {
  createTimeoutLifecycleChat,
  type TimeoutLifecycleChat,
} from './__tests__/timeout-lifecycle-chat-fixture.js';

setDefaultTimeout(60_000);

const DEADLINE_MS = 20_000;

type Policy = Readonly<Record<string, number>>;
const FIRST_RESPONSE: Policy = {
  'stream-first-response-timeout-ms': 300,
  'refusal.backoff-ms': 1,
};
const IDLE: Policy = {
  'stream-idle-timeout-ms': 300,
  'refusal.backoff-ms': 1,
};

function imageHistory(): Parameters<
  TimeoutLifecycleChat['chat']['setHistory']
>[0] {
  return [
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
  ];
}

function texts(setup: TimeoutLifecycleChat, speaker: 'human' | 'ai'): string[] {
  return setup.history
    .getAll()
    .filter((content) => content.speaker === speaker)
    .flatMap((content) => content.blocks)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []));
}

function imageCount(setup: TimeoutLifecycleChat): number {
  return setup.history
    .getAll()
    .flatMap((content) => content.blocks)
    .filter((block) => block.type === 'media').length;
}

async function runTurn(
  setup: TimeoutLifecycleChat,
  promptId: string,
  text: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<ServerAgentStreamEvent[]> {
  const turn = new Turn(
    setup.chat,
    promptId,
    DEFAULT_AGENT_ID,
    'timeout-lifecycle-provider',
    setup.execution,
  );
  const events: ServerAgentStreamEvent[] = [];
  for await (const event of turn.run([{ text }], signal)) events.push(event);
  return events;
}

function contentText(events: readonly ServerAgentStreamEvent[]): string {
  return events
    .flatMap((event) =>
      event.type === AgentEventType.Content ? [event.value] : [],
    )
    .join('');
}

function types(events: readonly ServerAgentStreamEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('stream attempts that ignore cancellation (issue #4093)', () => {
  let directory = '';
  let lifecycle: ProviderFileLifecycle;
  let setup: TimeoutLifecycleChat | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'turn-timeout-lifecycle-'));
    lifecycle = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
  });

  afterEach(async () => {
    setup?.provider.releaseAll();
    await setup?.chat.clearHistory();
    await setup?.invocationOwner.dispose();
    setup = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  function open(
    policy: Policy,
    purge: 'off' | 'remove' = 'off',
  ): TimeoutLifecycleChat {
    setup = createTimeoutLifecycleChat(directory, lifecycle, {
      semanticMediaPurge: purge,
      streamTimeoutPolicy: policy,
    });
    return setup;
  }

  describe.each([
    ['before any output', FIRST_RESPONSE, undefined],
    ['after partial output', IDLE, 'half an ans'],
  ] as const)(
    'stalled %s with a semantic media purge due',
    (_name, policy, partial) => {
      it('sends the resend and the next prompt while the abandoned stream is still pending', async () => {
        const chat = open(policy, 'remove');
        await chat.chat.setHistory(imageHistory());
        chat.provider.onAttempt = (attempt) => {
          if (attempt.index === 0 && partial !== undefined)
            attempt.emit(partial);
          if (attempt.index === 1) {
            attempt.emit('resent answer');
            attempt.finish();
          }
          if (attempt.index === 2) {
            attempt.emit('later answer');
            attempt.finish();
          }
        };

        const first = await within(
          DEADLINE_MS,
          'resend of the timed-out request',
          runTurn(chat, 'prompt-1', 'describe it again'),
        );
        const requestsAfterFirst = chat.provider.attempts.length;
        const second = await within(
          DEADLINE_MS,
          'prompt after the timed-out request',
          runTurn(chat, 'prompt-2', 'and once more'),
        );

        expect({
          requestsAfterFirst,
          requests: chat.provider.attempts.length,
          firstText: contentText(first).endsWith('resent answer'),
          firstOutcome: types(first).filter(
            (type) =>
              type === AgentEventType.Error ||
              type === AgentEventType.StreamIdleTimeout,
          ),
          secondText: contentText(second),
          ai: texts(chat, 'ai'),
          human: texts(chat, 'human'),
          purgesPublishedByTheAbandonedAttempt: chat.persistedPurges.length,
        }).toStrictEqual({
          requestsAfterFirst: 2,
          requests: 3,
          firstText: true,
          firstOutcome: [],
          secondText: 'later answer',
          ai: ['one pixel', 'resent answer', 'later answer'],
          human: [
            'what is in this picture',
            'describe it again',
            'and once more',
          ],
          // Only the later, independent prompt publishes a purge.
          purgesPublishedByTheAbandonedAttempt: 1,
        });
      });
    },
  );

  describe('late delivery from the abandoned stream', () => {
    it('cannot commit its partial answer when it ends after the replacement answered', async () => {
      const chat = open(IDLE);
      chat.provider.onAttempt = (attempt) => {
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

      await within(
        DEADLINE_MS,
        'resend of the timed-out request',
        runTurn(chat, 'prompt-1', 'please summarise'),
      );
      const abandoned = chat.provider.attempts[0];
      abandoned.finish();
      await within(DEADLINE_MS, 'late EOF delivery', abandoned.ended);
      // History mutations are queued in order, so the commit of a later turn
      // lands after anything the abandoned stream published on EOF.
      await within(
        DEADLINE_MS,
        'prompt after the late EOF',
        runTurn(chat, 'prompt-2', 'and then'),
      );

      expect({
        human: texts(chat, 'human'),
        ai: texts(chat, 'ai'),
      }).toStrictEqual({
        human: ['please summarise', 'and then'],
        ai: ['whole answer', 'next answer'],
      });
    });

    it('cannot commit its partial answer while the replacement is still streaming', async () => {
      const chat = open(IDLE);
      chat.provider.onAttempt = (attempt) => {
        if (attempt.index === 0) attempt.emit('half an ans');
        if (attempt.index === 1) attempt.emit('whole');
      };
      const turn = new Turn(
        chat.chat,
        'prompt-1',
        DEFAULT_AGENT_ID,
        'timeout-lifecycle-provider',
        chat.execution,
      );

      for await (const event of turn.run(
        [{ text: 'please summarise' }],
        new AbortController().signal,
      )) {
        if (event.type === AgentEventType.Content && event.value === 'whole') {
          const abandoned = chat.provider.attempts[0];
          abandoned.finish();
          await within(DEADLINE_MS, 'late EOF delivery', abandoned.ended);
          chat.provider.attempts[1].emit(' answer');
          chat.provider.attempts[1].finish();
        }
      }

      expect({
        human: texts(chat, 'human'),
        ai: texts(chat, 'ai'),
        images: imageCount(chat),
      }).toStrictEqual({
        human: ['please summarise'],
        ai: ['whole answer'],
        images: 0,
      });
    });
  });

  describe('cancellation while the abandoned stream is still pending', () => {
    it.each([
      ['while the first request is stalled', 0],
      ['while the resend is stalled', 1],
    ] as const)(
      'ends as cancelled %s, sends nothing more and admits the next prompt',
      async (_name, cancelAtRequest) => {
        const chat = open(FIRST_RESPONSE, 'remove');
        await chat.chat.setHistory(imageHistory());
        chat.provider.onAttempt = (attempt) => {
          if (attempt.index === cancelAtRequest + 1) {
            attempt.emit('next answer');
            attempt.finish();
          }
        };
        const controller = new AbortController();
        void chat.provider
          .attemptAt(cancelAtRequest)
          .then(() => controller.abort());

        const cancelled = await within(
          DEADLINE_MS,
          'cancelled turn',
          runTurn(chat, 'prompt-1', 'describe it', controller.signal),
        );
        const requestsAtCancel = chat.provider.attempts.length;
        const next = await within(
          DEADLINE_MS,
          'prompt after the cancellation',
          runTurn(chat, 'prompt-2', 'and now'),
        );

        expect({
          cancelled: types(cancelled).filter(
            (type) => type === AgentEventType.UserCancelled,
          ),
          failed: types(cancelled).filter(
            (type) =>
              type === AgentEventType.Error ||
              type === AgentEventType.StreamIdleTimeout,
          ),
          requestsAtCancel,
          requests: chat.provider.attempts.length,
          nextText: contentText(next),
          ai: texts(chat, 'ai'),
          human: texts(chat, 'human'),
        }).toStrictEqual({
          cancelled: [AgentEventType.UserCancelled],
          failed: [],
          requestsAtCancel: cancelAtRequest + 1,
          requests: cancelAtRequest + 2,
          nextText: 'next answer',
          ai: ['one pixel', 'next answer'],
          human: ['what is in this picture', 'and now'],
        });
      },
    );
  });
});
