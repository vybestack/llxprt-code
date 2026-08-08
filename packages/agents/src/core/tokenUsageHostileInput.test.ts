/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3130: telemetry must be observationally inert.
 *
 * Request-shape measurement runs on the request path, before every send, over
 * tool schemas, tool arguments and tool result bodies. Those are third-party
 * data and can be cyclic or otherwise hostile to JSON serialization. A throw
 * here would abort a real conversation to satisfy telemetry, so this pins that
 * it cannot happen.
 */

import { describe, it, expect } from 'bun:test';
import { computeRequestShape } from './tokenUsageRequestShape.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

interface Cyclic {
  name: string;
  self?: Cyclic;
}

function cyclicValue(): Cyclic {
  const value: Cyclic = { name: 'loop' };
  value.self = value;
  return value;
}

const countTokens = (text: string): number => text.length;

describe('request-shape measurement over hostile input (issue #3130)', () => {
  it('survives a cyclic tool result instead of aborting the send', () => {
    const contents: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 't',
            result: cyclicValue(),
          },
        ],
      },
    ];

    const result = computeRequestShape({
      requestContents: contents,
      tools: undefined,
      instructionsText: undefined,
      countTokens,
      previouslySentCallIds: new Set<string>(),
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].callId).toBe('c1');
  });

  it('survives cyclic tool-call parameters', () => {
    const contents: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'c1',
            name: 'search',
            parameters: cyclicValue(),
          },
        ],
      },
    ];

    const result = computeRequestShape({
      requestContents: contents,
      tools: undefined,
      instructionsText: undefined,
      countTokens,
      previouslySentCallIds: new Set<string>(),
    });

    expect(result.historyTokens).toBeGreaterThan(0);
  });

  it('survives a cyclic tool schema when fingerprinting', () => {
    const result = computeRequestShape({
      requestContents: [],
      tools: cyclicValue(),
      instructionsText: undefined,
      countTokens,
      previouslySentCallIds: new Set<string>(),
    });

    expect(result.prefixFingerprint).toMatch(/^[0-9a-f]+$/);
  });

  it('never writes the cyclic body into the measured output', () => {
    const contents: IContent[] = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c1',
            toolName: 't',
            result: cyclicValue(),
          },
        ],
      },
    ];

    const result = computeRequestShape({
      requestContents: contents,
      tools: undefined,
      instructionsText: undefined,
      countTokens,
      previouslySentCallIds: new Set<string>(),
    });

    expect(JSON.stringify(result)).not.toContain('loop');
  });
});
