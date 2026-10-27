/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createCapturedSessionOwner,
  ownerClients,
} from './helpers/session-client-capture.js';
import { gate as createGate } from './helpers/async-child-disposal-join-fixture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { randomUUID } from 'node:crypto';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { cleanupAfterFailure } from '../../core/subagent-cleanup.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { writeFile, access, unlink } from 'node:fs/promises';
import { join } from 'node:path';

describe('Session owner cleanup joining', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();
  it('keeps the borrowed root fetch open through client cleanup and closes it when the root release closes', async () => {
    const builtDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
    );
    const builtConfig = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: builtDirectory,
      }),
    );
    const builtSettings = new SettingsService();
    const builtPolicy = new RuntimePolicyOwner(builtConfig);
    const builtMessageBus = builtPolicy.session.messageBus;
    const builtMcp = await createTestMcpRuntime(
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
        config: builtConfig,
        policy: { owner: builtPolicy, ownership: 'runtime' },
      },
      {},
    );

    const builtRuntimeId = 'engine-' + randomUUID();
    const builtRelease = new AcquisitionRelease();
    const builtSettingsOwner = new SessionSettingsOwner(builtSettings);
    builtRelease.acquire('settings', () => builtSettingsOwner.dispose());
    builtSettingsOwner.initializeProviderSelection(
      builtConfig.getProvider(),
      builtConfig.getModel(),
    );
    builtSettingsOwner.bindTelemetry(builtConfig);
    const builtFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [builtRuntimeId, builtConfig.getSessionId()])
      builtRelease.acquire('files', () =>
        releaseAdoptedFileScope(builtFiles, scope),
      );
    const builtManager = acquirePreferredProviderManager(
      builtConfig,
      builtSettings,
      builtSettingsOwner,
      builtFiles,
      builtRuntimeId,
      credentials().authority,
      builtRelease,
    );
    const builtTokenizer = configureProviderTokenizer(builtManager);
    const builtContent = createRuntimeContentGeneratorFactory();
    const builtOAuth = acquirePreferredOAuth(
      undefined,
      builtMessageBus,
      builtConfig,
      builtSettings,
      builtManager,
      builtRuntimeId,
      builtMcp.profileDefinitions,
      credentials().authority,
      builtRelease,
      undefined,
    );
    const builtMedia = new SessionMediaOwner(
      builtConfig.projectTempDir,
      1024 * 1024,
    );
    const builtOwner = await createCapturedSessionOwner(
      builtConfig,
      assembleTaskSchemaPolicy(builtSettings),
      builtManager,
      buildAgentClientFactory(),
      builtMedia.store,
      builtMcp.readInstructions,
      builtMcp.workspacePaths,
      builtSettingsOwner,
      builtContent,
      builtTokenizer,
    );
    builtOwner.bindMcpRuntime(builtMcp);
    builtOwner.bindHooks();
    const closeEngine = (): Promise<void> =>
      runCleanupSteps([
        () => builtOwner.dispose(),
        () => builtRelease.close(),
        () => builtMedia.dispose(),
        () => builtMcp.dispose(),
        () => builtConfig.dispose(),
        () => rm(builtDirectory, { recursive: true, force: true }),
      ]);
    try {
      await preparePreferredProviderCompletion(
        builtConfig,
        builtSettings,
        builtSettingsOwner,
        builtManager,
        builtOAuth,
        builtRuntimeId,
        builtTokenizer,
        undefined,
      );
      await builtMcp.initialize();
      await builtOwner.initializeTools();
      await builtOwner.clients.refreshAuth();
      const clients = ownerClients(builtOwner);
      await clients[clients.length - 1].startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, closeEngine);
    }

    const entered = createGate();
    const released = createGate();
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end(request.url);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected HTTP address');
    const url = `http://127.0.0.1:${address.port}/joined`;
    const manager = builtManager;
    let received: string | undefined;
    const buildClient = buildAgentClientFactory();
    const owner = await createCapturedSessionOwner(
      builtConfig,
      assembleTaskSchemaPolicy(builtSettings),
      manager,
      (...operands) => {
        const client = buildClient(...operands);
        const cleanup = client.dispose.bind(client);
        client.dispose = async () => {
          entered.release();
          await released.promise;
          try {
            received = await (await owner.operations.fetch(url)).text();
          } finally {
            await cleanup();
          }
        };
        return client;
      },
      builtMedia.store,
      builtMcp.readInstructions,
      builtMcp.workspacePaths,
      builtSettingsOwner,
      builtContent,
      builtTokenizer,
    );
    const closing = owner.dispose();
    void closing.catch(() => undefined);
    let engineClosed = false;
    try {
      await entered.promise;
      expect(new Set([owner.dispose(), closing]).size).toBe(1);
      released.release();
      await closing;
      expect(received).toBe(new URL(url).pathname);
      expect(await (await owner.operations.fetch(url)).text()).toBe(
        new URL(url).pathname,
      );
      engineClosed = true;
      await closeEngine();
      await expect(owner.operations.fetch(url)).rejects.toThrow(
        'Root fetch is closed',
      );
    } finally {
      released.release();
      await closing.catch(() => undefined);
      if (!engineClosed) await closeEngine();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
  it('releases retained provider resources when a prepared activation is abandoned', async () => {
    const route = await openRouteBPreflight({
      authority: credentials().authority,
    });
    try {
      await route.prepare();
      const file = join(route.directory, 'abandoned-provider-file');
      await writeFile(file, 'uploaded bytes');
      let deletions = 0;
      const retained = await route.preflight.retainProviderFile({
        cacheKey: file,
        fileId: 'abandoned-upload',
        bytes: 14,
        identity: {
          provider: 'fake',
          baseURL: 'http://127.0.0.1',
          credentialHash: 'abandoned-key',
        },
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
      await access(file);
      expect(route.preflight.captureProviderFiles().retainedFiles).toBe(1);
      await route.preflight.preflight({ provider: 'fake' });
      await Promise.all([route.disposePreflight(), route.preflight.dispose()]);
      await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(route.preflight.captureProviderFiles().retainedFiles).toBe(0);
      expect(deletions).toBe(1);
    } finally {
      await route.close();
    }
  });
});
