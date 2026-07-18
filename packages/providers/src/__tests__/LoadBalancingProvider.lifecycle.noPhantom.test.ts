/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Finding #2: No phantom raw transport attempts for missing provider,
 * exhausted transport budget, or setup failures before delegate
 * invocation. The LB lifecycle (onAttemptStart) must start immediately
 * before the actual delegate generateChatCompletion call, so setup
 * failures do not leave orphaned start records.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import type { IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  AttemptLifecycleObserver,
  AttemptStartInfo,
  AttemptEndInfo,
} from '../logging/attemptLifecycle.js';
import { ATTEMPT_LIFECYCLE_KEY } from '../logging/attemptLifecycle.js';

/**
 * Captures all onAttemptStart/onAttemptEnd calls in order so tests can
 * assert exact lifecycle sequences (no phantom starts before setup).
 */
class LifecycleCapture implements AttemptLifecycleObserver {
  readonly starts: AttemptStartInfo[] = [];
  readonly ends: AttemptEndInfo[] = [];
  readonly events: Array<
    | { type: 'start'; info: AttemptStartInfo }
    | { type: 'end'; info: AttemptEndInfo }
  > = [];

  onAttemptStart(info: AttemptStartInfo): void {
    this.starts.push(info);
    this.events.push({ type: 'start', info });
  }
  onAttemptEnd(info: AttemptEndInfo): void {
    this.ends.push(info);
    this.events.push({ type: 'end', info });
  }
}

function makeSuccessDelegate(name: string): IProvider {
  return {
    name,
    async *generateChatCompletion(): AsyncGenerator<IContent> {
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
    },
    getModels: async () => [],
    getDefaultModel: () => `${name}-model`,
    getServerTools: () => [],
    invokeServerTool: async () => null,
  };
}

function makeSyncThrowDelegate(name: string, error: Error): IProvider {
  return {
    name,
    generateChatCompletion(): AsyncIterableIterator<IContent> {
      throw error;
    },
    getModels: async () => [],
    getDefaultModel: () => `${name}-model`,
    getServerTools: () => [],
    invokeServerTool: async () => null,
  };
}

function makeFailoverConfig(
  subProfiles: Array<{ name: string; providerName: string }>,
): LoadBalancingProviderConfig {
  return {
    profileName: 'test-lb',
    strategy: 'failover',
    subProfiles: subProfiles.map((sp) => ({
      name: sp.name,
      providerName: sp.providerName,
      modelId: `${sp.name}-model`,
      baseURL: `https://${sp.name}.test`,
      authToken: `token-${sp.name}`,
    })),
  };
}

describe('LoadBalancingProvider lifecycle (finding #2): no phantom starts', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  it('setup failure (missing provider) emits zero lifecycle start/end events', async () => {
    const capture = new LifecycleCapture();
    // Only register one provider, but reference a second non-existent one
    providerManager.registerProvider(makeSuccessDelegate('real-provider'));

    const provider = new LoadBalancingProvider(
      makeFailoverConfig([
        { name: 'primary', providerName: 'nonexistent-provider' },
        { name: 'secondary', providerName: 'real-provider' },
      ]),
      providerManager,
    );

    const chunks: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion({
      contents: [],
      metadata: {
        [ATTEMPT_LIFECYCLE_KEY]: capture,
      },
    })) {
      chunks.push(chunk);
    }

    // The nonexistent provider fails over to the real provider
    expect(chunks).toHaveLength(1);

    // The missing-provider backend must NOT have emitted any lifecycle
    // start event — it was a setup failure, not a real transport attempt.
    // The real backend emits exactly one start + one end.
    expect(capture.starts).toHaveLength(1);
    expect(capture.ends).toHaveLength(1);
    // The only start is for the real provider (secondary backend)
    expect(capture.starts[0].providerName).toBe('real-provider');
    expect(capture.ends[0].status).toBe('success');
  });

  it('sync delegate throw emits exactly one start + one error terminal', async () => {
    const capture = new LifecycleCapture();
    const throwProvider = makeSyncThrowDelegate(
      'throw-provider',
      new Error('sync delegate failure'),
    );
    providerManager.registerProvider(throwProvider);
    // Also register a success provider for failover target
    const successProvider = makeSuccessDelegate('success-provider');
    providerManager.registerProvider(successProvider);

    const provider = new LoadBalancingProvider(
      makeFailoverConfig([
        { name: 'primary', providerName: 'throw-provider' },
        { name: 'secondary', providerName: 'success-provider' },
      ]),
      providerManager,
    );

    const chunks: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion({
      contents: [],
      metadata: {
        [ATTEMPT_LIFECYCLE_KEY]: capture,
      },
    })) {
      chunks.push(chunk);
    }

    // Failover from sync-throw to success
    expect(chunks).toHaveLength(1);

    // Two backends attempted: one sync-throw (error terminal) + one success
    expect(capture.starts).toHaveLength(2);
    expect(capture.ends).toHaveLength(2);

    // First start is the throwing backend
    expect(capture.starts[0].providerName).toBe('throw-provider');
    expect(capture.ends[0].status).toBe('error');
    expect(capture.ends[0].errorMessage).toBe('sync delegate failure');

    // Second start is the success backend
    expect(capture.starts[1].providerName).toBe('success-provider');
    expect(capture.ends[1].status).toBe('success');
  });

  it('success emits exactly one start + one success terminal', async () => {
    const capture = new LifecycleCapture();
    providerManager.registerProvider(makeSuccessDelegate('good-provider'));

    const provider = new LoadBalancingProvider(
      makeFailoverConfig([
        { name: 'primary', providerName: 'good-provider' },
        { name: 'secondary', providerName: 'good-provider' },
      ]),
      providerManager,
    );

    const chunks: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion({
      contents: [],
      metadata: {
        [ATTEMPT_LIFECYCLE_KEY]: capture,
      },
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(capture.starts).toHaveLength(1);
    expect(capture.ends).toHaveLength(1);
    expect(capture.starts[0].providerName).toBe('good-provider');
    expect(capture.ends[0].status).toBe('success');
  });

  it('every end event has a matching preceding start (no orphan ends)', async () => {
    const capture = new LifecycleCapture();
    providerManager.registerProvider(makeSuccessDelegate('provider-a'));
    providerManager.registerProvider(makeSuccessDelegate('provider-b'));

    const provider = new LoadBalancingProvider(
      makeFailoverConfig([
        { name: 'primary', providerName: 'provider-a' },
        { name: 'secondary', providerName: 'provider-b' },
      ]),
      providerManager,
    );

    for await (const _chunk of provider.generateChatCompletion({
      contents: [],
      metadata: {
        [ATTEMPT_LIFECYCLE_KEY]: capture,
      },
    })) {
      void _chunk;
    }

    expect(capture.events).toHaveLength(2);
    expect(capture.events.map(({ type }) => type)).toStrictEqual([
      'start',
      'end',
    ]);
    expect(capture.events[0].info.attemptId).toBe(
      capture.events[1].info.attemptId,
    );
  });
});
