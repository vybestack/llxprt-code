/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertNoLiveWrappers,
  runScript,
  scriptedWrapperPath,
} from './__tests__/runtime-test-helpers.js';
import type { ScriptCall, ScriptToolResult } from './runtime-contract.js';

const FAKE_SOCKET = '/tmp/llxprt-fake-credential.sock';
const FAKE_KEY = 'sk-fake-code-mode-test-key';
const seededNames = ['LLXPRT_CREDENTIAL_SOCKET', 'FAKE_API_KEY'] as const;
const originalValues = seededNames.map((name) => process.env[name]);

function seedFakeCredentials(): void {
  process.env['LLXPRT_CREDENTIAL_SOCKET'] = FAKE_SOCKET;
  process.env['FAKE_API_KEY'] = FAKE_KEY;
}

describe('QuickJsProcessRuntime', () => {
  afterEach(() => {
    seededNames.forEach((name, index) => {
      const original = originalValues[index];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    });
    assertNoLiveWrappers();
  });

  describe('nested calls and results', () => {
    it('round-trips one nested call and returns the final JSON value', async () => {
      const calls: ScriptCall[] = [];
      const result = await runScript(
        'const response = await tools["echo"]({ value: 7 }); return { response };',
        {
          invoke: async (call) => {
            calls.push(call);
            return { ok: true, value: 'seven', completeness: 'complete' };
          },
        },
      );

      expect(
        calls.map(({ requestId, tool, args }) => [requestId, tool, args]),
      ).toStrictEqual([[1, 'echo', { value: 7 }]]);
      expect(result).toStrictEqual({
        ok: true,
        value: {
          response: { ok: true, value: 'seven', completeness: 'complete' },
        },
        callCount: 1,
        logs: [],
      });
    });

    it('runs sequential calls from a guest loop in order', async () => {
      const seen: unknown[] = [];
      const result = await runScript(
        'let total = 0; for (let n = 1; n <= 3; n++) { const r = await tools.echo({ n }); total += r.value; } return total;',
        {
          invoke: async (call) => {
            seen.push(call.args['n']);
            return {
              ok: true,
              value: Number(call.args['n']) * 10,
              completeness: 'complete',
            };
          },
        },
      );

      expect(seen).toStrictEqual([1, 2, 3]);
      expect(result).toMatchObject({ ok: true, value: 60, callCount: 3 });
    });

    it('matches concurrent Promise.all results to their calls when answered out of order', async () => {
      const waiting: Array<{
        call: ScriptCall;
        resolve: (result: ScriptToolResult) => void;
      }> = [];
      const pending = runScript(
        'return await Promise.all([1, 2, 3].map((n) => tools.echo({ n })));',
        {
          invoke: (call) =>
            new Promise((resolve) => {
              waiting.push({ call, resolve });
              if (waiting.length === 3) {
                for (const entry of [...waiting].reverse()) {
                  entry.resolve({
                    ok: true,
                    value: `answer-${String(entry.call.args['n'])}`,
                    completeness: 'partial',
                  });
                }
              }
            }),
        },
      );

      expect(await pending).toMatchObject({
        ok: true,
        value: [
          { ok: true, value: 'answer-1', completeness: 'partial' },
          { ok: true, value: 'answer-2', completeness: 'partial' },
          { ok: true, value: 'answer-3', completeness: 'partial' },
        ],
        callCount: 3,
      });
    });

    it('lets the guest handle an ordinary structured tool error', async () => {
      const result = await runScript(
        'const r = await tools.echo({}); return r.ok ? "unexpected" : r.error.code + ":" + r.error.message;',
        {
          invoke: async () => ({
            ok: false,
            error: { code: 'FILE_NOT_FOUND', message: 'missing.txt' },
          }),
        },
      );

      expect(result).toMatchObject({
        ok: true,
        value: 'FILE_NOT_FOUND:missing.txt',
      });
    });

    it('collects console output as log lines, formatting data as JSON', async () => {
      const result = await runScript(
        'console.log("files", 3, { a: [1] }); console.log(null); return "done";',
      );

      expect(result).toMatchObject({
        ok: true,
        value: 'done',
        logs: ['files 3 {"a":[1]}', 'null'],
      });
    });

    it('returns null for a script without a return value and follows JSON rules for undefined members', async () => {
      const none = await runScript('await tools.echo({});');
      const members = await runScript(
        'return { a: undefined, b: [undefined, 1] };',
      );

      expect(none).toMatchObject({ ok: true, value: null, callCount: 1 });
      expect(members).toMatchObject({ ok: true, value: { b: [null, 1] } });
    });

    it('exposes only the requested tools on a frozen tools object', async () => {
      const result = await runScript(
        'tools.extra = () => 1; return [Object.keys(tools), typeof tools.write_file, typeof tools.extra, Object.isFrozen(tools)];',
        { tools: ['echo', 'read_file'] },
      );

      expect(result).toMatchObject({
        ok: true,
        value: [['echo', 'read_file'], 'undefined', 'undefined', true],
      });
    });

    it('reports a thrown guest error with its message', async () => {
      const result = await runScript('throw new TypeError("bad input");');

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'SCRIPT_ERROR', message: 'TypeError: bad input' },
      });
    });

    it('rejects malformed source as SYNTAX_ERROR before any call', async () => {
      let invoked = false;
      const result = await runScript('return (', {
        invoke: async () => {
          invoked = true;
          return { ok: true, value: null, completeness: 'complete' };
        },
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'SYNTAX_ERROR' },
        callCount: 0,
      });
      expect(invoked).toBe(false);
    });
  });

  describe('isolation', () => {
    it('gives the guest no host globals, modules, network, timers or bindings', async () => {
      seedFakeCredentials();
      const names = [
        'process',
        'Bun',
        'Deno',
        'require',
        'module',
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'setTimeout',
        'setInterval',
        'setImmediate',
        'queueMicrotask',
        'std',
        'os',
        'LLXPRT_CREDENTIAL_SOCKET',
        'FAKE_API_KEY',
        'hostCall',
        'hostLog',
        '__hostCall',
        '__guestLog',
      ];
      const result = await runScript(
        `return ${JSON.stringify(names)}.map((name) => [name, typeof globalThis[name]]);`,
      );

      expect(result).toMatchObject({
        ok: true,
        value: names.map((name) => [name, 'undefined']),
      });
    });

    it('fails a guest that touches host capabilities', async () => {
      seedFakeCredentials();
      const probes = [
        'process.env',
        'Bun.file("/etc/hosts")',
        'require("node:fs")',
        'fetch("https://example.com")',
        'setTimeout(() => {}, 0)',
        'LLXPRT_CREDENTIAL_SOCKET',
        'FAKE_API_KEY',
      ];

      for (const probe of probes) {
        const result = await runScript(`return ${probe};`);
        expect(result).toMatchObject({
          ok: false,
          error: { code: 'SCRIPT_ERROR' },
        });
        if (result.ok) throw new Error(`Probe ${probe} succeeded.`);
        expect(result.error.message).toContain('ReferenceError');
      }
    });

    it('rejects dynamic module imports', async () => {
      const result = await runScript('await import("node:fs"); return true;');

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'SCRIPT_ERROR' },
      });
    });

    it('never exposes seeded credential values anywhere in the global object', async () => {
      seedFakeCredentials();
      const result = await runScript(
        `
      const seen = new Set();
      const text = [];
      const walk = (value, depth) => {
        if (depth > 4 || value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return;
        seen.add(value);
        for (const key of Object.getOwnPropertyNames(value)) {
          text.push(key);
          let child;
          try { child = value[key]; } catch { continue; }
          if (typeof child === 'string') text.push(child);
          walk(child, depth + 1);
        }
      };
      walk(globalThis, 0);
      return text.join('\\n');
    `,
        { limits: { maxResultBytes: 1024 * 1024 } },
      );

      if (!result.ok) throw new Error(result.error.message);
      expect(String(result.value)).toContain('console');
      expect(String(result.value)).not.toContain(FAKE_KEY);
      expect(String(result.value)).not.toContain(FAKE_SOCKET);
      expect(String(result.value)).not.toContain('LLXPRT_');
    });

    it('starts the wrapper with an empty environment, ignoring workspace .env and bunfig preloads', async () => {
      seedFakeCredentials();
      const workspace = mkdtempSync(join(tmpdir(), 'code-mode-workspace-'));
      writeFileSync(join(workspace, '.env'), `FAKE_API_KEY=${FAKE_KEY}\n`);
      writeFileSync(
        join(workspace, 'preload.ts'),
        '(globalThis as Record<string, unknown>).codeModePreloaded = true;\n',
      );
      writeFileSync(
        join(workspace, 'bunfig.toml'),
        'preload = ["./preload.ts"]\n',
      );
      const previousCwd = process.cwd();
      process.chdir(workspace);
      try {
        const result = await runScript('inspect-env', {
          wrapperPath: scriptedWrapperPath,
        });

        expect(result).toMatchObject({
          ok: true,
          value: { keys: [], preloaded: false },
        });
      } finally {
        process.chdir(previousCwd);
        rmSync(workspace, { recursive: true, force: true });
      }
    });

    it('fails with RUNTIME_UNAVAILABLE and evaluates nothing when the wrapper cannot start', async () => {
      let invoked = false;
      const result = await runScript('return 1;', {
        wrapperPath: '/path/that/does/not/exist/quickjs-wrapper.ts',
        invoke: async () => {
          invoked = true;
          return { ok: true, value: null, completeness: 'complete' };
        },
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'RUNTIME_UNAVAILABLE' },
        callCount: 0,
      });
      expect(invoked).toBe(false);
    });

    it('fails with RUNTIME_UNAVAILABLE when the wrapper exits without a result', async () => {
      const result = await runScript('exit-without-frame', {
        wrapperPath: scriptedWrapperPath,
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'RUNTIME_UNAVAILABLE' },
      });
      if (result.ok) throw new Error('Expected failure.');
      expect(result.error.message).toContain('wrapper exploded');
    });
  });
});
