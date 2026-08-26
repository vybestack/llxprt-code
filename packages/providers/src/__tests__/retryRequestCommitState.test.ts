/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { GenerateChatOptions } from '../IProvider.js';
import {
  getRequestCommitState,
  markRequestCommitted,
  markTerminalSeen,
  resolveRetryRequestContext,
} from '../retryRequestContext.js';
import { tryConsumeTransportAttempt } from '../transportAttemptBudget.js';

const defaults = {
  maxAttempts: 2,
  initialDelayMs: 25,
  authRetryTimeoutMs: 500,
};

function createContext(options: GenerateChatOptions = { contents: [] }) {
  return resolveRetryRequestContext(options, defaults);
}

describe('retry request commit state', () => {
  it('starts uncommitted with no exposure or terminal event', () => {
    const context = createContext();

    expect({
      committed: context.committed,
      exposure: context.exposure,
      terminalSeen: context.terminalSeen,
    }).toStrictEqual({
      committed: false,
      exposure: 'none',
      terminalSeen: false,
    });
    expect(getRequestCommitState(context)).toStrictEqual({
      committed: false,
      exposure: 'none',
      terminalSeen: false,
    });
  });

  it('allows an idempotent metadata commitment', () => {
    const context = createContext();

    markRequestCommitted(context, 'metadata');
    markRequestCommitted(context, 'metadata');

    expect(getRequestCommitState(context)).toStrictEqual({
      committed: true,
      exposure: 'metadata',
      terminalSeen: false,
    });
  });

  it('upgrades exposure from metadata to content', () => {
    const context = createContext();

    markRequestCommitted(context, 'metadata');
    markRequestCommitted(context, 'content');

    expect(getRequestCommitState(context).exposure).toBe('content');
  });

  it('does not downgrade exposure from content to metadata', () => {
    const context = createContext();

    markRequestCommitted(context, 'content');
    markRequestCommitted(context, 'metadata');

    expect(getRequestCommitState(context)).toMatchObject({
      committed: true,
      exposure: 'content',
    });
  });

  it('keeps commitment irreversible when re-marked with no exposure', () => {
    const context = createContext();

    markRequestCommitted(context, 'tool_call');
    markRequestCommitted(context, 'none');

    expect(getRequestCommitState(context)).toMatchObject({
      committed: true,
      exposure: 'tool_call',
    });
  });

  it('records a terminal protocol event', () => {
    const context = createContext();

    markTerminalSeen(context);

    expect(getRequestCommitState(context).terminalSeen).toBe(true);
  });

  it('keeps independently resolved request states isolated', () => {
    const first = createContext();
    const second = createContext();

    markRequestCommitted(first, 'content');
    markTerminalSeen(first);

    expect(getRequestCommitState(first)).toStrictEqual({
      committed: true,
      exposure: 'content',
      terminalSeen: true,
    });
    expect(getRequestCommitState(second)).toStrictEqual({
      committed: false,
      exposure: 'none',
      terminalSeen: false,
    });
  });

  it('shares commit state with a nested context on the same request options', () => {
    const outer = createContext();
    const nested = createContext(outer.options);

    markRequestCommitted(nested, 'metadata');

    expect(getRequestCommitState(outer)).toStrictEqual({
      committed: true,
      exposure: 'metadata',
      terminalSeen: false,
    });
    nested.releaseBudget();
    outer.releaseBudget();
  });

  it('retains transport budget release semantics', () => {
    const first = createContext();
    const nested = createContext(first.options);

    expect(nested.budget).toBe(first.budget);
    expect(tryConsumeTransportAttempt(first.options)).toBe(true);
    expect(nested.budget.used).toBe(1);

    nested.releaseBudget();
    first.releaseBudget();
    const reused = createContext(first.options);

    expect(reused.budget).not.toBe(first.budget);
    expect(reused.budget.used).toBe(0);
    expect(getRequestCommitState(reused)).toStrictEqual({
      committed: false,
      exposure: 'none',
      terminalSeen: false,
    });
    reused.releaseBudget();
  });
});
