/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #2532: load-balancer-owned raw attempts must report the same
 * retry taxonomy telemetry the orchestrator reports. Every backend
 * attempt's onAttemptEnd carries the decoded failure kind/phase, the
 * request's commitment state, and the shared transport budget usage, so
 * downstream telemetry cannot tell (or care) which layer owned the
 * attempt.
 *
 * These tests compose a real LoadBalancingProvider with a real
 * ProviderManager and scripted delegates; only the delegates are scripted.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  AttemptLifecycleObserver,
  AttemptStartInfo,
  AttemptEndInfo,
} from '../logging/attemptLifecycle.js';
import { ATTEMPT_LIFECYCLE_KEY } from '../logging/attemptLifecycle.js';

class LifecycleCapture implements AttemptLifecycleObserver {
  readonly starts: AttemptStartInfo[] = [];
  readonly ends: AttemptEndInfo[] = [];
  onAttemptStart(info: AttemptStartInfo): void {
    this.starts.push(info);
  }
  onAttemptEnd(info: AttemptEndInfo): void {
    this.ends.push(info);
  }
}

const metadataChunk: IContent = {
  speaker: 'ai',
  blocks: [],
  metadata: {
    usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
  },
};

function makeScriptedProvider(
  name: string,
  scripts: Array<() => AsyncGenerator<IContent>>,
): { provider: IProvider; calls: { value: number } } {
  const calls = { value: 0 };
  const provider: IProvider = {
    name,
    generateChatCompletion(
      optionsOrContents: GenerateChatOptions | IContent[],
    ) {
      void optionsOrContents;
      const script = scripts[Math.min(calls.value, scripts.length - 1)];
      calls.value++;
      return script();
    },
    getModels: async () => [],
    getDefaultModel: () => `${name}-model`,
    getServerTools: () => [],
    invokeServerTool: async () => null,
  };
  return { provider, calls };
}

function failBeforeOutput(status: number): () => AsyncGenerator<IContent> {
  return async function* fail() {
    const error = new Error(`HTTP ${status}`) as Error & { status: number };
    error.status = status;
    throw error;
    yield undefined as unknown as IContent; // eslint require-yield
  };
}

function metadataThenThrow(status: number): () => AsyncGenerator<IContent> {
  return async function* partial() {
    yield metadataChunk;
    const error = new Error(`HTTP ${status}`) as Error & { status: number };
    error.status = status;
    throw error;
  };
}

function successText(text: string): () => AsyncGenerator<IContent> {
  return async function* ok() {
    yield { speaker: 'ai', blocks: [{ type: 'text', text }] } as IContent;
  };
}

function makeFailoverConfig(providers: string[]): LoadBalancingProviderConfig {
  return {
    profileName: 'lb-telemetry',
    strategy: 'failover',
    // One attempt per backend keeps attempt accounting deterministic.
    lbProfileEphemeralSettings: { failover_retry_count: 0 },
    subProfiles: providers.map((name) => ({
      name,
      providerName: name,
      modelId: `${name}-model`,
      baseURL: `https://${name}.test`,
      authToken: `token-${name}`,
    })),
  };
}

describe('LoadBalancingProvider attempt telemetry (issue #2532)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  it('reports taxonomy, commitment, and shared budget for failed then successful backend attempts', async () => {
    const capture = new LifecycleCapture();
    const backendA = makeScriptedProvider('provider-a', [
      failBeforeOutput(500),
    ]);
    const backendB = makeScriptedProvider('provider-b', [successText('ok')]);
    providerManager.registerProvider(backendA.provider);
    providerManager.registerProvider(backendB.provider);

    // Production shape: the load balancer always runs wrapped in the
    // orchestrator, which owns the shared request budget.
    const composed = new RetryOrchestrator(
      new LoadBalancingProvider(
        makeFailoverConfig(['provider-a', 'provider-b']),
        providerManager,
      ),
    );

    const chunks: IContent[] = [];
    for await (const chunk of composed.generateChatCompletion({
      contents: [],
      metadata: { [ATTEMPT_LIFECYCLE_KEY]: capture },
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);

    // Backend-level records are attributed to the delegate providers; the
    // orchestrator-level success record is attributed to the LB profile.
    const backendEnds = capture.ends.filter((end) =>
      end.providerName.startsWith('provider-'),
    );
    expect(backendEnds).toHaveLength(2);

    const [failed, succeeded] = backendEnds;
    expect(failed.status).toBe('error');
    expect(failed.providerName).toBe('provider-a');
    expect(failed.failureKind).toBe('server');
    expect(failed.failurePhase).toBe('headers');
    expect(failed.committed).toBe(false);
    expect(failed.exposure).toBe('none');
    expect(failed.budgetUsed).toBeGreaterThanOrEqual(1);
    expect(failed.budgetUsed).toBeDefined();
    expect(failed.budgetLimit).toBeDefined();
    expect(failed.budgetLimit).toBeGreaterThanOrEqual(failed.budgetUsed!);

    expect(succeeded.status).toBe('success');
    expect(succeeded.providerName).toBe('provider-b');
    expect(succeeded.failureKind).toBeUndefined();
    expect(succeeded.committed).toBe(true);
    expect(succeeded.exposure).toBe('content');
    // Both backends consumed the same request budget.
    expect(succeeded.budgetUsed).toBe(failed.budgetUsed! + 1);
    expect(succeeded.budgetLimit).toBe(failed.budgetLimit);
  });

  it('reports commitment on a metadata-exposed attempt that surfaces terminally', async () => {
    const capture = new LifecycleCapture();
    const backendA = makeScriptedProvider('provider-a', [
      metadataThenThrow(429),
    ]);
    const backendB = makeScriptedProvider('provider-b', [successText('ok')]);
    providerManager.registerProvider(backendA.provider);
    providerManager.registerProvider(backendB.provider);

    const composed = new RetryOrchestrator(
      new LoadBalancingProvider(
        makeFailoverConfig(['provider-a', 'provider-b']),
        providerManager,
      ),
    );

    const iterator = composed.generateChatCompletion({
      contents: [],
      metadata: { [ATTEMPT_LIFECYCLE_KEY]: capture },
    });
    const first = await iterator.next();
    expect(first.done).toBe(false);
    await expect(iterator.next()).rejects.toThrow('HTTP 429');

    expect(backendB.calls.value).toBe(0);
    const backendEnds = capture.ends.filter((end) =>
      end.providerName.startsWith('provider-'),
    );
    expect(backendEnds).toHaveLength(1);
    const [failed] = backendEnds;
    expect(failed.status).toBe('error');
    expect(failed.providerName).toBe('provider-a');
    expect(failed.failureKind).toBe('rate_limit');
    expect(failed.committed).toBe(true);
    expect(failed.exposure).toBe('metadata');
  });
});
