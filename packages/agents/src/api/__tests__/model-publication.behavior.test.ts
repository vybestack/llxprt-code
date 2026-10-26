/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral contract for issue #3954: `Agent.setModel` publishes the model
 * change so subscribers (the footer) refresh. The events under test are
 * produced by the real agent and observed through the session settings owner
 * the way the CLI footer subscribes; nothing here emits them manually.
 *
 * The transition's failing and blocking steps are injected through the
 * tokenizer factory the session client prepares before it acquires anything,
 * which is the seam this branch leaves open to a host.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { AgentBusyError } from '@vybestack/llxprt-code-agents';
import type { Agent } from '../agent.js';
import { drain, type BuiltAgent } from './helpers/agentHarness.js';
import {
  buildReplayProviderAgent,
  fixtureKeys,
} from './helpers/replay-provider-agent.js';

const PROFILE_NAME = 'gpt-sol-high';

interface Gate {
  readonly entered: Promise<void>;
  open(): void;
  readonly released: Promise<void>;
  release(): void;
}

function gate(): Gate {
  let open = (): void => undefined;
  let release = (): void => undefined;
  const entered = new Promise<void>((resolve) => {
    open = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { entered, open, released, release };
}

interface TokenizerControl {
  readonly factory: RuntimeTokenizerFactory;
  /** Rejects the next preparation with the returned error. */
  failNext(): Error;
  /** Blocks the next preparation until the returned gate is released. */
  holdNext(): Gate;
}

/**
 * A tokenizer factory whose preparation the test can fail or hold. Client
 * replacement prepares the tokenizer before it acquires anything, so a failure
 * or a hold lands inside the model transition: nothing has been swapped yet and
 * the transition observes a rejection, or waits.
 */
function tokenizerControl(): TokenizerControl {
  const failures: Error[] = [];
  const holds: Gate[] = [];
  return {
    factory: {
      getTokenizer: () => ({ fallbackPolicy: 'deny', countTokens: () => 1 }),
      estimatePrompt: async (request) => ({
        count: await request.legacyEstimate(),
        method: 'calibrated',
        family: 'model-publication',
        estimatorVersion: 'model-publication-v1',
        assetRevision: 'none',
        projectionRevision: request.projectionRevision,
      }),
      prepareTokenizer: async () => {
        const held = holds.shift();
        if (held !== undefined) {
          held.open();
          await held.released;
        }
        const failure = failures.shift();
        if (failure !== undefined) throw failure;
      },
    },
    failNext: () => {
      const failure = new Error('credential refresh failed');
      failures.push(failure);
      return failure;
    },
    holdNext: () => {
      const held = gate();
      holds.push(held);
      return held;
    },
  };
}

function recordModelChanges(subject: Agent): {
  readonly models: readonly string[];
  readonly stop: () => void;
} {
  const models: string[] = [];
  const stop = subject.settings.subscribeModelChanges((profile) => {
    if (profile === undefined) models.push(subject.getModel());
  });
  return { models, stop };
}

function recordProfileChanges(subject: Agent): {
  readonly payloads: ReadonlyArray<{ model: string; providerName?: string }>;
  readonly stop: () => void;
} {
  const payloads: Array<{ model: string; providerName?: string }> = [];
  const stop = subject.settings.subscribeModelChanges((profile) => {
    if (profile !== undefined) payloads.push(profile);
  });
  return { payloads, stop };
}

async function buildPublicationAgent(
  tokenizer: TokenizerControl,
): Promise<BuiltAgent> {
  return buildReplayProviderAgent({
    initial: {
      alias: 'fake',
      script: { fixtureRelPath: 'plain-text.jsonl' },
    },
    storedKeys: fixtureKeys('openai-prod', 'anthropic-prod'),
    configOverrides: { tokenizerFactory: tokenizer.factory },
  });
}

describe('Agent.setModel model publication (#3954)', () => {
  let built: BuiltAgent;
  let agent: Agent;
  let tokenizer: TokenizerControl;
  let changes: ReturnType<typeof recordModelChanges>;

  beforeEach(async () => {
    tokenizer = tokenizerControl();
    built = await buildPublicationAgent(tokenizer);
    agent = built.agent;
    await agent.profiles.applySnapshot(
      {
        version: 1,
        provider: 'fake',
        model: 'fake-model',
        modelParams: {},
        ephemeralSettings: {},
      },
      { profileName: PROFILE_NAME },
    );
    changes = recordModelChanges(agent);
  });

  afterEach(async () => {
    changes.stop();
    await built.cleanup();
  });

  it('publishes exactly one ModelChanged carrying the new model while the profile is unchanged', async () => {
    await agent.setModel('fake-model-next');

    expect(changes.models).toStrictEqual(['fake-model-next']);
    expect(agent.getModel()).toBe('fake-model-next');
    expect(agent.getActiveProfileName()).toBe(PROFILE_NAME);
  });

  it('publishes one event per consecutive model change, in order', async () => {
    await agent.setModel('fake-model-first');
    await agent.setModel('fake-model-second');

    expect(changes.models).toStrictEqual([
      'fake-model-first',
      'fake-model-second',
    ]);
  });

  it('publishes nothing when the model is set to the current model', async () => {
    await agent.setModel(agent.getModel());

    expect(changes.models).toStrictEqual([]);
  });

  it('publishes nothing and keeps the previous model when a run is active', async () => {
    const entered = gate();
    const blocked = gate();
    const model = spyOn(
      FakeProvider.prototype,
      'generateChatCompletion',
    ).mockImplementation(async function* () {
      entered.open();
      await blocked.released;
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'complete' }] };
    });
    const previousModel = agent.getModel();
    const run = drain(agent.stream('hold the run open'));
    try {
      await entered.entered;

      await expect(agent.setModel('fake-model-busy')).rejects.toBeInstanceOf(
        AgentBusyError,
      );

      expect(changes.models).toStrictEqual([]);
      expect(agent.getModel()).toBe(previousModel);
    } finally {
      blocked.release();
      await run;
      model.mockRestore();
    }
  });

  it('publishes nothing when a later step of the model change fails and still publishes the next successful change', async () => {
    const failure = tokenizer.failNext();

    await expect(agent.setModel('fake-model-failed')).rejects.toBe(failure);
    expect(changes.models).toStrictEqual([]);

    await agent.setModel('fake-model-recovered');

    expect(changes.models).toStrictEqual(['fake-model-recovered']);
  });

  it('publishes when the same target is retried successfully after an earlier attempt failed after the selection was written', async () => {
    const failure = tokenizer.failNext();

    await expect(agent.setModel('fake-model-retry')).rejects.toBe(failure);
    expect(changes.models).toStrictEqual([]);

    await agent.setModel('fake-model-retry');

    expect(changes.models).toStrictEqual(['fake-model-retry']);
    expect(changes.models[0]).toBe(agent.getModel());
  });

  it('stays silent for a no-op setModel of the current model after a failed attempt of another model', async () => {
    const failure = tokenizer.failNext();
    await expect(agent.setModel('fake-model-failed')).rejects.toBe(failure);

    await agent.setModel('fake-model');

    expect(changes.models).toStrictEqual([]);
    expect(agent.getModel()).toBe('fake-model');
  });

  it('rejects a concurrent setModel with AgentBusyError without mutating the model or emitting, and accepts a later setModel', async () => {
    const held = tokenizer.holdNext();
    const first = agent.setModel('fake-model-first');
    try {
      await held.entered;

      await expect(agent.setModel('fake-model-second')).rejects.toBeInstanceOf(
        AgentBusyError,
      );

      expect(agent.getModel()).toBe('fake-model-first');
      expect(changes.models).toStrictEqual([]);
    } finally {
      held.release();
      await first;
    }

    expect(changes.models).toStrictEqual(['fake-model-first']);
    await agent.setModel('fake-model-third');
    expect(changes.models).toStrictEqual([
      'fake-model-first',
      'fake-model-third',
    ]);
    expect(agent.getModel()).toBe('fake-model-third');
  });

  describe('shared exclusive mutation boundary for model and provider changes', () => {
    it('rejects a setModel issued while a provider switch is in flight with AgentBusyError, without mutating the model or emitting for the rejected call', async () => {
      const hold = tokenizer.holdNext();
      const switching = agent.setProvider('openai');
      try {
        await hold.entered;
        const modelDuringSwitch = agent.getModel();
        const publishedDuringSwitch = [...changes.models];

        await expect(
          agent.setModel('fake-model-rejected'),
        ).rejects.toBeInstanceOf(AgentBusyError);

        expect(agent.getModel()).toBe(modelDuringSwitch);
        expect(changes.models).toStrictEqual(publishedDuringSwitch);
      } finally {
        hold.release();
        await switching;
      }

      expect(changes.models).not.toContain('fake-model-rejected');
      expect(agent.getProvider()).toBe('openai');
      expect(agent.getModel()).not.toBe('fake-model-rejected');
    });

    it('rejects a setProvider issued while a model change is in flight with AgentBusyError and keeps the active provider', async () => {
      const hold = tokenizer.holdNext();
      const changing = agent.setModel('fake-model-first');
      try {
        await hold.entered;

        await expect(agent.setProvider('openai')).rejects.toBeInstanceOf(
          AgentBusyError,
        );

        expect(agent.getProvider()).toBe('fake');
      } finally {
        hold.release();
        await changing;
      }

      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model-first');
      expect(changes.models).toStrictEqual(['fake-model-first']);
    });

    it('accepts awaited setProvider then setModel, publishing the model change once and leaving provider and model correct', async () => {
      await agent.setProvider('openai', 'gpt-4o');
      const publishedBySwitch = changes.models.length;

      await agent.setModel('gpt-4o-mini');

      expect(changes.models.slice(publishedBySwitch)).toStrictEqual([
        'gpt-4o-mini',
      ]);
      expect(agent.getProvider()).toBe('openai');
      expect(agent.getModel()).toBe('gpt-4o-mini');
    });

    it('accepts awaited setModel then setProvider, publishing the model change once and leaving provider and model correct', async () => {
      await agent.setModel('fake-model-next');
      expect(changes.models).toStrictEqual(['fake-model-next']);

      await agent.setProvider('openai', 'gpt-4o');

      expect(
        changes.models.filter((m) => m === 'fake-model-next'),
      ).toHaveLength(1);
      expect(agent.getProvider()).toBe('openai');
      expect(agent.getModel()).toBe('gpt-4o');
    });
  });

  describe('provider switch with an explicit model', () => {
    let profileChanges: ReturnType<typeof recordProfileChanges>;

    beforeEach(() => {
      profileChanges = recordProfileChanges(agent);
    });

    afterEach(() => {
      profileChanges.stop();
    });

    it('keeps one ModelProfileChanged and the target default model when no model is requested', async () => {
      await agent.setProvider('openai');

      const switchedModel = agent.getModel();
      expect(switchedModel).not.toBe('fake-model');
      expect(changes.models).toStrictEqual([switchedModel]);
      expect(profileChanges.payloads).toStrictEqual([
        expect.objectContaining({
          model: switchedModel,
          providerName: 'openai',
        }),
      ]);
    });

    it('applies a requested model that equals the previous model instead of keeping the target default', async () => {
      const previousModel = agent.getModel();

      await agent.setProvider('openai', previousModel);

      expect(agent.getProvider()).toBe('openai');
      expect(agent.getModel()).toBe(previousModel);
      expect(changes.models).toStrictEqual([]);
      expect(profileChanges.payloads).toStrictEqual([
        expect.objectContaining({
          model: previousModel,
          providerName: 'openai',
        }),
      ]);
    });

    it('publishes only the requested model, never the target default, when it differs from the previous model', async () => {
      await agent.setProvider('openai', 'gpt-4o');

      expect(agent.getProvider()).toBe('openai');
      expect(agent.getModel()).toBe('gpt-4o');
      expect(changes.models).toStrictEqual(['gpt-4o']);
      expect(profileChanges.payloads).toStrictEqual([
        expect.objectContaining({ model: 'gpt-4o', providerName: 'openai' }),
      ]);
    });

    it('publishes the requested model when the provider is unchanged', async () => {
      await agent.setProvider('fake', 'fake-model-next');

      expect(agent.getModel()).toBe('fake-model-next');
      expect(changes.models).toStrictEqual(['fake-model-next']);
    });

    it('keeps a completed provider switch successful when a ModelProfileChanged listener throws', async () => {
      const stop = agent.settings.subscribeModelChanges((profile) => {
        if (profile !== undefined) throw new Error('profile listener exploded');
      });
      try {
        await expect(
          agent.setProvider('openai', 'gpt-4o'),
        ).resolves.toBeDefined();

        expect(agent.getProvider()).toBe('openai');
        expect(agent.getModel()).toBe('gpt-4o');
        expect(changes.models).toStrictEqual(['gpt-4o']);
      } finally {
        stop();
      }
    });

    it('publishes nothing when applying the requested model fails after the provider switched', async () => {
      const failure = tokenizer.failNext();

      await expect(agent.setProvider('openai', 'gpt-4o')).rejects.toBe(failure);

      expect(changes.models).toStrictEqual([]);
      expect(profileChanges.payloads).toStrictEqual([]);
    });
  });

  describe('after a provider switch without an explicit model', () => {
    it('publishes a change back to the previous provider model, which is no longer the model in force', async () => {
      await agent.setProvider('openai');
      const switchedModel = agent.getModel();
      expect(switchedModel).not.toBe('fake-model');
      const publishedBySwitch = changes.models.length;

      await agent.setModel('fake-model');

      expect(changes.models.slice(publishedBySwitch)).toStrictEqual([
        'fake-model',
      ]);
      expect(changes.models[changes.models.length - 1]).toBe(agent.getModel());
    });

    it('publishes nothing when the model is set to the default model the switch applied', async () => {
      await agent.setProvider('openai');
      const switchedModel = agent.getModel();
      const publishedBySwitch = changes.models.length;

      await agent.setModel(switchedModel);

      expect(changes.models.slice(publishedBySwitch)).toStrictEqual([]);
      expect(agent.getModel()).toBe(switchedModel);
    });
  });

  it('keeps a completed model change successful when a ModelChanged listener throws', async () => {
    const stop = agent.settings.subscribeModelChanges((profile) => {
      if (profile === undefined) throw new Error('listener exploded');
    });
    try {
      await expect(
        agent.setModel('fake-model-notified'),
      ).resolves.toBeUndefined();
      expect(agent.getModel()).toBe('fake-model-notified');

      await expect(
        agent.setModel('fake-model-after-listener'),
      ).resolves.toBeUndefined();
      expect(agent.getModel()).toBe('fake-model-after-listener');
    } finally {
      stop();
    }
  });

  it('reports the last published model as the model the agent now uses after a provider and model switch', async () => {
    await agent.setProvider('openai', 'gpt-4o');
    await agent.setModel('gpt-4o-mini');

    const lastPublished = changes.models[changes.models.length - 1];
    expect(lastPublished).toBe('gpt-4o-mini');
    expect(lastPublished).toBe(agent.getModel());
  });
});
