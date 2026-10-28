/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { type Agent } from '../agent.js';
import { type ProviderActivationIntent } from '../config-types.js';
import { fromConfig } from '../fromConfig.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';

/**
 * Behavioral tests for declarative provider-activation / auth intent (#2374,
 * part of #1595). These assert on RESULTING STATE (active provider name,
 * ephemeral values, authFailed flag, config auth state), never on mock call
 * counts. They call `fromConfig` with the caller-owned `Config`,
 * `SettingsService` and `CredentialAuthority` a host passes, wired to the
 * FakeProvider replay seam.
 */
describe('fromConfig activation intent does not desync Agent facade (#2374 round-3 fix 1)', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('fromConfig with activation intent differing from adopted config provider reports the activated provider', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'activation-desync-')),
    );
    const config = new Config(
      toConfigParameters({
        provider: 'openai',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
    );
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    let agent: Agent | undefined;
    try {
      // Force the adopted config to report a DIFFERENT provider than the
      // intent will activate, so the desync is observable: the config says
      // 'openai' but the runtime active provider (and the intent's target) is
      // 'fake'. After activation, the facade must report 'fake'.
      expect(config.getProvider()).toBe('openai');

      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'intent-override-model',
        authMode: 'auto',
      };
      agent = await fromConfig(
        config,
        settings,
        { activation: intent },
        new CredentialAuthority(),
      );
      // POST-activation truth: the executor switched to 'fake' (registered +
      // active under the fake seam) and applied the intent's model override.
      // The facade must NOT report the stale config provider 'openai'.
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('intent-override-model');
    } finally {
      await runCleanupSteps([
        () => agent?.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });
});
