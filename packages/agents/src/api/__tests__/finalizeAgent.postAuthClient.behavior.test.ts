/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for the session client guard ("no post-auth agent
 * client", SessionClientAcquisitionOwner): characterizes the typed fail-fast
 * when the client factory completes without constructing an agent client.
 *
 * Reachability: `createAgent` and `fromConfig` always pass
 * `buildAgentClientFactory()`, which constructs a real client, so no host
 * input produces the omission. The subject is therefore the session owner
 * itself, `SessionClientOwner.create`, whose client factory is the parameter
 * production fills; the factory here is the fault under test, everything else
 * is built the way production builds it.
 */

import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
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
import { toConfigParameters } from '../agentConfig.adapter.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { AgentBootstrapError } from '../agentBootstrap.js';
import { acquirePreferredProviderManager } from '../preferred-provider-acquisition.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { createCapturedSessionOwner } from './helpers/session-client-capture.js';

describe('session client post-auth guard', () => {
  const credentials = useOwnedCredentials();

  it('throws a typed AgentBootstrapError when a client factory completed bootstrap without constructing an agent client', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'factoryless-client-')),
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
    const release = new AcquisitionRelease();
    const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
    let mcpClose: () => Promise<void> = async () => {};
    const close = (): Promise<void> =>
      runCleanupSteps([
        () => release.close(),
        () => media.dispose(),
        () => mcpClose(),
        () => policy.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    try {
      const mcp = await createTestMcpRuntime(
        {
          oauth: {
            openBrowser: async () => {
              throw new Error('Unexpected browser request');
            },
            tokenStorage: new MCPOAuthTokenStorage({
              getCredentials: async () => null,
              setCredentials: async () => {
                throw new Error('Unexpected token write');
              },
              deleteCredentials: async () => {},
              listServers: async () => [],
              getAllCredentials: async () => new Map(),
              clearAll: async () => {},
            }),
          },
          config,
          policy: { owner: policy, ownership: 'runtime' },
        },
        {},
      );
      mcpClose = () => mcp.dispose();
      const runtimeId = 'factoryless-' + randomUUID();
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
        credentials().authority,
        release,
      );
      const tokenizer = configureProviderTokenizer(manager);

      let captured: unknown;
      try {
        await createCapturedSessionOwner(
          config,
          assembleTaskSchemaPolicy(settings),
          manager,
          // Deliberate defect under test: the factory "succeeds" but
          // constructs nothing.
          () => undefined as unknown as AgentClientContract,
          media.store,
          mcp.readInstructions,
          mcp.workspacePaths,
          settingsOwner,
          createRuntimeContentGeneratorFactory(),
          tokenizer,
          mcp.messageBus,
        );
        expect.unreachable('the session owner should have rejected');
      } catch (error) {
        captured = error;
      }

      expect(captured).toBeInstanceOf(AgentBootstrapError);
      expect(captured).toBeInstanceOf(Error);
      const bootstrapError = captured as AgentBootstrapError;
      expect(bootstrapError.name).toBe('AgentBootstrapError');
      expect(bootstrapError.message).toBe('no post-auth agent client');
    } finally {
      await close();
    }
  });
});
