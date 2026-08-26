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

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  estimatePromptEnvelope,
  type PromptEnvelopeEstimate,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { OpenAIResponsesProvider } from '@vybestack/llxprt-code-providers';
import { createRuntimeTokenizerFactory } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import type { SerializedTokenUsageRecord } from './TokenUsageLogger.js';
import { recordFinalizedPromptEnvelopeEstimate } from './tokenUsageEstimateLogger.js';

afterEach(() => {
  clearActiveProviderRuntimeContext();
});

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

interface PromptAccounting {
  readonly transmitted: number;
  readonly incremental: number;
  readonly retained: number;
  readonly effective: number;
  readonly statefulParentUsed: boolean;
}

function promptAccounting(estimate: PromptEnvelopeEstimate): PromptAccounting {
  const transmitted = estimate.transmittedTokens;
  const incremental = estimate.incrementalTokens;
  const retained = estimate.retainedBaselineTokens;
  const effective = estimate.effectiveTokens;
  const statefulParentUsed = estimate.statefulParentUsed;
  if (
    transmitted === undefined ||
    incremental === undefined ||
    retained === undefined
  ) {
    throw new Error('Expected finalized prompt accounting facts');
  }
  if (effective === undefined || statefulParentUsed === undefined) {
    throw new Error('Expected finalized prompt accounting facts');
  }
  return { transmitted, incremental, retained, effective, statefulParentUsed };
}
function serializedPromptAccounting(
  record: SerializedTokenUsageRecord,
): PromptAccounting {
  const transmitted = record.transmitted_prompt_tokens;
  const incremental = record.incremental_prompt_tokens;
  const retained = record.retained_context_tokens;
  const effective = record.effective_provider_context_tokens;
  const statefulParentUsed = record.stateful_parent_used;
  if (
    transmitted === undefined ||
    incremental === undefined ||
    retained === undefined
  ) {
    throw new Error('Expected serialized prompt accounting facts');
  }
  if (effective === undefined || statefulParentUsed === undefined) {
    throw new Error('Expected serialized prompt accounting facts');
  }
  return { transmitted, incremental, retained, effective, statefulParentUsed };
}

function createResponsesProvider(): OpenAIResponsesProvider {
  const settingsService = new SettingsService();
  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({
      settingsService,
      runtimeId: 'token-usage-stateful-responses-test',
    }),
  );
  return new OpenAIResponsesProvider('token-test', 'https://api.openai.com/v1');
}

async function estimateResponsesPrompt(
  provider: OpenAIResponsesProvider,
  contents: readonly IContent[],
  stateful: boolean,
): Promise<PromptEnvelopeEstimate> {
  const projection = await provider.projectPromptEnvelope(
    createProviderCallOptions({
      providerName: provider.name,
      resolved: {
        model: 'gpt-4o',
        baseURL: 'https://api.openai.com/v1',
        telemetry: { providerName: provider.name },
      },
      contents: [...contents],
      ...(stateful ? { ephemerals: { 'responses-stateful': true } } : {}),
    }),
  );
  return estimatePromptEnvelope(
    provider.name,
    projection,
    createRuntimeTokenizerFactory(),
  );
}

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

describe('stateful Responses finalized-estimate telemetry (issue #3219 AC-6)', () => {
  it('serializes equal transmitted and effective context for a real stateless projection', async () => {
    const provider = createResponsesProvider();
    const estimate = await estimateResponsesPrompt(
      provider,
      [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'Compare the orbital periods of Mars and Jupiter.',
            },
          ],
        },
      ],
      false,
    );
    const accounting = promptAccounting(estimate);
    const { logger, readRecord } = await createLogger();

    recordFinalizedPromptEnvelopeEstimate(logger, 'stateless-prompt', estimate);
    await logger.recordActual('stateless-prompt', {
      actualPromptTokens: accounting.effective + 5,
      cachedTokens: 0,
    });

    const record = await readRecord();
    const serialized = serializedPromptAccounting(record);
    expect(accounting.statefulParentUsed).toBe(false);
    expect(serialized).toStrictEqual(accounting);
    expect(serialized.retained).toBe(0);
    expect(serialized.transmitted).toBe(serialized.effective);
    expect(serialized.effective).toBe(record.estimated_tokens);
  });

  it('serializes retained plus transmitted context independently of provider-reported cached usage', async () => {
    const provider = createResponsesProvider();
    const priorQuestion: IContent = {
      speaker: 'human',
      blocks: [
        {
          type: 'text',
          text: 'Describe how tidal forces shape a moon over geological time. '.repeat(
            20,
          ),
        },
      ],
    };
    const priorAnswer: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: 'Tidal stress dissipates orbital energy and deforms the crust. '.repeat(
            20,
          ),
        },
      ],
    };
    const priorEstimate = await estimateResponsesPrompt(
      provider,
      [priorQuestion, priorAnswer],
      false,
    );
    const contents: readonly IContent[] = [
      priorQuestion,
      {
        ...priorAnswer,
        metadata: {
          id: 'resp-telemetry-parent',
          responsesStored: true,
          usage: {
            promptTokens: priorEstimate.estimatedPromptTokens,
            completionTokens: 10,
            totalTokens: priorEstimate.estimatedPromptTokens + 10,
            cachedTokens: Math.floor(priorEstimate.estimatedPromptTokens / 2),
          },
        },
      },
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Relate that process to orbital decay.' },
        ],
      },
    ];
    const estimate = await estimateResponsesPrompt(provider, contents, true);
    const accounting = promptAccounting(estimate);
    const { logger, readRecord } = await createLogger();
    const reportedCachedTokens = Math.max(
      1,
      Math.floor(accounting.effective / 2),
    );

    recordFinalizedPromptEnvelopeEstimate(logger, 'stateful-prompt', estimate);
    await logger.recordActual('stateful-prompt', {
      actualPromptTokens: accounting.effective + 7,
      cachedTokens: reportedCachedTokens,
    });

    const record = await readRecord();
    const serialized = serializedPromptAccounting(record);
    expect(accounting.statefulParentUsed).toBe(true);
    expect(serialized).toStrictEqual(accounting);
    expect(serialized.retained).toBeGreaterThan(0);
    expect(serialized.effective).toBeGreaterThan(serialized.transmitted);
    expect(serialized.transmitted).toBe(serialized.incremental);
    expect(serialized.retained + serialized.incremental).toBe(
      serialized.effective,
    );
    expect(record.estimated_tokens).toBe(serialized.effective);
    expect(record.cached_tokens).toBeGreaterThan(0);
    expect(serialized.effective).toBe(accounting.effective);
  });
});
