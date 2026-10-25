/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, afterAll, describe, expect, it, afterEach } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { Agent } from '../agent.js';
import type { ProviderActivationIntent } from '../config-types.js';
import { AgentProfilePreflight } from '../profile-preflight.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

const intent: ProviderActivationIntent = {
  provider: 'fake',
  model: 'fake-model',
  authMode: 'none',
};

describe('fromConfig admission before resource effects', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  useFakeResponsesReplay('plain-text.jsonl');

  const credentials = useOwnedCredentials();

  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function rejectWithoutAcquisition(
    workspaceDirectory: string,
    adopt: () => Promise<Agent>,
  ): Promise<unknown> {
    const home = process.env.LLXPRT_CONFIG_HOME;
    if (home === undefined) throw new Error('Missing fixture config home');
    const before = (await readdir(home, { recursive: true })).sort();
    const workspaceBefore = (
      await readdir(workspaceDirectory, { recursive: true })
    ).sort();
    const transports = credentials().snapshot();
    const outcome = await adopt().then(
      async (agent) => {
        await agent.dispose();
        return undefined;
      },
      (error: unknown) => error,
    );
    const after = await readdir(home, { recursive: true });
    const workspaceAfter = await readdir(workspaceDirectory, {
      recursive: true,
    });
    expect([
      ...after.filter((entry) => !before.includes(entry)),
      ...before.filter((entry) => !after.includes(entry)),
    ]).toStrictEqual([]);
    expect([
      ...workspaceAfter.filter((entry) => !workspaceBefore.includes(entry)),
      ...workspaceBefore.filter((entry) => !workspaceAfter.includes(entry)),
    ]).toStrictEqual([]);
    expect(credentials().snapshot().length - transports.length).toBe(0);
    return outcome;
  }

  it('rejects preflight intent identity before transferring or acquiring resources', async () => {
    const route = await openRouteBPreflight({
      authority: credentials().authority,
      config: {
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        recording: { enabled: false },
        telemetry: { enabled: false },
        settings: { jitContextEnabled: false },
      },
    });
    cleanups.push(() => route.close());
    await route.prepare();
    const result = await route.preflight.preflight(intent);
    if (result.token === undefined)
      throw new Error('Missing preflight receipt');
    const token = result.token;
    await expect(
      rejectWithoutAcquisition(route.config.getTargetDir(), () =>
        AgentProfilePreflight.createForegroundAgent(
          route.preflight,
          token,
          { ...intent, model: 'other' },
          {},
        ),
      ),
    ).resolves.toMatchObject({
      message: expect.stringMatching(/preflight/i),
    });
  });
});
