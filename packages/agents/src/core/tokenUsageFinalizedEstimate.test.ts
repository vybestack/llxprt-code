/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: recording the finalized prompt-envelope estimate must not
 * blank an already-measured tiktoken comparison for the same prompt
 * (issue #2817 remediation).
 *
 * The token-usage log exists to compare our estimate against a tiktoken
 * measurement and the provider's actual count. Writing hardcoded
 * `tiktokenTokens: null` over an existing measurement destroys that column.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import type { SerializedTokenUsageRecord } from './TokenUsageLogger.js';
import { recordFinalizedPromptEnvelopeEstimate } from './tokenUsageEstimateLogger.js';

async function createLogger(): Promise<{
  logger: TokenUsageLogger;
  readRecord: () => Promise<SerializedTokenUsageRecord>;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'llxprt-token-usage-'));
  const logFilePath = path.join(dir, 'token-usage.jsonl');
  return {
    logger: new TokenUsageLogger(true, logFilePath),
    readRecord: async () => {
      const lines = (await readFile(logFilePath, 'utf8'))
        .split('\n')
        .filter(Boolean);
      expect(lines).toHaveLength(1);
      return JSON.parse(lines.join('')) as SerializedTokenUsageRecord;
    },
  };
}

const FINALIZED_ESTIMATE = {
  estimatedPromptTokens: 123,
  activeProvider: 'openai',
  model: 'gpt-4o',
  protocol: 'openai-chat',
  method: 'chat/completions/v1',
  estimatorMethod: 'calibrated',
  estimatorFamily: 'legacy-unregistered',
  estimatorVersion: 'core-estimate-tokens-v1',
  assetRevision: 'none',
  projectionRevision: 2,
  unsupportedMedia: [],
} as const;

describe('recordFinalizedPromptEnvelopeEstimate (issue #2817)', () => {
  it('keeps an earlier tiktoken measurement while adopting the finalized token count', async () => {
    const { logger, readRecord } = await createLogger();

    logger.recordEstimate('prompt-1', {
      provider: 'openai',
      model: 'gpt-4o',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 97,
      tiktokenEstimationFailed: false,
    });

    recordFinalizedPromptEnvelopeEstimate(
      logger,
      'prompt-1',
      FINALIZED_ESTIMATE,
    );

    await logger.recordActual('prompt-1', {
      actualPromptTokens: 130,
      cachedTokens: 0,
    });

    const record = await readRecord();
    expect(record.estimated_tokens).toBe(123);
    expect(record.tiktoken_tokens).toBe(97);
    expect(record.tiktoken_estimation_failed).toBe(false);
  });

  it('keeps an earlier tiktoken failure flag', async () => {
    const { logger, readRecord } = await createLogger();

    logger.recordEstimate('prompt-2', {
      provider: 'openai',
      model: 'gpt-4o',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: null,
      tiktokenEstimationFailed: true,
    });

    recordFinalizedPromptEnvelopeEstimate(
      logger,
      'prompt-2',
      FINALIZED_ESTIMATE,
    );

    await logger.recordActual('prompt-2', {
      actualPromptTokens: 130,
      cachedTokens: 0,
    });

    const record = await readRecord();
    expect(record.tiktoken_tokens).toBeNull();
    expect(record.tiktoken_estimation_failed).toBe(true);
  });

  it('records a null tiktoken measurement when none was taken for the prompt', async () => {
    const { logger, readRecord } = await createLogger();

    recordFinalizedPromptEnvelopeEstimate(
      logger,
      'prompt-3',
      FINALIZED_ESTIMATE,
    );

    await logger.recordActual('prompt-3', {
      actualPromptTokens: 130,
      cachedTokens: 0,
    });

    const record = await readRecord();
    expect(record.estimated_tokens).toBe(123);
    expect(record.tiktoken_tokens).toBeNull();
    expect(record.tiktoken_estimation_failed).toBe(false);
  });

  it('does not resurrect a tiktoken measurement from a different prompt', async () => {
    const { logger, readRecord } = await createLogger();

    logger.recordEstimate('prompt-other', {
      provider: 'openai',
      model: 'gpt-4o',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 97,
      tiktokenEstimationFailed: false,
    });

    recordFinalizedPromptEnvelopeEstimate(
      logger,
      'prompt-4',
      FINALIZED_ESTIMATE,
    );

    await logger.recordActual('prompt-4', {
      actualPromptTokens: 130,
      cachedTokens: 0,
    });

    const record = await readRecord();
    expect(record.prompt_id).toBe('prompt-4');
    expect(record.tiktoken_tokens).toBeNull();
  });
});
