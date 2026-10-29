/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializePromptSystem } from '@vybestack/llxprt-code-core';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

describe('public Agent loop replacement contract', () => {
  const suiteCleanup: Array<() => void | Promise<void>> = [];
  const cleanup: Array<() => void | Promise<void>> = [];
  afterAll(async () => runCleanupSteps(suiteCleanup.splice(0).reverse()));
  afterEach(async () => runCleanupSteps(cleanup.splice(0).reverse()));
  const credentials = useOwnedCredentials();
  let agent: Agent;
  beforeAll(async () => {
    const prompts = await mkdtemp(join(tmpdir(), 'public-loop-prompts-'));
    suiteCleanup.push(() => rm(prompts, { recursive: true, force: true }));
    const previous = process.env.LLXPRT_PROMPTS_DIR;
    suiteCleanup.push(() => {
      if (previous === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
      else process.env.LLXPRT_PROMPTS_DIR = previous;
    });
    process.env.LLXPRT_PROMPTS_DIR = prompts;
    await initializePromptSystem();
  });
  beforeEach(async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'public-loop-'));
    cleanup.push(() => rm(temporary, { recursive: true, force: true }));
    const directory = await realpath(temporary);
    const previous = process.env.LLXPRT_FAKE_RESPONSES;
    cleanup.push(() => {
      if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previous;
    });
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    agent = await createAgent({
      provider: 'fake',
      model: 'original-model',
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
      recording: { enabled: false },
      coreTools: [],
    });
    cleanup.push(() => agent.dispose());
  });
  it('generates through the initial loop and a new model-bound loop without losing prior conversation', async () => {
    expect((await agent.chat('Keep original conversation')).text).toContain(
      'turn one reply',
    );
    await agent.setModel('replacement-model');
    expect(agent.getModel()).toBe('replacement-model');
    expect((await agent.chat('Continue after model change')).text).toContain(
      'turn two reply',
    );
    const history = JSON.stringify(await agent.session.getHistory());
    expect(history).toContain('Keep original conversation');
    expect(history).toContain('Continue after model change');
  });
  it('starts a fresh conversation on the same Agent and still executes the newly selected client loop', async () => {
    await agent.chat('Old conversation marker');
    expect(JSON.stringify(await agent.session.getHistory())).toContain(
      'Old conversation marker',
    );
    await agent.session.startNewSession();
    expect(await agent.session.getHistory()).toStrictEqual([]);
    expect((await agent.chat('New conversation marker')).text).toContain(
      'reply',
    );
    const history = JSON.stringify(await agent.session.getHistory());
    expect(history).toContain('New conversation marker');
    expect(history).not.toContain('Old conversation marker');
  });
  it('keeps the existing conversation runnable when a candidate provider cannot be acquired', async () => {
    await agent.chat('Preserve before rejected profile');
    const history = structuredClone(await agent.session.getHistory());
    await expect(
      agent.profiles.applySnapshot({
        version: 1,
        provider: 'unregistered-loop-provider',
        model: 'unpublished-model',
        modelParams: {},
        ephemeralSettings: {},
      }),
    ).rejects.toThrow(/unregistered-loop-provider/);
    expect(agent.getProvider()).toBe('fake');
    expect(agent.getModel()).toBe('original-model');
    expect(await agent.session.getHistory()).toStrictEqual(history);
    expect(
      (await agent.chat('Continue after candidate failure')).text,
    ).toContain('reply');
  });
});
