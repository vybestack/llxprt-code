/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  JsonStreamEventType,
  StreamJsonFormatter,
  type MessageEvent,
} from './output-format.js';

describe('StreamJsonFormatter', () => {
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
