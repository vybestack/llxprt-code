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
import { afterEach, describe, expect, it, vi } from 'bun:test';

import {
  FakeProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { fromConfig } from '../fromConfig.js';
import { assembleAgentActivationBootstrap } from '../providerSwitchAssembly.js';

const cleanups: Array<() => Promise<void>> = [];

function messagesOf(error: unknown): string[] {
  if (error instanceof AggregateError)
    return [error.message, ...error.errors.flatMap(messagesOf)];
  return [error instanceof Error ? error.message : String(error)];
}

describe('activation preflight cleanup failure reporting', () => {
  async function failingCleanupOperation() {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'preflight-cleanup-failure-')),
    );
    cleanups.push(() => rm(directory, { recursive: true, force: true }));

    builtFactorylessPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    builtFactorylessDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
    );
    const builtFactorylessSupplied: CallerAgentRuntimeFactories = {};
    builtFactorylessConfig = new Config(
      toConfigParameters({
        ...{
          provider: 'fake',
          model: 'fake-model',
          workingDir: builtFactorylessDirectory,
        },
        ...{
          workingDir: directory,
          sessionId: 'preflight-cleanup-failure',
          folderTrust: true,
          mcpEnabled: false,
          skillsSupport: false,
          recording: { enabled: false },
          telemetry: { enabled: false },
          settings: { jitContextEnabled: false },
        },
      }),
    );
    builtFactorylessSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtFactorylessConfig.getInitialSettings(),
    ))
      builtFactorylessSettings.set(key, value);
    builtFactorylessSettingsOwner = new SessionSettingsOwner(
      builtFactorylessSettings,
    );
    builtFactorylessSettingsOwner.bindTelemetry(builtFactorylessConfig);
    builtFactorylessSettingsOwner.initializeProviderSelection(
      builtFactorylessConfig.getProvider(),
      builtFactorylessConfig.getModel(),
    );
    builtFactorylessPolicy = new RuntimePolicyOwner(builtFactorylessConfig);
    const builtFactorylessTask = builtFactorylessSupplied.taskToolRegistration;
    builtFactorylessFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...(builtFactorylessSupplied.agentClientFactory
        ? { agentClientFactory: builtFactorylessSupplied.agentClientFactory }
        : {}),
      ...(builtFactorylessTask
        ? { taskToolRegistration: () => builtFactorylessTask }
        : {}),
    };

    builtFactorylessClose = settleFactorylessRelease.bind(
      undefined,
      [
        () => builtFactorylessSettingsOwner.dispose(),
        () => builtFactorylessPolicy.dispose(),
        () => builtFactorylessConfig.dispose(),
        () => rm(builtFactorylessDirectory, { recursive: true, force: true }),
      ],
      builtFactorylessPreviousReplay,
    );

    cleanups.push(builtFactorylessClose);
    manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      builtFactorylessSettings,
    );
    manager.registerProvider(
      new FakeProvider(join(import.meta.dir, 'fixtures/plain-text.jsonl')),
    );
    vi.spyOn(builtFactorylessSettingsOwner, 'dispose').mockRejectedValue(
      new Error('settings disposal failed'),
    );
    operation = await assembleAgentActivationBootstrap(
      builtFactorylessConfig,
      builtFactorylessSettings,
      manager,
      null,
      () => undefined,
      'borrowed',
      undefined,
      undefined,
      undefined,
      undefined,
      builtFactorylessSettingsOwner,
      'transferred',
      builtFactorylessPolicy.trust,
      () => Promise.reject(new Error('trust cleanup failed')),
    );
    intent = { provider: 'fake', model: 'fake-model' };
    const result = await operation.preflight(intent);
    if (!result.token) throw new Error('Missing actual preflight token');
    token = result.token;
  }

  let directory: string;
  let builtFactorylessPreviousReplay: string | undefined;
  let builtFactorylessDirectory: string;
  let builtFactorylessConfig: Config;
  let builtFactorylessSettings: SettingsService;
  let builtFactorylessSettingsOwner: SessionSettingsOwner;
  let builtFactorylessPolicy: RuntimePolicyOwner;
  let builtFactorylessFactories: ReturnType<
    typeof createAgentRuntimeFactoryBindings
  >;
  let builtFactorylessClose: () => Promise<void>;
  let manager: ProviderManager;
  let operation: Awaited<ReturnType<typeof assembleAgentActivationBootstrap>>;
  let intent: { provider: string; model: string };
  let token: NonNullable<
    Awaited<ReturnType<typeof operation.preflight>>['token']
  >;

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('reports a settings disposal rejection together with the other collected resource failures', async () => {
    await failingCleanupOperation();
    const outcome = await Promise.resolve(operation.dispose()).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(AggregateError);
    const messages = messagesOf(outcome);
    expect(messages).toContain('trust cleanup failed');
    expect(messages).toContain('settings disposal failed');
  });

  it('keeps the original adoption failure when preflight cleanup also fails', async () => {
    await failingCleanupOperation();
    const outcome = await fromConfig({
      config: builtFactorylessConfig,
      settingsService: builtFactorylessSettings,
      settingsOwner: builtFactorylessSettingsOwner,
      policyOwner: builtFactorylessPolicy,
      messageBus: builtFactorylessPolicy.session.messageBus,
      runtimeFactoryBindings: builtFactorylessFactories,
      providerManager: manager,
      activation: { provider: 'fake', model: 'a-different-model' },
      activationPreflight: { operation, token },
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(AggregateError);
    if (!(outcome instanceof AggregateError))
      throw new Error('Expected an AggregateError');
    expect(messagesOf(outcome.errors[0])[0]).toContain(
      'Activation preflight intent mismatch',
    );
    const messages = messagesOf(outcome);
    expect(messages).toContain('trust cleanup failed');
    expect(messages).toContain('settings disposal failed');
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
