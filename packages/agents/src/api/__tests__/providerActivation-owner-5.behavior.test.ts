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
import { openRouteAAgent } from './helpers/route-a-agent.js';

/**
 * Behavioral tests for declarative provider-activation / auth intent (#2374,
 * part of #1595). These assert on RESULTING STATE (active provider name,
 * ephemeral values, authFailed flag, config auth state), never on mock call
 * counts. They call `fromConfig` with the caller-owned `Config`,
 * `SettingsService` and `CredentialAuthority` a host passes, wired to the
 * FakeProvider replay seam.
 */
describe('fromConfig surfaces auth failure (#2374 finding 3)', () => {
  useFakeResponsesReplay('plain-text.jsonl');

  it('fromConfig with intent whose provider switch fails reports the failure (auto mode, unknown provider)', async () => {
    // Under the FakeProvider seam, switching to an unregistered provider
    // ('nonexistent') in auto mode falls through — the executor's auto path
    // resolves configProvider='nonexistent', switches (swallowed under fake
    // seam), refreshes auth. The auth for an unknown provider fails, which
    // the executor maps to authFailed:true. fromConfig must throw
    // AgentBootstrapError.
    const intent: ProviderActivationIntent = {
      provider: 'nonexistent-provider-xyz',
      authMode: 'auto',
    };
    // Assert on the observable error name + message (behavioral) rather than
    // instanceof, because the runner resolves the test's AgentBootstrapError
    // import and fromConfig's import to distinct module instances, breaking
    // instanceof identity. The error.name is the reliable cross-identity
    // signal that fromConfig surfaced an AgentBootstrapError.
    let thrownError: unknown;
    try {
      await openRouteAAgent({ intent: { activation: intent } });
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).name).toBe('AgentBootstrapError');
    expect((thrownError as Error).message).toContain(
      'fromConfig activation failed',
    );
  });

  it('fromConfig with intent for already-active provider with profile ephemerals resolves (ephemerals intact)', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'activation-ephemerals-')),
    );
    const config = new Config(
      toConfigParameters({
        provider: 'fake',
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
      settings.set('auth-keyfile', '/tmp/profile.key');
      settings.set('base-url', 'https://profile.example/v1');

      const intent: ProviderActivationIntent = {
        provider: 'fake',
        model: 'fake-model',
        authMode: 'auto',
      };
      agent = await fromConfig(
        config,
        settings,
        { activation: intent },
        new CredentialAuthority(),
      );
      expect(settings.get('auth-keyfile')).toBe('/tmp/profile.key');
      expect(settings.get('base-url')).toBe('https://profile.example/v1');
    } finally {
      await runCleanupSteps([
        () => agent?.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });
});
