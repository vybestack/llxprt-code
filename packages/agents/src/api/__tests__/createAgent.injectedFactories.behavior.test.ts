/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import type { RuntimeContentGeneratorFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeContentGeneratorFactory.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { buildAgent, countType, drain } from './helpers/agentHarness.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

function readinessTokenizer(
  prepareTokenizer: (providerName: string, model?: string) => Promise<void>,
): RuntimeTokenizerFactory {
  return {
    prepareTokenizer,
    getTokenizer: () => ({
      fallbackPolicy: 'deny',
      countTokens: () => 1,
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'calibrated',
      family: 'test-readiness',
      estimatorVersion: 'test-readiness-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    }),
  };
}

describe('createAgent function-valued factory inputs', () => {
  const credentials = useOwnedCredentials();

  it('holds construction until the supplied tokenizerFactory is ready', async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = (): void => {};
    const preparing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const prepared: string[] = [];
    const tokenizerFactory = readinessTokenizer(async (provider, model) => {
      prepared.push(`${provider}:${model ?? ''}`);
      started();
      await gate;
    });

    let built: Awaited<ReturnType<typeof buildAgent>> | undefined;
    let completed = false;
    const pending = buildAgent('plain-text.jsonl', {
      credentialAuthority: credentials().authority,
      tokenizerFactory,
    }).then((result) => {
      completed = true;
      built = result;
    });
    try {
      await preparing;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(completed).toBe(false);
      release();
      await pending;
      expect(prepared).toStrictEqual(['fake:fake-model']);
    } finally {
      release();
      await pending.catch(() => {});
      await built?.cleanup();
    }
  });

  it('rejects construction with the supplied tokenizerFactory preparation failure', async () => {
    const failure = new Error('supplied tokenizer readiness failed');
    const tokenizerFactory = readinessTokenizer(async () => {
      throw failure;
    });

    await expect(
      buildAgent('plain-text.jsonl', {
        credentialAuthority: credentials().authority,
        tokenizerFactory,
      }),
    ).rejects.toThrow(failure.message);
  });

  it('serves the session through the supplied contentGeneratorFactory', async () => {
    let created = 0;
    const contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator> =
      {
        createContentGenerator: () => {
          created += 1;
          return {
            generateContent: async () => {
              throw new Error('supplied generator not expected to generate');
            },
            generateContentStream: async () => {
              throw new Error('supplied generator not expected to stream');
            },
            countTokens: async () => ({ totalTokens: 1 }),
            embedContent: async () => ({ embeddings: [] }),
          };
        },
      };
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      credentialAuthority: credentials().authority,
      contentGeneratorFactory,
    });
    try {
      const events = await drain(agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);
      expect(created).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });
});
