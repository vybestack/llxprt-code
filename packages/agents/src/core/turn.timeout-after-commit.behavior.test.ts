/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4093: the idle watchdog is still armed while the stream generator
 * runs past the provider's EOF into history finalization. When something
 * after the history commit takes longer than the idle interval, the attempt
 * ends with a timeout although its answer is already in history. A resend then
 * would put a second answer next to the first. These scenarios run a real Turn
 * over a real ChatSession and HistoryService with a history batch participant
 * whose post-commit cleanup waits for the scenario.
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
import { within } from '../api/__tests__/helpers/stalling-agent.js';
import {
  createTimeoutLifecycleChat,
  type TimeoutLifecycleChat,
} from './__tests__/timeout-lifecycle-chat-fixture.js';

setDefaultTimeout(60_000);

const DEADLINE_MS = 20_000;

const IDLE: Readonly<Record<string, number>> = {
  'stream-idle-timeout-ms': 300,
  'refusal.backoff-ms': 1,
};

interface Gate {
  readonly open: Promise<void>;
  release(): void;
}

function gate(): Gate {
  let release: () => void = () => undefined;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { open, release };
}

function texts(setup: TimeoutLifecycleChat, speaker: 'human' | 'ai'): string[] {
  return setup.history
    .getAll()
    .filter((content) => content.speaker === speaker)
    .flatMap((content) => content.blocks)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []));
}

async function runTurn(
  setup: TimeoutLifecycleChat,
  text: string,
): Promise<ServerAgentStreamEvent[]> {
  const turn = new Turn(
    setup.chat,
    'prompt-1',
    DEFAULT_AGENT_ID,
    'timeout-lifecycle-provider',
    setup.execution,
  );
  const events: ServerAgentStreamEvent[] = [];
  for await (const event of turn.run([{ text }], new AbortController().signal))
    events.push(event);
  return events;
}

describe('an idle timeout after the answer reached history (issue #4093)', () => {
  let directory = '';
  let setup: TimeoutLifecycleChat | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'turn-timeout-after-commit-'));
  });

  afterEach(async () => {
    setup?.provider.releaseAll();
    await setup?.chat.clearHistory();
    await setup?.invocationOwner.dispose();
    setup = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('does not resend the request, and the answer is committed once', async () => {
    const chat = createTimeoutLifecycleChat(
      directory,
      new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      }),
      { streamTimeoutPolicy: IDLE },
    );
    setup = chat;
    chat.provider.onAttempt = (attempt) => {
      attempt.emit('complete answer');
      attempt.finish();
    };
    // The cleanup that follows the first commit takes longer than the idle
    // interval. A resend is what would let it finish early here.
    const cleanup = gate();
    const cleanedUp = gate();
    let commits = 0;
    chat.history.registerBatchParticipant(() => {
      commits += 1;
      const first = commits === 1;
      return {
        publish: () => undefined,
        rollback: () => undefined,
        settle: async () => {
          if (!first) return;
          await cleanup.open;
          cleanedUp.release();
        },
      };
    });
    void chat.provider.attemptAt(1).then(() => cleanup.release());

    const events = await within(
      DEADLINE_MS,
      'turn whose commit cleanup outlasts the idle interval',
      runTurn(chat, 'please summarise'),
    );
    const requestsWhenTheTurnEnded = chat.provider.attempts.length;
    cleanup.release();
    await within(DEADLINE_MS, 'the commit cleanup', cleanedUp.open);

    expect({
      requestsWhenTheTurnEnded,
      resendAnnounced: events.filter(
        (event) =>
          event.type === AgentEventType.Retry ||
          event.type === AgentEventType.SystemNotice,
      ).length,
      requests: chat.provider.attempts.length,
      human: texts(chat, 'human'),
      ai: texts(chat, 'ai'),
    }).toStrictEqual({
      requestsWhenTheTurnEnded: 1,
      resendAnnounced: 0,
      requests: 1,
      human: ['please summarise'],
      ai: ['complete answer'],
    });
  });
});
