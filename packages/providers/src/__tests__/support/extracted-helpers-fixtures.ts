/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { IProvider } from '../../IProvider.js';

export function captureThrown(fn: () => unknown): { error: unknown } {
  try {
    fn();
  } catch (error) {
    return { error };
  }
  throw new Error('expected the call to throw, but it did not');
}

export function debugLoggerStub(): DebugLogger {
  return {
    debug: () => {},
    log: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as DebugLogger;
}
export function providerStub(overrides: Partial<IProvider> = {}): IProvider {
  return {
    name: 'provider-a',
    getModels: vi.fn().mockResolvedValue([]),
    getDefaultModel: vi.fn().mockReturnValue('default-model'),
    generateChatCompletion: vi.fn(),
    ...overrides,
  } as unknown as IProvider;
}

export function statusError(status: number): Error {
  return Object.assign(new Error(`status ${status}`), { status });
}

export const handlerStub = {
  tryBucketFailover: async () => false,
  readFailoverBuckets: () => ['bucket'],
  getBuckets: () => ['bucket-a'],
  getCurrentBucket: () => 'bucket-a',
  isEnabled: () => true,
  tryFailover: () => Promise.resolve(true),
  resetSession: () => {},
};

export async function collectChunks(
  stream: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

const configRoots: Config[] = [];

export function runtimeConfig(
  model = 'config-model',
  initialSettings: Readonly<Record<string, unknown>> = {},
  provider?: string,
): Config {
  const config = new Config({
    sessionId: 'extracted-helper-fixture',
    model,
    provider,
    initialSettings,
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
  });
  configRoots.push(config);
  return config;
}

export async function disposeConfigRoots(): Promise<void> {
  await Promise.all(configRoots.splice(0).map((config) => config.dispose()));
}
