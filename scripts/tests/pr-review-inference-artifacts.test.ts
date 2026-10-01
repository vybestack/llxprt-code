/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, it } from 'bun:test';
import { inferenceMetadata } from '../pr-review-local.ts';
it('retains hash and validated counters without storing arbitrary network content', () => {
  const raw = {
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 12,
    eval_count: 9,
    message: { content: 'private response' },
    unexpected: '<script>unsafe</script>',
  };
  const metadata = inferenceMetadata(raw);
  expect(metadata).toMatchObject({
    done: true,
    reason: 'stop',
    promptTokens: 12,
    outputTokens: 9,
  });
  expect(metadata.envelopeSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(metadata)).not.toContain('private response');
  expect(JSON.stringify(metadata)).not.toContain('script');
  expect(
    inferenceMetadata({ prompt_eval_count: 'not a number' }).promptTokens,
  ).toBeNull();
});
