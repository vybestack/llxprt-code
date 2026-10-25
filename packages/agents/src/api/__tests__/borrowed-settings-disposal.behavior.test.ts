import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import type { Agent } from '../agent.js';
import { fromConfig } from '../fromConfig.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface PeerAgent {
  readonly agent: Agent;
  readonly close: () => Promise<void>;
}

/** A second agent over the caller's `SettingsService`, with its own `Config`. */
async function openPeerOverSettings(
  settings: SettingsService,
  authority: CredentialAuthority,
): Promise<PeerAgent> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'borrowed-settings-peer-')),
  );
  const config = new Config(
    toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      workingDir: directory,
    }),
  );
  let agent: Agent | undefined;
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => agent?.dispose(),
      () => config.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]);
  try {
    agent = await fromConfig(
      config,
      settings,
      { activation: { provider: 'fake', model: 'fake-model' } },
      authority,
    );
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
  return { agent, close };
}

describe('borrowed settings disposal', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
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

  it.each([0, 1])(
    'retains caller settings and the peer when facade %s closes first',
    async (closingIndex) => {
      const built = await openRouteAAgent();
      let second: PeerAgent;
      try {
        second = await openPeerOverSettings(built.settings, built.authority);
      } catch (primary) {
        await built.close();
        throw primary;
      }
      const first = built.agent;
      const closing = closingIndex === 0 ? first : second.agent;
      const peer = closingIndex === 0 ? second.agent : first;
      try {
        const disposal = closing.dispose();
        expect(() =>
          closing.setEphemeralSetting('maxOutputTokens', 19),
        ).toThrow('Session settings owner is closed');
        expect(() => closing.getEphemeralSetting('maxOutputTokens')).toThrow(
          'Session settings owner is closed',
        );
        await disposal;
        peer.setEphemeralSetting('maxOutputTokens', 71);
        const events = [];
        for await (const event of peer.stream(
          'Peer survives borrowed disposal',
        ))
          events.push(event);
        expect(events.filter((event) => event.type === 'error')).toStrictEqual(
          [],
        );
        expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
        expect(built.settings.get('maxOutputTokens')).toBe(71);
        await peer.dispose();
      } finally {
        await runCleanupSteps([() => second.close(), () => built.close()]);
      }
    },
    30000,
  );
});
