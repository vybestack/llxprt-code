import { createCapturedSessionOwner } from './helpers/session-client-capture.js';
import {
  captureAgentAdoption,
  fixtureAgentResources,
} from './helpers/agent-resource-capture.js';
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
import { describe, expect, it, spyOn } from 'bun:test';
import { writeFile } from 'node:fs/promises';

import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { cleanupFailedAdoption } from '../fromConfig-cleanup.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('adoption cleanup with explicit close operations', () => {
  const credentials = useOwnedCredentials();
  for (const ownership of ['agent', 'caller'] as const) {
    it(`retains ${ownership} workspace ownership when media acquisition fails before provider acquisition`, async () => {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'adoption-media-rollback-')),
      );
      const config = new Config(
        toConfigParameters({
          provider: 'fake',
          model: 'fake-model',
          workingDir: directory,
          folderTrust: true,
          mcpEnabled: false,
          skillsSupport: false,
          telemetry: { enabled: false },
          recording: { enabled: false },
        }),
      );
      const settings = new SettingsService();
      const selected = new SessionSettingsOwner(settings);
      const policy = new RuntimePolicyOwner(config);
      const mcp = await buildTestMcpRuntime(
        config,
        policy.session.messageBus,
        {},
        undefined,
        policy,
      );
      const primary = new Error('media quota input failed');
      const quota = spyOn(
        config,
        'getMediaStoreQuotaByteLimit',
      ).mockImplementation(() => {
        throw primary;
      });
      try {
        await expect(
          captureAgentAdoption(
            config,
            settings,
            { mcpOwnership: ownership },
            selected,
            undefined,
            undefined,
            policy.session.messageBus,
            mcp,
          ),
        ).rejects.toBe(primary);
        expect(mcp.isStopped()).toBe(ownership === 'agent');
        const retainsDirectory = await Promise.resolve()
          .then(() => mcp.workspacePaths.directories())
          .then(
            (directories) => directories.includes(directory),
            () => false,
          );
        expect(retainsDirectory).toBe(ownership === 'caller');
        selected.writeUserParameter('survived-media-failure', true);
        expect(selected.readNamedParameter('survived-media-failure')).toBe(
          true,
        );
      } finally {
        quota.mockRestore();
        await runCleanupSteps([
          () => mcp.dispose(),
          () => selected.dispose(),
          () => config.dispose(),
          () => rm(directory, { recursive: true, force: true }),
        ]);
      }
    });
  }
  it('joins client closure before runtime closure and preserves independent failures', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'adoption-cleanup-')),
    );

    const fixtureFactorylessPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('fixtures/' + 'plain-text.jsonl', import.meta.url),
    );
    const fixtureFactorylessDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-caller-')),
    );
    const fixtureFactorylessSupplied: CallerAgentRuntimeFactories = {};
    const fixtureFactorylessConfig = new Config(
      toConfigParameters({
        ...{
          provider: 'fake',
          model: 'fake-model',
          workingDir: fixtureFactorylessDirectory,
        },
        ...{
          workingDir: directory,
          sessionId: 'cleanup-caller',
          folderTrust: true,
          mcpEnabled: false,
          skillsSupport: false,
          telemetry: { enabled: false },
          recording: { enabled: false },
        },
      }),
    );
    const fixtureFactorylessSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      fixtureFactorylessConfig.getInitialSettings(),
    ))
      fixtureFactorylessSettings.set(key, value);
    const fixtureFactorylessSettingsOwner = new SessionSettingsOwner(
      fixtureFactorylessSettings,
    );
    fixtureFactorylessSettingsOwner.bindTelemetry(fixtureFactorylessConfig);
    fixtureFactorylessSettingsOwner.initializeProviderSelection(
      fixtureFactorylessConfig.getProvider(),
      fixtureFactorylessConfig.getModel(),
    );
    const fixtureFactorylessPolicy = new RuntimePolicyOwner(
      fixtureFactorylessConfig,
    );
    const fixtureFactorylessTask =
      fixtureFactorylessSupplied.taskToolRegistration;
    const fixtureFactorylessFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...(fixtureFactorylessSupplied.agentClientFactory
        ? { agentClientFactory: fixtureFactorylessSupplied.agentClientFactory }
        : {}),
      ...(fixtureFactorylessTask
        ? { taskToolRegistration: () => fixtureFactorylessTask }
        : {}),
    };

    const fixtureFactorylessClose = settleFactorylessRelease.bind(
      undefined,
      [
        () => fixtureFactorylessSettingsOwner.dispose(),
        () => fixtureFactorylessPolicy.dispose(),
        () => fixtureFactorylessConfig.dispose(),
        () => rm(fixtureFactorylessDirectory, { recursive: true, force: true }),
      ],
      fixtureFactorylessPreviousReplay,
    );

    const config = fixtureFactorylessConfig;
    const settingsService = fixtureFactorylessSettings;
    const settingsOwner = fixtureFactorylessSettingsOwner;
    const messageBus = fixtureFactorylessPolicy.session.messageBus;
    const policyOwner = fixtureFactorylessPolicy;
    const mcp = await buildTestMcpRuntime(
      config,
      messageBus,
      {},
      undefined,
      policyOwner,
    );
    const files = new ProviderFileLifecycle({ maxFiles: 10, maxBytes: 1024 });
    const agent = await captureAgentAdoption(
      fixtureFactorylessConfig,
      fixtureFactorylessSettings,
      {},
      fixtureFactorylessSettingsOwner,
      undefined,
      undefined,
      fixtureFactorylessPolicy.session.messageBus,
      mcp,
      undefined,
      undefined,
      files,
      undefined,
      undefined,
      fixtureFactorylessFactories,
      undefined,
      credentials().authority,
      fixtureFactorylessPolicy,
    );
    const tokenizerFactory = configureProviderTokenizer(
      fixtureAgentResources(agent).manager,
    );
    const contentGeneratorFactory = createRuntimeContentGeneratorFactory();
    const media = new SessionMediaOwner(config.projectTempDir, 1024);
    const owner = await createCapturedSessionOwner(
      config,
      assembleTaskSchemaPolicy(settingsService),
      fixtureAgentResources(agent).manager,
      buildAgentClientFactory(),
      media.store,
      mcp.readInstructions,
      mcp.workspacePaths,
      settingsOwner,
      contentGeneratorFactory,
      tokenizerFactory,
    );
    const file = join(directory, 'missing-remote-file');
    await writeFile(file, 'remote upload');
    const retained = await files.retain({
      cacheKey: file,
      fileId: 'cleanup-upload',
      bytes: 13,
      identity: {
        provider: 'fake',
        baseURL: 'http://127.0.0.1',
        credentialHash: 'cleanup',
      },
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60_000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      scopeId: config.getSessionId(),
      deleteRemote: () => rm(file),
    });
    await retained.lease.release();
    await rm(file);
    let signalEntered = (): void => {};
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    let signalRelease = (): void => {};
    const release = new Promise<void>((resolve) => {
      signalRelease = resolve;
    });
    const primary = new Error('adoption failed');
    let runtimeFailure: unknown;
    let joinedRuntimeFailure: AggregateError | undefined;
    let settled = false;
    const result = cleanupFailedAdoption(
      primary,
      async () => {
        signalEntered();
        await release;
        try {
          await agent.dispose();
        } catch (error) {
          runtimeFailure = error;
          joinedRuntimeFailure = new AggregateError([primary, error]);
          throw joinedRuntimeFailure;
        }
      },
      undefined,
      () => media.dispose(),
      () => owner.dispose(),
    ).catch((error: unknown) => {
      settled = true;
      return error;
    });
    try {
      await entered;
      expect(settled).toBe(false);
      expect(() => owner.refreshAuth()).toThrow('disposed');
      signalRelease();
      const error = await result;
      if (!(error instanceof AggregateError))
        throw new Error('Expected joined cleanup failures');
      expect(error.errors).toStrictEqual([primary, joinedRuntimeFailure]);
      expect(joinedRuntimeFailure).toBeInstanceOf(AggregateError);
      expect(joinedRuntimeFailure?.errors).toStrictEqual([
        primary,
        runtimeFailure,
      ]);
      expect(runtimeFailure).toBeInstanceOf(Error);
      expect(joinedRuntimeFailure?.errors[1]).toMatchObject({
        message: expect.stringContaining('cleanup-upload'),
      });
      expect(credentials().snapshot()).toStrictEqual([1]);
      await expect(media.store.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
    } finally {
      signalRelease();
      await result;
      await mcp.dispose();
      await fixtureFactorylessClose();
      await rm(directory, { recursive: true, force: true });
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
