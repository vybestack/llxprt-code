/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { isNoticeEvent } from './helpers/agentHarness.js';
import {
  runScriptedPrompt,
  stopReply,
  turnRecords,
} from './helpers/refusal-endpoint.js';

setDefaultTimeout(90_000);

const PROMPT = 'please summarize the local report';
const CYBER_DETAILS = {
  type: 'refusal',
  category: 'cyber',
  explanation: 'The requested operation crosses a safety boundary.',
  recommendedModel: 'claude-sonnet-5-5',
};

function refusalPayloads(
  run: Awaited<ReturnType<typeof runScriptedPrompt>>,
): Array<Record<string, unknown>> {
  return run.journalRecords
    .filter((record) => record['type'] === 'refusal')
    .map((record) => record['payload'] as Record<string, unknown>);
}

describe('Anthropic refusal diagnostics (REQ-4101-A1)', () => {
  it('persists stop details and the HTTP request id on refusal records', async () => {
    const run = await runScriptedPrompt(
      [
        {
          kind: 'finish',
          finishReason: 'refusal',
          outputTokens: 0,
          stopDetails: CYBER_DETAILS,
          requestId: 'anthropic-request-refused',
        },
        {
          ...stopReply('accepted after refusal'),
          requestId: 'anthropic-request-accepted',
        },
      ],
      [PROMPT],
      {
        protocol: 'anthropic',
        settings: {
          'refusal.retries': 1,
          'refusal.backoff-ms': 1,
          'refusal.rewrite': false,
        },
      },
    );

    const records = turnRecords(run.tokenRecords);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      refusal_category: 'cyber',
      refusal_explanation: CYBER_DETAILS.explanation,
      recommended_model: 'claude-sonnet-5-5',
      request_id: 'anthropic-request-refused',
    });
    expect(records[1]).toMatchObject({
      request_id: 'anthropic-request-accepted',
    });
    expect(records[1]).not.toHaveProperty('refusal_category');
    expect(records[1]).not.toHaveProperty('refusal_explanation');
    expect(records[1]).not.toHaveProperty('recommended_model');
    const acceptedHistory = run.historyAfter.filter(
      (content) => content.speaker === 'ai',
    );
    expect(
      acceptedHistory.every(
        (content) =>
          content.metadata?.requestId === undefined &&
          content.metadata?.stopDetails === undefined,
      ),
    ).toBe(true);

    expect(refusalPayloads(run)).toHaveLength(1);
    expect(refusalPayloads(run)[0]).toMatchObject({
      refusal_category: 'cyber',
      refusal_explanation: CYBER_DETAILS.explanation,
      recommended_model: 'claude-sonnet-5-5',
      request_id: 'anthropic-request-refused',
    });
    expect(
      run.events.filter(isNoticeEvent).map((event) => event.message),
    ).toContain(
      `Model claude-opus-5-5 refused the request; retrying in 1 ms (retry 1 of 1). Category: cyber. ${CYBER_DETAILS.explanation}`,
    );
  });

  it('retains explicit null details and preserves future category strings', async () => {
    const run = await runScriptedPrompt(
      [
        {
          kind: 'finish',
          finishReason: 'refusal',
          outputTokens: 0,
          stopDetails: { type: 'refusal', category: null, explanation: null },
          requestId: 'anthropic-request-null',
        },
        {
          kind: 'finish',
          finishReason: 'refusal',
          outputTokens: 0,
          stopDetails: {
            type: 'refusal',
            category: 'future_category',
            explanation: 'Future detail',
          },
          requestId: 'anthropic-request-future',
        },
      ],
      [PROMPT, PROMPT],
      { protocol: 'anthropic' },
    );

    const refusals = refusalPayloads(run);
    expect(refusals).toHaveLength(2);
    expect(refusals[0]).toMatchObject({
      refusal_category: null,
      refusal_explanation: null,
      request_id: 'anthropic-request-null',
    });
    expect(refusals[1]).toMatchObject({
      refusal_category: 'future_category',
      refusal_explanation: 'Future detail',
      request_id: 'anthropic-request-future',
    });
  });

  it('retains refusal diagnostics from the non-streaming Messages response', async () => {
    const run = await runScriptedPrompt(
      [
        {
          kind: 'finish',
          finishReason: 'refusal',
          outputTokens: 0,
          stopDetails: CYBER_DETAILS,
          requestId: 'anthropic-json-request',
        },
      ],
      [PROMPT],
      {
        protocol: 'anthropic',
        settings: {
          streaming: 'disabled',
          'refusal.retries': 0,
          'refusal.rewrite': false,
        },
      },
    );

    expect(run.requests[0]?.['stream']).toBe(false);
    expect(refusalPayloads(run)[0]).toMatchObject({
      refusal_category: 'cyber',
      refusal_explanation: CYBER_DETAILS.explanation,
      recommended_model: 'claude-sonnet-5-5',
      request_id: 'anthropic-json-request',
    });
  });

  it('keeps stop details when the terminal stream event has no usage', async () => {
    const run = await runScriptedPrompt(
      [
        {
          kind: 'finish',
          finishReason: 'refusal',
          outputTokens: 0,
          stopDetails: CYBER_DETAILS,
          requestId: 'anthropic-no-usage-request',
          includeUsage: false,
        },
      ],
      [PROMPT],
      {
        protocol: 'anthropic',
        settings: { 'refusal.retries': 0, 'refusal.rewrite': false },
      },
    );

    expect(refusalPayloads(run)[0]).toMatchObject({
      refusal_category: 'cyber',
      refusal_explanation: CYBER_DETAILS.explanation,
      request_id: 'anthropic-no-usage-request',
    });
  });

  it('records an HTTP request id for every successful Anthropic turn', async () => {
    const run = await runScriptedPrompt(
      [
        {
          ...stopReply('ordinary response'),
          requestId: 'anthropic-request-success',
        },
      ],
      [PROMPT],
      { protocol: 'anthropic' },
    );

    expect(turnRecords(run.tokenRecords)).toHaveLength(1);
    expect(turnRecords(run.tokenRecords)[0]).toMatchObject({
      request_id: 'anthropic-request-success',
    });
  });

  it('records null when an Anthropic response has no request-id header', async () => {
    const run = await runScriptedPrompt(
      [{ ...stopReply('ordinary response'), requestId: null }],
      [PROMPT],
      { protocol: 'anthropic' },
    );

    expect(turnRecords(run.tokenRecords)).toHaveLength(1);
    expect(turnRecords(run.tokenRecords)[0]).toHaveProperty('request_id', null);
  });
});
