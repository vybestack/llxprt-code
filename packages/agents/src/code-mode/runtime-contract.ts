/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Host-facing contract of the code mode script runtime (issue #4084).
 *
 * The runtime evaluates model-written JavaScript inside QuickJS-WASM in a
 * dedicated subprocess. Everything that crosses the boundary is JSON data;
 * every terminal failure carries one of the named codes below.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export type ResultCompleteness = 'complete' | 'partial' | 'unknown';

export type ScriptToolResult =
  | {
      readonly ok: true;
      readonly value: JsonValue;
      readonly completeness: ResultCompleteness;
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

export interface ScriptRunRequest {
  readonly language: 'javascript';
  readonly source: string;
  readonly tools: readonly string[];
  readonly apiRevision: string;
  readonly purpose: string;
}

export interface ScriptCall {
  /** Host-side sequence number of the accepted call, starting at 1. */
  readonly requestId: number;
  readonly tool: string;
  readonly args: JsonObject;
  /** Aborted when the run reaches a terminal state before this call settles. */
  readonly signal: AbortSignal;
}

/** Codes the trusted wrapper may report in a failure frame. */
export const GUEST_FAILURE_CODES = [
  'CPU_LIMIT',
  'MEMORY_LIMIT',
  'STACK_LIMIT',
  'CALL_LIMIT',
  'PENDING_LIMIT',
  'ARGUMENTS_TOO_LARGE',
  'INVALID_ARGUMENTS',
  'CONSOLE_LIMIT',
  'RESULT_TOO_LARGE',
  'RESULT_NOT_JSON',
  'UNAWAITED_TOOL_CALLS',
  'UNRESOLVED_PROMISE',
  'SYNTAX_ERROR',
  'SCRIPT_ERROR',
  'PROTOCOL_ERROR',
] as const;

export type GuestFailureCode = (typeof GUEST_FAILURE_CODES)[number];

/** Codes produced by the host side of the runtime. */
export type HostFailureCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'SOURCE_TOO_LARGE'
  | 'INPUT_BYTES_LIMIT'
  | 'PROTOCOL_ERROR'
  | 'RUNTIME_UNAVAILABLE'
  | 'HOST_ERROR';

export type CodeModeErrorCode = GuestFailureCode | HostFailureCode | string;

export type CodeModeRunResult =
  | {
      readonly ok: true;
      readonly value: JsonValue;
      readonly callCount: number;
      readonly logs: readonly string[];
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: CodeModeErrorCode;
        readonly message: string;
      };
      readonly callCount: number;
      readonly logs: readonly string[];
    };

/**
 * Thrown (rejected) by an invoke callback to end the whole run with a named
 * error, for example a policy denial or a headless approval requirement. Any
 * other rejection ends the run with HOST_ERROR. Ordinary tool failures are
 * returned as `{ ok: false }` results instead, so the script can handle them.
 */
export class ScriptRunTermination extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ScriptRunTermination';
  }
}

export type ScriptInvoker = (call: ScriptCall) => Promise<ScriptToolResult>;

export interface CodeModeRuntime {
  run(
    request: ScriptRunRequest,
    invoke: ScriptInvoker,
    signal: AbortSignal,
  ): Promise<CodeModeRunResult>;
}

export interface CodeModeLimits {
  /** Script source size, checked before the subprocess starts. */
  readonly maxSourceBytes: number;
  /** QuickJS heap cap. */
  readonly memoryBytes: number;
  /** QuickJS stack cap. */
  readonly stackBytes: number;
  /** Cumulative guest CPU time; enforced by the interpreter interrupt. */
  readonly cpuMs: number;
  /** Host wall deadline for the whole run, including nested tool calls. */
  readonly wallTimeoutMs: number;
  readonly maxCalls: number;
  readonly maxPendingCalls: number;
  /** Serialized arguments of one nested call. */
  readonly maxCallArgumentBytes: number;
  /** Serialized result of one nested call delivered to the guest. */
  readonly maxResponseBytes: number;
  /** Cumulative serialized results delivered to the guest. */
  readonly maxInputBytes: number;
  readonly maxConsoleBytes: number;
  readonly maxConsoleLines: number;
  /** Serialized final value. */
  readonly maxResultBytes: number;
  /** Nesting depth of the final value. */
  readonly maxResultDepth: number;
}

export const DEFAULT_CODE_MODE_LIMITS: CodeModeLimits = Object.freeze({
  maxSourceBytes: 256 * 1024,
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024,
  cpuMs: 5_000,
  wallTimeoutMs: 300_000,
  maxCalls: 64,
  maxPendingCalls: 16,
  maxCallArgumentBytes: 64 * 1024,
  maxResponseBytes: 1024 * 1024,
  maxInputBytes: 8 * 1024 * 1024,
  maxConsoleBytes: 16 * 1024,
  maxConsoleLines: 256,
  maxResultBytes: 16 * 1024,
  maxResultDepth: 64,
});

export const CODE_MODE_LIMIT_KEYS = Object.freeze(
  Object.keys(DEFAULT_CODE_MODE_LIMITS) as Array<keyof CodeModeLimits>,
);

export function isCodeModeLimits(value: unknown): value is CodeModeLimits {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== CODE_MODE_LIMIT_KEYS.length) return false;
  return CODE_MODE_LIMIT_KEYS.every((key) => {
    const limit = value[key];
    return (
      typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0
    );
  });
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Validates data as a JSON value: finite numbers, plain objects, arrays, no
 * cycles, bounded depth. Shared (acyclic) references are allowed because
 * JSON serialization simply repeats them.
 */
export function isJsonValue(value: unknown, maxDepth = 64): value is JsonValue {
  return isJsonNode(value, 0, maxDepth, new Set<object>());
}

function isJsonNode(
  value: unknown,
  depth: number,
  maxDepth: number,
  ancestors: Set<object>,
): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (depth >= maxDepth || typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;
  if (!Array.isArray(value) && !isPlainRecord(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every((child) =>
    isJsonNode(child, depth + 1, maxDepth, ancestors),
  );
  ancestors.delete(value);
  return valid;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isPlainRecord(value) && isJsonValue(value);
}

function isCompleteness(value: unknown): boolean {
  return value === 'complete' || value === 'partial' || value === 'unknown';
}

function isToolError(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    Object.keys(value).length === 2 &&
    typeof value['code'] === 'string' &&
    typeof value['message'] === 'string'
  );
}

export function isScriptToolResult(value: unknown): value is ScriptToolResult {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort().join('|');
  if (value['ok'] === true)
    return (
      keys === 'completeness|ok|value' &&
      isJsonValue(value['value']) &&
      isCompleteness(value['completeness'])
    );
  return (
    value['ok'] === false && keys === 'error|ok' && isToolError(value['error'])
  );
}

export function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
