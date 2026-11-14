/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One guest execution inside a fresh QuickJS-WASM runtime and context. Runs in
 * the trusted wrapper subprocess only; the host never loads QuickJS.
 *
 * Limit violations detected while the guest runs (call budget, pending calls,
 * argument size, console output) end the run: the violation is recorded as
 * terminal, the call that hit it throws, and the interrupt handler stops any
 * further guest execution, so a script cannot catch a budget violation and keep
 * going.
 */

import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
} from 'quickjs-emscripten';
import { guestPreludeSource } from './guest-prelude.js';
import {
  PROTOCOL_VERSION,
  type ChildFrame,
  type ResultFrame,
  type StartFrame,
} from './ipc-frames.js';
import {
  isPlainRecord,
  utf8Length,
  type CodeModeLimits,
  type GuestFailureCode,
  type JsonObject,
  type JsonValue,
} from './runtime-contract.js';

export type GuestOutcome =
  | { readonly kind: 'complete'; readonly value: JsonValue }
  | {
      readonly kind: 'failure';
      readonly code: GuestFailureCode;
      readonly message: string;
    };

type Emit = (frame: ChildFrame) => void;

interface GuestHelpers {
  readonly serialize: QuickJSHandle;
  readonly parse: QuickJSHandle;
  readonly compile: QuickJSHandle;
}

const MAX_ERROR_DETAIL = 1024;

function failure(code: GuestFailureCode, message: string): GuestOutcome {
  return { kind: 'failure', code, message };
}

export class GuestRun {
  private terminal: GuestOutcome | undefined;
  private cpuUsedMs = 0;
  private sliceStartedAt: number | undefined;
  private cpuExceeded = false;
  private callCount = 0;
  private consoleBytes = 0;
  private consoleLines = 0;
  private readonly pending = new Map<number, QuickJSDeferredPromise>();
  private helpers: GuestHelpers | undefined;
  private guestPromise: QuickJSHandle | undefined;

  private constructor(
    private readonly start: StartFrame,
    private readonly limits: CodeModeLimits,
    private readonly runtime: QuickJSRuntime,
    private readonly context: QuickJSContext,
    private readonly emit: Emit,
  ) {}

  static async create(start: StartFrame, emit: Emit): Promise<GuestRun> {
    const quickJS = await getQuickJS();
    const runtime = quickJS.newRuntime();
    runtime.setMemoryLimit(start.limits.memoryBytes);
    runtime.setMaxStackSize(start.limits.stackBytes);
    const guest = new GuestRun(
      start,
      start.limits,
      runtime,
      runtime.newContext(),
      emit,
    );
    runtime.setInterruptHandler(() => guest.shouldInterrupt());
    return guest;
  }

  get pendingCalls(): number {
    return this.pending.size;
  }

  get calls(): number {
    return this.callCount;
  }

  /** Installs the prelude, compiles the source and runs it to its first wait. */
  begin(): GuestOutcome | undefined {
    this.installPrelude();
    const sourceHandle = this.context.newString(this.start.source);
    const compiled = this.inSlice(() =>
      this.context.callFunction(
        this.helper('compile'),
        this.context.undefined,
        sourceHandle,
      ),
    );
    sourceHandle.dispose();
    if (compiled.error) {
      const outcome = this.classifyError(compiled.error, 'SYNTAX_ERROR');
      compiled.error.dispose();
      return outcome;
    }
    const invoked = this.inSlice(() =>
      this.context.callFunction(compiled.value, this.context.undefined),
    );
    compiled.value.dispose();
    if (invoked.error) {
      const outcome = this.classifyError(invoked.error, 'SCRIPT_ERROR');
      invoked.error.dispose();
      return outcome;
    }
    this.guestPromise = invoked.value;
    return this.settle();
  }

  /** Delivers a host result to the waiting guest promise. */
  deliver(frame: ResultFrame): GuestOutcome | 'unknown-call' | undefined {
    const deferred = this.pending.get(frame.callId);
    if (deferred === undefined) return 'unknown-call';
    this.pending.delete(frame.callId);
    const text = this.context.newString(JSON.stringify(frame.value));
    const parsed = this.inSlice(() =>
      this.context.callFunction(
        this.helper('parse'),
        this.context.undefined,
        text,
      ),
    );
    text.dispose();
    if (parsed.error) {
      const outcome = this.classifyError(parsed.error, 'SCRIPT_ERROR');
      parsed.error.dispose();
      deferred.dispose();
      return outcome;
    }
    deferred.resolve(parsed.value);
    parsed.value.dispose();
    deferred.dispose();
    return this.settle();
  }

