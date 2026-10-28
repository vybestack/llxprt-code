/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { createRecordingProvider } from './helpers/recording-provider.js';
import { makeScratchDir } from './helpers/scratch-dir.js';

describe('recording provider contribution', () => {
  const credentials = useOwnedCredentials();
  const releases: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await runCleanupSteps(releases.splice(0).reverse());
  });

  async function openAgent(
    recording: ReturnType<typeof createRecordingProvider>,
  ): Promise<Agent> {
    const directory = await makeScratchDir('recording-provider-');
    releases.push(() => rm(directory, { recursive: true, force: true }));
    const agent = await createAgent({
      provider: recording.alias,
      model: 'recording-default',
      providerContributions: recording.contributions,
      workingDir: directory,
      credentialAuthority: credentials().authority,
      harness: { includeProcessCwd: false },
    });
    releases.push(() => agent.dispose());
    return agent;
  }

  it('records the request a turn sends and answers with the configured text', async () => {
    const recording = createRecordingProvider({ responseText: 'canned reply' });
    const agent = await openAgent(recording);

    const result = await agent.chat('where is the model request');

    expect(result.text).toContain('canned reply');
    expect(recording.requests).toHaveLength(1);
    expect(JSON.stringify(recording.requests[0].contents)).toContain(
      'where is the model request',
    );
  });

  it('holds a request until it is released', async () => {
    const recording = createRecordingProvider();
    const agent = await openAgent(recording);
    const hold = recording.hold();

    let settled = false;
    const turn = agent.chat('held turn').then((result) => {
      settled = true;
      return result;
    });
    const request = await hold.entered;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const settledWhileHeld = settled;
    hold.release();
    const result = await turn;

    expect(JSON.stringify(request.contents)).toContain('held turn');
    expect(settledWhileHeld).toBe(false);
    expect(result.text).toContain('recorded');
  });
});
