/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import { strict as assert } from 'assert';
import { TestRig } from './test-helper.js';

test('should fetch web content with provider-based architecture', async (t) => {
  const rig = new TestRig();
  rig.setup(t.name);

  const prompt = `fetch https://example.com and summarize the content`;
  const result = await rig.run(prompt);

  // Should contain content from example.com
  assert.ok(
    result.toLowerCase().includes('example') ||
      result.toLowerCase().includes('domain') ||
      result.toLowerCase().includes('illustrative'),
    'Should mention example, domain, or illustrative from example.com content',
  );

  // Should NOT have errors
  assert.ok(
    !result.toLowerCase().includes('error fetching'),
    'Should not have fetch errors',
  );
  assert.ok(
    !result.toLowerCase().includes('failed to fetch'),
    'Should not say failed to fetch',
  );
});

test('should fetch web content with OpenAI provider', async (t) => {
  const rig = new TestRig();
  rig.setup(t.name);

  // Set OpenAI provider with API key
  process.env.OPENAI_API_KEY = 'test-openai-key';

  const prompt = `fetch https://example.com and summarize the content`;
  const result = await rig.run(
    prompt,
    '--provider',
    'openai',
    '--model',
    'gpt-4.1',
  );

  // Should contain content from example.com
  assert.ok(
    result.toLowerCase().includes('example') ||
      result.toLowerCase().includes('domain') ||
      result.toLowerCase().includes('illustrative'),
    'Should mention example, domain, or illustrative from example.com content',
  );

  // Should NOT have errors
  assert.ok(
    !result.toLowerCase().includes('error fetching'),
    'Should not have fetch errors',
  );
  assert.ok(
    !result.toLowerCase().includes('failed to fetch'),
    'Should not say failed to fetch',
  );
});

test('should fetch web content with Gemini provider', async (t) => {
  const rig = new TestRig();
  rig.setup(t.name);

  // Set Gemini provider with API key
  process.env.GEMINI_API_KEY = 'test-gemini-key';

  const prompt = `fetch https://example.com and summarize the content`;
  const result = await rig.run(
    prompt,
    '--provider',
    'gemini',
    '--model',
    'gemini-2.5-pro',
  );

  // Should contain content from example.com
  assert.ok(
    result.toLowerCase().includes('example') ||
      result.toLowerCase().includes('domain') ||
      result.toLowerCase().includes('illustrative'),
    'Should mention example, domain, or illustrative from example.com content',
  );

  // Should NOT have errors
  assert.ok(
    !result.toLowerCase().includes('error fetching'),
    'Should not have fetch errors',
  );
  assert.ok(
    !result.toLowerCase().includes('failed to fetch'),
    'Should not say failed to fetch',
  );
});

test('should fetch web content with Anthropic provider', async (t) => {
  const rig = new TestRig();
  rig.setup(t.name);

  // Set Anthropic provider with API key
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

  const prompt = `fetch https://example.com and summarize the content`;
  const result = await rig.run(
    prompt,
    '--provider',
    'anthropic',
    '--model',
    'claude-3-7-sonnet-20250219',
  );

  // Should contain content from example.com
  assert.ok(
    result.toLowerCase().includes('example') ||
      result.toLowerCase().includes('domain') ||
      result.toLowerCase().includes('illustrative'),
    'Should mention example, domain, or illustrative from example.com content',
  );

  // Should NOT have errors
  assert.ok(
    !result.toLowerCase().includes('error fetching'),
    'Should not have fetch errors',
  );
  assert.ok(
    !result.toLowerCase().includes('failed to fetch'),
    'Should not say failed to fetch',
  );
});

test('should fetch and analyze specific content', async (t) => {
  const rig = new TestRig();
  rig.setup(t.name);

  const prompt = `fetch https://www.iana.org/domains/reserved and tell me what reserved domains are listed`;
  const result = await rig.run(prompt);

  // Should mention some reserved domains
  assert.ok(
    result.toLowerCase().includes('example') ||
      result.toLowerCase().includes('test') ||
      result.toLowerCase().includes('localhost') ||
      result.toLowerCase().includes('reserved'),
    'Should mention reserved domains like example, test, or localhost',
  );

  // Should NOT have errors
  assert.ok(
    !result.toLowerCase().includes('error fetching'),
    'Should not have fetch errors',
  );
  assert.ok(
    !result.toLowerCase().includes('failed to fetch'),
    'Should not say failed to fetch',
  );
});