  private shouldInterrupt(): boolean {
    if (this.terminal !== undefined) return true;
    if (this.sliceStartedAt === undefined) return false;
    if (this.cpuUsedMs + Date.now() - this.sliceStartedAt > this.limits.cpuMs)
      this.cpuExceeded = true;
    return this.cpuExceeded;
  }

  private inSlice<T>(work: () => T): T {
    if (this.sliceStartedAt !== undefined) return work();
    this.sliceStartedAt = Date.now();
    try {
      return work();
    } finally {
      this.cpuUsedMs += Date.now() - this.sliceStartedAt;
      this.sliceStartedAt = undefined;
    }
  }

  private helper(name: keyof GuestHelpers): QuickJSHandle {
    if (this.helpers === undefined)
      throw new Error('QuickJS prelude is not installed.');
    return this.helpers[name];
  }

  private installPrelude(): void {
    const factory = this.context.unwrapResult(
      this.context.evalCode(
        guestPreludeSource(this.start.tools, this.limits.maxResultDepth),
      ),
    );
    const hostCall = this.context.newFunction('call', (name, args) =>
      this.hostCall(name, args),
    );
    const hostLog = this.context.newFunction('log', (text) => {
      this.hostLog(this.context.getString(text));
    });
    const helpers = this.context.unwrapResult(
      this.context.callFunction(
        factory,
        this.context.undefined,
        hostCall,
        hostLog,
      ),
    );
    this.helpers = {
      serialize: this.context.getProp(helpers, 'serialize'),
      parse: this.context.getProp(helpers, 'parse'),
      compile: this.context.getProp(helpers, 'compile'),
    };
    helpers.dispose();
    factory.dispose();
    hostCall.dispose();
    hostLog.dispose();
  }

  private terminate(code: GuestFailureCode, message: string): never {
    this.terminal ??= failure(code, message);
    throw new Error(`${code}: ${message}`);
  }

  private hostCall(nameHandle: QuickJSHandle, argsHandle: QuickJSHandle) {
    if (this.terminal !== undefined)
      this.terminate('SCRIPT_ERROR', 'The run has already ended.');
    const tool = this.context.getString(nameHandle);
    if (this.callCount >= this.limits.maxCalls)
      this.terminate('CALL_LIMIT', `More than ${this.limits.maxCalls} calls.`);
    if (this.pending.size >= this.limits.maxPendingCalls)
      this.terminate(
        'PENDING_LIMIT',
        `More than ${this.limits.maxPendingCalls} calls pending at once.`,
      );
    const args = this.serializeArguments(argsHandle);
    this.callCount += 1;
    const callId = this.callCount;
    const deferred = this.context.newPromise();
    this.pending.set(callId, deferred);
    this.emit({
      version: PROTOCOL_VERSION,
      runId: this.start.runId,
      type: 'call',
      callId,
      tool,
      args,
    });
    return deferred.handle;
  }

  private serializeArguments(argsHandle: QuickJSHandle): JsonObject {
    const result = this.context.unwrapResult(
      this.context.callFunction(
        this.helper('serialize'),
        this.context.undefined,
        argsHandle,
      ),
    );
    const serialized = this.context.getString(result);
    result.dispose();
    const parsed: unknown = serialized.startsWith('J')
      ? JSON.parse(serialized.slice(1))
      : undefined;
    if (!isPlainRecord(parsed))
      this.terminate(
        'INVALID_ARGUMENTS',
        'Tool arguments must be a plain JSON object.',
      );
    if (utf8Length(serialized) - 1 > this.limits.maxCallArgumentBytes)
      this.terminate(
        'ARGUMENTS_TOO_LARGE',
        `Tool arguments exceed ${this.limits.maxCallArgumentBytes} bytes.`,
      );
    return parsed as JsonObject;
  }

