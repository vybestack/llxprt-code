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
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { assembleAgentActivationBootstrap } from '../providerSwitchAssembly.js';
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';

import { assembleWorkspaceMemory } from '@vybestack/llxprt-code-core';

import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { gate } from './helpers/async-child-disposal-join-fixture.js';
import { describe, expect, it } from 'bun:test';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { AgentActivationBootstrap } from '../activationPreflightState.js';

describe('activation media owner lifetime', () => {
  const createFilesystem = installTestWorkspaceFilesystem();
  it('joins accepted activation before closing an untransferred media owner', async () => {
    const builtFactorylessPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'multi-turn-text.jsonl', import.meta.url),
    );
    const builtFactorylessDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
    );
    const builtFactorylessSupplied: CallerAgentRuntimeFactories = {};
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

    const filesystem = createFilesystem({
      targetDir: builtFactorylessConfig.getTargetDir(),
      isTrusted: () =>
        new WorkspaceTrustLifecycle({
          localTrust: builtFactorylessConfig.initialWorkspaceTrust,
        }).isTrustedFolder(),
    });
    const owner = new SessionMediaOwner(
      builtFactorylessConfig.projectTempDir,
      1024,
    );
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      builtFactorylessSettings,
    );
    const entered = gate();
    const factoriesTokenizer = configureProviderTokenizer(manager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    const released = gate();
    const settingsOwner = builtFactorylessSettingsOwner;
    const operation = new AgentActivationBootstrap(
      builtFactorylessConfig,
      manager,
      async () => {
        await owner.store.admit({
          bytes: new Uint8Array([1, 2, 3, 4]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        entered.release();
        await released.promise;
        return { authFailed: false, infoMessages: [] };
      },
      undefined,
      owner,
      await SessionClientOwner.create(
        builtFactorylessConfig,
        assembleTaskSchemaPolicy(builtFactorylessSettings),
        manager,
        builtFactorylessFactories.agentClientFactory,
        owner.store,
        () => undefined,
        filesystem.paths,
        settingsOwner,
        factoriesContent,
        factoriesTokenizer,
      ),
      filesystem,
      assembleWorkspaceMemory(
        builtFactorylessConfig,
        filesystem,
        new WorkspaceTrustLifecycle({
          localTrust: builtFactorylessConfig.initialWorkspaceTrust,
        }),
      ),
      false,
      settingsOwner,
      'borrowed',
      new WorkspaceDefinitionOwner(
        join(builtFactorylessConfig.getTargetDir(), 'profiles'),
        join(builtFactorylessConfig.getTargetDir(), 'subagents'),
      ),
      true,
      new WorkspaceTrustLifecycle({
        localTrust: builtFactorylessConfig.initialWorkspaceTrust,
      }),
    );
    const pending = operation.preflight({ provider: 'fake' });
    await entered.promise;
    const closing = operation.dispose();
    try {
      expect(
        await Promise.race([
          closing.then(() => 'closed'),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve('joining'), 20),
          ),
        ]),
      ).toBe('joining');
    } finally {
      released.release();
      await pending;
      await closing;
      manager.dispose();
      await builtFactorylessClose();
    }
    await expect(owner.store.getStoredByteLength()).rejects.toThrow(/closed/i);
  });
  it('releases the owned filesystem after an accepted memory publication fails during teardown', async () => {
    const builtFactorylessPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'multi-turn-text.jsonl', import.meta.url),
    );
    const builtFactorylessDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
    );

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

    const filesystem = createFilesystem({
      targetDir: builtFactorylessConfig.getTargetDir(),
      isTrusted: () => true,
    });
    const memory = assembleWorkspaceMemory(
      builtFactorylessConfig,
      filesystem,
      new WorkspaceTrustLifecycle({
        localTrust: builtFactorylessConfig.initialWorkspaceTrust,
      }),
    );
    const entered = gate();
    const release = gate();
    memory.operations.subscribe(async () => {
      entered.release();
      await release.promise;
      throw new Error('publication rejected during teardown');
    });
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      builtFactorylessSettings,
      builtFactorylessConfig,
    );
    const operation = await assembleAgentActivationBootstrap(
      builtFactorylessConfig,
      builtFactorylessSettings,
      manager,
      null,
      () => undefined,
      'borrowed',
      undefined,
      undefined,
      filesystem,
      memory,
      builtFactorylessSettingsOwner,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'transferred',
    );
    const refreshing = memory.operations.refresh();
    await entered.promise;
    const closing = operation.dispose();
    release.release();
    try {
      await expect(refreshing).rejects.toThrow(
        'Memory publication and rollback failed',
      );
      await expect(closing).rejects.toThrow('Activation owner cleanup');
      expect(() => filesystem.paths.directories()).toThrow('disposed');
    } finally {
      manager.dispose();
      await filesystem.dispose();
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
