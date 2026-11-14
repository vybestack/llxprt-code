/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a script sees from its nested calls (issue #4084), through a real
 * agent: real tools over a temp workspace, real policy and scheduler, real
 * QuickJS subprocess.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { assertNoLiveWrappers } from './__tests__/runtime-test-helpers.js';
import {
  buildScriptAgent,
  runTurn,
  scratchDir,
  scriptResponse,
  type ScriptAgent,
} from './__tests__/script-agent.js';

const ALLOW_SHELL = {
  toolName: 'run_shell_command',
  decision: PolicyDecision.ALLOW,
  priority: 2,
};

let built: ScriptAgent | undefined;

describe('code mode results', () => {
  afterEach(async () => {
    await built?.cleanup();
    built = undefined;
    assertNoLiveWrappers();
  });

  async function runScript(
    source: (workspace: string) => string,
    tools: readonly string[],
    setup: (workspace: string) => void = () => undefined,
    rules = [ALLOW_SHELL],
  ) {
    const workspace = scratchDir('code-mode-results-');
    setup(workspace);
    // Redirections make shell calls ask even under an allow rule; approve
    // every nested prompt so these tests observe results, not approvals.
    built = await buildScriptAgent([{ source: source(workspace), tools }], {
      workspace,
      rules,
      config: { onApproval: () => ToolConfirmationOutcome.ProceedOnce },
    });
    await runTurn(built.agent);
    return scriptResponse(built.agent);
  }

  describe('CodeModeRunOwner results', () => {
    it('delivers one nested read as complete text', async () => {
      const response = await runScript(
        (dir) =>
          `const r = await tools["read_file"]({ absolute_path: ${JSON.stringify(join(dir, 'a.txt'))} }); return r;`,
        ['read_file'],
        (dir) => writeFileSync(join(dir, 'a.txt'), 'alpha\nbeta\n'),
      );

      expect(response).toStrictEqual({
        ok: true,
        value: {
          ok: true,
          value: { text: 'alpha\nbeta' },
          completeness: 'complete',
        },
        callCount: 1,
        partial: false,
        completedCalls: [{ tool: 'read_file', status: 'ok' }],
        logs: [],
      });
    }, 60_000);

    it('runs nested calls in a loop and aggregates their results', async () => {
      const response = await runScript(
        (dir) => `
        const names = ["one.txt", "two.txt", "three.txt"];
        const sizes = {};
        for (const name of names) {
          const r = await tools["read_file"]({ absolute_path: ${JSON.stringify(dir)} + "/" + name });
          sizes[name] = r.value.text.split("\\n").length;
        }
        return sizes;`,
        ['read_file'],
        (dir) => {
          writeFileSync(join(dir, 'one.txt'), 'a');
          writeFileSync(join(dir, 'two.txt'), 'a\nb');
          writeFileSync(join(dir, 'three.txt'), 'a\nb\nc');
        },
      );

      expect(response.ok).toBe(true);
      expect(response.value).toStrictEqual({
        'one.txt': 1,
        'two.txt': 2,
        'three.txt': 3,
      });
      expect(response.completedCalls).toHaveLength(3);
    }, 60_000);

    it('serializes Promise.all calls in the order the script made them', async () => {
      let log = '';
      const response = await runScript(
        (dir) => {
          log = join(dir, 'order.log');
          const step = (n: number) =>
            `tools["run_shell_command"]({ command: "echo start-${n} >> ${log}; sleep 0.2; echo end-${n} >> ${log}" })`;
          return `const all = await Promise.all([${step(1)}, ${step(2)}, ${step(3)}]); return all.map((r) => r.ok);`;
        },
        ['run_shell_command'],
      );

      expect(response.value).toStrictEqual([true, true, true]);
      expect(readFileSync(log, 'utf8').trim().split('\n')).toStrictEqual([
        'start-1',
        'end-1',
        'start-2',
        'end-2',
        'start-3',
        'end-3',
      ]);
    }, 60_000);

    it('gives shell results as stdout, stderr and exit code from the execution', async () => {
      const response = await runScript(
        () =>
          `const r = await tools["run_shell_command"]({ command: "echo out-line; echo err-line 1>&2; exit 3" }); return r;`,
        ['run_shell_command'],
      );

      const nested = response.value as {
        readonly ok: boolean;
        readonly completeness: string;
        readonly value: {
          readonly stdout: string;
          readonly stderr: string;
          readonly exitCode: number;
          readonly streamsMerged: boolean;
        };
      };
      expect(nested.ok).toBe(true);
      expect(nested.completeness).toBe('complete');
      expect(nested.value.exitCode).toBe(3);
      expect(nested.value.streamsMerged).toBe(false);
      expect(nested.value.stdout.trim()).toBe('out-line');
      expect(nested.value.stderr.trim()).toBe('err-line');
    }, 60_000);

    it('marks a truncated read partial, and the run partial even if the script claims otherwise', async () => {
      const response = await runScript(
        (dir) =>
          `const r = await tools["read_file"]({ absolute_path: ${JSON.stringify(join(dir, 'long.txt'))} }); return { completeness: r.completeness, partial: false };`,
        ['read_file'],
        (dir) =>
          writeFileSync(
            join(dir, 'long.txt'),
            Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n'),
          ),
      );

      expect(response.ok).toBe(true);
      expect(response.value).toStrictEqual({
        completeness: 'partial',
        partial: false,
      });
      expect(response.partial).toBe(true);
    }, 60_000);

    it('marks a search the tool cut at its match limit partial', async () => {
      const response = await runScript(
        (dir) =>
          `const r = await tools["search_file_content"]({ pattern: "needle", path: ${JSON.stringify(dir)}, max_results: 1 }); return r.completeness;`,
        ['search_file_content'],
        (dir) =>
          writeFileSync(join(dir, 'hay.txt'), 'needle\nneedle\nneedle\n'),
      );

      expect(response.value).toBe('partial');
      expect(response.partial).toBe(true);
    }, 60_000);

    it('marks a multi-file read with a truncated file partial', async () => {
      const response = await runScript(
        (dir) =>
          `const r = await tools["read_many_files"]({ paths: [${JSON.stringify(join(dir, 'long.txt'))}] }); return r.completeness;`,
        ['read_many_files'],
        (dir) =>
          writeFileSync(
            join(dir, 'long.txt'),
            Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n'),
          ),
      );

      expect(response.value).toBe('partial');
      expect(response.partial).toBe(true);
    }, 60_000);

    it('reports a window the script asked for as complete', async () => {
      const response = await runScript(
        (dir) =>
          `const r = await tools["read_file"]({ absolute_path: ${JSON.stringify(join(dir, 'long.txt'))}, offset: 10, limit: 5 }); return r.completeness;`,
        ['read_file'],
        (dir) =>
          writeFileSync(
            join(dir, 'long.txt'),
            Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'),
          ),
      );

      expect(response.value).toBe('complete');
      expect(response.partial).toBe(false);
    }, 60_000);

    it('returns RESULT_TOO_LARGE for an oversized final value without clipping it', async () => {
      const response = await runScript(
        () => 'return "x".repeat(20000);',
        ['read_file'],
      );

      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('RESULT_TOO_LARGE');
      expect(response.value).toBeUndefined();
    }, 60_000);

    it('fails a call to a tool the script did not list', async () => {
      const response = await runScript(
        (dir) =>
          `return await tools["list_directory"]({ dir_path: ${JSON.stringify(dir)} });`,
        ['read_file'],
      );

      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('SCRIPT_ERROR');
      expect(response.callCount).toBe(0);
      expect(response.completedCalls).toStrictEqual([]);
    }, 60_000);

    it('returns an ordinary tool failure to the script as ok:false', async () => {
      const response = await runScript(
        (dir) =>
          `const r = await tools["read_file"]({ absolute_path: ${JSON.stringify(join(dir, 'missing.txt'))} }); return r.ok ? "read" : r.error.code;`,
        ['read_file'],
      );

      expect(response.ok).toBe(true);
      expect(response.value).toBe('FILE_NOT_FOUND');
      expect(response.completedCalls).toStrictEqual([
        { tool: 'read_file', status: 'failed' },
      ]);
    }, 60_000);
  });
});
