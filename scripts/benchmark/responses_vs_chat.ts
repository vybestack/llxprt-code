#!/usr/bin/env tsx

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Benchmark script to compare performance between Responses API and Chat Completions API
 *
 * Usage:
 *   OPENAI_API_KEY=your-key tsx scripts/benchmark/responses_vs_chat.ts
 */

import { OpenAIProvider } from '../../packages/core/src/providers/openai/OpenAIProvider.js';
import { IMessage } from '../../packages/cli/src/providers/IMessage.js';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  ProviderRuntimeContext,
} from '../../packages/core/src/runtime/providerRuntimeContext.js';

interface BenchmarkResult {
  apiType: string;
  model: string;
  timeToFirstToken: number;
  totalTime: number;
  tokensGenerated: number;
  tokensPerSecond: number;
}

async function benchmarkAPI(
  provider: OpenAIProvider,
  messages: IMessage[],
  apiType: 'responses' | 'legacy',
): Promise<BenchmarkResult> {
  const startTime = Date.now();
  let timeToFirstToken = 0;
  let tokensGenerated = 0;
  let firstTokenReceived = false;

  const generator = provider.generateChatCompletion(messages);

  for await (const message of generator) {
    if (!firstTokenReceived && message.content) {
      timeToFirstToken = Date.now() - startTime;
      firstTokenReceived = true;
    }

    if (message.content) {
      // Rough token count estimation
      tokensGenerated += message.content.split(/\s+/).length;
    }
  }

  const totalTime = Date.now() - startTime;
  const tokensPerSecond = (tokensGenerated / totalTime) * 1000;

  return {
    apiType,
    model: provider.getModel(),
    timeToFirstToken,
    totalTime,
    tokensGenerated,
    tokensPerSecond,
  };
}

async function withRuntime<T>(
  metadata: ProviderRuntimeContext['metadata'],
  task: (runtime: ProviderRuntimeContext) => Promise<T>,
): Promise<T> {
  const previous = peekActiveProviderRuntimeContext();
  const runtime = createProviderRuntimeContext({ metadata });
  setActiveProviderRuntimeContext(runtime);
  try {
    return await task(runtime);
  } finally {
    clearActiveProviderRuntimeContext();
    if (previous) {
      setActiveProviderRuntimeContext(previous);
    }
  }
}

function formatImprovementLabel(
  value: string,
  positive: string,
  negative: string,
): string {
  return parseFloat(value) > 0 ? positive : negative;
}

async function runSingleTest(
  apiKey: string,
  testMessages: IMessage[],
  results: BenchmarkResult[],
  scenario: string,
  model: string,
  apiType: 'responses' | 'legacy',
  label: string,
  cleanup?: () => void,
): Promise<void> {
  await withRuntime({ scenario }, async (runtime) => {
    const provider = new OpenAIProvider(apiKey);
    runtime.settingsService.set('activeProvider', 'openai');
    runtime.settingsService.set('model', model);

    try {
      const result = await benchmarkAPI(provider, testMessages, apiType);
      results.push(result);
      console.log(`[OK] ${label} test completed\n`);
    } catch (error) {
      console.error(` ${label} test failed:`, error);
    } finally {
      if (cleanup) cleanup();
    }
  });
}

function displayResultsTable(results: BenchmarkResult[]): void {
  console.log('\n' + '='.repeat(80) + '\n');
  console.log('BENCHMARK RESULTS:\n');
  console.log(
    '| API Type  | Model         | First Token (ms) | Total Time (ms) | Tokens | Tokens/sec |',
  );
  console.log(
    '|-----------|---------------|------------------|-----------------|--------|------------|',
  );

  for (const result of results) {
    console.log(
      `| ${result.apiType.padEnd(9)} | ${result.model.padEnd(13)} | ${result.timeToFirstToken
        .toString()
        .padStart(
          16,
        )} | ${result.totalTime.toString().padStart(15)} | ${result.tokensGenerated
        .toString()
        .padStart(6)} | ${result.tokensPerSecond.toFixed(2).padStart(10)} |`,
    );
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

function displayComparison(results: BenchmarkResult[]): void {
  const responsesGpt4o = results.find(
    (r) => r.apiType === 'responses' && r.model === 'gpt-4o',
  );
  const legacyGpt4o = results.find(
    (r) => r.apiType === 'legacy' && r.model === 'gpt-4o',
  );

  if (!(responsesGpt4o && legacyGpt4o)) return;

  console.log('COMPARISON (gpt-4o Responses vs Legacy):\n');

  const firstTokenImprovement = (
    ((legacyGpt4o.timeToFirstToken - responsesGpt4o.timeToFirstToken) /
      legacyGpt4o.timeToFirstToken) *
    100
  ).toFixed(1);
  const totalTimeImprovement = (
    ((legacyGpt4o.totalTime - responsesGpt4o.totalTime) /
      legacyGpt4o.totalTime) *
    100
  ).toFixed(1);
  const throughputImprovement = (
    ((responsesGpt4o.tokensPerSecond - legacyGpt4o.tokensPerSecond) /
      legacyGpt4o.tokensPerSecond) *
    100
  ).toFixed(1);

  console.log(
    `Time to First Token: ${firstTokenImprovement}% ${formatImprovementLabel(firstTokenImprovement, 'faster', 'slower')}`,
  );
  console.log(
    `Total Time: ${totalTimeImprovement}% ${formatImprovementLabel(totalTimeImprovement, 'faster', 'slower')}`,
  );
  console.log(
    `Throughput: ${throughputImprovement}% ${formatImprovementLabel(throughputImprovement, 'higher', 'lower')}`,
  );
}

async function runBenchmark() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Please set OPENAI_API_KEY environment variable');
    process.exit(1);
  }

  const testMessages: IMessage[] = [
    {
      role: 'user',
      content:
        'Write a detailed explanation of how async generators work in JavaScript, including examples and best practices. Make it at least 500 words.',
    },
  ];

  console.log('OpenAI Responses API vs Chat Completions API Benchmark\n');
  console.log('Testing with prompt:', testMessages[0].content);
  console.log('\n' + '='.repeat(80) + '\n');

  const results: BenchmarkResult[] = [];

  console.log('Testing Responses API with gpt-4o...');
  await runSingleTest(
    apiKey,
    testMessages,
    results,
    'responses-gpt-4o',
    'gpt-4o',
    'responses',
    'Responses API',
  );

  console.log(
    'Testing Legacy API with gpt-4o (OPENAI_RESPONSES_DISABLE=true)...',
  );
  process.env.OPENAI_RESPONSES_DISABLE = 'true';
  await runSingleTest(
    apiKey,
    testMessages,
    results,
    'legacy-gpt-4o',
    'gpt-4o',
    'legacy',
    'Legacy API',
    () => {
      delete process.env.OPENAI_RESPONSES_DISABLE;
    },
  );

  console.log('Testing Legacy API with gpt-3.5-turbo...');
  await runSingleTest(
    apiKey,
    testMessages,
    results,
    'legacy-gpt-35-turbo',
    'gpt-3.5-turbo',
    'legacy',
    'gpt-3.5-turbo',
  );

  displayResultsTable(results);
  displayComparison(results);

  console.log(
    '\nNote: Results may vary based on network conditions, server load, and prompt complexity.',
  );
}

// Run the benchmark
runBenchmark().catch(console.error);
