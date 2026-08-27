/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { GenerateChatOptions } from '../IProvider.js';
import {
  claimRequestAuthRepair,
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

  it('grants the one-shot auth repair slot once per request across nested contexts', () => {
    const outer = createContext();
    // A nested orchestrator (e.g. an LB backend attempt) resolves its own
    // context object for the same live request; both must contend for the
    // single repair slot on the shared metadata record, not per-context.
    const nested = createContext(outer.options);

    expect(claimRequestAuthRepair(outer.options)).toBe(true);
    expect(claimRequestAuthRepair(nested.options)).toBe(false);
    expect(claimRequestAuthRepair(outer.options)).toBe(false);

    nested.releaseBudget();
    outer.releaseBudget();
  });

  it('re-arms the auth repair slot for a new request on released options', () => {
    const first = createContext();
    expect(claimRequestAuthRepair(first.options)).toBe(true);
    first.releaseBudget();

    // A new logical request resolving a fresh budget on the same options
    // (attachTransportAttemptBudget spreads the prior record) must not
    // inherit the previous request's consumed repair slot.
    const second = createContext(first.options);
    expect(claimRequestAuthRepair(second.options)).toBe(true);
    second.releaseBudget();
  });

  it('does not leak the auth repair slot into the next request', () => {
    const first = createContext();
    const second = createContext();

    expect(claimRequestAuthRepair(first.options)).toBe(true);
    expect(claimRequestAuthRepair(second.options)).toBe(true);

    second.releaseBudget();
    first.releaseBudget();
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

  it('tracks cumulative wait, visited targets, and credentials on one request (issue #2532)', () => {
    const context = createContext();

    context.recordWait(500);
    context.recordWait(250);
    context.recordTarget('provider-a');
    context.recordTarget('provider-a');
    context.recordTarget('provider-b');
    context.recordCredentialId('digest-1');
    context.recordCredentialId('digest-2');

    expect(context.totalWaitMs).toBe(750);
    expect(context.visitedTargets).toStrictEqual(['provider-a', 'provider-b']);
    expect(context.visitedCredentialCount).toBe(2);
    expect(context.deadlineRemainingMs).toBeUndefined();
  });

  it('tracks an optional request deadline from the retry-deadline-ms ephemeral', () => {
    const ephemerals: Record<string, unknown> = { 'retry-deadline-ms': 60_000 };
    const context = createContext({
      contents: [],
      invocation: { ephemerals } as GenerateChatOptions['invocation'],
    });

    const remaining = context.deadlineRemainingMs;
    expect(remaining).toBeDefined();
    expect(remaining as number).toBeGreaterThan(59_000);
    expect(remaining as number).toBeLessThanOrEqual(60_000);
  });

  it('shares recovery tracking with a nested context while the request budget is live', () => {
    const first = createContext();
    first.recordWait(100);
    first.recordTarget('provider-a');

    // Delegate-layer resolve on the same options (e.g. a load-balancer
    // backend attempt) reuses the live budget and must observe the same
    // recovery accounting record.
    const nested = createContext(first.options);
    nested.recordWait(50);

    expect(nested.totalWaitMs).toBe(150);
    expect(first.totalWaitMs).toBe(150);
    expect(nested.visitedTargets).toStrictEqual(['provider-a']);

    // After the budget is released the record belongs to a fresh logical
    // request, matching the commit-state reset semantics.
    nested.releaseBudget();
    first.releaseBudget();
    const reused = createContext(first.options);
    expect(reused.totalWaitMs).toBe(0);
    expect(reused.visitedTargets).toStrictEqual([]);
    reused.releaseBudget();
  });
});
