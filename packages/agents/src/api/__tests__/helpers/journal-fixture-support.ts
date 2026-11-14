/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';

export function useTempDir(prefix: string): () => string {
  let directory: string | undefined;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), prefix));
  });
  afterEach(async () => {
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });
  return () => {
    if (directory === undefined) {
      throw new Error('useTempDir accessor used outside a running test');
    }
    return directory;
  };
}

export function exactTokenizer(): RuntimeTokenizerFactory {
  return {
    getTokenizer: () => ({
      fallbackPolicy: 'deny',
      countTokens: async (): Promise<number> => 1,
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'exact',
      family: 'rollback-test',
      estimatorVersion: '1',
      assetRevision: '1',
      projectionRevision: request.projectionRevision,
    }),
  };
}
