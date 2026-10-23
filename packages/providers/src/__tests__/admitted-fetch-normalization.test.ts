/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../ProviderManager.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { normalizeProviderGenerateChatOptions } from '../BaseProviderNormalization.js';

describe('admitted request transport normalization', () => {
  it('retains the exact owned fetch and caller signal through manager and valid BaseProvider normalization and physical release', async () => {
    const server = createServer((socket) => {
      socket.once('data', () =>
        socket.end(
          'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nactual owner route',
        ),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing physical endpoint');
    const baseURL = `http://127.0.0.1:${address.port}`;
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'admitted-model');
    settings.setProviderSetting('openai', 'base-url', baseURL);
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
    );
    const provider = new OpenAIProvider('local-only');
    manager.registerProvider(provider);
    const owner = new OwnedFetch();
    const signal = new AbortController();
    const invocation = createRuntimeInvocationContext({
      runtimeId: 'normalization-owner',
      providerName: 'openai',
      ephemeralsSnapshot: {
        openai: { model: 'admitted-model', 'base-url': baseURL },
      },
      fetch: owner.fetch,
      signal: signal.signal,
    });
    const failures: unknown[] = [];
    try {
      const admitted = manager.normalizeRuntimeInputs(
        { contents: [], invocation },
        'openai',
      );
      const normalized = normalizeProviderGenerateChatOptions(
        provider,
        admitted,
        {
          providerName: 'openai',
          authToken: 'local-only',
          resolvedModel: 'admitted-model',
          resolvedBaseURL: baseURL,
          providerSettings: {},
          ephemeralsSnapshot: {},
          providerDefaults: {},
          configuredHeaders: {},
        },
      );
      expect(admitted.invocation?.fetch).toBe(owner.fetch);
      expect(normalized.invocation.fetch).toBe(owner.fetch);
      expect(normalized.invocation.signal).toBe(signal.signal);
      expect(normalized.resolved.model).toBe('admitted-model');
      const request = normalized.invocation.fetch;
      if (request === undefined) throw new Error('Admitted fetch was lost');
      expect(await (await request(baseURL)).text()).toBe('actual owner route');
      owner.closeAdmissionAndAbort();
      await expect(request(baseURL)).rejects.toThrow('Root fetch is closed');
    } catch (error) {
      failures.push(error);
    } finally {
      const released = await Promise.allSettled([
        Promise.resolve().then(() => manager.dispose()),
        owner.dispose(),
      ]);
      failures.push(
        ...released.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      );
      const stopped = await Promise.allSettled([
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
      ]);
      failures.push(
        ...stopped.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      );
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Admitted transport fixture failed');
  });
});
