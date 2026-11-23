/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4093: a watchdog timeout abandons an attempt while the media
 * admissions of its turn are still being settled. These scenarios run a real
 * Turn over a real ChatSession, HistoryService and MediaAdmissionService whose
 * media store holds or fails one operation, and observe what the abandoned
 * attempt leaves behind: whether the turn resends, and which turn identity the
 * requests it sends carry.
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
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
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

/** A media store that can fail the next release of a reservation, late. */
class ReleaseFailingStore extends LocalMediaStore {
  /** The next release waits for this, releases, and then reports a failure. */
  failNextReleaseAfter: Promise<void> | undefined;

  override async release(contentId: string, ownerId: string): Promise<void> {
    const hold = this.failNextReleaseAfter;
    if (hold === undefined) return super.release(contentId, ownerId);
    this.failNextReleaseAfter = undefined;
    await hold;
    await super.release(contentId, ownerId);
    throw new Error('induced media cleanup failure');
  }
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
  for await (const event of turn.run(
    [{ inlineData: { mimeType: 'image/png', data: PNG_BASE64 } }, { text }],
    new AbortController().signal,
  ))
    events.push(event);
  return events;
}

describe('an attempt abandoned while its media admissions are settled (issue #4093)', () => {
  let directory = '';
  let setup: TimeoutLifecycleChat | undefined;
  let store: ReleaseFailingStore | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'turn-timeout-admission-'));
  });

  afterEach(async () => {
    setup?.provider.releaseAll();
    await setup?.chat.clearHistory();
    await setup?.invocationOwner.dispose();
    setup = undefined;
    store = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  function open(policy: Readonly<Record<string, number>>): {
    readonly chat: TimeoutLifecycleChat;
    readonly store: () => ReleaseFailingStore;
  } {
    const chat = createTimeoutLifecycleChat(
      directory,
      new ProviderFileLifecycle({ maxFiles: 100, maxBytes: 512 * 1024 * 1024 }),
      {
        streamTimeoutPolicy: policy,
        createMediaStore: (storeOptions) => {
          store = new ReleaseFailingStore(storeOptions);
          return store;
        },
      },
    );
    setup = chat;
    return {
      chat,
      store: () => {
        if (store === undefined) throw new Error('The chat has no media store');
        return store;
      },
    };
  }

  it('sends the request again when the abort lands in cleanup that then fails and rolls the answer back', async () => {
    const { chat, store: mediaStore } = open(IDLE);
    const aborted = gate();
    // The answer's history commit publishes first; the release that follows
    // it, which hands the user's media over to history, is the one that fails.
    let commits = 0;
    chat.history.registerBatchParticipant(() => {
      commits += 1;
      const first = commits === 1;
      return {
        publish: () => {
          if (first) mediaStore().failNextReleaseAfter = aborted.open;
        },
        rollback: () => undefined,
      };
    });
    chat.provider.onAttempt = (attempt) => {
      if (attempt.index === 0) {
        for (const signal of attempt.signals)
          signal.addEventListener('abort', () => aborted.release());
        attempt.emit('half answer');
        attempt.finish();
      }
      if (attempt.index === 1) {
        attempt.emit('whole answer');
        attempt.finish();
      }
    };

    const events = await within(
      DEADLINE_MS,
      'turn whose answer was rolled back after the abort',
      runTurn(chat, 'describe it'),
    );

    expect({
      requests: chat.provider.attempts.length,
      timeouts: events.filter(
        (event) => event.type === AgentEventType.StreamIdleTimeout,
      ).length,
      human: texts(chat, 'human'),
      ai: texts(chat, 'ai'),
      images: imageCount(chat),
    }).toStrictEqual({
      requests: 2,
      timeouts: 0,
      human: ['describe it'],
      ai: ['whole answer'],
      images: 1,
    });
  });
});
