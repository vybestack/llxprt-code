/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import {
  heldInvoker,
  assertNoLiveWrappers,
  liveWrapperProcesses,
  runScript,
  scriptedWrapperPath,
} from './__tests__/runtime-test-helpers.js';

/**
 * Each case drives a scripted stand-in wrapper that writes one kind of bad
 * frame and then stays alive. The host must fail the run with PROTOCOL_ERROR,
 * kill the wrapper, and never hand an unvalidated call to the invoker.
 */

describe('QuickJsProcessRuntime protocol', () => {
  afterEach(() => {
    assertNoLiveWrappers();
  });

  it('detects a live wrapper process with the orphan check used by these tests', async () => {
    const stray = spawn(process.execPath, [scriptedWrapperPath], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const closed = new Promise((resolve) => stray.once('close', resolve));
    try {
      expect(liveWrapperProcesses().join(' | ')).toContain('scripted-wrapper');
    } finally {
      stray.kill('SIGKILL');
      await closed;
    }
    expect(liveWrapperProcesses()).toStrictEqual([]);
  });

  describe('IPC frame validation', () => {
    const cases: Array<{ behavior: string; description: string }> = [
      {
        behavior: 'call-without-id',
        description: 'a call frame without a call ID',
      },
      {
        behavior: 'unrequested-tool',
        description: 'a call to a tool the run did not request',
      },
      { behavior: 'wrong-run-id', description: 'a frame for another run' },
      { behavior: 'invalid-json', description: 'a frame that is not JSON' },
      {
        behavior: 'unknown-failure-code',
        description: 'a failure frame with an unknown code',
      },
    ];

    for (const { behavior, description } of cases) {
      it(`fails with PROTOCOL_ERROR on ${description}`, async () => {
        const held = heldInvoker();
        const result = await runScript(behavior, {
          wrapperPath: scriptedWrapperPath,
          invoke: held.invoke,
        });

        expect(result).toMatchObject({
          ok: false,
          error: { code: 'PROTOCOL_ERROR' },
        });
        expect(held.calls).toStrictEqual([]);
      });
    }

    it('fails with PROTOCOL_ERROR on a duplicate call ID and aborts the first call', async () => {
      const held = heldInvoker();
      const result = await runScript('duplicate-call', {
        wrapperPath: scriptedWrapperPath,
        invoke: held.invoke,
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'PROTOCOL_ERROR' },
        callCount: 1,
      });
      expect(held.calls.map((call) => call.requestId)).toStrictEqual([1]);
      expect(held.settled.has(1)).toBe(true);
    });

    it('fails with PROTOCOL_ERROR when the wrapper completes while a call is unanswered', async () => {
      const held = heldInvoker();
      const result = await runScript('complete-with-pending-call', {
        wrapperPath: scriptedWrapperPath,
        invoke: held.invoke,
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'PROTOCOL_ERROR' },
      });
      expect(held.settled.has(1)).toBe(true);
    });

    it('fails with PROTOCOL_ERROR on a log-frame flood past the console line limit', async () => {
      const result = await runScript('log-flood', {
        wrapperPath: scriptedWrapperPath,
        limits: { maxConsoleLines: 20 },
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'PROTOCOL_ERROR' },
      });
      expect(result.logs.length).toBe(20);
    });

    it('fails with PROTOCOL_ERROR as soon as an unterminated frame passes the size limit', async () => {
      const result = await runScript('unterminated-frame', {
        wrapperPath: scriptedWrapperPath,
        limits: { wallTimeoutMs: 60_000 },
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'PROTOCOL_ERROR' },
      });
    });
  });
});
