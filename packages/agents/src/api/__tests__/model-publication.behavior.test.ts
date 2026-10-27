/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral contract for issue #3954: `Agent.setModel` publishes the model
 * change through the core event bus so subscribers (the footer) refresh. The
 * events under test are produced by the real agent and observed through a real
 * `coreEvents` subscription; nothing here emits them manually.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { AgentBusyError } from '@vybestack/llxprt-code-agents';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import {
  buildProfileAgent,
  drain,
  type Agent,
  type BuiltAgent,
} from './helpers/agentHarness.js';

const PROFILE_NAME = 'gpt-sol-high';

function recordModelChanges(): {
  readonly models: readonly string[];
  readonly stop: () => void;
} {
  const models: string[] = [];
  const listener = (model: string): void => {
    models.push(model);
  };
  coreEvents.on(CoreEvent.ModelChanged, listener);
  return {
    models,
    stop: () => {
      coreEvents.off(CoreEvent.ModelChanged, listener);
    },
  };
}

function recordProfileChanges(): {
  readonly payloads: ReadonlyArray<{ model: string; providerName?: string }>;
  readonly stop: () => void;
} {
  const payloads: Array<{ model: string; providerName?: string }> = [];
  const listener = (payload: {
    model: string;
    providerName?: string;
  }): void => {
    payloads.push(payload);
  };
  coreEvents.on(CoreEvent.ModelProfileChanged, listener);
  return {
    payloads,
    stop: () => {
      coreEvents.off(CoreEvent.ModelProfileChanged, listener);
    },
  };
}

function clientOwner(agent: Agent): SessionClientOwner {
  const deps = 'deps' in agent ? agent.deps : undefined;
  const owner =
    typeof deps === 'object' && deps !== null && 'sessionClient' in deps
      ? deps.sessionClient
      : undefined;
  if (!(owner instanceof SessionClientOwner))
    throw new Error('Expected an owned session client');
  return owner;
}

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('Gate has not been initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('Agent.setModel model publication (#3954)', () => {
  let built: BuiltAgent;
  let agent: Agent;
  let changes: ReturnType<typeof recordModelChanges>;

  beforeEach(async () => {
    built = await buildProfileAgent('plain-text.jsonl');
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
    changes = recordModelChanges();
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
      entered.release();
      await blocked.promise;
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'complete' }] };
    });
    const previousModel = agent.getModel();
    const run = drain(agent.stream('hold the run open'));
    try {
      await entered.promise;

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
    const failure = new Error('credential refresh failed');
    const refresh = spyOn(
      clientOwner(agent),
      'refreshAuth',
    ).mockRejectedValueOnce(failure);

    await expect(agent.setModel('fake-model-failed')).rejects.toBe(failure);
    expect(changes.models).toStrictEqual([]);

    refresh.mockRestore();
    await agent.setModel('fake-model-recovered');

    expect(changes.models).toStrictEqual(['fake-model-recovered']);
  });

  it('publishes when the same target is retried successfully after an earlier attempt failed after the selection was written', async () => {
    const failure = new Error('credential refresh failed');
    const refresh = spyOn(
      clientOwner(agent),
      'refreshAuth',
    ).mockRejectedValueOnce(failure);

    await expect(agent.setModel('fake-model-retry')).rejects.toBe(failure);
    expect(changes.models).toStrictEqual([]);

    await agent.setModel('fake-model-retry');

    refresh.mockRestore();
    expect(changes.models).toStrictEqual(['fake-model-retry']);
    expect(changes.models[0]).toBe(agent.getModel());
  });

  it('stays silent for a no-op setModel of the current model after a failed attempt of another model', async () => {
    const failure = new Error('credential refresh failed');
    const refresh = spyOn(
      clientOwner(agent),
      'refreshAuth',
    ).mockRejectedValueOnce(failure);
    await expect(agent.setModel('fake-model-failed')).rejects.toBe(failure);
    refresh.mockRestore();

    await agent.setModel('fake-model');

    expect(changes.models).toStrictEqual([]);
    expect(agent.getModel()).toBe('fake-model');
  });

  it('rejects a concurrent setModel with AgentBusyError without mutating the model or emitting, and accepts a later setModel', async () => {
    const entered = gate();
    const blocked = gate();
    const refresh = spyOn(clientOwner(agent), 'refreshAuth').mockImplementation(
      async () => {
        entered.release();
        await blocked.promise;
      },
    );
    const first = agent.setModel('fake-model-first');
    try {
      await entered.promise;

      await expect(agent.setModel('fake-model-second')).rejects.toBeInstanceOf(
        AgentBusyError,
      );

      expect(agent.getModel()).toBe('fake-model-first');
      expect(changes.models).toStrictEqual([]);
    } finally {
      blocked.release();
      await first;
      refresh.mockRestore();
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
    function holdNextRefreshAuth(): {
      readonly entered: Promise<void>;
      readonly release: () => void;
      readonly restore: () => void;
    } {
      const entered = gate();
      const blocked = gate();
      const refresh = spyOn(
        clientOwner(agent),
        'refreshAuth',
      ).mockImplementationOnce(async () => {
        entered.release();
        await blocked.promise;
      });
      return {
        entered: entered.promise,
        release: blocked.release,
        restore: () => refresh.mockRestore(),
      };
    }

    it('rejects a setModel issued while a provider switch is in flight with AgentBusyError, without mutating the model or emitting for the rejected call', async () => {
      const hold = holdNextRefreshAuth();
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
        hold.restore();
      }

      expect(changes.models).not.toContain('fake-model-rejected');
      expect(agent.getProvider()).toBe('openai');
      expect(agent.getModel()).not.toBe('fake-model-rejected');
    });

    it('rejects a setProvider issued while a model change is in flight with AgentBusyError and keeps the active provider', async () => {
      const hold = holdNextRefreshAuth();
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
        hold.restore();
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
      profileChanges = recordProfileChanges();
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
      const throwing = (): void => {
        throw new Error('profile listener exploded');
      };
      coreEvents.on(CoreEvent.ModelProfileChanged, throwing);
      try {
        await expect(
          agent.setProvider('openai', 'gpt-4o'),
        ).resolves.toBeDefined();

        expect(agent.getProvider()).toBe('openai');
        expect(agent.getModel()).toBe('gpt-4o');
        expect(changes.models).toStrictEqual(['gpt-4o']);
      } finally {
        coreEvents.off(CoreEvent.ModelProfileChanged, throwing);
      }
    });

    it('publishes nothing when applying the requested model fails after the provider switched', async () => {
      const failure = new Error('credential refresh failed');
      const owner = clientOwner(agent);
      const refreshAuth = owner.refreshAuth.bind(owner);
      let calls = 0;
      const refresh = spyOn(owner, 'refreshAuth').mockImplementation(
        async (method?: string) => {
          calls += 1;
          if (calls === 2) throw failure;
          return refreshAuth(method);
        },
      );
      try {
        await expect(agent.setProvider('openai', 'gpt-4o')).rejects.toBe(
          failure,
        );
      } finally {
        refresh.mockRestore();
      }

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
    const listenerFailure = new Error('listener exploded');
    const throwing = (): void => {
      throw listenerFailure;
    };
    coreEvents.on(CoreEvent.ModelChanged, throwing);
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
      coreEvents.off(CoreEvent.ModelChanged, throwing);
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
