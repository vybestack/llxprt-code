/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { realpath, rm } from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from '../preferred-provider-acquisition.js';
import { bindCreatedSessionClient } from '../policyComposition.js';
import { gate as createGate } from './helpers/async-child-disposal-join-fixture.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { makeScratchDir } from './helpers/scratch-dir.js';

describe('session client binding rollback', () => {
  const credentials = useOwnedCredentials();

  it('joins the created client cleanup before rejecting a post-create binding failure and keeps both errors', async () => {
    const authority = credentials().authority;
    const directory = await realpath(
      await makeScratchDir('policy-client-binding-rollback-'),
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
    const policy = new RuntimePolicyOwner(config);
    const mcp = await buildTestMcpRuntime(
      config,
      policy.session.messageBus,
      {},
      undefined,
      policy,
    );
    const runtimeId = 'policy-client-binding-' + randomUUID();
    const release = new AcquisitionRelease();
    const settingsOwner = new SessionSettingsOwner(settings);
    release.acquire('settings', () => settingsOwner.dispose());
    settingsOwner.initializeProviderSelection(
      config.getProvider(),
      config.getModel(),
    );
    settingsOwner.bindTelemetry(config);
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [runtimeId, config.getSessionId()])
      release.acquire('files', () => releaseAdoptedFileScope(files, scope));
    const manager = acquirePreferredProviderManager(
      config,
      settings,
      settingsOwner,
      files,
      runtimeId,
      authority,
      release,
    );
    const oauth = acquirePreferredOAuth(
      undefined,
      policy.session.messageBus,
      config,
      settings,
      manager,
      runtimeId,
      mcp.profileDefinitions,
      authority,
      release,
      undefined,
    );
    const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
    const closeStack = (): Promise<void> =>
      runCleanupSteps([
        () => release.close(),
        () => media.dispose(),
        () => mcp.dispose(),
        () => policy.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);

    const gate = createGate();
    const entered = createGate();
    let disposals = 0;
    let settled = false;
    const productionFactory = buildAgentClientFactory();
    const factory: AgentClientFactory = (...operands) => {
      const client = productionFactory(...operands);
      const bindIdeContext = client.bindIdeContext?.bind(client);
      const dispose = client.dispose.bind(client);
      let bindings = 0;
      client.bindIdeContext = (...readers) => {
        bindings += 1;
        if (bindings > 1) throw new Error('policy binding failed');
        bindIdeContext?.(...readers);
      };
      client.dispose = async () => {
        disposals += 1;
        entered.release();
        await gate.promise;
        await dispose();
        throw new Error('policy client cleanup failed');
      };
      return client;
    };
    const pending = bindCreatedSessionClient(
      config,
      settings,
      settingsOwner,
      manager,
      oauth,
      createRuntimeContentGeneratorFactory(),
      configureProviderTokenizer(manager),
      files,
      media,
      factory,
      mcp,
      (registration) => registration,
      false,
      undefined,
      authority,
    ).then(
      () => undefined,
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    try {
      const progress = await Promise.race([
        entered.promise.then(() => 'cleanup'),
        pending.then(() => 'rejected'),
      ]);
      expect(progress).toBe('cleanup');
      expect(settled).toBe(false);
      gate.release();
      const failure = await pending;
      expect(failure).toBeInstanceOf(AggregateError);
      if (!(failure instanceof AggregateError)) throw failure;
      const [binding, cleanup] = failure.errors;
      if (!(binding instanceof Error))
        throw new Error('Expected binding error');
      expect(binding.message).toBe('policy binding failed');
      if (!(cleanup instanceof AggregateError))
        throw new Error('Expected client cleanup aggregate');
      expect(cleanup.errors.map((error: Error) => error.message)).toStrictEqual(
        ['policy client cleanup failed'],
      );
      expect(disposals).toBe(1);
    } finally {
      gate.release();
      await pending;
      await closeStack();
    }
  }, 30000);
});
