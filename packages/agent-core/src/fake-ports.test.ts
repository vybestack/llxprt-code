/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  FakeClock,
  MemorySessionStore,
  MemoryTools,
  ScriptedDecisions,
  ScriptedModel,
} from './testing/fake-ports.js';

describe('agent-core fake ports', () => {
  it('routes model and decision operations and exposes tool revocation state', async () => {
    let modelResolved = false;
    const model = new ScriptedModel(async () => {
      modelResolved = true;
      throw new Error('model resolver reached');
    });
    await expect(
      model.resolve(
        { provider: 'p', model: 'm' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('model resolver reached');
    expect(modelResolved).toBe(true);

    let decisionResolved = false;
    const decisions = new ScriptedDecisions(async () => {
      decisionResolved = true;
      throw new Error('decision resolver reached');
    });
    await expect(
      decisions.decide(
        { id: 'r', from: 'a', turn: 't', kind: 'question', prompt: '?' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('decision resolver reached');
    expect(decisionResolved).toBe(true);

    const tools = new MemoryTools([]);
    const pinned = await tools.pin([], new AbortController().signal);
    expect(pinned.tools).toStrictEqual([]);
    expect(pinned.revoked.aborted).toBe(false);
    tools.revoke();
    expect(pinned.revoked.aborted).toBe(true);
  });

  it('exercises fake port state transitions and abort handling', async () => {
    const controller = new AbortController();
    const clock = new FakeClock(10);
    await clock.sleep(5, controller.signal);
    expect(clock.now()).toBe(15);
    controller.abort(new Error('cancelled'));
    await expect(clock.sleep(1, controller.signal)).rejects.toThrow(
      'cancelled',
    );
    await expect(
      new MemoryTools([]).pin([], controller.signal),
    ).rejects.toThrow('cancelled');
    await expect(
      new MemorySessionStore().load('session', controller.signal),
    ).rejects.toThrow('cancelled');
    expect(() =>
      new ScriptedModel(async (_ref, signal) => {
        signal.throwIfAborted();
        throw new Error('resolver invoked');
      }).resolve({ provider: 'p', model: 'm' }, controller.signal),
    ).toThrow('cancelled');
    expect(() =>
      new ScriptedDecisions(async (_request, signal) => {
        signal.throwIfAborted();
        throw new Error('resolver invoked');
      }).decide(
        { id: 'r', from: 'a', turn: 't', kind: 'question', prompt: '?' },
        controller.signal,
      ),
    ).toThrow('cancelled');
  });
});
