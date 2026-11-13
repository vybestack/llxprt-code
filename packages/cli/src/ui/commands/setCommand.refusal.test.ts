/*
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036: `/set` validates the five refusal recovery settings before they
 * are stored. The command runs against an in-memory settings store, so the
 * assertions are on the message the user sees and on what was stored.
 */

import { describe, expect, it } from 'bun:test';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createSetCommand } from './setCommand.js';

function setup() {
  const stored = new Map<string, unknown>();
  const command = createSetCommand({
    getEphemeralSettings: () => Object.fromEntries(stored),
    setEphemeralSetting: (key, value) => {
      if (value === undefined) stored.delete(key);
      else stored.set(key, value);
    },
    getActiveModelParams: () => ({}),
    setActiveModelParam: () => {},
    clearActiveModelParam: () => {},
    isFuzzyFilteringEnabled: () => true,
  });
  const context = createMockCommandContext({});
  const run = async (args: string) => {
    const result = await command.action!(context, args);
    return result !== undefined && result.type === 'message'
      ? { type: result.messageType, text: result.content }
      : undefined;
  };
  return { stored, run };
}

describe('/set refusal settings (issue #4036)', () => {
  it.each([
    ['refusal.retries -1', 'refusal.retries must be an integer from 0 to 10'],
    ['refusal.retries 11', 'refusal.retries must be an integer from 0 to 10'],
    ['refusal.retries 1.5', 'refusal.retries must be an integer from 0 to 10'],
    [
      'refusal.backoff-ms -100',
      'refusal.backoff-ms must be a non-negative integer',
    ],
    [
      'refusal.max-rewrites 4',
      'refusal.max-rewrites must be an integer from 0 to 3',
    ],
    [
      'refusal.rewrite maybe',
      "refusal.rewrite must be either 'true' or 'false'",
    ],
  ])(
    'rejects "/set %s" with a message and stores nothing',
    async (args, message) => {
      const { stored, run } = setup();

      const result = await run(args);

      expect(result?.type).toBe('error');
      expect(result?.text).toContain(message);
      expect(stored.size).toBe(0);
    },
  );

  it('stores valid values as typed numbers and booleans', async () => {
    const { stored, run } = setup();

    await run('refusal.retries 4');
    await run('refusal.backoff-ms 2000');
    await run('refusal.rewrite false');
    await run('refusal.max-rewrites 2');
    await run('refusal.review-profile sonnet-reviewer');

    expect(Object.fromEntries(stored)).toStrictEqual({
      'refusal.retries': 4,
      'refusal.backoff-ms': 2000,
      'refusal.rewrite': false,
      'refusal.max-rewrites': 2,
      'refusal.review-profile': 'sonnet-reviewer',
    });
  });
});
