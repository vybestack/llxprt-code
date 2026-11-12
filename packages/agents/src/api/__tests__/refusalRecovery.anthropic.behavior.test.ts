/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036: the real-world refusal is an Anthropic stream that carries only
 * `message_delta.delta.stop_reason: "refusal"` with zero output tokens. This
 * drives the real Anthropic provider (API-key path) against a local endpoint
 * that answers with exactly that shape and then with a normal answer.
 */

import { describe, expect, it } from 'bun:test';
import { isDoneEvent, isNoticeEvent } from './helpers/agentHarness.js';
import {
  aiTexts,
  emptyRefusalReply,
  runScriptedPrompt,
  stopReply,
  turnRecords,
} from './helpers/refusal-endpoint.js';

const PROMPT = 'please summarise the work';

describe('Anthropic metadata-only refusal (issue #4036)', () => {
  const recovered = () =>
    runScriptedPrompt(
      [emptyRefusalReply(), stopReply('recovered on the second request')],
      [PROMPT],
      {
        protocol: 'anthropic',
        settings: { 'refusal.retries': 1, 'refusal.rewrite': false },
      },
    );

  it('resends the identical request and keeps only the answer', async () => {
    const run = await recovered();

    expect(run.requests).toHaveLength(2);
    expect(run.requests[1]).toStrictEqual(run.requests[0]);
    expect(aiTexts(run.historyAfter)).toStrictEqual([
      'recovered on the second request',
    ]);
    expect(run.events.filter(isDoneEvent).map((e) => e.reason)).toStrictEqual([
      'stop',
    ]);
  });

  it('classifies the metadata-only stream as a refusal with its raw stop reason', async () => {
    const run = await recovered();

    const records = turnRecords(run.tokenRecords);
    expect(records.map((r) => r['attempt_outcome'])).toStrictEqual([
      'refusal',
      'success',
    ]);
    expect(records[0]).toMatchObject({
      finish_reason: 'refusal',
      raw_stop_reason: 'refusal',
      output_tokens: 0,
      attempt_index: 0,
    });
    expect(records[1]).toMatchObject({ attempt_index: 1 });
  });

  it('waits the default 15 s before the retry and announces it', async () => {
    const run = await runScriptedPrompt(
      [emptyRefusalReply(), stopReply('ok')],
      [PROMPT],
      { protocol: 'anthropic', settings: { 'refusal.retries': 1 } },
    );

    expect(run.waits).toStrictEqual([15000]);
    expect(
      run.events.filter(isNoticeEvent).map((e) => e.message),
    ).toStrictEqual([
      'Model claude-opus-5-5 refused the request; retrying in 15 s (retry 1 of 1).',
    ]);
  });
});
