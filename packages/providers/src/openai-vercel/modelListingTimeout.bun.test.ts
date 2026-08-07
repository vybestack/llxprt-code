/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';

const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
});

describe('OpenAIVercelProvider model listing timeout', () => {
  it('bounds the external request and falls back after cancellation', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    AbortSignal.timeout = mock(() => controller.signal);
    globalThis.fetch = mock(
      async (_input: string | URL | Request, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        await new Promise<void>((_resolve, reject) => {
          requestSignal?.addEventListener(
            'abort',
            () => reject(requestSignal?.reason),
            { once: true },
          );
        });
        throw new Error('unreachable');
      },
    ) as typeof fetch;

    const provider = new OpenAIVercelProvider('test-api-key');
    const modelsPromise = provider.getModels();

    await Bun.sleep(0);
    expect(requestSignal).toBe(controller.signal);
    expect(requestSignal?.aborted).toBe(false);

    controller.abort();
    const models = await modelsPromise;

    expect(AbortSignal.timeout).toHaveBeenCalledTimes(1);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000);
    expect(models.map((model) => model.id)).toContain('gpt-4o');
  });
});
