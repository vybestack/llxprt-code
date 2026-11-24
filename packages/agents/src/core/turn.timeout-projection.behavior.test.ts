/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4093: a provider that projects its prompt envelope hands the agent a
 * projection to release if the request is never sent. An attempt the watchdog
 * abandons while its request is still being estimated never sends it. These
 * scenarios run a real Turn over a real ChatSession and HistoryService and
 * observe what happens to that attempt's projection.
 */

import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { IProvider } from '@vybestack/llxprt-code-providers/IProvider.js';
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
const SETTLE_MS = 3_000;

const FIRST_RESPONSE: Readonly<Record<string, number>> = {
  'stream-first-response-timeout-ms': 1000,
  'refusal.backoff-ms': 1,
};

type ProjectPromptEnvelope = NonNullable<IProvider['projectPromptEnvelope']>;

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

/** One projection the provider handed out, and how often it was released. */
interface Projected {
  readonly token: object;
  releases: number;
}

/**
 * A projection for every request. Estimating projection number `held` waits
 * at `estimate` without looking at any signal.
 */
function projecting(
  held: number,
  estimate: Promise<void>,
): {
  readonly project: ProjectPromptEnvelope;
  readonly projected: readonly Projected[];
} {
  const projected: Projected[] = [];
  const project: ProjectPromptEnvelope = (options) => {
    const entry: Projected = { token: Object.freeze({}), releases: 0 };
    const isHeld = projected.length === held;
    projected.push(entry);
    return Promise.resolve({
      model: 'timeout-lifecycle-model',
      protocol: 'anthropic-messages',
      method: 'messages/v1',
      projectionRevision: 1,
      unsupportedMedia: [],
      transportToken: entry.token,
      finalizedProjection: options.contents,
      legacyEstimate: async () => {
        if (isHeld) await estimate;
        return options.contents.length;
      },
      releaseIfUnsent: () => {
        entry.releases += 1;
        return Promise.resolve();
      },
    });
  };
  return { project, projected };
}

/** Waits until `done` holds, or for SETTLE_MS; the caller asserts the state. */
async function settled(done: () => boolean): Promise<void> {
  const deadline = Date.now() + SETTLE_MS;
  while (!done() && Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

async function runTurn(
  setup: TimeoutLifecycleChat,
  promptId: string,
  text: string,
): Promise<ServerAgentStreamEvent[]> {
  const turn = new Turn(
    setup.chat,
    promptId,
    DEFAULT_AGENT_ID,
    'timeout-lifecycle-provider',
    setup.execution,
  );
  const events: ServerAgentStreamEvent[] = [];
  for await (const event of turn.run([{ text }], new AbortController().signal))
    events.push(event);
  return events;
}

function failures(events: readonly ServerAgentStreamEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === AgentEventType.Error ||
    event.type === AgentEventType.StreamIdleTimeout
      ? [event.type]
      : [],
  );
}

describe('a timeout while the prompt envelope is being estimated (issue #4093)', () => {
  let directory = '';
  let setup: TimeoutLifecycleChat | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'turn-timeout-projection-'));
  });

  afterEach(async () => {
    setup?.provider.releaseAll();
    await setup?.chat.clearHistory();
    await setup?.invocationOwner.dispose();
    setup = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  function open(project: ProjectPromptEnvelope): TimeoutLifecycleChat {
    setup = createTimeoutLifecycleChat(
      directory,
      new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      }),
      { streamTimeoutPolicy: FIRST_RESPONSE, projectPromptEnvelope: project },
    );
    return setup;
  }

  /** Runs one prompt, then lets the held estimate finish and settle. */
  async function runWithHeldEstimate(
    chat: TimeoutLifecycleChat,
    projected: readonly Projected[],
    estimate: Gate,
  ): Promise<{
    readonly failures: string[];
    readonly requests: number;
    readonly releasesOfUnsentProjections: number[];
    readonly releasesOfSentProjections: number[];
  }> {
    const sentTokens = (): unknown[] =>
      chat.provider.attempts.map(
        (attempt) => attempt.request.promptEnvelopeTransportToken,
      );
    let events: ServerAgentStreamEvent[];
    try {
      events = await within(
        DEADLINE_MS,
        'answer from the attempt that replaced the abandoned one',
        runTurn(chat, 'prompt-1', 'please summarise'),
      );
    } finally {
      // The abandoned attempt finishes its estimate only now, after its
      // replacement has answered.
      estimate.release();
    }
    await settled(() =>
      projected.every(
        (entry) => sentTokens().includes(entry.token) || entry.releases > 0,
      ),
    );
    const sent = sentTokens();
    return {
      failures: failures(events),
      requests: chat.provider.attempts.length,
      releasesOfUnsentProjections: projected
        .filter((entry) => !sent.includes(entry.token))
        .map((entry) => entry.releases),
      releasesOfSentProjections: projected
        .filter((entry) => sent.includes(entry.token))
        .map((entry) => entry.releases),
    };
  }

  it('releases the projection of an attempt abandoned before its request was sent', async () => {
    const estimate = gate();
    const { project, projected } = projecting(0, estimate.open);
    const chat = open(project);
    chat.provider.onAttempt = (attempt) => {
      attempt.emit('answer');
      attempt.finish();
    };

    const outcome = await runWithHeldEstimate(chat, projected, estimate);

    expect(outcome).toStrictEqual({
      failures: [],
      requests: 1,
      releasesOfUnsentProjections: [1],
      releasesOfSentProjections: [0],
    });
  });

  it('releases the projection of a resend abandoned before it was sent', async () => {
    const estimate = gate();
    const { project, projected } = projecting(1, estimate.open);
    const chat = open(project);
    chat.provider.onAttempt = (attempt) => {
      // The first request stalls. Its resend is held in its estimate and
      // abandoned, so the next request to arrive is the second resend.
      if (attempt.index === 1) {
        attempt.emit('answer');
        attempt.finish();
      }
    };

    const outcome = await runWithHeldEstimate(chat, projected, estimate);

    expect(outcome).toStrictEqual({
      failures: [],
      requests: 2,
      releasesOfUnsentProjections: [1],
      releasesOfSentProjections: [0, 0],
    });
  });
});
