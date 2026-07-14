/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  JsonFormatter,
  JsonStreamEventType,
  StreamJsonFormatter,
  type MessageEvent,
} from './output-format.js';

describe('JsonFormatter', () => {
  it('preserves safe machine-readable provider classification', () => {
    const formatter = new JsonFormatter();
    const error: Error & {
      status?: number;
      category?: string;
      reason?: string;
    } = new Error('retry budget exhausted');
    error.status = 429;
    error.category = 'rate_limit';
    error.reason = 'retries_exhausted';

    expect(JSON.parse(formatter.formatError(error))).toStrictEqual({
      error: {
        type: 'Error',
        message: 'retry budget exhausted',
        status: 429,
        category: 'rate_limit',
        reason: 'retries_exhausted',
      },
    });
  });
});

describe('StreamJsonFormatter', () => {
  it('serializes status, category, and terminal reason on error events', () => {
    const formatter = new StreamJsonFormatter();
    const formatted = formatter.formatEvent({
      type: JsonStreamEventType.ERROR,
      timestamp: '2026-06-26T00:00:00.000Z',
      severity: 'error',
      message: 'retry budget exhausted',
      status: 429,
      category: 'rate_limit',
      reason: 'retries_exhausted',
    });

    expect(JSON.parse(formatted)).toMatchObject({
      status: 429,
      category: 'rate_limit',
      reason: 'retries_exhausted',
    });
  });
  it('emits newline-delimited JSON records with escaped content newlines', () => {
    const formatter = new StreamJsonFormatter();
    const event: MessageEvent = {
      type: JsonStreamEventType.MESSAGE,
      timestamp: '2026-06-26T00:00:00.000Z',
      role: 'assistant',
      content: '## LLXPRT2208_ALPHA\n\nAlpha paragraph one.',
      delta: true,
    };

    const formatted = formatter.formatEvent(event);

    expect(formatted.endsWith('\n')).toBe(true);
    expect(formatted.endsWith('\\n')).toBe(false);
    expect(formatted.split('\n')).toHaveLength(2);
    expect(JSON.parse(formatted.trimEnd())).toStrictEqual(event);

    const newlineOnlyEvent: MessageEvent = {
      type: JsonStreamEventType.MESSAGE,
      timestamp: '2026-06-26T00:00:00.000Z',
      role: 'assistant',
      content: '\n\n',
      delta: true,
    };
    const newlineFormatted = formatter.formatEvent(newlineOnlyEvent);

    expect(newlineFormatted.split('\n')).toHaveLength(2);
    expect(JSON.parse(newlineFormatted.trimEnd())).toStrictEqual(
      newlineOnlyEvent,
    );
  });
});
