/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { describe, expect, it } from 'bun:test';
import { writeFile, access, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentClient } from '../../core/client.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import {
  createSessionClientEngineFixture,
  engineGate,
} from './helpers/session-client-engine-fixture.js';
import { fromConfig } from '../fromConfig.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { AgentActivationBootstrap } from '../activationPreflightState.js';

describe('Session owner cleanup joining', () => {
  it('releases retained provider resources when a prepared activation is abandoned', async () => {
    const built = await createSessionClientEngineFixture();
    const file = join(built.config.projectTempDir, 'abandoned-provider-file');
    const lifecycle = built.handle.providerFileLifecycle;
    const scope = built.config.getSessionId();
    await mkdir(built.config.projectTempDir, { recursive: true });
    await writeFile(file, 'uploaded bytes');
    let deletions = 0;
    const retained = await lifecycle.retain({
      cacheKey: file,
      fileId: 'abandoned-upload',
      bytes: 14,
      identity: {
        provider: 'fake',
        baseURL: 'http://127.0.0.1',
        credentialHash: 'abandoned-key',
      },
      scopeId: scope,
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60_000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      deleteRemote: async () => {
        await unlink(file);
        deletions += 1;
      },
    });
    await retained.lease.release();
    built.owner.bindProviderFiles(
      lifecycle,
      (provider) => built.handle.oauthManager.composeRetryOperations(provider),
      (id) => SessionClientOwner.cleanupProviderScope(lifecycle, id),
    );
    const candidate = await built.owner.prepareProfileClientReplacement();
    candidate.publish();
    await candidate.retire();
    await access(file);
    expect(lifecycle.snapshot().retainedFiles).toBe(1);
    const operation = new AgentActivationBootstrap(
      built.config,
      built.handle.providerManager,
      async () => ({ authFailed: false, infoMessages: [] }),
      undefined,
      built.owner,
      built.mcp.workspaceFilesystem,
      built.mcp.workspaceMemory,
      false,
      built.handle.settingsOwner,
      'borrowed',
      built.mcp.workspaceDefinitions,
      false,
      new WorkspaceTrustLifecycle({
        localTrust: built.config.initialWorkspaceTrust,
      }),
    );
    try {
      await operation.preflight({ provider: 'fake' });
      const first = operation.dispose();
      await Promise.all([first, operation.dispose()]);
      await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(lifecycle.snapshot().retainedFiles).toBe(0);
      expect(deletions).toBe(1);
    } finally {
      await SessionClientOwner.cleanupProviderScope(lifecycle, scope);
      await built.cleanup();
    }
  });

  it('joins the preflight client before media cleanup when adoption runtime construction fails', async () => {
    const built = await createSessionClientEngineFixture();
    let cleanupStates: readonly boolean[] = [];
    class ObservedCleanupClient extends AgentClient {
      override async dispose(): Promise<void> {
        const open = await built.media.store.getStoredByteLength().then(
          () => true,
          () => false,
        );
        cleanupStates = [...cleanupStates, open];
        await super.dispose();
      }
    }
    const owner = await SessionClientOwner.create(
      built.config,
      assembleTaskSchemaPolicy(built.settingsService),
      built.handle.providerManager,
      (config, state, instructions, store) => {
        if (store === undefined) throw new Error('Missing factory store');
        return new ObservedCleanupClient(
          config,
          state,
          instructions ?? (() => undefined),
          store,
          built.mcp.workspacePaths,
        );
      },
      built.media.store,
      built.mcp.readInstructions,
      built.mcp.workspacePaths,
      built.handle.settingsOwner,
      built.handle.contentGeneratorFactory,
      built.handle.tokenizerFactory,
    );
    const intent = { provider: 'fake', model: 'fake-model' };
    const operation = new AgentActivationBootstrap(
      built.config,
      built.handle.providerManager,
      async () => {
        await owner.refreshAuth();
        return { authFailed: false, infoMessages: [] };
      },
      built.media,
      owner,
      built.mcp.workspaceFilesystem,
      built.mcp.workspaceMemory,
      false,
      built.handle.settingsOwner,
      undefined,
      built.mcp.workspaceDefinitions,
      false,
      new WorkspaceTrustLifecycle({
        localTrust: built.config.initialWorkspaceTrust,
      }),
    );
    try {
      const receipt = await operation.preflight(intent);
      if (receipt.token === undefined) throw new Error('Missing receipt');
      await expect(
        fromConfig({
          settingsService: built.settingsService,
          config: built.config,
          providerManager: built.handle.providerManager,
          messageBus: built.messageBus,
          mcpRuntime: built.mcp,
          activation: intent,
          activationPreflight: { operation, token: receipt.token },
          runtimeFactoryBindings: {
            ...createAgentRuntimeFactoryBindings(built.media.store),
            taskToolRegistration: () => {
              throw new Error('Runtime assembly fault');
            },
          },
        }),
      ).rejects.toThrow('Runtime assembly fault');
      expect(cleanupStates).not.toContain(false);
      await expect(built.media.store.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
    } finally {
      await operation.dispose();
      await built.cleanup();
    }
  }, 30000);
  it('joins an accepted replacement and closes every owned client before resolving disposal', async () => {
    const built = await createSessionClientEngineFixture();
    const entered = engineGate();
    const released = engineGate();
    class GatedClient extends AgentClient {
      override async initialize(
        content: ContentGeneratorConfig,
      ): Promise<void> {
        entered.release();
        await released.promise;
        await super.initialize(content);
      }
    }
    const before = coreEvents.listenerCount(CoreEvent.ModelChanged);
    const owner = await SessionClientOwner.create(
      built.config,
      assembleTaskSchemaPolicy(built.settingsService),
      built.handle.providerManager,
      (config, state, instructions, store) => {
        if (store === undefined) throw new Error('Missing factory store');
        return new GatedClient(
          config,
          state,
          instructions ?? (() => undefined),
          store,
          built.mcp.workspacePaths,
        );
      },
      built.media.store,
      built.mcp.readInstructions,
      built.mcp.workspacePaths,
      built.handle.settingsOwner,
      built.handle.contentGeneratorFactory,
      built.handle.tokenizerFactory,
    );
    const pending = owner.refreshAuth();
    await entered.promise;
    let closed = false;
    const closing = owner.dispose().then(() => {
      closed = true;
    });
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(closed).toBe(false);
    } finally {
      released.release();
      await pending;
      await closing;
      await built.cleanup();
    }
    expect(coreEvents.listenerCount(CoreEvent.ModelChanged)).toBe(before - 1);
  }, 30000);
  it('still closes separately owned media when client cleanup rejects', async () => {
    const built = await createSessionClientEngineFixture();
    const entered = engineGate();
    const released = engineGate();
    class FailingCleanupClient extends AgentClient {
      override async dispose(): Promise<void> {
        await super.dispose();
        throw new Error('Client cleanup fault');
      }
    }
    const owner = await SessionClientOwner.create(
      built.config,
      assembleTaskSchemaPolicy(built.settingsService),
      built.handle.providerManager,
      (config, state, instructions, store) => {
        if (store === undefined) throw new Error('Missing factory store');
        return new FailingCleanupClient(
          config,
          state,
          instructions ?? (() => undefined),
          store,
          built.mcp.workspacePaths,
        );
      },
      built.media.store,
      built.mcp.readInstructions,
      built.mcp.workspacePaths,
      built.handle.settingsOwner,
      built.handle.contentGeneratorFactory,
      built.handle.tokenizerFactory,
    );
    const operation = new AgentActivationBootstrap(
      built.config,
      built.handle.providerManager,
      async () => {
        entered.release();
        await released.promise;
        return {
          authFailed: true,
          infoMessages: [],
          authError: new Error('Activation failed'),
        };
      },
      built.media,
      owner,
      built.mcp.workspaceFilesystem,
      built.mcp.workspaceMemory,
      false,
      built.handle.settingsOwner,
      undefined,
      built.mcp.workspaceDefinitions,
      false,
      new WorkspaceTrustLifecycle({
        localTrust: built.config.initialWorkspaceTrust,
      }),
    );
    const preflight = operation.preflight({ provider: 'fake' });
    await entered.promise;
    const closing = operation.dispose();
    released.release();
    try {
      await preflight;
      await expect(closing).rejects.toThrow(/cleanup/i);
      await expect(built.media.store.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
    } finally {
      await built.cleanup();
    }
  }, 30000);
});
