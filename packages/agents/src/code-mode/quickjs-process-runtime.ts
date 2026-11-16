/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Code mode runtime backed by QuickJS-WASM in a dedicated subprocess
 * (issue #4084). There is deliberately no fallback: if the subprocess cannot
 * start, the run fails with RUNTIME_UNAVAILABLE and no guest code is evaluated
 * anywhere else.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HostRunSession } from './quickjs-host-session.js';
import {
  DEFAULT_CODE_MODE_LIMITS,
  isCodeModeLimits,
  utf8Length,
  type CodeModeLimits,
  type CodeModeRunResult,
  type CodeModeRuntime,
  type ScriptInvoker,
  type ScriptRunRequest,
} from './runtime-contract.js';

/**
 * Locates the wrapper entrypoint next to the module at `runtimeUrl`: the
 * TypeScript source when running from source, the emitted `.js` file when
 * running from built output.
 */
export function resolveQuickJsWrapperPath(runtimeUrl: string): string {
  const wrapper = runtimeUrl.endsWith('.ts')
    ? './quickjs-wrapper.ts'
    : './quickjs-wrapper.js';
  return fileURLToPath(new URL(wrapper, runtimeUrl));
}

/**
 * The child environment is empty: the wrapper needs no variables, so none of
 * HOME, provider keys, LLXPRT_*, proxy settings, credential sockets or SSH
 * agent values can reach it.
 */
export const CODE_MODE_CHILD_ENVIRONMENT: Readonly<Record<string, string>> =
  Object.freeze({});

/**
 * Bun would otherwise load `.env` files and `bunfig.toml` preloads from the
 * working directory. The wrapper runs from its own (packaged) directory and
 * never reads `.env` files, so workspace files cannot inject values or code.
 */
function wrapperArguments(wrapperPath: string): string[] {
  return process.versions['bun'] === undefined
    ? [wrapperPath]
    : ['--no-env-file', wrapperPath];
}

export interface QuickJsProcessRuntimeOptions {
  readonly wrapperPath?: string;
  readonly limits?: Partial<CodeModeLimits>;
}

function errorResult(code: string, message: string): CodeModeRunResult {
  return { ok: false, error: { code, message }, callCount: 0, logs: [] };
}

export class QuickJsProcessRuntime implements CodeModeRuntime {
  private readonly wrapperPath: string;
  private readonly limits: CodeModeLimits;

  constructor(options: QuickJsProcessRuntimeOptions = {}) {
    this.wrapperPath =
      options.wrapperPath ?? resolveQuickJsWrapperPath(import.meta.url);
    const limits = { ...DEFAULT_CODE_MODE_LIMITS, ...options.limits };
    if (!isCodeModeLimits(limits))
      throw new Error('Code mode limits must be positive safe integers.');
    this.limits = limits;
  }

  async run(
    request: ScriptRunRequest,
    invoke: ScriptInvoker,
    signal: AbortSignal,
  ): Promise<CodeModeRunResult> {
    if (signal.aborted)
      return errorResult('CANCELLED', 'The run was cancelled.');
    const sourceBytes = utf8Length(request.source);
    if (sourceBytes > this.limits.maxSourceBytes)
      return errorResult(
        'SOURCE_TOO_LARGE',
        `The script is ${sourceBytes} bytes; the limit is ${this.limits.maxSourceBytes}.`,
      );
    const child = spawn(process.execPath, wrapperArguments(this.wrapperPath), {
      cwd: dirname(this.wrapperPath),
      env: CODE_MODE_CHILD_ENVIRONMENT,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return new HostRunSession({
      child,
      runId: randomUUID(),
      request,
      limits: this.limits,
      invoke,
      signal,
    }).start();
  }
}
