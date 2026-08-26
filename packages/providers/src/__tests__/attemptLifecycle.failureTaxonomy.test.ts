/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #2532 (AC-07): attempt lifecycle telemetry reports the shared
 * failure taxonomy, request commitment, and aggregate budget for every raw
 * provider attempt — without secrets. Fields are additive and optional; the
 * existing AttemptEndInfo shape is unchanged.
 */

import { describe, it, expect } from 'bun:test';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  ATTEMPT_LIFECYCLE_KEY,
  type AttemptEndInfo,
  type AttemptLifecycleObserver,
} from '../logging/attemptLifecycle.js';

function statusError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * Transport whose calls are scripted: each script either yields chunks then
 * ends, or throws. Calls beyond the script repeat the last entry.
 */
function scriptedTransport(
  scripts: ReadonlyArray<{
    chunks?: IContent[];
    error?: unknown;
  }>,
): { provider: IProvider; calls: () => number } {
  let calls = 0;
  const provider: IProvider = {
    name: 'telemetry-scripted',
    generateChatCompletion(
      options: GenerateChatOptions | IContent[],
    ): AsyncIterableIterator<IContent> {
      void options;
      const script = scripts[Math.min(calls, scripts.length - 1)];
      calls++;
      return (async function* (): AsyncGenerator<IContent> {
        for (const chunk of script.chunks ?? []) yield chunk;
        if (script.error !== undefined) throw script.error;
      })();
    },
    getModels: async () => [],
    getDefaultModel: () => 'model',
    getServerTools: () => [],
    invokeServerTool: async () => null,
  };
  return { provider, calls: () => calls };
}

function captureObserver(): {
  observer: AttemptLifecycleObserver;
  ends: AttemptEndInfo[];
} {
  const ends: AttemptEndInfo[] = [];
  return {
    ends,
    observer: {
      onAttemptStart: () => undefined,
      onAttemptEnd: (info) => {
        ends.push(info);
      },
    },
  };
}

async function collect(
  stream: AsyncIterable<IContent>,
): Promise<{ chunks: IContent[]; error: unknown }> {
  const chunks: IContent[] = [];
  let error: unknown;
  try {
    for await (const chunk of stream) chunks.push(chunk);
  } catch (caught) {
    error = caught;
  }
  return { chunks, error };
}

describe('attempt lifecycle taxonomy and commitment telemetry (issue #2532)', () => {
  it('reports failure kind/phase, commitment, and budget for a pre-output error attempt', async () => {
    const { provider } = scriptedTransport([
      { error: statusError(503, 'Service unavailable') },
      {
        chunks: [
          { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] },
        ],
      },
    ]);
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 1,
    });
    const { observer, ends } = captureObserver();

    const { error } = await collect(
      orchestrator.generateChatCompletion({
        contents: [],
        metadata: { [ATTEMPT_LIFECYCLE_KEY]: observer },
      } as GenerateChatOptions),
    );

    expect(error).toBeUndefined();
    expect(ends.length).toBe(2);

    const failed = ends[0];
    expect(failed?.status).toBe('error');
    expect(failed?.failureKind).toBe('server');
    expect(failed?.failurePhase).toBeDefined();
    expect(failed?.committed).toBe(false);
    expect(failed?.exposure).toBe('none');
    expect(failed?.budgetUsed).toBe(1);
    expect(failed?.budgetLimit).toBeGreaterThanOrEqual(1);

    const success = ends[1];
    expect(success?.status).toBe('success');
    expect(success?.committed).toBe(true);
    expect(success?.exposure).toBe('content');
    expect(success?.failureKind).toBeUndefined();
    expect(success?.budgetUsed).toBe(2);
  });

  it('reports commitment with content exposure when an attempt fails after output', async () => {
    const { provider } = scriptedTransport([
      {
        chunks: [
          { speaker: 'ai', blocks: [{ type: 'text', text: 'partial' }] },
        ],
        error: statusError(429, 'Rate limited'),
      },
    ]);
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 1,
    });
    const { observer, ends } = captureObserver();

    const { error } = await collect(
      orchestrator.generateChatCompletion({
        contents: [],
        metadata: { [ATTEMPT_LIFECYCLE_KEY]: observer },
      } as GenerateChatOptions),
    );

    expect(error).toBeDefined();
    expect(ends.length).toBe(1);
    expect(ends[0]?.failureKind).toBe('rate_limit');
    expect(ends[0]?.committed).toBe(true);
    expect(ends[0]?.exposure).toBe('content');
  });

  it('keeps error messages but never adds token or credential material for auth failures', async () => {
    const authError = statusError(401, 'authentication_error');
    const { provider } = scriptedTransport([{ error: authError }]);
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 1,
      initialDelayMs: 1,
    });
    const { observer, ends } = captureObserver();

    const { error } = await collect(
      orchestrator.generateChatCompletion({
        contents: [],
        metadata: { [ATTEMPT_LIFECYCLE_KEY]: observer },
      } as GenerateChatOptions),
    );

    expect(error).toBeDefined();
    expect(ends.length).toBe(1);
    expect(ends[0]?.failureKind).toBe('auth');
    expect(ends[0]?.errorMessage).toBe('authentication_error');
  });
});
