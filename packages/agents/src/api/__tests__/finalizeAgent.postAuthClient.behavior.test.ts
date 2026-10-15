import { CallerAgentRuntimeFactories } from './helpers/fixture-data.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for finalizeAgent's post-auth client guard
 * ("no post-auth agent client", createAgent.ts): characterizes the typed
 * fail-fast when activation reported success but the Config still has no
 * agent client.
 *
 * Reachability (investigated, not assumed):
 * - createAgent cannot reach the branch: it always injects
 *   buildAgentClientFactory() (a real `new AgentClient`) into ConfigParameters
 *   before `new Config(params)`, and applyActivation's `config.initialize()`
 *   runs that factory, so `config.getAgentClient()` is defined by finalize.
 * - fromConfig CAN reach it through public seams: a non-CLI consumer's Config
 *   (buildFactoryLessConfig) carrying a caller-supplied agentClientFactory
 *   that returns undefined. fromConfig honors caller factories (caller-wins —
 *   ensureAgentRuntimeFactories only fills ABSENT fields), `ensureInitialized`
 *   runs the factory without validating its result, and an activation intent
 *   with authMode 'none' skips refreshAuth entirely (executeNoAuth), so no
 *   client is ever constructed. The guard then fails fast instead of letting
 *   the facade bind a missing client.
 *
 * All collaborators are real (Config, MessageBus, FakeProvider env seam);
 * the undefined-returning factory is the behavior under test, not a mock.
 */

import { describe, expect, it } from 'bun:test';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { fromConfig } from '../fromConfig.js';
import { AgentBootstrapError } from '../agentBootstrap.js';

describe('finalizeAgent post-auth client guard', () => {
  it('throws a typed AgentBootstrapError when a caller factory completed bootstrap without constructing an agent client', async () => {
    const builtFactorylessPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const builtFactorylessDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
    );
    const builtFactorylessSupplied: CallerAgentRuntimeFactories = {
      // Deliberate caller-side defect under test: the factory "succeeds"
      // (initialize completes) but constructs nothing. authMode 'none' keeps
      // activation from repairing the omission via refreshAuth.
      agentClientFactory: () => undefined as unknown as AgentClientContract,
    };
    const builtFactorylessConfig = new Config(
      toConfigParameters({
        ...{
          provider: 'fake',
          model: 'fake-model',
          workingDir: builtFactorylessDirectory,
        },
        ...{},
      }),
    );
    const builtFactorylessSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtFactorylessConfig.getInitialSettings(),
    ))
      builtFactorylessSettings.set(key, value);
    const builtFactorylessSettingsOwner = new SessionSettingsOwner(
      builtFactorylessSettings,
    );
    builtFactorylessSettingsOwner.bindTelemetry(builtFactorylessConfig);
    builtFactorylessSettingsOwner.initializeProviderSelection(
      builtFactorylessConfig.getProvider(),
      builtFactorylessConfig.getModel(),
    );
    const builtFactorylessPolicy = new RuntimePolicyOwner(
      builtFactorylessConfig,
    );
    const builtFactorylessTask = builtFactorylessSupplied.taskToolRegistration;
    const builtFactorylessFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...(builtFactorylessSupplied.agentClientFactory
        ? { agentClientFactory: builtFactorylessSupplied.agentClientFactory }
        : {}),
      ...(builtFactorylessTask
        ? { taskToolRegistration: () => builtFactorylessTask }
        : {}),
    };
    const builtFactorylessNoManager = undefined;
    const builtFactorylessClose = settleFactorylessRelease.bind(
      undefined,
      [
        () => builtFactorylessSettingsOwner.dispose(),
        () => builtFactorylessPolicy.dispose(),
        () => builtFactorylessConfig.dispose(),
        () => rm(builtFactorylessDirectory, { recursive: true, force: true }),
      ],
      builtFactorylessPreviousReplay,
    );

    try {
      let captured: unknown;
      try {
        await fromConfig({
          settingsOwner: builtFactorylessSettingsOwner,
          settingsService: builtFactorylessSettings,
          providerManager: builtFactorylessNoManager,
          runtimeFactoryBindings: builtFactorylessFactories,
          config: builtFactorylessConfig,
          messageBus: builtFactorylessPolicy.session.messageBus,
          policyOwner: builtFactorylessPolicy,
          activation: {
            provider: 'fake',
            model: 'fake-model',
            authMode: 'none',
          },
        });
        expect.unreachable('fromConfig should have rejected');
      } catch (error) {
        captured = error;
      }

      // The typed fail-fast surfaces verbatim (fromConfig's cleanup rethrows
      // the primary error), naming the missing post-auth client.
      expect(captured).toBeInstanceOf(AgentBootstrapError);
      expect(captured).toBeInstanceOf(Error);
      const bootstrapError = captured as AgentBootstrapError;
      expect(bootstrapError.name).toBe('AgentBootstrapError');
      expect(bootstrapError.message).toBe('no post-auth agent client');
    } finally {
      await builtFactorylessClose();
    }
  });
});

async function settleFactorylessRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previous: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  }
}