  private hostLog(text: string): void {
    if (this.terminal !== undefined)
      this.terminate('SCRIPT_ERROR', 'The run has already ended.');
    this.consoleLines += 1;
    this.consoleBytes += utf8Length(text);
    if (
      this.consoleLines > this.limits.maxConsoleLines ||
      this.consoleBytes > this.limits.maxConsoleBytes
    )
      this.terminate(
        'CONSOLE_LIMIT',
        `Console output exceeds ${this.limits.maxConsoleLines} lines or ${this.limits.maxConsoleBytes} bytes.`,
      );
    this.emit({
      version: PROTOCOL_VERSION,
      runId: this.start.runId,
      type: 'log',
      text,
    });
  }

  /** Runs queued jobs and reports a terminal outcome, if one was reached. */
  private settle(): GuestOutcome | undefined {
    const jobs = this.inSlice(() => this.runtime.executePendingJobs());
    if (jobs.error) {
      const outcome = this.classifyError(jobs.error, 'SCRIPT_ERROR');
      jobs.error.dispose();
      return outcome;
    }
    const stopped = this.stoppedOutcome();
    if (stopped !== undefined) return stopped;
    if (this.guestPromise === undefined)
      throw new Error('Guest promise is not started.');
    const state = this.context.getPromiseState(this.guestPromise);
    if (state.type === 'fulfilled') {
      const outcome = this.complete(state.value);
      state.value.dispose();
      return outcome;
    }
    if (state.type === 'rejected') {
      const outcome = this.classifyError(state.error, 'SCRIPT_ERROR');
      state.error.dispose();
      return outcome;
    }
    if (this.pending.size === 0)
      return failure(
        'UNRESOLVED_PROMISE',
        'The script is waiting on a promise that nothing can settle.',
      );
    return undefined;
  }

  private complete(value: QuickJSHandle): GuestOutcome {
    if (this.pending.size > 0)
      return failure(
        'UNAWAITED_TOOL_CALLS',
        `The script returned while ${this.pending.size} tool call(s) were still pending.`,
      );
    const serialized = this.inSlice(() =>
      this.context.callFunction(
        this.helper('serialize'),
        this.context.undefined,
        value,
      ),
    );
    if (serialized.error) {
      const outcome = this.classifyError(serialized.error, 'RESULT_NOT_JSON');
      serialized.error.dispose();
      return outcome;
    }
    const text = this.context.getString(serialized.value);
    serialized.value.dispose();
    if (text.startsWith('E')) {
      const code =
        text.slice(1) === 'RESULT_TOO_LARGE'
          ? 'RESULT_TOO_LARGE'
          : 'RESULT_NOT_JSON';
      return failure(
        code,
        code === 'RESULT_TOO_LARGE'
          ? `The return value is nested deeper than ${this.limits.maxResultDepth} levels.`
          : 'The return value is not JSON data (cycle, function, symbol, bigint or non-finite number).',
      );
    }
    const json = text.slice(1);
    if (utf8Length(json) > this.limits.maxResultBytes)
      return failure(
        'RESULT_TOO_LARGE',
        `The return value exceeds ${this.limits.maxResultBytes} bytes when serialized.`,
      );
    return { kind: 'complete', value: JSON.parse(json) as JsonValue };
  }

  private classifyError(
    error: QuickJSHandle,
    fallback: GuestFailureCode,
  ): GuestOutcome {
    const stopped = this.stoppedOutcome();
    if (stopped !== undefined) return stopped;
    const detail = this.describeError(error);
    const lower = detail.toLowerCase();
    if (lower.includes('stack overflow'))
      return failure('STACK_LIMIT', 'The script exceeded the stack limit.');
    if (lower.includes('out of memory'))
      return failure('MEMORY_LIMIT', 'The script exceeded the memory limit.');
    return failure(fallback, detail);
  }

  /** The outcome of a run stopped by a recorded violation or the CPU cap. */
  private stoppedOutcome(): GuestOutcome | undefined {
    if (this.terminal !== undefined) return this.terminal;
    if (this.cpuExceeded)
      return failure(
        'CPU_LIMIT',
        `The script used more than ${this.limits.cpuMs} ms of CPU time.`,
      );
    return undefined;
  }

  private describeError(error: QuickJSHandle): string {
    const dumped: unknown = this.inSlice(() => this.context.dump(error));
    const text =
      isPlainRecord(dumped) &&
      typeof dumped['name'] === 'string' &&
      typeof dumped['message'] === 'string'
        ? `${dumped['name']}: ${dumped['message']}`
        : String(dumped);
    return text.slice(0, MAX_ERROR_DETAIL);
  }
}
