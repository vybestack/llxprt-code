/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4093: the idle watchdog is still armed while a finished stream is
 * finalized. When it fires after the attempt committed its media purge but
 * before the answer reached history, the attempt is abandoned with its purge
 * published. These scenarios run a real Turn over a real ChatSession and
 * HistoryService, with a history batch participant that holds the answer
 * commit, and observe that the replacement attempt starts only once the
 * abandoned purge is undone, so that the history it answers against and the
 * history that remains are those of the attempt that answered.
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
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { PNG_BASE64, within } from '../api/__tests__/helpers/stalling-agent.js';
import {
  createTimeoutLifecycleChat,
  type TimeoutLifecycleChat,
} from './__tests__/timeout-lifecycle-chat-fixture.js';

setDefaultTimeout(60_000);

const DEADLINE_MS = 20_000;
const REPLACEMENT_GRACE_MS = 500;

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

function imageCount(setup: TimeoutLifecycleChat): number {
  return setup.history
    .getAll()
    .flatMap((content) => content.blocks)
    .filter((block) => block.type === 'media').length;
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
  execution: AgentChatRecordingExecution,
  onEvent: (event: ServerAgentStreamEvent) => void,
): Promise<void> {
  const turn = new Turn(
    setup.chat,
    'prompt-1',
    DEFAULT_AGENT_ID,
    'timeout-lifecycle-provider',
    execution,
  );
  for await (const event of turn.run([{ text }], new AbortController().signal))
    onEvent(event);
}

describe('a timeout between the purge commit and the answer commit (issue #4093)', () => {
  let directory = '';
  let setup: TimeoutLifecycleChat | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'turn-timeout-purge-commit-'));
  });

  afterEach(async () => {
    setup?.provider.releaseAll();
    await setup?.chat.clearHistory();
    await setup?.invocationOwner.dispose();
    setup = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('starts the replacement only after the abandoned purge was rolled back', async () => {
    const chat = createTimeoutLifecycleChat(
      directory,
      new ProviderFileLifecycle({ maxFiles: 100, maxBytes: 512 * 1024 * 1024 }),
      { semanticMediaPurge: 'remove', streamTimeoutPolicy: IDLE },
    );
    setup = chat;
    await chat.chat.setHistory(imageHistory());
    // Holds the first answer commit, which comes after its purge commit, until
    // the turn announces the resend: the watchdog fires while it is held.
    const answerHeld = gate();
    let answerCommits = 0;
    chat.history.registerBatchParticipant(() => {
      answerCommits += 1;
      const first = answerCommits === 1;
      return {
        publish: async () => {
          if (first) await answerHeld.open;
        },
        rollback: () => undefined,
      };
    });
    // The journal writes are, in order: the abandoned purge and its rollback.
    // The rollback is held until the replacement reaches
    // the provider, or for a grace period when it cannot.
    const replacementArrived = gate();
    let requestsWhileRollbackPending = -1;
    let imagesWhenReplacementRequested = -1;
    let journalWrites = 0;
    const execution: AgentChatRecordingExecution = {
      transcriptPath: () => undefined,
      persistSemanticMediaPurge: async () => {
        journalWrites += 1;
        if (journalWrites !== 2) return;
        await Promise.race([
          replacementArrived.open,
          new Promise<void>((resolve) =>
            setTimeout(resolve, REPLACEMENT_GRACE_MS),
          ),
        ]);
        requestsWhileRollbackPending = chat.provider.attempts.length;
      },
    };
    chat.provider.onAttempt = (attempt) => {
      if (attempt.index === 0) {
        attempt.emit('half answer');
        attempt.finish();
      }
      if (attempt.index === 1) {
        imagesWhenReplacementRequested = imageCount(chat);
        replacementArrived.release();
        attempt.emit('whole answer');
        attempt.finish();
      }
    };

    await within(
      DEADLINE_MS,
      'turn whose answer commit was held past the idle interval',
      runTurn(chat, 'describe it again', execution, (event) => {
        if (event.type === AgentEventType.Retry) answerHeld.release();
      }),
    );

    expect({
      requestsWhileRollbackPending,
      imagesWhenReplacementRequested,
      journalWrites,
      images: imageCount(chat),
      human: texts(chat, 'human'),
      ai: texts(chat, 'ai'),
    }).toStrictEqual({
      requestsWhileRollbackPending: 1,
      imagesWhenReplacementRequested: 1,
      // A resend hands the purge over: only the abandoned attempt wrote one.
      journalWrites: 2,
      images: 1,
      human: ['what is in this picture', 'describe it again'],
      ai: ['one pixel', 'whole answer'],
    });
  });
});
