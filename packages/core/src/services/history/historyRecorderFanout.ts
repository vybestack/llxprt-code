/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { opToEnvelope } from './historyJournalEnvelope.js';
import type { HistoryJournalOp } from './historyJournalStore.js';
import { acceptsHistoryOrigin } from './historyOriginId.js';

interface FanoutBinding {
  readonly origin: string;
  readonly recorder: SessionRecordingService;
}

interface StagedEffect {
  readonly binding: FanoutBinding;
  readonly op: HistoryJournalOp;
}

/**
 * Per-origin recorder bindings behind one history. Each binding records the
 * ops of its own origin plus unowned ops and skips foreign-origin ops.
 *
 * Publication is two-phase. `stage` only remembers which bindings accept an
 * op; nothing reaches a recorder until `commit`, so a mutation that fails
 * after staging calls `discard` and no binding observes any of its effects.
 * `commit` enqueues every staged effect, and if any recorder refuses, the
 * rest still run (the failure of one binding must not starve another) and
 * the failures are rethrown together.
 */
export class HistoryRecorderFanout {
  private readonly bindings: FanoutBinding[] = [];
  private staged: StagedEffect[] = [];

  get size(): number {
    return this.bindings.length;
  }

  /** Re-binding an origin replaces that origin's recorder; others are untouched. */
  bind(origin: string, recorder: SessionRecordingService): void {
    const index = this.bindings.findIndex((entry) => entry.origin === origin);
    const binding = { origin, recorder };
    if (index >= 0) this.bindings[index] = binding;
    else this.bindings.push(binding);
  }

  unbind(recorder: SessionRecordingService): boolean {
    const index = this.bindings.findIndex(
      (entry) => entry.recorder === recorder,
    );
    if (index < 0) return false;
    this.bindings.splice(index, 1);
    return true;
  }

  has(recorder: SessionRecordingService): boolean {
    return this.bindings.some((entry) => entry.recorder === recorder);
  }

  stage(op: HistoryJournalOp): void {
    for (const binding of this.bindings)
      if (acceptsHistoryOrigin(binding.origin, op.origin))
        this.staged.push({ binding, op });
  }

  discard(): void {
    this.staged = [];
  }

  commit(): void {
    const effects = this.staged;
    this.staged = [];
    const failures: unknown[] = [];
    const failed = new Set<FanoutBinding>();
    for (const { binding, op } of effects) {
      if (failed.has(binding)) continue;
      try {
        binding.recorder.requireCommittable();
        const { type, payload } = opToEnvelope(op);
        if (binding.recorder.enqueue(type, payload) === null)
          throw new Error(`Session recording is inactive (${type})`);
      } catch (error) {
        failed.add(binding);
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'Recorder fan-out failed');
  }
}
