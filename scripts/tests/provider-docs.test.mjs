/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const providersGuide = readFileSync(
  new URL('../../docs/cli/providers.md', import.meta.url),
  'utf8',
);

test('hosted OpenAI-compatible guide uses the Chat Completions base URL correctly', () => {
  const example = providersGuide.slice(
    providersGuide.indexOf('### Hosted OpenAI-compatible endpoints'),
    providersGuide.indexOf('## Creating Your Own Provider Alias'),
  );

  assert.ok(example.includes('--provider openai'));
  assert.ok(example.includes('--base-url https://api.pzero.studio/v1'));
  assert.ok(example.includes('--model deepseek-v4-flash'));
  assert.ok(example.includes('not the full `/v1/chat/completions` request path'));
  assert.ok(example.includes('Do not add the `openai/` prefix'));
  assert.ok(example.includes('openaiResponsesEnabled` is disabled by default'));
});
