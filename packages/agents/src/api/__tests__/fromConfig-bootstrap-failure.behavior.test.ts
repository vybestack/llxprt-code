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
import { mkdir, writeFile } from 'node:fs/promises';

import { Storage } from '@vybestack/llxprt-code-settings';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import {
  FakeProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { WorkspaceCheckpointOwner } from '@vybestack/llxprt-code-core/services/workspace-checkpoint-owner.js';
import { CHECKPOINT_STORE_MARKER_FILENAME } from '@vybestack/llxprt-code-core/services/gitService.js';
import { fromConfig } from '../fromConfig.js';
import { assembleMcpRuntime } from '../mcpOAuthAssembly.js';

import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const cleanups: Array<() => Promise<void>> = [];

async function blockCheckpointConfiguration(
  historyDirectory: string,
): Promise<void> {
  await mkdir(join(historyDirectory, '.gitconfig'), { recursive: true });
  await writeFile(
    join(historyDirectory, CHECKPOINT_STORE_MARKER_FILENAME),
    'fixture',
  );
}

function collectMessages(error: unknown): string[] {
  if (error instanceof AggregateError)
    return [error.message, ...error.errors.flatMap(collectMessages)];
  return [error instanceof Error ? error.message : String(error)];
}

function observeCheckpointFailures(): unknown[] {
  const failures: unknown[] = [];
  const initialize = WorkspaceCheckpointOwner.prototype.initialize;
  vi.spyOn(WorkspaceCheckpointOwner.prototype, 'initialize').mockImplementation(
    function (this: WorkspaceCheckpointOwner) {
      return initialize.call(this).catch((error: unknown) => {
        failures.push(error);
        throw error;
      });
    },
  );
  return failures;
}

describe('fromConfig bootstrap failure reporting', () => {
  async function adoptionOptions(_credentialAuthority: CredentialAuthority) {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), 'from-config-bootstrap-failure-')),
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
          sessionId: 'from-config-bootstrap-failure',
          checkpointing: true,
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

  const credentials = useOwnedCredentials();

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('surfaces a workspace initialization failure as the original error, not a cleanup wrapper', async () => {
    await adoptionOptions(credentials().authority);
    const optionsConfig: Parameters<typeof fromConfig>[0] =
      builtFactorylessConfig;
    const optionsSettingsService: Parameters<typeof fromConfig>[1] =
      builtFactorylessSettings;
    const optionsSettingsOwner: Parameters<typeof fromConfig>[3] =
      builtFactorylessSettingsOwner;
    const optionsRuntimeFactoryBindings: Parameters<typeof fromConfig>[13] =
      builtFactorylessFactories;
    const optionsCredentialAuthority: Parameters<typeof fromConfig>[15] =
      credentials().authority;
    const optionsProviderManager: Parameters<typeof fromConfig>[4] = manager;
    const optionsActivation: NonNullable<
      Parameters<typeof fromConfig>[2]
    >['activation'] = { provider: 'fake', model: 'fake-model' };
    await blockCheckpointConfiguration(optionsConfig.projectHistoryDir);
    const failures = observeCheckpointFailures();

    const outcome = await fromConfig(
      optionsConfig,
      optionsSettingsService,
      { activation: optionsActivation },
      optionsSettingsOwner,
      optionsProviderManager,
      undefined,
      builtFactorylessPolicy.session.messageBus,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      optionsRuntimeFactoryBindings,
      undefined,
      optionsCredentialAuthority,
      builtFactorylessPolicy,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failures).toHaveLength(1);
    expect(outcome).toBe(failures[0]);
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).not.toBeInstanceOf(AggregateError);
    expect(outcome).toMatchObject({
      message: expect.stringContaining('Failed to initialize checkpointing'),
    });
    expect(credentials().snapshot()).toStrictEqual([1]);
  });

  it('keeps the primary message visible when a genuine cleanup failure is also reported', async () => {
    await adoptionOptions(credentials().authority);
    const optionsConfig: Parameters<typeof fromConfig>[0] =
      builtFactorylessConfig;
    const optionsSettingsService: Parameters<typeof fromConfig>[1] =
      builtFactorylessSettings;
    const optionsSettingsOwner: Parameters<typeof fromConfig>[3] =
      builtFactorylessSettingsOwner;
    const optionsRuntimeFactoryBindings: Parameters<typeof fromConfig>[13] =
      builtFactorylessFactories;
    const optionsCredentialAuthority: Parameters<typeof fromConfig>[15] =
      credentials().authority;
    const optionsProviderManager: Parameters<typeof fromConfig>[4] = manager;
    const optionsActivation: NonNullable<
      Parameters<typeof fromConfig>[2]
    >['activation'] = { provider: 'fake', model: 'fake-model' };
    await blockCheckpointConfiguration(optionsConfig.projectHistoryDir);
    const policyWritePath = join(
      Storage.getUserPoliciesDir(),
      'auto-saved.toml.tmp',
    );
    await mkdir(policyWritePath, { recursive: true });
    const mcpRuntime = await assembleMcpRuntime(
      optionsConfig,
      undefined,
      {},
      undefined,
      'runtime',
      optionsSettingsOwner,
    );
    mcpRuntime.messageBus.publish({
      type: MessageBusType.UPDATE_POLICY,
      toolName: 'write_file',
      persist: true,
    });
    const failures = observeCheckpointFailures();

    const outcome = await fromConfig(
      optionsConfig,
      optionsSettingsService,
      { activation: optionsActivation, mcpOwnership: 'agent' },
      optionsSettingsOwner,
      optionsProviderManager,
      undefined,
      mcpRuntime.messageBus,
      mcpRuntime,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      optionsRuntimeFactoryBindings,
      undefined,
      optionsCredentialAuthority,
      mcpRuntime.policyOwner,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(AggregateError);
    if (!(outcome instanceof AggregateError))
      throw new Error('Expected an AggregateError');
    expect(failures).toHaveLength(1);
    const primary = failures[0];
    if (!(primary instanceof Error))
      throw new Error('Expected a checkpoint initialization error');
    expect(outcome.message).toContain(primary.message);
    expect(outcome.errors[0]).toBe(primary);
    expect(collectMessages(outcome).join(' ')).toContain(policyWritePath);
    expect(outcome.errors).toHaveLength(2);
    expect(mcpRuntime.isStopped()).toBe(true);
    expect(credentials().snapshot()).toStrictEqual([1]);
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
