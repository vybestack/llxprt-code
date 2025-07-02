#!/usr/bin/env tsx

/**
 * Benchmark script to compare performance between Responses API and Chat Completions API
 *
 * Usage:
 *   OPENAI_API_KEY=your-key tsx scripts/benchmark/responses_vs_chat.ts
 */

import { OpenAIProvider } from '../../packages/cli/src/providers/openai/OpenAIProvider.js';
import { IMessage } from '../../packages/cli/src/providers/IMessage.js';

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

  // Test Responses API with gpt-4o
  console.log('Testing Responses API with gpt-4o...');
  const responsesProvider = new OpenAIProvider(apiKey);
  responsesProvider.setModel('gpt-4o');

  try {
    const responsesResult = await benchmarkAPI(
      responsesProvider,
      testMessages,
      'responses',
    );
    results.push(responsesResult);
    console.log('✓ Responses API test completed\n');
  } catch (error) {
    console.error('✗ Responses API test failed:', error);
  }

  // Test Legacy API with gpt-4o (force disable responses)
  console.log(
    'Testing Legacy API with gpt-4o (OPENAI_RESPONSES_DISABLE=true)...',
  );
  process.env.OPENAI_RESPONSES_DISABLE = 'true';
  const legacyProvider = new OpenAIProvider(apiKey);
  legacyProvider.setModel('gpt-4o');

  try {
    const legacyResult = await benchmarkAPI(
      legacyProvider,
      testMessages,
      'legacy',
    );
    results.push(legacyResult);
    console.log('✓ Legacy API test completed\n');
  } catch (error) {
    console.error('✗ Legacy API test failed:', error);
  } finally {
    delete process.env.OPENAI_RESPONSES_DISABLE;
  }

  // Test with gpt-3.5-turbo (always uses legacy)
  console.log('Testing Legacy API with gpt-3.5-turbo...');
  const turboProvider = new OpenAIProvider(apiKey);
  turboProvider.setModel('gpt-3.5-turbo');

  try {
    const turboResult = await benchmarkAPI(
      turboProvider,
      testMessages,
      'legacy',
    );
    results.push(turboResult);
    console.log('✓ gpt-3.5-turbo test completed\n');
  } catch (error) {
    console.error('✗ gpt-3.5-turbo test failed:', error);
  }

  // Display results
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

  // Compare Responses vs Legacy for gpt-4o
  const responsesGpt4o = results.find(
    (r) => r.apiType === 'responses' && r.model === 'gpt-4o',
  );
  const legacyGpt4o = results.find(
    (r) => r.apiType === 'legacy' && r.model === 'gpt-4o',
  );

  if (responsesGpt4o && legacyGpt4o) {
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
      `Time to First Token: ${firstTokenImprovement}% ${parseFloat(firstTokenImprovement) > 0 ? 'faster' : 'slower'}`,
    );
    console.log(
      `Total Time: ${totalTimeImprovement}% ${parseFloat(totalTimeImprovement) > 0 ? 'faster' : 'slower'}`,
    );
    console.log(
      `Throughput: ${throughputImprovement}% ${parseFloat(throughputImprovement) > 0 ? 'higher' : 'lower'}`,
    );
  }

  console.log(
    '\nNote: Results may vary based on network conditions, server load, and prompt complexity.',
  );
}

// Run the benchmark
runBenchmark().catch(console.error);
