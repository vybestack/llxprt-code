#!/usr/bin/env node

import { OpenAIProvider } from './packages/core/dist/src/providers/openai/OpenAIProvider.js';
import { ProviderManager } from './packages/core/dist/src/providers/ProviderManager.js';
import { Config } from './packages/core/dist/src/config/config.js';

async function testTokenTracking() {
  console.log('Testing token tracking...');

  // Create config and provider manager
  const config = new Config();
  const providerManager = new ProviderManager();

  // Set config on provider manager
  providerManager.setConfig(config);
  config.setProviderManager(providerManager);

  // Create and register OpenAI provider
  const provider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY || 'test-key',
  });

  providerManager.registerProvider(provider);
  providerManager.setActiveProvider('openai');

  // Check initial token usage
  console.log('Initial token usage:', providerManager.getSessionTokenUsage());

  // Make a simple API call
  const messages = [
    {
      speaker: 'user',
      blocks: [
        {
          type: 'text',
          text: 'Say hello in 5 words',
        },
      ],
    },
  ];

  try {
    console.log('Making API call...');
    const stream = providerManager
      .getActiveProvider()
      .generateChatCompletion(messages);

    let response = '';
    for await (const chunk of stream) {
      if (chunk.blocks?.[0]?.text) {
        response += chunk.blocks[0].text;
      }

      // Check if we got usage metadata
      if (chunk.metadata?.usage) {
        console.log('Got usage metadata:', chunk.metadata.usage);
      }
    }

    console.log('Response:', response);

    // Check token usage after call
    console.log('Final token usage:', providerManager.getSessionTokenUsage());

    // Check performance metrics
    const metrics = providerManager.getProviderMetrics();
    console.log('Performance metrics:', metrics);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testTokenTracking().catch(console.error);
