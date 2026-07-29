/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { it } from 'vitest';
import { strict as assert } from 'assert';
import { TestRig } from './test-helper.js';

// Skip web search tests in CI unless explicitly enabled via RUN_WEB_TESTS=true
const skipInCI =
  process.env.CI === 'true' && process.env.RUN_WEB_TESTS !== 'true';

it.skipIf(skipInCI)(
  'should perform web search with provider-based architecture',
  async ({ task }) => {
    const rig = new TestRig();
    rig.setup(task.name);

    const prompt = `do a web search for 'grok 4 heavy surname incident july 2025' and summarize what happened`;
    const result = await rig.run({ args: prompt });

    // Should contain search results about the event
    assert.ok(
      result.toLowerCase().includes('grok') ||
        result.toLowerCase().includes('july 2025'),
      'Should mention Grok or July 2025 in the results',
    );

    // Should mention Hitler since that was the surname in the incident
    assert.ok(
      result.toLowerCase().includes('hitler'),
      'Should mention Hitler as that was the surname in the incident',
    );

    // Should have sources if web search was performed
    assert.ok(
      result.includes('Sources:') || result.includes('http'),
      'Should include sources from web search',
    );

    // Should NOT say no results found
    assert.ok(
      !result.toLowerCase().includes('no results found'),
      'Should not say no results found',
    );
    assert.ok(
      !result.toLowerCase().includes("couldn't find"),
      'Should not say could not find',
    );
  },
);

it.skipIf(skipInCI)(
  'should perform web search with OpenAI provider',
  async ({ task }) => {
    const rig = new TestRig();
    rig.setup(task.name);

    // Set OpenAI provider with API key
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai-key';
    try {
      const prompt = `do a web search for 'grok 4 heavy surname incident july 2025' and summarize what happened`;
      const result = await rig.run({
        args: [prompt, '--provider', 'openai', '--model', 'gpt-4.1'],
      });

      // Should contain search results about the event
      assert.ok(
        result.toLowerCase().includes('grok') ||
          result.toLowerCase().includes('july 2025'),
        'Should mention Grok or July 2025 in the results',
      );

      // Should mention Hitler since that was the surname in the incident
      assert.ok(
        result.toLowerCase().includes('hitler'),
        'Should mention Hitler as that was the surname in the incident',
      );

      // Should have sources if web search was performed
      assert.ok(
        result.includes('Sources:') || result.includes('http'),
        'Should include sources from web search',
      );

      // Should NOT say no results found
      assert.ok(
        !result.toLowerCase().includes('no results found'),
        'Should not say no results found',
      );
      assert.ok(
        !result.toLowerCase().includes("couldn't find"),
        'Should not say could not find',
      );
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }
  },
);

it.skipIf(skipInCI)(
  'should perform web search with Anthropic provider',
  async ({ task }) => {
    const rig = new TestRig();
    rig.setup(task.name);

    // Set Anthropic provider with API key
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    try {
      const prompt = `do a web search for 'grok 4 heavy surname incident july 2025' and summarize what happened`;
      const result = await rig.run({
        args: [
          prompt,
          '--provider',
          'anthropic',
          '--model',
          'claude-sonnet-4-20250514',
        ],
      });

      // Should contain search results about the event
      assert.ok(
        result.toLowerCase().includes('grok') ||
          result.toLowerCase().includes('july 2025'),
        'Should mention Grok or July 2025 in the results',
      );

      // Should mention Hitler since that was the surname in the incident
      assert.ok(
        result.toLowerCase().includes('hitler'),
        'Should mention Hitler as that was the surname in the incident',
      );

      // Should have sources if web search was performed
      assert.ok(
        result.includes('Sources:') || result.includes('http'),
        'Should include sources from web search',
      );

      // Should NOT say no results found
      assert.ok(
        !result.toLowerCase().includes('no results found'),
        'Should not say no results found',
      );
      assert.ok(
        !result.toLowerCase().includes("couldn't find"),
        'Should not say could not find',
      );
    } finally {
      if (previousKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = previousKey;
      }
    }
  },
);
