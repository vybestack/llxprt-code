/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4093: a watchdog timeout can land while a request is still being
 * prepared, for example while a BeforeModel hook runs. The abandoned
 * preparation keeps running because a hook ignores cancellation. These
 * scenarios run a real Turn over a real ChatSession and HistoryService and
 * observe which request a later resend puts on the wire.
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
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
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

const FIRST_RESPONSE: Readonly<Record<string, number>> = {
  'stream-first-response-timeout-ms': 400,
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

/**
 * A BeforeModel hook that answers differently on every run, like the hook in
 * the agent-level replay scenario, and whose first run waits at `firstRun`
 * without looking at any signal.
 */
function changingHook(firstRun: Gate): {
  readonly owner: HookExecutionOwner;
  readonly runs: () => number;
} {
  let runs = 0;
  const owner: HookExecutionOwner = {
    sessionId: () => 'timeout-preparation-session',
    transcriptPath: () => undefined,
    beforeModel: async (request) => {
      runs += 1;
      const run = runs;
      if (run === 1) await firstRun.open;
      return new BeforeModelHookOutput({
        hookSpecificOutput: {
          llm_request: {
            contents: [
              ...request.contents,
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: `hook pass ${run}` }],
              },
            ],
          },
        },
      });
    },
  };
  return { owner, runs: () => runs };
}

function aiTexts(setup: TimeoutLifecycleChat): string[] {
  return setup.history
    .getAll()
    .filter((content) => content.speaker === 'ai')
    .flatMap((content) => content.blocks)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []));
}

