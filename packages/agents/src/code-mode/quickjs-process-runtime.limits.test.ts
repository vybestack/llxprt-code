/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  heldInvoker,
  assertNoLiveWrappers,
  runScript,
} from './__tests__/runtime-test-helpers.js';
import {
  ScriptRunTermination,
  type ScriptInvoker,
} from './runtime-contract.js';

describe('QuickJsProcessRuntime limits', () => {
  afterEach(() => {
    assertNoLiveWrappers();
  });

  describe('interpreter limits', () => {
    it('stops an infinite loop with CPU_LIMIT, even inside try/catch', async () => {
      const result = await runScript(
        'try { while (true) {} } catch { } return "escaped";',
        { limits: { cpuMs: 200 } },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'CPU_LIMIT' },
      });
    });

    it('stops a microtask storm with CPU_LIMIT', async () => {
      const result = await runScript(
        'const again = () => Promise.resolve().then(again); again(); await new Promise(() => {});',
        { limits: { cpuMs: 200 } },
      );

      expect(result).toMatchObject({ ok: false, error: { code: 'CPU_LIMIT' } });
    });

    it('stops unbounded recursion with STACK_LIMIT', async () => {
      const result = await runScript(
        'function recurse(n) { return recurse(n + 1) + 1; } return recurse(0);',
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'STACK_LIMIT' },
      });
    });

    it('stops memory growth with MEMORY_LIMIT', async () => {
      const result = await runScript(
        'const chunks = []; while (true) chunks.push(new Array(100000).fill(chunks.length));',
        { limits: { memoryBytes: 16 * 1024 * 1024 } },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'MEMORY_LIMIT' },
      });
    });

    it('fails a promise that nothing can settle with UNRESOLVED_PROMISE without waiting for the deadline', async () => {
      const result = await runScript('await new Promise(() => {}); return 1;', {
        limits: { wallTimeoutMs: 60_000 },
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'UNRESOLVED_PROMISE' },
      });
    });

    it('rejects source over the size limit before starting a subprocess', async () => {
      let invoked = false;
      const result = await runScript(`return "${'x'.repeat(2048)}";`, {
        limits: { maxSourceBytes: 1024 },
        invoke: async () => {
          invoked = true;
          return { ok: true, value: null, completeness: 'complete' };
        },
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'SOURCE_TOO_LARGE' },
      });
      expect(invoked).toBe(false);
    });
  });

  describe('call budgets', () => {
    it('ends the run with CALL_LIMIT at the call budget; the guest cannot catch it', async () => {
      let invocations = 0;
      const result = await runScript(
        'for (let n = 0; n < 10; n++) { try { await tools.echo({ n }); } catch { } } return "escaped";',
        {
          limits: { maxCalls: 3 },
          invoke: async () => {
            invocations += 1;
            return { ok: true, value: null, completeness: 'complete' };
          },
        },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'CALL_LIMIT' },
      });
      expect(result.callCount).toBe(3);
      expect(invocations).toBe(3);
    });

    it('ends the run with PENDING_LIMIT and aborts and joins the calls in flight', async () => {
      const held = heldInvoker();
      const result = await runScript(
        'await Promise.all(Array.from({ length: 5 }, (_, n) => tools.echo({ n }))); return true;',
        { limits: { maxPendingCalls: 2 }, invoke: held.invoke },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'PENDING_LIMIT' },
      });
      expect(held.calls.length).toBe(2);
      expect(held.calls.every((call) => call.signal.aborted)).toBe(true);
      expect([...held.settled].sort()).toStrictEqual([1, 2]);
    });

    it('fails with UNAWAITED_TOOL_CALLS after aborting and joining the pending call', async () => {
      const held = heldInvoker();
      const result = await runScript('tools.echo({}); return "finished";', {
        invoke: held.invoke,
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'UNAWAITED_TOOL_CALLS' },
      });
      expect(held.calls.length).toBe(1);
      expect(held.calls[0]?.signal.aborted).toBe(true);
      expect(held.settled.has(1)).toBe(true);
    });

    it('ends the run with ARGUMENTS_TOO_LARGE before dispatching oversized arguments', async () => {
      let invoked = false;
      const result = await runScript(
        'return await tools.echo({ text: "x".repeat(500) });',
        {
          limits: { maxCallArgumentBytes: 100 },
          invoke: async () => {
            invoked = true;
            return { ok: true, value: null, completeness: 'complete' };
          },
        },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'ARGUMENTS_TOO_LARGE' },
      });
      expect(invoked).toBe(false);
      expect(result.callCount).toBe(0);
    });

    it('ends the run with INVALID_ARGUMENTS for cyclic or non-object arguments', async () => {
      const cyclic = await runScript(
        'const args = {}; args.self = args; return await tools.echo(args);',
      );
      const scalar = await runScript('return await tools.echo("ls");');

      expect(cyclic).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENTS' },
      });
      expect(scalar).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENTS' },
      });
      expect(cyclic.callCount).toBe(0);
    });

    it('enforces the per-response guest input limit', async () => {
      const result = await runScript('await tools.echo({}); return true;', {
        limits: { maxResponseBytes: 1000 },
        invoke: async () => ({
          ok: true,
          value: 'x'.repeat(2000),
          completeness: 'complete',
        }),
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'INPUT_BYTES_LIMIT' },
      });
    });

    it('enforces the cumulative guest input limit', async () => {
      const result = await runScript(
        'for (let n = 0; n < 4; n++) await tools.echo({ n }); return true;',
        {
          limits: { maxResponseBytes: 1000, maxInputBytes: 2500 },
          invoke: async () => ({
            ok: true,
            value: 'x'.repeat(900),
            completeness: 'complete',
          }),
        },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'INPUT_BYTES_LIMIT' },
      });
      expect(result.callCount).toBe(3);
    });

    it('ends the run with CONSOLE_LIMIT on too many bytes or lines; the guest cannot catch it', async () => {
      const bytes = await runScript(
        'try { console.log("x".repeat(2000)); } catch { } return "escaped";',
        { limits: { maxConsoleBytes: 1000 } },
      );
      const lines = await runScript(
        'for (let n = 0; n < 50; n++) { try { console.log(n); } catch { } } return "escaped";',
        { limits: { maxConsoleLines: 10 } },
      );

      expect(bytes).toMatchObject({
        ok: false,
        error: { code: 'CONSOLE_LIMIT' },
      });
      expect(lines).toMatchObject({
        ok: false,
        error: { code: 'CONSOLE_LIMIT' },
      });
      expect(lines.logs.length).toBe(10);
    });
  });

  describe('final values', () => {
    it('returns RESULT_TOO_LARGE for an oversized or overly deep value instead of clipping it', async () => {
      const oversized = await runScript('return "x".repeat(20000);');
      const deep = await runScript(
        `return ${'['.repeat(70)}0${']'.repeat(70)};`,
      );

      expect(oversized).toMatchObject({
        ok: false,
        error: { code: 'RESULT_TOO_LARGE' },
      });
      expect(deep).toMatchObject({
        ok: false,
        error: { code: 'RESULT_TOO_LARGE' },
      });
      expect(oversized).not.toHaveProperty('value');
    });

    it('keeps the size check effective after the guest tampers with intrinsics', async () => {
      const result = await runScript(
        'Object.prototype.toJSON = () => "small"; Array.prototype.toJSON = () => "small"; JSON.stringify = () => "\\"small\\""; Object.keys = () => []; return "x".repeat(20000);',
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'RESULT_TOO_LARGE' },
      });
    });

    it('returns RESULT_NOT_JSON for cyclic, function and non-finite values', async () => {
      const cyclic = await runScript('const v = {}; v.self = v; return v;');
      const fn = await runScript('return { run: () => 1 };');
      const nan = await runScript('return [NaN];');

      expect(cyclic).toMatchObject({
        ok: false,
        error: { code: 'RESULT_NOT_JSON' },
      });
      expect(fn).toMatchObject({
        ok: false,
        error: { code: 'RESULT_NOT_JSON' },
      });
      expect(nan).toMatchObject({
        ok: false,
        error: { code: 'RESULT_NOT_JSON' },
      });
    });
  });

  describe('termination and cancellation', () => {
    it('kills the run at the host wall deadline and aborts the call in flight', async () => {
      const held = heldInvoker();
      const result = await runScript('await tools.echo({}); return true;', {
        limits: { wallTimeoutMs: 200 },
        invoke: held.invoke,
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
      expect(held.calls[0]?.signal.aborted).toBe(true);
      expect(held.settled.has(1)).toBe(true);
    });

    it('cancels the subprocess and the call in flight when the caller aborts', async () => {
      const controller = new AbortController();
      const held = heldInvoker();
      const invoke: ScriptInvoker = (call) => {
        const response = held.invoke(call);
        controller.abort();
        return response;
      };
      const result = await runScript('await tools.echo({}); return true;', {
        invoke,
        signal: controller.signal,
      });

      expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
      expect(held.settled.has(1)).toBe(true);
    });

    it('does not start a subprocess for an already aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();

      expect(
        await runScript('return 1;', { signal: controller.signal }),
      ).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    });

    it('ends the run with the code of a ScriptRunTermination; the guest cannot catch it', async () => {
      const result = await runScript(
        'try { await tools.echo({ command: "rm -rf /" }); } catch { } return "continued";',
        {
          invoke: async () => {
            throw new ScriptRunTermination(
              'POLICY_DENIED',
              'Denied by policy.',
            );
          },
        },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'POLICY_DENIED', message: 'Denied by policy.' },
        callCount: 1,
      });
    });

    it('ends the run with HOST_ERROR for any other invoke failure or a malformed result', async () => {
      const thrown = await runScript('await tools.echo({}); return 1;', {
        invoke: async () => {
          throw new Error('broker crashed');
        },
      });
      const malformed = await runScript('await tools.echo({}); return 1;', {
        invoke: async () =>
          ({ ok: true, value: 1 }) as unknown as Awaited<
            ReturnType<ScriptInvoker>
          >,
      });

      expect(thrown).toMatchObject({
        ok: false,
        error: { code: 'HOST_ERROR' },
      });
      expect(malformed).toMatchObject({
        ok: false,
        error: { code: 'HOST_ERROR' },
      });
    });
  });
});
