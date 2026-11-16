/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Serializing the return value runs guest code (getters, Proxy traps). A tool
 * call started there was never awaited, so the run fails with
 * UNAWAITED_TOOL_CALLS whatever the host's response timing (issue #4084).
 * Real wrapper subprocess and real QuickJS.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  assertNoLiveWrappers,
  heldInvoker,
  runScript,
} from './__tests__/runtime-test-helpers.js';
import type { ScriptCall, ScriptInvoker } from './runtime-contract.js';

function promptInvoker(): {
  readonly invoke: ScriptInvoker;
  readonly calls: ScriptCall[];
} {
  const calls: ScriptCall[] = [];
  return {
    calls,
    invoke: async (call) => {
      calls.push(call);
      return { ok: true, value: 'answered', completeness: 'complete' };
    },
  };
}

const RETURNS_STARTING_A_CALL: ReadonlyArray<readonly [string, string]> = [
  ['a getter', 'return { get x() { tools.echo({ v: 1 }); return 1; } };'],
  [
    'a getter that catches the refusal',
    'return { get x() { try { tools.echo({ v: 1 }); } catch {} return 1; } };',
  ],
  [
    'a getter named toJSON',
    'return { get toJSON() { tools.echo({ v: 1 }); return 1; } };',
  ],
  [
    'a Proxy ownKeys trap',
    'return new Proxy({}, { ownKeys() { tools.echo({ v: 1 }); return []; } });',
  ],
];

/**
 * Returning from an async function looks up `then` on the value before the
 * run completes, so this trap starts its call while the script is still
 * running: an ordinary unawaited call, cancelled and joined.
 */
const PROXY_GET_TRAP =
  'return new Proxy({ a: 1 }, { get(target, key) { tools.echo({ v: 1 }); return target[key]; } });';

describe('QuickJsProcessRuntime final value serialization', () => {
  afterEach(() => {
    assertNoLiveWrappers();
  });

  for (const [label, source] of RETURNS_STARTING_A_CALL) {
    it(`fails with UNAWAITED_TOOL_CALLS when ${label} starts a call, with a prompt host`, async () => {
      const host = promptInvoker();
      const result = await runScript(source, { invoke: host.invoke });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'UNAWAITED_TOOL_CALLS' },
      });
      expect(host.calls).toHaveLength(0);
    });

    it(`fails with UNAWAITED_TOOL_CALLS when ${label} starts a call, with a held host`, async () => {
      const held = heldInvoker();
      const result = await runScript(source, { invoke: held.invoke });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'UNAWAITED_TOOL_CALLS' },
      });
      expect(held.calls).toHaveLength(0);
    });
  }

  it('fails with UNAWAITED_TOOL_CALLS and joins the call a Proxy get trap starts on return', async () => {
    const held = heldInvoker();
    const result = await runScript(PROXY_GET_TRAP, { invoke: held.invoke });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'UNAWAITED_TOOL_CALLS' },
    });
    expect(held.calls.length).toBeGreaterThan(0);
    expect(held.calls.every((call) => call.signal.aborted)).toBe(true);
    expect(held.settled.size).toBe(held.calls.length);
  });

  it('still serializes getters and proxies that start no call', async () => {
    const result = await runScript(
      'const done = await tools.echo({ v: 1 }); return { get x() { return done.ok; }, y: new Proxy({ a: 2 }, {}) };',
    );

    expect(result).toStrictEqual({
      ok: true,
      value: { x: true, y: { a: 2 } },
      callCount: 1,
      logs: [],
    });
  });
});
