/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { createProducerIdentity, type JspBootstrap } from './jspSchema.js';
import {
  initProducerState,
  applyTransition,
  buildSnapshot,
  type JspNativeSession,
} from './jspProducerState.js';

const bootstrap: JspBootstrap = {
  schema: 1,
  protocol: 'jsp/1',
  endpoint: 'http://127.0.0.1:9123/jsp/1',
  registrationId: 'reg-abc',
  publisherCredential: 'pub-secret-xyz',
  agentId: 'agent-alex',
  lifecycleGeneration: 7,
};

const nativeSession: JspNativeSession = {
  repository: 'vybestack/llxprt-code',
  path: '/Users/dev/src/llxprt-code',
  agent_kind: 'llxprt',
  pid: 12345,
  display_name: 'main-worker',
};

function makeIdentity(now = 1_000_000) {
  return createProducerIdentity(bootstrap, () => now);
}

describe('createProducerIdentity', () => {
  it('creates a fresh source epoch per call', () => {
    const a = createProducerIdentity(bootstrap, () => 1000);
    const b = createProducerIdentity(bootstrap, () => 1001);
    expect(a.sourceEpoch).not.toBe(b.sourceEpoch);
    expect(a.agentId).toBe('agent-alex');
    expect(a.lifecycleGeneration).toBe(7);
  });

  it('uses safe-ascii epoch of bounded length', () => {
    const id = makeIdentity();
    expect(id.sourceEpoch).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(id.sourceEpoch.length).toBeLessThanOrEqual(128);
    expect(id.sourceEpoch.length).toBeGreaterThanOrEqual(1);
  });

  it('takes its agent identity from the bootstrap rather than inventing one', () => {
    const id = makeIdentity();
    expect(id.agentId).toBe(bootstrap.agentId);
    expect(id.startedAtMs).toBe(1_000_000);
  });
});

describe('initProducerState', () => {
  it('starts with sequence zero and idle activity', () => {
    const id = makeIdentity();
    const state = initProducerState(id, nativeSession);
    expect(state.sourceSequence).toBe(0);
    expect(state.activity).toBe('idle');
    expect(state.wait).toBeNull();
    expect(state.currentTurn).toBeNull();
    expect(state.todos).toBeNull();
    expect(state.lastMessage).toBeNull();
    expect(state.lastTool).toBeNull();
  });
});

describe('turn lifecycle', () => {
  it('turn.started sets activity to thinking and anchors elapsed at zero', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(state, { type: 'turn.started' }, () => 200);
    expect(state.activity).toBe('thinking');
    expect(state.currentTurn).toStrictEqual({ startedAtMs: 200 });
  });

  it('turn.ended completed sets activity idle and clears turn', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(state, { type: 'turn.started' }, () => 200);
    state = applyTransition(
      state,
      { type: 'turn.ended', outcome: 'completed' },
      () => 5000,
    );
    expect(state.activity).toBe('idle');
    expect(state.currentTurn).toBeNull();
  });

  it('turn.ended failed sets activity idle', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(state, { type: 'turn.started' }, () => 200);
    state = applyTransition(
      state,
      { type: 'turn.ended', outcome: 'failed' },
      () => 5000,
    );
    expect(state.activity).toBe('idle');
  });

  it('turn.ended cancelled sets activity idle', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(state, { type: 'turn.started' }, () => 200);
    state = applyTransition(
      state,
      { type: 'turn.ended', outcome: 'cancelled' },
      () => 5000,
    );
    expect(state.activity).toBe('idle');
  });
});

describe('activity and wait transitions', () => {
  it('activity.changed sets native activity', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(
      state,
      { type: 'activity.changed', state: 'acting' },
      () => 200,
    );
    expect(state.activity).toBe('acting');
  });

  it('wait.opened sets the wait reason', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(
      state,
      { type: 'wait.opened', reason: 'permission' },
      () => 200,
    );
    expect(state.wait).toStrictEqual({ reason: 'permission' });
  });

  it('wait.resolved clears the wait', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(
      state,
      { type: 'wait.opened', reason: 'question' },
      () => 200,
    );
    state = applyTransition(state, { type: 'wait.resolved' }, () => 300);
    expect(state.wait).toBeNull();
  });
});

describe('todos', () => {
  it('todos.replaced sets the full list with positive revision', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(
      state,
      {
        type: 'todos.replaced',
        revision: 1,
        items: [{ text: 'Do thing', completed: false }],
      },
      () => 200,
    );
    expect(state.todos).toStrictEqual({
      revision: 1,
      items: [{ text: 'Do thing', completed: false }],
    });
  });

  it('ignores a stale revision (lower or equal)', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(
      state,
      { type: 'todos.replaced', revision: 2, items: [] },
      () => 200,
    );
    state = applyTransition(
      state,
      {
        type: 'todos.replaced',
        revision: 1,
        items: [{ text: 'old', completed: true }],
      },
      () => 300,
    );
    expect(state.todos).toStrictEqual({ revision: 2, items: [] });
  });
});

