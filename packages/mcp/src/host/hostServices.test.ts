/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  defaultHostServices,
  deliverHostFeedback,
  MCP_CLIENT_UPDATE_EVENT,
} from './hostServices.js';

describe('MCP host ports', () => {
  it('forwards feedback with the exact original argument count', () => {
    const calls: unknown[][] = [];
    const sink = (...args: unknown[]): void => {
      calls.push(args);
    };
    const failure = new Error('failure');
    deliverHostFeedback(sink, 'info', 'two arguments');
    deliverHostFeedback(sink, 'error', 'three arguments', failure);
    expect(calls).toStrictEqual([
      ['info', 'two arguments'],
      ['error', 'three arguments', failure],
    ]);
  });

  it('does not let advisory feedback failure interrupt MCP work', () => {
    expect(() =>
      deliverHostFeedback(
        () => {
          throw new Error('sink failed');
        },
        'warning',
        'advisory',
      ),
    ).not.toThrow();
  });

  it('leaves standalone browser authorization available for manual paste', async () => {
    const failure = await defaultHostServices
      .openBrowser('https://example.test/oauth?code_challenge=sensitive')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain(
      'No browser launcher registered by the host',
    );
    expect(String(failure)).not.toContain('sensitive');
    expect(() =>
      defaultHostServices.emitFeedback('info', 'standalone'),
    ).not.toThrow();
  });

  it('keeps the MCP update event identity', () => {
    expect(MCP_CLIENT_UPDATE_EVENT).toBe('mcp-client-update');
  });
});
