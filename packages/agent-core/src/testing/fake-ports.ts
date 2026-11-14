/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  DecisionPort,
  DecisionRequest,
  ModelClient,
  ModelPort,
  ModelRef,
  ResponseFor,
  SessionId,
  SessionStore,
  ToolCatalog,
  ToolHandle,
  ToolId,
  ToolSet,
  JournalRecord,
  Unavailable,
} from '../types.js';

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

export type ScriptedModelResolver = (
  ref: ModelRef,
  signal: AbortSignal,
) => Promise<ModelClient>;

export class ScriptedModel implements ModelPort {
  constructor(private readonly resolveClient: ScriptedModelResolver) {}

  resolve(ref: ModelRef, signal: AbortSignal): Promise<ModelClient> {
    throwIfAborted(signal);
    return this.resolveClient(ref, signal);
  }
}

export class MemoryTools implements ToolCatalog {
  readonly #revocation = new AbortController();

  constructor(private readonly available: readonly ToolHandle[]) {}

  async pin(ids: readonly ToolId[], signal: AbortSignal): Promise<ToolSet> {
    throwIfAborted(signal);
    const requested = new Set(ids);
    return {
      tools: this.available.filter((tool) => requested.has(tool.descriptor.id)),
      revoked: this.#revocation.signal,
    };
  }

  revoke(): void {
    this.#revocation.abort(new Error('Tool capability revoked.'));
  }
}

export type ScriptedDecisionResolver = <R extends DecisionRequest>(
  request: R,
  signal: AbortSignal,
) => Promise<ResponseFor<R> | Unavailable>;

export class ScriptedDecisions implements DecisionPort {
  readonly presence = 'human';

  constructor(private readonly resolveDecision: ScriptedDecisionResolver) {}

  decide<R extends DecisionRequest>(
    request: R,
    signal: AbortSignal,
  ): Promise<ResponseFor<R> | Unavailable> {
    throwIfAborted(signal);
    return this.resolveDecision(request, signal);
  }
}

export class FakeClock {
  #currentTime: number;

  constructor(startAt = 0) {
    this.#currentTime = startAt;
  }

  now(): number {
    return this.#currentTime;
  }

  async sleep(ms: number, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!Number.isFinite(ms) || ms < 0)
      throw new RangeError('Sleep duration must be nonnegative.');
    this.#currentTime += ms;
  }
}

export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<SessionId, readonly JournalRecord[]>();

  async append(
    session: SessionId,
    records: readonly JournalRecord[],
    signal: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const current = this.#sessions.get(session) ?? [];
    this.#sessions.set(session, [...current, ...records]);
  }

  async load(
    session: SessionId,
    signal: AbortSignal,
  ): Promise<readonly JournalRecord[]> {
    throwIfAborted(signal);
    return [...(this.#sessions.get(session) ?? [])];
  }
}
