/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host side of one code mode run: owns the wrapper subprocess, validates every
 * frame it writes, dispatches nested calls to the invoke callback, and enforces
 * the host-side limits. The run settles only after the subprocess has closed
 * and every invoke callback it started has settled.
 */

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  LineFramer,
  PROTOCOL_VERSION,
  encodeFrame,
  parseChildFrame,
  type CallFrame,
  type ChildFrame,
} from './ipc-frames.js';
import {
  ScriptRunTermination,
  isScriptToolResult,
  utf8Length,
  type CodeModeErrorCode,
  type CodeModeLimits,
  type CodeModeRunResult,
  type ScriptInvoker,
  type ScriptRunRequest,
  type ScriptToolResult,
} from './runtime-contract.js';

const MAX_STDERR_BYTES = 2048;
/** Bound on how long a wrapper may linger after its terminal frame. */
const EXIT_GRACE_MS = 2_000;

export interface HostRunSessionOptions {
  readonly child: ChildProcessWithoutNullStreams;
  readonly runId: string;
  readonly request: ScriptRunRequest;
  readonly limits: CodeModeLimits;
  readonly invoke: ScriptInvoker;
  readonly signal: AbortSignal;
}

/** Largest legitimate wrapper frame: JSON escaping can grow text sixfold. */
export function maxChildFrameBytes(limits: CodeModeLimits): number {
  return (
    6 *
      Math.max(
        limits.maxCallArgumentBytes,
        limits.maxConsoleBytes,
        limits.maxResultBytes,
      ) +
    4096
  );
}

export class HostRunSession {
  private settled = false;
  private callCount = 0;
  private inputBytes = 0;
  private logBytes = 0;
  private readonly logs: string[] = [];
  private stderr = '';
  private readonly inFlight = new Set<Promise<void>>();
  private readonly callAbort = new AbortController();
  private readonly closed: Promise<void>;
  private wallTimer: ReturnType<typeof setTimeout> | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private resolveRun: ((result: CodeModeRunResult) => void) | undefined;

  constructor(private readonly options: HostRunSessionOptions) {
    const { child } = options;
    this.closed = new Promise((resolve) => {
      child.once('close', () => resolve());
      child.once('error', () => {
        if (child.pid === undefined) resolve();
      });
    });
  }

  start(): Promise<CodeModeRunResult> {
    const { child, request, limits, runId, signal } = this.options;
    const result = new Promise<CodeModeRunResult>((resolve) => {
      this.resolveRun = resolve;
    });
    this.wallTimer = setTimeout(
      () =>
        this.fail(
          'TIMEOUT',
          `The run exceeded its ${limits.wallTimeoutMs} ms wall deadline.`,
        ),
      limits.wallTimeoutMs,
    );
    signal.addEventListener('abort', this.onAbort, { once: true });
    this.readFrames();
    child.stderr.on('data', (chunk: Buffer) => {
      if (this.stderr.length < MAX_STDERR_BYTES)
        this.stderr += chunk.toString('utf8').slice(0, MAX_STDERR_BYTES);
    });
    child.once('error', (error) =>
      this.fail(
        'RUNTIME_UNAVAILABLE',
        `The QuickJS subprocess could not start: ${error.message}`,
      ),
    );
    child.once('close', (code, exitSignal) => this.onClose(code, exitSignal));
    child.stdin.on('error', (error: Error) =>
      this.fail(
        'RUNTIME_UNAVAILABLE',
        `The QuickJS subprocess input closed: ${error.message}`,
      ),
    );
    child.stdin.write(
      encodeFrame({
        version: PROTOCOL_VERSION,
        runId,
        type: 'start',
        source: request.source,
        tools: request.tools,
        limits,
      }),
    );
    return result;
  }

  private readonly onAbort = (): void => {
    this.fail('CANCELLED', 'The run was cancelled.');
  };

