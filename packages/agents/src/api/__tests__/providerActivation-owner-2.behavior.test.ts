import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
import { describe, expect, it } from 'bun:test';
import { buildAgent } from './helpers/agentHarness.js';

describe('createAgent with declarative activation intent (#2374 finding 1)', () => {
  it('createAgent with activation intent yields the intended provider/auth state', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      activation: {
        provider: 'fake',
        model: 'fake-model',
        authMode: 'auto',
      },
    });
    try {
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');
      expect(fixtureAgentResources(agent).manager.getActiveProviderName()).toBe(
        'fake',
      );
    } finally {
      await cleanup();
    }
  });

  it('createAgent without activation preserves byte-identical legacy behavior', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');
    } finally {
      await cleanup();
    }
  });

  // ─── #2374 round-3: Fix 1 — activation intent desync ────────────────────
  //
  // When the activation intent changes the runtime provider/model to something
  // DIFFERENT from the original AgentConfig fields, the constructed Agent's
  // public state (getProvider/getModel) must reflect the POST-activation truth,
  // not the stale parsed-config values. Under the FakeProvider seam, setting
  // provider:'openai' in the base config but activation.provider:'fake' means
  // the executor activates 'fake' while parsed.provider stays 'openai'. The
  // Agent facade must report 'fake'.
  it('createAgent with activation.provider differing from config.provider reports the activated provider', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      provider: 'openai',
      model: 'gpt-4',
      activation: {
        provider: 'fake',
        model: 'fake-model',
        authMode: 'auto',
      },
    });
    try {
      // POST-activation truth: the executor switched to 'fake' (registered +
      // active under the fake seam) and set model 'fake-model'. The facade
      // must NOT report the stale parsed-provider 'openai'.
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');
      expect(fixtureAgentResources(agent).manager.getActiveProviderName()).toBe(
        'fake',
      );
    } finally {
      await cleanup();
    }
  });
});
