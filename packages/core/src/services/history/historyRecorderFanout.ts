/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordingPort } from '../../recording/recordingPort.js';
import type { SessionEventType } from '../../recording/types.js';
import { acceptsHistoryOrigin, payloadOrigin } from './historyOriginId.js';

interface FanoutBinding {
  readonly origin: string;
  readonly recorder: RecordingPort;
}

export function rethrow(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

/**
 * Per-origin recorder bindings behind one history. Each binding records the
 * rows of its own origin plus unowned rows and skips foreign-origin rows.
 * Once a fan-out is active the history's primary journal is hidden and holds
 * every row; the bindings are filtered mirrors of it.
 */
export class HistoryRecorderFanout {
  private readonly bindings: FanoutBinding[] = [];
  active = false;

  get size(): number {
    return this.bindings.length;
  }

  /** The origins that have a mirror. */
  get origins(): string[] {
    return this.bindings.map((entry) => entry.origin);
  }

  /** Append one record to the mirror of `origin`; a refusing recorder throws. */
  send(origin: string, type: SessionEventType, payload: unknown): void {
    const binding = this.bindings.find((entry) => entry.origin === origin);
    if (binding === undefined)
      throw new Error(`History fan-out has no mirror for origin ${origin}`);
    binding.recorder.requireCommittable();
    if (binding.recorder.enqueue(type, payload) === null)
      throw new Error(`Session recording is inactive (${type})`);
  }

  /**
   * Resolve once every record handed to a mirror is on disk. `send` and
   * `deliver` only enqueue, so a caller that reports a mutation durable has to
   * wait here; every mirror is flushed before failures are rethrown together.
   */
  async flush(): Promise<void> {
    const results = await Promise.allSettled(
      this.bindings.map((entry) => entry.recorder.flush()),
    );
    rethrow(
      results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      ),
      'Recorder fan-out flush failed',
    );
  }

  /** Re-binding an origin replaces that origin's recorder; others are untouched. */
  bind(origin: string, recorder: RecordingPort): void {
    const index = this.bindings.findIndex((entry) => entry.origin === origin);
    const binding = { origin, recorder };
    if (index >= 0) this.bindings[index] = binding;
    else this.bindings.push(binding);
  }

  unbind(recorder: RecordingPort): boolean {
    const index = this.bindings.findIndex(
      (entry) => entry.recorder === recorder,
    );
    if (index < 0) return false;
    this.bindings.splice(index, 1);
    return true;
  }

  has(recorder: RecordingPort): boolean {
    return this.bindings.some((entry) => entry.recorder === recorder);
  }

  /**
   * Hand one committed primary row to every accepting binding. One refusing
   * recorder does not starve the others; failures are rethrown together.
   */
  deliver(type: SessionEventType, payload: unknown): void {
    const origin = payloadOrigin(payload);
    const failures: unknown[] = [];
    for (const binding of this.bindings) {
      if (!acceptsHistoryOrigin(binding.origin, origin)) continue;
      try {
        binding.recorder.requireCommittable();
        if (binding.recorder.enqueue(type, payload) === null)
          throw new Error(`Session recording is inactive (${type})`);
      } catch (error) {
        failures.push(error);
      }
    }
    rethrow(failures, 'Recorder fan-out failed');
  }
}
