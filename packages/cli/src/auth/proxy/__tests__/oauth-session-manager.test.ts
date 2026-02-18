/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250214-CREDPROXY.P25
 * @plan:PLAN-20250214-CREDPROXY.P25
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { PKCESessionStore } from '../oauth-session-manager.js';

describe('PKCESessionStore', () => {
  const baseNow = new Date('2025-02-14T00:00:00.000Z').getTime();
  const peerA = { type: 'uid', uid: 1000 };
  const peerB = { type: 'uid', uid: 2000 };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseNow);
    delete process.env.LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS;
  });

  /**
   * @requirement R20.1
   * @scenario createSession returns a 32-character hex session ID
   */
  it('creates cryptographic-looking session IDs', () => {
    const store = new PKCESessionStore();
    const sessionId = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { f: 1 },
      peerA,
    );

    expect(sessionId).toMatch(/^[a-f0-9]{32}$/);
  });

  /**
   * @requirement R20.9
   * @scenario concurrent createSession calls produce independent unique IDs
   */
  it('creates unique IDs for independent concurrent sessions', () => {
    const store = new PKCESessionStore();
    const id1 = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { flow: 'a' },
      peerA,
    );
    const id2 = store.createSession(
      'gemini',
      'work',
      'device_code',
      { flow: 'b' },
      peerA,
    );

    expect(id1).not.toBe(id2);
  });

  /**
   * @requirement R20.1
   * @scenario createSession stores all required session fields
   */
  it('stores expected fields on createSession', () => {
    const store = new PKCESessionStore();
    const flowInstance = { providerFlow: true };
    const sessionId = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      flowInstance,
      peerA,
    );

    const session = store.getSession(sessionId, peerA);
    expect(session.sessionId).toBe(sessionId);
    expect(session.provider).toBe('anthropic');
    expect(session.bucket).toBe('default');
    expect(session.flowType).toBe('pkce_redirect');
    expect(session.flowInstance).toBe(flowInstance);
    expect(session.peerIdentity).toEqual(peerA);
    expect(session.createdAt).toBe(baseNow);
    expect(session.used).toBe(false);
  });

  /**
   * @requirement R20.1
   * @scenario getSession returns session data when valid and unused
   */
  it('returns session for valid getSession requests', () => {
    const store = new PKCESessionStore();
    const sessionId = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { f: 1 },
      peerA,
    );

    const session = store.getSession(sessionId, peerA);
    expect(session.sessionId).toBe(sessionId);
  });

  /**
   * @requirement R20.2
   * @scenario getSession throws SESSION_NOT_FOUND for unknown IDs
   */
  it('throws SESSION_NOT_FOUND for missing session IDs', () => {
    const store = new PKCESessionStore();

    expect(() =>
      store.getSession('deadbeefdeadbeefdeadbeefdeadbeef', peerA),
    ).toThrow('SESSION_NOT_FOUND');
  });

  /**
   * @requirement R20.2,R20.6
   * @scenario markUsed makes getSession throw SESSION_ALREADY_USED
   */
  it('throws SESSION_ALREADY_USED when session has been marked used', () => {
    const store = new PKCESessionStore();
    const id = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { f: 1 },
      peerA,
    );

    store.markUsed(id);

    expect(() => store.getSession(id, peerA)).toThrow('SESSION_ALREADY_USED');
  });

  /**
   * @requirement R20.3
   * @scenario getSession rejects mismatched peer identity uid
   */
  it('throws UNAUTHORIZED on peer identity mismatch', () => {
    const store = new PKCESessionStore();
    const id = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { f: 1 },
      peerA,
    );

    expect(() => store.getSession(id, peerB)).toThrow('UNAUTHORIZED');
    expect(() => store.getSession(id, peerB)).toThrow(
      'Session peer identity mismatch',
    );
  });

  /**
   * @requirement R20.3
   * @scenario getSession succeeds when peer identity matches creator
   */
  it('allows getSession when peer identity uid matches', () => {
    const store = new PKCESessionStore();
    const id = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { f: 1 },
      peerA,
    );

    const session = store.getSession(id, { type: 'uid', uid: 1000 });
    expect(session.sessionId).toBe(id);
  });

  /**
   * @requirement R20.4,R20.5
   * @scenario expired sessions are deleted and throw SESSION_EXPIRED
   */
  it('expires sessions based on timeout and removes them', () => {
    const store = new PKCESessionStore();
    const id = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { f: 1 },
      peerA,
    );

    vi.advanceTimersByTime(600_001);

    expect(() => store.getSession(id, peerA)).toThrow('SESSION_EXPIRED');
    expect(() => store.getSession(id, peerA)).toThrow('SESSION_NOT_FOUND');
  });

  /**
   * @requirement R20.8
   * @scenario removeSession aborts abortController then removes session
   */
  it('removeSession aborts controller and deletes the session', () => {
    const store = new PKCESessionStore();
    const id = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { f: 1 },
      peerA,
    );
    const session = store.getSession(id, peerA);
    session.abortController = new AbortController();

    store.removeSession(id);

    expect(session.abortController.signal.aborted).toBe(true);
    expect(() => store.getSession(id, peerA)).toThrow('SESSION_NOT_FOUND');
  });

  /**
   * @requirement R20.8
   * @scenario removeSession is a no-op for unknown session IDs
   */
  it('removeSession no-ops for unknown IDs', () => {
    const store = new PKCESessionStore();

    store.removeSession('ffffffffffffffffffffffffffffffff');

    const id = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { f: 1 },
      peerA,
    );
    const session = store.getSession(id, peerA);
    expect(session.sessionId).toBe(id);
  });

  /**
   * @requirement R20.7
   * @scenario sweepExpired removes used and expired sessions while keeping active sessions
   */
  it('sweepExpired removes only used/expired sessions', () => {
    const store = new PKCESessionStore();
    const activeId = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { a: 1 },
      peerA,
    );
    const usedId = store.createSession(
      'gemini',
      'default',
      'device_code',
      { b: 1 },
      peerA,
    );
    const expiringId = store.createSession(
      'qwen',
      'default',
      'device_code',
      { c: 1 },
      peerA,
    );

    store.markUsed(usedId);
    vi.advanceTimersByTime(600_001);
    store.sweepExpired();

    expect(() => store.getSession(usedId, peerA)).toThrow('SESSION_NOT_FOUND');
    expect(() => store.getSession(expiringId, peerA)).toThrow(
      'SESSION_NOT_FOUND',
    );
    expect(() => store.getSession(activeId, peerA)).toThrow(
      'SESSION_NOT_FOUND',
    );
  });

  /**
   * @requirement R20.7,R20.8
   * @scenario sweepExpired aborts controllers for swept sessions
   */
  it('sweepExpired aborts controllers for removed sessions', () => {
    const store = new PKCESessionStore();
    const id = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { f: 1 },
      peerA,
    );
    const session = store.getSession(id, peerA);
    session.abortController = new AbortController();

    store.markUsed(id);
    store.sweepExpired();

    expect(session.abortController.signal.aborted).toBe(true);
    expect(() => store.getSession(id, peerA)).toThrow('SESSION_NOT_FOUND');
  });

  /**
   * @requirement R20.4
   * @scenario env timeout override applies LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS
   */
  it('uses LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS when provided', () => {
    process.env.LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS = '300';
    const store = new PKCESessionStore();
    const id = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { f: 1 },
      peerA,
    );

    vi.advanceTimersByTime(300_001);

    expect(() => store.getSession(id, peerA)).toThrow('SESSION_EXPIRED');
  });

  /**
   * @requirement R20.7
   * @scenario startGC triggers periodic sweep on 60s interval
   */
  it('startGC uses a 60-second interval to trigger cleanup', () => {
    const store = new PKCESessionStore(1);
    const id = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { f: 1 },
      peerA,
    );

    store.startGC();
    vi.advanceTimersByTime(60_001);

    expect(() => store.getSession(id, peerA)).toThrow('SESSION_NOT_FOUND');
  });

  /**
   * @requirement R20.8
   * @scenario clearAll aborts all controllers and removes all sessions
   */
  it('clearAll aborts all controllers and clears sessions', () => {
    const store = new PKCESessionStore();
    const id1 = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { a: 1 },
      peerA,
    );
    const id2 = store.createSession(
      'gemini',
      'work',
      'device_code',
      { b: 1 },
      peerA,
    );
    const s1 = store.getSession(id1, peerA);
    const s2 = store.getSession(id2, peerA);
    s1.abortController = new AbortController();
    s2.abortController = new AbortController();

    store.clearAll();

    expect(s1.abortController.signal.aborted).toBe(true);
    expect(s2.abortController.signal.aborted).toBe(true);
    expect(() => store.getSession(id1, peerA)).toThrow('SESSION_NOT_FOUND');
    expect(() => store.getSession(id2, peerA)).toThrow('SESSION_NOT_FOUND');
  });

  /**
   * @requirement R20.7,R20.8
   * @scenario clearAll also clears active GC interval to prevent future sweeps
   */
  it('clearAll stops future GC interval sweeps', () => {
    const store = new PKCESessionStore(1);
    const id = store.createSession(
      'anthropic',
      'default',
      'pkce_redirect',
      { a: 1 },
      peerA,
    );

    store.startGC();
    store.clearAll();

    vi.advanceTimersByTime(120_000);

    expect(() => store.getSession(id, peerA)).toThrow('SESSION_NOT_FOUND');
  });
});
