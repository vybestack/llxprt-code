/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import { runSubmitQueryCore } from './submitQueryTurnLifecycle.js';
import {
  buildLifecycleHookDeps,
  createLifecycleDeps,
  createLifecyclePerfHarness,
} from './__tests__/lifecyclePerfFixtures.js';

async function runOwnedTurn(owner: Agent, decoy: Agent): Promise<string> {
  await owner.setHistory([
    { speaker: 'human', blocks: [{ type: 'text', text: 'start' }] },
  ]);
  await owner.session.setRecording({ enabled: true });
  const path = owner.session.getRecording().path;
  if (!path) throw new Error('Missing owner recording');
  const controller = new AbortController();
  const harness = createLifecyclePerfHarness();
  await harness.setup();
  const state = createLifecycleDeps({
    abortControllerRef: { current: controller },
    runStreamRef: {
      current: async (query, signal, promptId) => {
        if (typeof query !== 'string') throw new Error('Expected text input');
        for await (const _event of owner.stream(query, { signal, promptId })) {
          /* drain actual provider events */
        }
      },
    },
  });
  const base = buildLifecycleHookDeps(state, harness.registry);
  try {
    await runSubmitQueryCore(
      {
        ...base,
        ...{ agent: decoy, recordingOwner: 'agent' as const },
        flushRecording: () => owner.session.flushRecording(),
        operationLifecycle: undefined,
        displayUserMessage: () => {},
        prepareQueryForAgent: async (query) => ({
          queryToSend: query,
          shouldProceed: true,
        }),
        handleLoopDetectedEvent: () => {},
        startNewPrompt: () => {},
        getPromptCount: () => 1,
        activeTurnRef: { current: true },
        scheduleNextQueuedSubmission: () => {},
      },
      'keep this owner turn',
      {
        userMessageTimestamp: Date.now(),
        abortSignal: controller.signal,
        promptId: 'owned-submission',
        trimmedStr: 'keep this owner turn',
      },
    );
    return await readFile(path, 'utf8');
  } finally {
    await harness.cleanup();
  }
}

describe('submission turn recording owner', () => {
  const makeOwner = useCommandOwners();
  it('finishes and records a live owner turn without consulting a retired decoy', async () => {
    const retired = await makeOwner('retired-submission');
    const owner = await makeOwner('submission-owner');
    const sibling = await makeOwner('submission-sibling');
    await retired.dispose();
    expect(await runOwnedTurn(owner, retired)).toContain(
      'keep this owner turn',
    );
    expect(await sibling.getHistory()).toHaveLength(0);
    await owner.dispose();
    expect(await runOwnedTurn(sibling, owner)).toContain(
      'keep this owner turn',
    );
  });
});