async function runTurn(
  setup: TimeoutLifecycleChat,
  hookOwner: HookExecutionOwner,
  promptId: string,
  text: string,
): Promise<ServerAgentStreamEvent[]> {
  const turn = new Turn(
    setup.chat,
    promptId,
    DEFAULT_AGENT_ID,
    'timeout-lifecycle-provider',
    setup.execution,
    hookOwner,
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

describe('a timeout while the request is still being prepared (issue #4093)', () => {
  let directory = '';
  let setup: TimeoutLifecycleChat | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'turn-timeout-preparation-'));
  });

  afterEach(async () => {
    setup?.provider.releaseAll();
    await setup?.chat.clearHistory();
    await setup?.invocationOwner.dispose();
    setup = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  function open(
    projectPromptEnvelope?: NonNullable<IProvider['projectPromptEnvelope']>,
  ): TimeoutLifecycleChat {
    setup = createTimeoutLifecycleChat(
      directory,
      new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      }),
      {
        streamTimeoutPolicy: FIRST_RESPONSE,
        ...(projectPromptEnvelope === undefined
          ? {}
          : { projectPromptEnvelope }),
      },
    );
    return setup;
  }

  it('resends the request that went out, not the one an abandoned attempt finished preparing late', async () => {
    const chat = open();
    const firstRun = gate();
    const hook = changingHook(firstRun);
    chat.provider.onAttempt = (attempt) => {
      if (attempt.index === 1) {
        attempt.emit('resent answer');
        attempt.finish();
      }
    };
    // The abandoned attempt finishes its hook only once its replacement is on
    // the wire and waiting for an answer.
    void chat.provider.attemptAt(0).then(() => firstRun.release());

    const events = await within(
      DEADLINE_MS,
      'resend after the preparation timed out',
      runTurn(chat, hook.owner, 'prompt-1', 'please summarise'),
    );
    const [onWire, resent] = chat.provider.attempts;

    expect({
      requests: chat.provider.attempts.length,
      failures: failures(events),
      onWireHookPass: JSON.stringify(onWire.data).includes('hook pass 2'),
      resentIsWhatWentOut: JSON.stringify(resent.data),
      abandonedHookPassSent: JSON.stringify(resent.data).includes(
        'hook pass 1',
      ),
      ai: aiTexts(chat),
    }).toStrictEqual({
      requests: 2,
      failures: [],
      onWireHookPass: true,
      resentIsWhatWentOut: JSON.stringify(onWire.data),
      abandonedHookPassSent: false,
      ai: ['resent answer'],
    });
  });

  it('resends the request that went out when an abandoned attempt finishes its prompt estimate late', async () => {
    const estimate = gate();
    let projections = 0;
    // Every request is projected; estimating the first projection waits at
    // `estimate` without looking at any signal.
    const chat = open((options) => {
      const held = projections === 0;
      projections += 1;
      return Promise.resolve({
        model: 'timeout-lifecycle-model',
        protocol: 'anthropic-messages',
        method: 'messages/v1',
        projectionRevision: 1,
        unsupportedMedia: [],
        transportToken: Object.freeze({}),
        finalizedProjection: options.contents,
        legacyEstimate: async () => {
          if (held) await estimate.open;
          return options.contents.length;
        },
      });
    });
    const hookRuns = gate();
    hookRuns.release();
    const hook = changingHook(hookRuns);
    chat.provider.onAttempt = (attempt) => {
      if (attempt.index === 1) {
        attempt.emit('resent answer');
        attempt.finish();
      }
    };
    // The abandoned attempt finishes its estimate only once its replacement
    // is on the wire and waiting for an answer.
    void chat.provider.attemptAt(0).then(() => estimate.release());

    const events = await within(
      DEADLINE_MS,
      'resend after the estimate timed out',
      runTurn(chat, hook.owner, 'prompt-1', 'please summarise'),
    );
    const [onWire, resent] = chat.provider.attempts;

    expect({
      requests: chat.provider.attempts.length,
      failures: failures(events),
      onWireHookPass: JSON.stringify(onWire.data).includes('hook pass 2'),
      resentIsWhatWentOut: JSON.stringify(resent.data),
      abandonedHookPassSent: JSON.stringify(resent.data).includes(
        'hook pass 1',
      ),
      ai: aiTexts(chat),
    }).toStrictEqual({
      requests: 2,
      failures: [],
      onWireHookPass: true,
      resentIsWhatWentOut: JSON.stringify(onWire.data),
      abandonedHookPassSent: false,
      ai: ['resent answer'],
    });
  });

  it('builds the replacement afresh, and sends nothing for the abandoned attempt, when the timeout lands before any request was kept', async () => {
    const chat = open();
    const firstRun = gate();
    const hook = changingHook(firstRun);
    chat.provider.onAttempt = (attempt) => {
      if (attempt.index === 0) {
        attempt.emit('answer');
        attempt.finish();
      }
      if (attempt.index === 1) {
        attempt.emit('later answer');
        attempt.finish();
      }
    };

    const first = await within(
      DEADLINE_MS,
      'replacement of the attempt that timed out in its hook',
      runTurn(chat, hook.owner, 'prompt-1', 'please summarise'),
    );
    const hookRunsAfterFirst = hook.runs();
    const requestsAfterFirst = chat.provider.attempts.length;
    firstRun.release();
    const second = await within(
      DEADLINE_MS,
      'prompt after the abandoned hook finished',
      runTurn(chat, hook.owner, 'prompt-2', 'and then'),
    );

    expect({
      firstFailures: failures(first),
      secondFailures: failures(second),
      hookRunsAfterFirst,
      requestsAfterFirst,
      requests: chat.provider.attempts.length,
      firstSawItsOwnHook: JSON.stringify(
        chat.provider.attempts[0].data,
      ).includes('hook pass 2'),
      secondSawItsOwnHook: JSON.stringify(
        chat.provider.attempts[1].data,
      ).includes('hook pass 3'),
      ai: aiTexts(chat),
    }).toStrictEqual({
      firstFailures: [],
      secondFailures: [],
      hookRunsAfterFirst: 2,
      requestsAfterFirst: 1,
      requests: 2,
      firstSawItsOwnHook: true,
      secondSawItsOwnHook: true,
      ai: ['answer', 'later answer'],
    });
  });
});
