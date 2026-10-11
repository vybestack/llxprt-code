/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { assembleAgentActivationBootstrap } from '../providerSwitchAssembly.js';
import { WorkspaceDefinitionOwner } from '@vybestack/llxprt-code-core';
import { join } from 'node:path';
import { assembleWorkspaceMemory } from '@vybestack/llxprt-code-core';

import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { gate } from './helpers/async-child-disposal-join-fixture.js';
import { describe, expect, it } from 'bun:test';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { AgentActivationBootstrap } from '../activationPreflightState.js';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';

describe('activation media owner lifetime', () => {
  const createFilesystem = installTestWorkspaceFilesystem();
  it('joins accepted activation before closing an untransferred media owner', async () => {
    const built = await buildFactoryLessConfig('multi-turn-text.jsonl');
    const filesystem = createFilesystem({
      targetDir: built.config.getTargetDir(),
      isTrusted: () =>
        new WorkspaceTrustLifecycle({
          localTrust: built.config.initialWorkspaceTrust,
        }).isTrustedFolder(),
    });
    const owner = new SessionMediaOwner(built.config.projectTempDir, 1024);
    const manager = new ProviderManager({
      settingsService: built.settingsService,
    });
    const entered = gate();
    const factories = configureProviderRuntimeFactories(built.config, manager);
    const released = gate();
    const settingsOwner = built.settingsOwner;
    const operation = new AgentActivationBootstrap(
      built.config,
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
      owner,
      await SessionClientOwner.create(
        built.config,
        assembleTaskSchemaPolicy(built.settingsService),
        manager,
        built.runtimeFactoryBindings.agentClientFactory,
        owner.store,
        () => undefined,
        filesystem.paths,
        settingsOwner,
        factories.contentGeneratorFactory,
        factories.tokenizerFactory,
      ),
      filesystem,
      assembleWorkspaceMemory(
        built.config,
        filesystem,
        new WorkspaceTrustLifecycle({
          localTrust: built.config.initialWorkspaceTrust,
        }),
      ),
      false,
      settingsOwner,
      'borrowed',
      new WorkspaceDefinitionOwner(
        join(built.config.getTargetDir(), 'profiles'),
        join(built.config.getTargetDir(), 'subagents'),
      ),
      true,
      new WorkspaceTrustLifecycle({
        localTrust: built.config.initialWorkspaceTrust,
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
      await built.cleanup();
    }
    await expect(owner.store.getStoredByteLength()).rejects.toThrow(/closed/i);
  });
  it('releases the owned filesystem after an accepted memory publication fails during teardown', async () => {
    const built = await buildFactoryLessConfig('multi-turn-text.jsonl');
    const filesystem = createFilesystem({
      targetDir: built.config.getTargetDir(),
      isTrusted: () => true,
    });
    const memory = assembleWorkspaceMemory(
      built.config,
      filesystem,
      new WorkspaceTrustLifecycle({
        localTrust: built.config.initialWorkspaceTrust,
      }),
    );
    const entered = gate();
    const release = gate();
    memory.operations.subscribe(async () => {
      entered.release();
      await release.promise;
      throw new Error('publication rejected during teardown');
    });
    const manager = new ProviderManager({
      config: built.config,
      settingsService: built.settingsService,
    });
    const operation = assembleAgentActivationBootstrap(
      built.config,
      built.settingsService,
      manager,
      null,
      () => undefined,
      undefined,
      undefined,
      filesystem,
      memory,
      built.settingsOwner,
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
      await built.cleanup();
    }
  });
});
