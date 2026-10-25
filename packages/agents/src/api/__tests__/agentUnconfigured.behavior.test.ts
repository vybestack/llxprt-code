import { makeScratchDir } from './helpers/scratch-dir.js';
import { rm } from 'node:fs/promises';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  createRecordingProvider,
  type RecordingProvider,
} from './helpers/recording-provider.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import {
  describe,
  expect,
  it,
  afterEach as disposeOwnedPolicies,
  beforeEach,
} from 'bun:test';
import {
  UNCONFIGURED_PROVIDER,
  PLACEHOLDER_MODEL,
} from '@vybestack/llxprt-code-core';
import type { AgentEvent } from '../event-types.js';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving an Agent with no active
 * provider fails closed on every model-dependent operation (#2481).
 *
 * The agent is built through createAgent with the unconfigured provider and
 * a recording provider contribution, so we can assert ZERO requests reached a
 * model — the fail-closed guard fires BEFORE any model/client/MCP interaction.
 */

describe('AgentImpl: fail-closed when unconfigured (#2481)', () => {
  const credentials = useOwnedCredentials();
  const releases: Array<() => void | Promise<void>> = [];
  disposeOwnedPolicies(async () => {
    await runCleanupSteps(releases.splice(0).reverse());
  });

  async function makeAgent(provider: RecordingProvider): Promise<Agent> {
    const directory = await makeScratchDir('agent-unconfigured-');
    releases.push(() => rm(directory, { recursive: true, force: true }));
    const created = await createAgent({
      provider: UNCONFIGURED_PROVIDER,
      model: PLACEHOLDER_MODEL,
      providerContributions: provider.contributions,
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    });
    releases.push(() => created.dispose());
    return created;
  }

  let recording: RecordingProvider;
  let agent: Agent;

  beforeEach(async () => {
    recording = createRecordingProvider();
    agent = await makeAgent(recording);
  });

  it('stream yields error + done with actionable /setup message', async () => {
    const {
      errorEvent,
      doneEvent,
      errorIdx,
      doneIdx,
      doneTyped,
      streamYieldsErrorDoneWithActionableSetupMessageObservation1,
      streamYieldsErrorDoneWithActionableSetupMessageObservation2,
    } = await observeStreamYieldsErrorDoneWithActionableSetupMessage();
    expect(errorEvent).toBeDefined();
    expect(doneEvent).toBeDefined();
    expect(
      streamYieldsErrorDoneWithActionableSetupMessageObservation1,
    ).toContain('/setup');
    expect(streamYieldsErrorDoneWithActionableSetupMessageObservation2).toBe(
      'error',
    );
    expect(errorIdx).toBeLessThan(doneIdx);
    expect(doneTyped.finished).toBeUndefined();
  });

  const observeStreamYieldsErrorDoneWithActionableSetupMessage = async () => {
    const events: AgentEvent[] = [];
    for await (const event of agent.stream('hello')) {
      events.push(event);
    }
    const errorEvent = events.find((e) => e.type === 'error');
    const doneEvent = events.find((e) => e.type === 'done');

    // Event contract: the error event precedes the done event, and the done
    // event carries reason 'error' without a finished payload (the error
    // details live on the error event, not the done event's optional
    // `finished` field).
    const errorIdx = events.findIndex((e) => e.type === 'error');
    const doneIdx = events.findIndex((e) => e.type === 'done');

    // doneEvent is guaranteed to be the 'done' variant by the assertion above.
    const doneTyped = doneEvent as Extract<
      (typeof events)[number],
      { type: 'done' }
    >;

    const streamYieldsErrorDoneWithActionableSetupMessageObservation1 =
      errorEvent?.type === 'error' && errorEvent.error.message;
    const streamYieldsErrorDoneWithActionableSetupMessageObservation2 =
      doneEvent?.type === 'done' && doneEvent.reason;
    return {
      errorEvent,
      doneEvent,
      errorIdx,
      doneIdx,
      doneTyped,
      streamYieldsErrorDoneWithActionableSetupMessageObservation1,
      streamYieldsErrorDoneWithActionableSetupMessageObservation2,
    };
  };

  it('stream makes ZERO generation calls to the client', async () => {
    for await (const _event of agent.stream('hello')) {
      // drain
    }
    expect(recording.requests).toHaveLength(0);
  });

  it('chat returns AgentResult with error and done reason error', async () => {
    const result = await agent.chat('hello');
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('/setup');
    expect(result.finishReason).toBe('error');
  });

  it('chat makes ZERO generation calls to the client', async () => {
    await agent.chat('hello');
    expect(recording.requests).toHaveLength(0);
  });

  it('generate rejects with actionable /setup error', async () => {
    await expect(agent.generate('hello')).rejects.toThrow('/setup');
    expect(recording.requests).toHaveLength(0);
  });

  it('generateJson rejects with actionable /setup error', async () => {
    await expect(agent.generateJson([], { type: 'object' })).rejects.toThrow(
      '/setup',
    );
    expect(recording.requests).toHaveLength(0);
  });

  it('generateEmbedding rejects with actionable /setup error', async () => {
    await expect(agent.generateEmbedding(['hello'])).rejects.toThrow('/setup');
    expect(recording.requests).toHaveLength(0);
  });

  it('setModel rejects with actionable /setup error', async () => {
    await expect(agent.setModel('gpt-4')).rejects.toThrow('/setup');
  });

  it('compress rejects with actionable /setup error', async () => {
    await expect(agent.compress()).rejects.toThrow('/setup');
  });

  it('getProvider returns sentinel UNCONFIGURED_PROVIDER when unconfigured', () => {
    expect(agent.getProvider()).toBe(UNCONFIGURED_PROVIDER);
  });

  it('getProviderStatus does not expose the UNCONFIGURED_PROVIDER sentinel', () => {
    const status = agent.getProviderStatus();
    // The sentinel must not be exposed as a real provider name in public status.
    expect(status.provider).not.toBe(UNCONFIGURED_PROVIDER);
    // A neutral empty string is the safe representation.
    expect(status.provider).toBe('');
    expect(status.provider).not.toBe('gemini');
    expect(status.provider).not.toBe('openai');
    expect(status.provider).not.toBe('anthropic');
  });

  it('setProvider from unconfigured returns previousProvider null, not sentinel (#2481)', async () => {
    const { result } =
      await observeSetProviderFromUnconfiguredReturnsPreviousProviderNullNotSentinel2481();
    expect(result.previousProvider).toBeNull();
  });

  const observeSetProviderFromUnconfiguredReturnsPreviousProviderNullNotSentinel2481 =
    async () => {
      // The switch succeeds for real against a registered provider; the
      // unconfigured sentinel must NOT leak as previousProvider.
      const result = await agent.setProvider(recording.alias);

      return { result };
    };
});
