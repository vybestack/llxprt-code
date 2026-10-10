/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HookModelRowsInput } from './hookModelInputStream.js';
import { assertSnapshotTextRequest } from './hookSnapshotTextRequest.js';
import type { HookLLMRequest, HookLLMResponse } from './hookTranslator.js';
import type { ProviderRequestRows } from '../services/history/provider-request-snapshot.js';
import type {
  HookOutputDocument,
  HookSnapshotResult,
} from './hookOutputSnapshot.js';

export type HookModelSnapshotRequest = Omit<
  HookLLMRequest,
  'version' | 'contents'
> & {
  readonly contents: ProviderRequestRows;
};
export class MissingSnapshotHookCallbackError extends Error {
  override readonly name = 'MissingSnapshotHookCallbackError';
  constructor(method: keyof HookModelSnapshotCallbacks) {
    super(`Missing snapshot callback: ${method}`);
  }
}

export interface HookModelSnapshotCallbacks {
  fireBeforeModelSnapshotEvent(
    request: HookModelSnapshotRequest,
    signal?: AbortSignal,
  ): Promise<AggregatedHookSnapshotResult>;
  fireAfterModelSnapshotEvent(
    request: HookModelSnapshotRequest,
    response: Omit<HookLLMResponse, 'version'>,
    signal?: AbortSignal,
  ): Promise<AggregatedHookSnapshotResult>;
}
export interface AggregatedHookSnapshotResult {
  readonly success: boolean;
  readonly finalOutput?: HookModelSnapshotOutput;
  readonly errors: readonly Error[];
  readonly totalDuration: number;
  close(): void;
}

/** Field replacement matches the model-event reducer; ancestor objects stay on disk. */
export class HookModelSnapshotOutput {
  private readonly control = new Map<string, unknown>();
  private retained:
    | { readonly response: unknown; readonly systemMessage: unknown }
    | undefined;
  constructor(private readonly outputs: readonly HookOutputDocument[]) {
    for (const field of ['continue', 'decision', 'reason', 'stopReason'])
      this.control.set(field, this.readValue([field]));
  }

  private selected(
    path: ReadonlyArray<string | number>,
  ): HookOutputDocument | undefined {
    const field =
      path[0] === 'hookSpecificOutput' ? path.slice(0, 2) : path.slice(0, 1);
    for (let index = this.outputs.length - 1; index >= 0; index--) {
      const output = this.outputs[index];
      if (output.hasValue(field)) return output;
    }
    return undefined;
  }

  readValue(path: ReadonlyArray<string | number>): unknown {
    if (
      path.length === 0 ||
      (path[0] === 'hookSpecificOutput' && path.length === 1)
    )
      throw new Error('Select a snapshot output field, not an ancestor');
    const field = path[0];
    if (
      path.length === 1 &&
      typeof field === 'string' &&
      this.control.has(field)
    )
      return this.control.get(field);
    return this.selected(path)?.readValue(path);
  }

  /** Copies the small decision payload before eager disposal closes the disk outputs. */
  retainDecisionPayload(): void {
    this.retained ??= {
      response: this.readValue(['hookSpecificOutput', 'llm_response']),
      systemMessage: this.readValue(['systemMessage']),
    };
  }

  readLlmResponse(): unknown {
    return this.retained === undefined
      ? this.readValue(['hookSpecificOutput', 'llm_response'])
      : this.retained.response;
  }

  readSystemMessage(): string | undefined {
    const message =
      this.retained === undefined
        ? this.readValue(['systemMessage'])
        : this.retained.systemMessage;
    return typeof message === 'string' ? message : undefined;
  }

  shouldStopExecution(): boolean {
    return this.control.get('continue') === false;
  }
  isBlockingDecision(): boolean {
    const decision = this.control.get('decision');
    return decision === 'block' || decision === 'deny';
  }
  getEffectiveReason(): string {
    const reason = this.control.get('stopReason') ?? this.control.get('reason');
    return typeof reason === 'string' && reason !== ''
      ? reason
      : 'No reason provided';
  }

  assertTextRequest(): void {
    for (const output of this.outputs) assertSnapshotTextRequest(output);
  }

  applyRequestRows(
    target: HookModelRowsInput['llm_request'],
  ): HookModelRowsInput['llm_request'] {
    return (
      this.selected(['hookSpecificOutput', 'llm_request'])?.mergeRequestRows(
        target,
      ) ?? target
    );
  }
}

export function aggregateHookSnapshots(
  results: readonly HookSnapshotResult[],
  signal?: AbortSignal,
): AggregatedHookSnapshotResult {
  const outputs = results.flatMap((result) =>
    result.output === undefined ? [] : [result.output],
  );
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', close);
    disposeHookSnapshots(results);
  };
  try {
    const finalOutput =
      outputs.length === 0 ? undefined : new HookModelSnapshotOutput(outputs);
    const errors = results.flatMap((result) => {
      if (result.error !== undefined) return [result.error];
      if (result.success) return [];
      return [
        new Error(
          `Hook ${result.hookConfig.name ?? 'command'} exited with code ${result.exitCode ?? 'unknown'}`,
        ),
      ];
    });
    const success =
      results.every((result) => result.success) && errors.length === 0;
    const aggregated = {
      success,
      finalOutput,
      errors,
      totalDuration: results.reduce((sum, result) => sum + result.duration, 0),
      close,
    };
    signal?.addEventListener('abort', close, { once: true });
    const decided =
      finalOutput !== undefined &&
      (finalOutput.shouldStopExecution() || finalOutput.isBlockingDecision());
    if (decided) finalOutput.retainDecisionPayload();
    if (signal?.aborted === true || !success || decided) close();
    return aggregated;
  } catch (error) {
    close();
    throw error;
  }
}

export function disposeHookSnapshots(
  results: readonly HookSnapshotResult[],
): void {
  let failure: unknown;
  for (const result of results) {
    try {
      result.dispose();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
}