  private readFrames(): void {
    const { child, limits, runId } = this.options;
    const framer = new LineFramer(maxChildFrameBytes(limits));
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.settled) return;
      const lines = framer.push(chunk);
      if (lines === 'oversized') {
        this.fail('PROTOCOL_ERROR', 'A wrapper frame exceeds the size limit.');
        return;
      }
      for (const line of lines) this.onLine(line, runId);
    });
  }

  private onLine(line: string, runId: string): void {
    if (this.settled) return;
    const frame = parseChildFrame(line, runId);
    if (frame === undefined)
      this.fail('PROTOCOL_ERROR', 'The wrapper sent an invalid frame.');
    else this.onFrame(frame);
  }

  private onFrame(frame: ChildFrame): void {
    switch (frame.type) {
      case 'log':
        this.onLog(frame.text);
        return;
      case 'call':
        this.onCall(frame);
        return;
      case 'complete':
        if (frame.callCount !== this.callCount || this.inFlight.size > 0) {
          this.fail(
            'PROTOCOL_ERROR',
            'The wrapper completed with unanswered or unknown calls.',
          );
        } else if (
          utf8Length(JSON.stringify(frame.value)) >
          this.options.limits.maxResultBytes
        ) {
          this.fail('PROTOCOL_ERROR', 'The wrapper exceeded the result limit.');
        } else {
          this.finish(
            { ok: true, value: frame.value, ...this.progress() },
            false,
          );
        }
        return;
      default:
        this.fail(frame.code, frame.message, false);
    }
  }

  private onLog(text: string): void {
    const { maxConsoleBytes, maxConsoleLines } = this.options.limits;
    this.logBytes += utf8Length(text);
    if (
      this.logs.length >= maxConsoleLines ||
      this.logBytes > maxConsoleBytes
    ) {
      this.fail('PROTOCOL_ERROR', 'The wrapper exceeded the console limits.');
      return;
    }
    this.logs.push(text);
  }

  private callViolation(frame: CallFrame): string | undefined {
    const { limits, request } = this.options;
    if (frame.callId !== this.callCount + 1)
      return 'Call frames must use consecutive call IDs.';
    if (!request.tools.includes(frame.tool))
      return `The wrapper called ${JSON.stringify(frame.tool)}, which the run did not request.`;
    if (this.callCount >= limits.maxCalls)
      return 'The wrapper exceeded the call limit.';
    if (this.inFlight.size >= limits.maxPendingCalls)
      return 'The wrapper exceeded the pending call limit.';
    if (utf8Length(JSON.stringify(frame.args)) > limits.maxCallArgumentBytes)
      return 'The wrapper exceeded the argument size limit.';
    return undefined;
  }

  private onCall(frame: CallFrame): void {
    const violation = this.callViolation(frame);
    if (violation !== undefined) {
      this.fail('PROTOCOL_ERROR', violation);
      return;
    }
    this.callCount = frame.callId;
    const call = this.options
      .invoke({
        requestId: frame.callId,
        tool: frame.tool,
        args: frame.args,
        signal: this.callAbort.signal,
      })
      .then(
        (result) => this.deliver(frame.callId, result),
        (error: unknown) => this.onInvokeError(error),
      );
    this.inFlight.add(call);
    void call.finally(() => this.inFlight.delete(call));
  }

  private deliver(callId: number, result: ScriptToolResult): void {
    if (this.settled) return;
    if (!isScriptToolResult(result)) {
      this.fail('HOST_ERROR', 'A nested call returned a malformed result.');
      return;
    }
    const { maxResponseBytes, maxInputBytes } = this.options.limits;
    const bytes = utf8Length(JSON.stringify(result));
    if (bytes > maxResponseBytes) {
      this.fail(
        'INPUT_BYTES_LIMIT',
        `Nested call ${callId} returned ${bytes} bytes; the limit is ${maxResponseBytes}.`,
      );
      return;
    }
    this.inputBytes += bytes;
    if (this.inputBytes > maxInputBytes) {
      this.fail(
        'INPUT_BYTES_LIMIT',
        `Nested call results exceeded ${maxInputBytes} bytes in total.`,
      );
      return;
    }
    this.options.child.stdin.write(
      encodeFrame({
        version: PROTOCOL_VERSION,
        runId: this.options.runId,
        type: 'result',
        callId,
        value: result,
      }),
    );
  }

  private onInvokeError(error: unknown): void {
    if (error instanceof ScriptRunTermination)
      this.fail(error.code, error.message);
    else
      this.fail(
        'HOST_ERROR',
        `A nested call failed in the host: ${error instanceof Error ? error.message : String(error)}`,
      );
  }

  private onClose(code: number | null, exitSignal: string | null): void {
    if (this.settled) return;
    const detail = this.stderr.trim();
    this.fail(
      'RUNTIME_UNAVAILABLE',
      `The QuickJS subprocess exited (code ${String(code)}, signal ${String(exitSignal)}) without a result.${detail === '' ? '' : ` ${detail}`}`,
    );
  }

  private progress(): { callCount: number; logs: readonly string[] } {
    return { callCount: this.callCount, logs: [...this.logs] };
  }

  private fail(code: CodeModeErrorCode, message: string, kill = true): void {
    this.finish(
      { ok: false, error: { code, message }, ...this.progress() },
      kill,
    );
  }

  /**
   * Terminal transition: stops admission, aborts in-flight nested calls, ends
   * the subprocess (immediately when `kill`, otherwise after a short grace for
   * a wrapper that already sent its terminal frame), then resolves once the
   * subprocess has closed and every invoke callback has settled.
   */
  private finish(result: CodeModeRunResult, kill: boolean): void {
    if (this.settled) return;
    this.settled = true;
    const { child, signal } = this.options;
    clearTimeout(this.wallTimer);
    signal.removeEventListener('abort', this.onAbort);
    this.callAbort.abort();
    if (child.exitCode === null && child.signalCode === null) {
      if (kill) child.kill('SIGKILL');
      else {
        child.stdin.end();
        this.graceTimer = setTimeout(
          () => child.kill('SIGKILL'),
          EXIT_GRACE_MS,
        );
      }
    }
    void Promise.all([this.closed, ...this.inFlight]).then(() => {
      clearTimeout(this.graceTimer);
      this.resolveRun?.(result);
    });
  }
}
