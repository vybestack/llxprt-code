/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { SessionRecordingService } from '@vybestack/llxprt-code-core';
import { AgentBusyError, type Agent } from '@vybestack/llxprt-code-agents';
import { buildAgent, drain } from './helpers/agentHarness.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Barrier not initialized');
  };
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function applyProfile(agent: Agent, operation: string): Promise<unknown> {
  if (operation === 'load') return agent.profiles.load('during-clear');
  if (operation === 'apply') return agent.profiles.apply('during-clear');
  return agent.profiles.applySnapshot({
    version: 1,
    provider: 'fake',
    model: 'profile-during-clear',
    modelParams: {},
    ephemeralSettings: {},
  });
}

import { usePromptFixture } from './helpers/prompt-fixture.js';

describe('profile admission during a session switch', () => {
  usePromptFixture();

  it.each(['load', 'applySnapshot', 'apply'])(
    'rejects %s while the old recording retires',
    async (operation) => {
      const { agent, cleanup } = await buildAgent('multi-turn-text.jsonl');
      const entered = deferred();
      const release = deferred();
      let switching: Promise<void> | undefined;
      const original = SessionRecordingService.prototype.dispose;
      const pause = spyOn(SessionRecordingService.prototype, 'dispose');
      try {
        await agent.session.setRecording({ enabled: true });
        await drain(agent.stream('old question'));
        const oldState = {
          sessionId: agent.session.getSessionId(),
          model: agent.getModel(),
        };
        await agent.profiles.create('during-clear', {
          name: 'during-clear',
          provider: 'fake',
          model: 'profile-during-clear',
        });
        pause.mockImplementationOnce(async function (
          this: SessionRecordingService,
        ): Promise<void> {
          entered.resolve();
          await release.promise;
          await original.call(this);
        });
        switching = agent.session.startNewSession();
        await entered.promise;
        const application = applyProfile(agent, operation);
        await expect(application).rejects.toBeInstanceOf(AgentBusyError);
        expect({
          sessionId: agent.session.getSessionId(),
          model: agent.getModel(),
        }).toStrictEqual(oldState);
        expect(agent.profiles.isApplying()).toBe(false);
        release.resolve();
        await switching;
        expect(agent.session.getSessionId()).not.toBe(oldState.sessionId);
        expect(agent.getModel()).toBe(oldState.model);
        await agent.profiles.apply('during-clear');
        expect(agent.getModel()).toBe('profile-during-clear');
      } finally {
        release.resolve();
        await switching;
        pause.mockRestore();
        await cleanup();
      }
    },
  );
});
