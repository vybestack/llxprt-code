/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { MessageBusType } from '@vybestack/llxprt-code-core';
import type { BucketAuthConfirmationRequest } from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SessionClientOwner } from '../../session/session-client-owner.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import type { BucketAuthConsentRequest } from '../agent.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { acquirePreferredProviderManager } from '../preferred-provider-acquisition.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { createCapturedSessionOwner } from './helpers/session-client-capture.js';

interface ConsentSession {
  readonly owner: SessionClientOwner;
  /** The bus the owner reads; the test acts as the requester on it. */
  readonly bus: MessageBus;
  close(): Promise<void>;
}

describe('Session owner bucket consent', () => {
  const credentials = useOwnedCredentials();

  async function openConsentSession(): Promise<ConsentSession> {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'bucket-consent-')),
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
    const policy = new RuntimePolicyOwner(config);
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
    const runtimeId = 'bucket-consent-' + randomUUID();
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
      credentials().authority,
      release,
    );
    const tokenizer = configureProviderTokenizer(manager);
    const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
    const owner = await createCapturedSessionOwner(
      config,
      assembleTaskSchemaPolicy(settings),
      manager,
      buildAgentClientFactory(),
      media.store,
      mcp.readInstructions,
      mcp.workspacePaths,
      settingsOwner,
      createRuntimeContentGeneratorFactory(),
      tokenizer,
      mcp.messageBus,
    );
    owner.bindMcpRuntime(mcp);
    const close = (): Promise<void> =>
      runCleanupSteps([
        () => owner.dispose(),
        () => release.close(),
        () => media.dispose(),
        () => mcp.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    return { owner, bus: policy.session.messageBus, close };
  }

  it.each([true, false])(
    'settles the actual acquired requester with the correlated decision %s',
    async (confirmed) => {
      const { owner, bus, close } = await openConsentSession();
      const captured: BucketAuthConfirmationRequest[] = [];
      const stopCapture = bus.subscribe<BucketAuthConfirmationRequest>(
        MessageBusType.BUCKET_AUTH_CONFIRMATION_REQUEST,
        (request) => captured.push(request),
      );
      const observed: BucketAuthConsentRequest[] = [];
      const stop = owner.subscribeBucketConsent((request) =>
        observed.push(request),
      );
      try {
        const result = bus.requestBucketAuthConfirmation(
          'anthropic',
          'work',
          2,
          3,
        );
        expect(observed).toHaveLength(1);
        expect(observed[0]).toStrictEqual({
          correlationId: captured[0].correlationId,
          provider: 'anthropic',
          bucket: 'work',
          bucketIndex: 2,
          totalBuckets: 3,
        });
        expect(observed[0]).not.toHaveProperty('type');
        expect(Reflect.set(observed[0], 'bucket', 'mutated')).toBe(false);
        expect(captured[0].bucket).toBe('work');
        owner.respondToBucketConsent(observed[0].correlationId, confirmed);
        expect(await result).toBe(confirmed);
      } finally {
        stop();
        stopCapture();
        await close();
      }
    },
  );

  it('unsubscribes one observer without closing a requester or its peer', async () => {
    const { owner, bus, close } = await openConsentSession();
    const first: BucketAuthConsentRequest[] = [];
    const peer: BucketAuthConsentRequest[] = [];
    const stop = owner.subscribeBucketConsent((request) => first.push(request));
    const stopPeer = owner.subscribeBucketConsent((request) =>
      peer.push(request),
    );
    try {
      const pending = bus.requestBucketAuthConfirmation(
        'anthropic',
        'first',
        1,
        2,
      );
      stop();
      stop();
      owner.respondToBucketConsent(peer[0].correlationId, true);
      expect(await pending).toBe(true);
      const next = bus.requestBucketAuthConfirmation(
        'anthropic',
        'second',
        2,
        2,
      );
      expect(first).toHaveLength(1);
      expect(peer).toHaveLength(2);
      owner.respondToBucketConsent(peer[1].correlationId, false);
      expect(await next).toBe(false);
    } finally {
      stopPeer();
      await close();
    }
  });

  it('does not revive a closed requester when its UI replies late', async () => {
    const { owner, bus, close } = await openConsentSession();
    const requests: BucketAuthConsentRequest[] = [];
    const stop = owner.subscribeBucketConsent((request) =>
      requests.push(request),
    );
    try {
      const closed = bus.requestBucketAuthConfirmation(
        'anthropic',
        'expired',
        1,
        2,
      );
      bus.cancelPendingConfirmations();
      expect(await closed).toBe(false);
      const current = bus.requestBucketAuthConfirmation(
        'anthropic',
        'current',
        2,
        2,
      );
      let settled = false;
      void current.then(() => {
        settled = true;
      });
      owner.respondToBucketConsent(requests[0].correlationId, true);
      await Promise.resolve();
      expect(settled).toBe(false);
      owner.respondToBucketConsent(requests[1].correlationId, false);
      expect(await current).toBe(false);
      expect(await closed).toBe(false);
    } finally {
      stop();
      await close();
    }
  });
});