describe('tool calls', () => {
  it('tool_call.created sets the last tool by creation order', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(
      state,
      { type: 'tool_call.created', label: 'read_file', phase: 'proposed' },
      () => 200,
    );
    expect(state.lastTool).toStrictEqual({
      label: 'read_file',
      phase: 'proposed',
    });
  });

  it('tool_call.phase_changed updates the phase when the label is the headline tool', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(
      state,
      { type: 'tool_call.created', label: 'read_file', phase: 'proposed' },
      () => 200,
    );
    const created = state.sourceSequence;
    state = applyTransition(
      state,
      {
        type: 'tool_call.phase_changed',
        label: 'read_file',
        phase: 'succeeded',
      },
      () => 300,
    );
    expect(state.lastTool).toStrictEqual({
      label: 'read_file',
      phase: 'succeeded',
    });
    expect(state.sourceSequence).toBe(created + 1);
  });

  it('tool_call.phase_changed for a superseded tool neither updates nor advances the sequence', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(
      state,
      { type: 'tool_call.created', label: 'read_file', phase: 'proposed' },
      () => 200,
    );
    state = applyTransition(
      state,
      { type: 'tool_call.created', label: 'run_shell', phase: 'scheduled' },
      () => 300,
    );
    const beforeSequence = state.sourceSequence;
    state = applyTransition(
      state,
      {
        type: 'tool_call.phase_changed',
        label: 'read_file',
        phase: 'succeeded',
      },
      () => 400,
    );
    expect(state.lastTool).toStrictEqual({
      label: 'run_shell',
      phase: 'scheduled',
    });
    expect(state.sourceSequence).toBe(beforeSequence);
  });
});

describe('assistant message commit boundary', () => {
  it('assistant_message.displayed sets last message only at commit', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(
      state,
      {
        type: 'assistant_message.displayed',
        content: 'Done.',
        committedMs: 9999,
      },
      () => 200,
    );
    expect(state.lastMessage).toStrictEqual({
      content: 'Done.',
      committedMs: 9999,
    });
  });
});

describe('monotonic ordering', () => {
  it('increments source_sequence by exactly one per event', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    expect(state.sourceSequence).toBe(0);
    state = applyTransition(state, { type: 'turn.started' }, () => 200);
    expect(state.sourceSequence).toBe(1);
    state = applyTransition(
      state,
      { type: 'activity.changed', state: 'acting' },
      () => 300,
    );
    expect(state.sourceSequence).toBe(2);
  });

  it('derives snapshot cursor from source_sequence so they cannot drift', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(state, { type: 'turn.started' }, () => 200);
    state = applyTransition(
      state,
      { type: 'activity.changed', state: 'acting' },
      () => 300,
    );
    const snap = buildSnapshot(state, () => 400);
    expect(snap.cursor).toBe(snap.source_sequence);
  });
});

describe('session ended', () => {
  it('produces a genuinely terminal snapshot: no turn, no wait, idle activity', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(state, { type: 'turn.started' }, () => 200);
    state = applyTransition(
      state,
      { type: 'wait.opened', reason: 'permission' },
      () => 300,
    );
    state = applyTransition(state, { type: 'session.ended' }, () => 10_000);
    // The session is terminal, so a snapshot taken long after the turn started
    // must not report a growing elapsed_ms or a pending wait.
    const snap = buildSnapshot(state, () => 100_000);
    expect(snap.current_turn).toMatchObject({
      availability: 'known',
      value: null,
    });
    expect(snap.current_wait).toMatchObject({
      availability: 'known',
      value: null,
    });
    expect(snap.native_activity).toMatchObject({
      availability: 'known',
      value: { state: 'idle' },
    });
    expect(snap.source_terminal_state).toMatchObject({
      availability: 'known',
      value: { code: 'SESSION_ENDED' },
    });
  });
});

describe('buildSnapshot', () => {
  it('produces a valid current snapshot reflecting all effects through cursor', () => {
    const id = makeIdentity();
    let state = initProducerState(id, nativeSession);
    state = applyTransition(state, { type: 'turn.started' }, () => 200);
    state = applyTransition(
      state,
      {
        type: 'todos.replaced',
        revision: 1,
        items: [{ text: 'x', completed: false }],
      },
      () => 300,
    );
    const snap = buildSnapshot(state, () => 400);
    expect(snap.schema).toBe(1);
    expect(snap.kind).toBe('snapshot');
    expect(snap.agent_id).toBe('agent-alex');
    expect(snap.lifecycle_generation).toBe(7);
    expect(snap.source_sequence).toBe(2);
    expect(snap.cursor).toBe(2);
    expect(snap.bridge_observed_ms).toBe(400);
    expect(snap.native_activity).toMatchObject({
      availability: 'known',
      value: { state: 'thinking' },
    });
    expect(snap.todos).toMatchObject({
      availability: 'known',
      value: { revision: 1 },
    });
    expect(snap.current_turn).toMatchObject({
      availability: 'known',
      value: { elapsed_ms: 200 },
    });
  });
});
