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
import {
  STRUCTURED_ERROR_CATEGORIES,
  STRUCTURED_ERROR_REASONS,
} from '../core/turn.js';

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

  it('accepts every canonical structured category and reason', () => {
    for (const category of STRUCTURED_ERROR_CATEGORIES) {
      const formatted = JSON.parse(
        new JsonFormatter().formatError(
          Object.assign(new Error(category), { category }),
        ),
      );
      expect(formatted.error.category).toBe(category);
    }
    for (const reason of STRUCTURED_ERROR_REASONS) {
      const formatted = JSON.parse(
        new JsonFormatter().formatError(
          Object.assign(new Error(reason), { reason }),
        ),
      );
      expect(formatted.error.reason).toBe(reason);
    }
  });

  it('omits unrecognized machine-readable provider classification', () => {
    const formatter = new JsonFormatter();
    const error: Error & { category?: string; reason?: string } = new Error(
      'provider failed',
    );
    error.category = 'future_category';
    error.reason = 'future_reason';

    expect(JSON.parse(formatter.formatError(error))).toStrictEqual({
      error: {
        type: 'Error',
        message: 'provider failed',
      },
    });
  });

  it.each([
    {
      category: 'rate_limit',
      reason: 'future_reason',
      expected: { category: 'rate_limit' },
    },
    {
      category: 'future_category',
      reason: 'retries_exhausted',
      expected: { reason: 'retries_exhausted' },
    },
  ])(
    'preserves recognized fields independently for $category and $reason',
    ({ category, reason, expected }) => {
      const error: Error & { category?: string; reason?: string } = new Error(
        'provider failed',
      );
      error.category = category;
      error.reason = reason;

      expect(
        JSON.parse(new JsonFormatter().formatError(error)).error,
      ).toStrictEqual({
        type: 'Error',
        message: 'provider failed',
        ...expected,
      });
    },
  );
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
