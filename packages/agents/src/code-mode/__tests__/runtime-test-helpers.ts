/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  QuickJsProcessRuntime,
  type QuickJsProcessRuntimeOptions,
} from '../quickjs-process-runtime.js';
import type {
  CodeModeLimits,
  CodeModeRunResult,
  ScriptCall,
  ScriptInvoker,
  ScriptToolResult,
} from '../runtime-contract.js';

export const scriptedWrapperPath = fileURLToPath(
  new URL('./fixtures/scripted-wrapper.ts', import.meta.url),
);

export const echoInvoker: ScriptInvoker = async (call) => ({
  ok: true,
  value: { tool: call.tool, args: call.args },
  completeness: 'complete',
});

/**
 * An invoker whose calls stay in flight until the runtime aborts them, the way
 * a nested tool execution honours cancellation. Records each call and whether
 * it had settled.
 */
export function heldInvoker(): {
  readonly invoke: ScriptInvoker;
  readonly calls: ScriptCall[];
  readonly settled: Set<number>;
} {
  const calls: ScriptCall[] = [];
  const settled = new Set<number>();
  const invoke: ScriptInvoker = (call) => {
    calls.push(call);
    return new Promise<ScriptToolResult>((resolve) => {
      call.signal.addEventListener(
        'abort',
        () => {
          settled.add(call.requestId);
          resolve({
            ok: false,
            error: { code: 'CANCELLED', message: 'aborted' },
          });
        },
        { once: true },
      );
    });
  };
  return { invoke, calls, settled };
}

export async function runScript(
  source: string,
  options: {
    readonly invoke?: ScriptInvoker;
    readonly tools?: readonly string[];
    readonly limits?: Partial<CodeModeLimits>;
    readonly wrapperPath?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<CodeModeRunResult> {
  const runtimeOptions: QuickJsProcessRuntimeOptions = {
    limits: options.limits,
    wrapperPath: options.wrapperPath,
  };
  return new QuickJsProcessRuntime(runtimeOptions).run(
    {
      language: 'javascript',
      source,
      tools: options.tools ?? ['echo'],
      apiRevision: 'test-revision',
      purpose: 'runtime behavior test',
    },
    options.invoke ?? echoInvoker,
    options.signal ?? new AbortController().signal,
  );
}

/** Wrapper processes (real or scripted) still parented by this test process. */
export function liveWrapperProcesses(): string[] {
  const listing = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
  });
  if (listing.status !== 0)
    throw new Error(`Cannot list processes: ${listing.stderr}`);
  return listing.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(
      ([, ppid, ...command]) =>
        Number(ppid) === process.pid &&
        /quickjs-wrapper|scripted-wrapper/.test(command.join(' ')),
    )
    .map((fields) => fields.join(' '));
}

/** Fails the current test when a wrapper process outlived its run. */
export function assertNoLiveWrappers(): void {
  const live = liveWrapperProcesses();
  if (live.length > 0)
    throw new Error(`Wrapper processes outlived their run: ${live.join('; ')}`);
}
