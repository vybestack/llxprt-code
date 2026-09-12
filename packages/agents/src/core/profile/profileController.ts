/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Serialized executor for profile commands.
 *
 * The controller serializes command execution over the pure core reduction tree,
 * carrying its own committed state, live runtime, pending-destroy confirmations, and
 * a FIFO queue with per-command cancellation. Commands land as `busy` or `queued`
 * while another command is in flight; the queue drains reactively. Commit and save
 * routes attach new runtimes and persist documents through the agents-owned ports; the
 * caller never touches core's pure surface directly.
 */

import {
  deepFreeze,
  fingerprintsMatch,
  reduceProfileCommand,
} from '@vybestack/llxprt-code-core';
import type {
  ProfileCommand,
  ProfileCommandKind,
  ProfileCommandResult,
  ProfileEvent,
  ProfileReductionOutcome,
  ProfileState,
} from '@vybestack/llxprt-code-core';
import type {
  ControllerExecuteOptions,
  ProfileControllerDeps,
  QueuedProfileCommand,
} from './controllerTypes.js';
import type {
  CommitCandidateInput,
  CommitRouteOutcome,
} from './controllerCommit.js';
import { commitCandidate } from './controllerCommit.js';
import { executeSaveRoute } from './controllerSave.js';
import type { SaveRouteOutcome } from './controllerSave.js';
import { buildReductionEnvironment } from './controllerEnv.js';
import type { ActiveProfileRuntime } from './activeProfileRuntime.js';

/**
 * Revision of a workspace state; the unconfigured workspace has revision zero.
 */
function revisionOf(state: ProfileState): number {
  return state.status === 'configured' ? state.revision : 0;
}

/**
 * Redact an unexpected failure to the plain message a typed `failed` result carries:
 * no stack, no wrapper prefixes, nothing but the message itself.
 */
function redactError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The maximum number of reduction passes per command. The rewrite pass for a confirmed
 * discard bumps the count from zero to one; a second discard-authorized outcome would
 * mean the rewrite was ineffective, so the guard aborts instead of looping forever.
 */
const MAX_REDUCTION_PASSES = 2;

/**
 * Copy a queued command so later caller-side mutation cannot change what runs.
 *
 * Command fields are primitives except the `set` patch and the `confirm-discard`
 * pending payload; both are structured-cloned. The copy is deep-frozen before it
 * enters the queue so a queued command is immutable from submission to drain.
 */
function freezeQueuedCommand(command: ProfileCommand): ProfileCommand {
  const copy: ProfileCommand = { ...command };
  if (copy.kind === 'set') {
    return deepFreeze({ ...copy, patch: structuredClone(copy.patch) });
  }
  if (copy.kind === 'confirm-discard') {
    return deepFreeze({ ...copy, pending: structuredClone(copy.pending) });
  }
  return deepFreeze(copy);
}

/**
 * Serialized profile controller.
 *
 * `state` is the committed workspace: `{ status: 'unconfigured' }` until the
 * first commit or save lands. `runtime` is the live runtime for the committed
 * state, swapped when a new state commits. `pendingConfirmations` holds the original
 * command behind each outstanding discard token so a confirmed discard can be replayed
 * with destructive intent.
 */
export class ProfileController {
  private state: ProfileState = deepFreeze({ status: 'unconfigured' });
  private runtime: ActiveProfileRuntime | undefined;
  private queue: QueuedProfileCommand[] = [];
  private inFlight = false;
  private activeKind: ProfileCommandKind | undefined;
  private closed = false;
  private readonly pendingConfirmations = new Map<string, ProfileCommand>();
  private readonly deps: ProfileControllerDeps;

  constructor(deps: ProfileControllerDeps) {
    this.deps = deps;
  }

  /**
   * Adopt a new committed workspace state.
   *
   * The state graph is deep-frozen before it is stored — `ProfileState` carries no
   * functions, so freezing is safe — which means getState hands out a committed
   * document no caller can mutate. The live runtime's state view is re-supplied so
   * its snapshot always describes the adopted workspace, including transitions that
   * reuse the runtime (a save or an external-change promotion).
   */
  private adoptState(state: ProfileState): void {
    this.state = deepFreeze(state);
    this.runtime?.resupplyState(() => this.state);
  }

  private executionGuard(
    signal?: AbortSignal,
  ): ProfileCommandResult | undefined {
    const revision = revisionOf(this.state);
    if (signal?.aborted === true) {
      return { kind: 'cancelled', reason: 'execute cancelled', revision };
    }
    if (this.closed) {
      return { kind: 'failed', error: 'controller disposed', revision };
    }
    return undefined;
  }

  /**
   * Reconcile the active saved identity with its on-disk source before reduction.
   *
   * A source that disappeared or changed outside the controller detaches the
   * workspace to a draft (revision + 1, document and runtime preserved) so every
   * later step of the command — including no-op detection — runs against the
   * promoted state instead of a saved identity whose file no longer backs it.
   */
  private async reconcileSavedSource(signal?: AbortSignal): Promise<void> {
    if (
      this.state.status !== 'configured' ||
      this.state.identity.kind !== 'saved'
    ) {
      return;
    }
    const now = await this.deps.repository.stat(this.state.identity.name);
    if (this.executionGuard(signal) !== undefined) {
      return;
    }
    if (now !== null && fingerprintsMatch(now, this.state.identity.source)) {
      return;
    }
    this.adoptState({
      ...this.state,
      revision: this.state.revision + 1,
      identity: {
        kind: 'draft',
        derivedFrom: {
          name: this.state.identity.name,
          source: this.state.identity.source,
        },
      },
    });
  }

  /**
   * The committed workspace state, frozen against mutation.
   */
  getState(): ProfileState {
    return this.state;
  }

  /**
   * The live runtime bound to the committed state, if any.
   */
  getRuntime(): ActiveProfileRuntime | undefined {
    return this.runtime;
  }

  /**
   * Confirmation tokens awaiting a `confirm-discard` command.
   */
  getPendingConfirmations(): readonly string[] {
    return [...this.pendingConfirmations.keys()];
  }

  /**
   * Execute a command.
   *
   * While a command is in flight: a non-queueing caller gets `busy` immediately,
   * otherwise the command is queued with its own signal and answered `queued`. When
   * idle, the command runs immediately and the queue drains afterwards.
   */
  async execute(
    command: ProfileCommand,
    options?: ControllerExecuteOptions,
  ): Promise<ProfileCommandResult> {
    const stopped = this.executionGuard(options?.signal);
    if (stopped !== undefined) {
      return stopped;
    }
    if (this.inFlight) {
      if (options?.queue === false) {
        return {
          kind: 'busy',
          activeCommandKind: this.activeKind ?? command.kind,
          revision: revisionOf(this.state),
        };
      }
      const copy = freezeQueuedCommand(command);
      this.queue.push({ command: copy, signal: options?.signal });
      this.emit('command-queued', command.kind, revisionOf(this.state));
      return {
        kind: 'queued',
        baseRevision: revisionOf(this.state),
        revision: revisionOf(this.state),
      };
    }

    this.inFlight = true;
    this.activeKind = command.kind;
    try {
      return await this.runCommand(command, options?.signal);
    } finally {
      await this.drain();
    }
  }

  /**
   * Dispose the controller: drop queued commands and pending confirmations, then
   * release the live runtime best-effort. A hanging or failing disposal is isolated.
   *
   * Setting `closed` first lets any commit route still in flight observe the disposal
   * at its next await boundary and bail out with a typed failure instead of landing a
   * runtime after teardown.
   */
  async dispose(): Promise<void> {
    this.closed = true;
    this.queue = [];
    this.pendingConfirmations.clear();
    const runtime = this.runtime;
    this.runtime = undefined;
    if (runtime !== undefined) {
      try {
        await runtime[Symbol.asyncDispose]();
      } catch {
        // best-effort teardown; disposal failure must not surface to the caller
      }
    }
  }

  /**
   * Run one command, translating unexpected throws into typed `failed` results.
   *
   * A route that throws must never reject the caller of an already-committed command
   * (the drain shares this method, and queued callers were already answered `queued`),
   * nor leave the serialization lock held: every failure lands as a result plus a
   * `command-rejected` event.
   */
  private async runCommand(
    command: ProfileCommand,
    signal?: AbortSignal,
  ): Promise<ProfileCommandResult> {
    try {
      return await this.process(command, signal);
    } catch (error) {
      const stopped = this.executionGuard(signal);
      if (stopped !== undefined) {
        return stopped;
      }
      const result: ProfileCommandResult = {
        kind: 'failed',
        error: redactError(error),
        revision: revisionOf(this.state),
      };
      this.emit('command-rejected', command.kind, result.revision);
      return result;
    }
  }

  /**
   * Run one reduction pass, applying the outcome, then continue queued commands.
   */
  private async process(
    command: ProfileCommand,
    signal?: AbortSignal,
  ): Promise<ProfileCommandResult> {
    const before = this.executionGuard(signal);
    if (before !== undefined) {
      return before;
    }
    await this.reconcileSavedSource(signal);
    const afterReconcile = this.executionGuard(signal);
    if (afterReconcile !== undefined) {
      return afterReconcile;
    }
    let current = command;
    for (let pass = 0; pass < MAX_REDUCTION_PASSES; pass += 1) {
      this.emit('command-started', current.kind, revisionOf(this.state));
      const env = await buildReductionEnvironment(
        this.state,
        current,
        this.deps,
      );
      const afterEnvironment = this.executionGuard(signal);
      if (afterEnvironment !== undefined) {
        return afterEnvironment;
      }
      const outcome = reduceProfileCommand(this.state, current, env);
      const result = await this.applyOutcome(current, outcome, signal);
      if (result.rewritten !== undefined) {
        current = result.rewritten;
        continue;
      }
      return result.result;
    }
    this.emit('command-rejected', current.kind, revisionOf(this.state));
    return {
      kind: 'invalid',
      errors: ['confirmation rewrite exceeded maximum passes'],
      revision: revisionOf(this.state),
    };
  }

  /**
   * Apply a reduction outcome. A confirmed discard yields a rewritten command instead of
   * a result so the discard replay can proceed on the next pass.
   */
  private async applyOutcome(
    command: ProfileCommand,
    outcome: ProfileReductionOutcome,
    signal: AbortSignal | undefined,
  ): Promise<
    | { result: ProfileCommandResult; rewritten?: undefined }
    | { result?: undefined; rewritten: ProfileCommand }
  > {
    switch (outcome.kind) {
      case 'unverified':
        this.emit('command-rejected', command.kind, revisionOf(this.state));
        return {
          result: {
            kind: 'unverified',
            constraints: [...outcome.constraints],
            revision: revisionOf(this.state),
          },
        };
      case 'stale':
        this.emit('command-rejected', command.kind, revisionOf(this.state));
        return {
          result: {
            kind: 'stale',
            expectedRevision: outcome.expectedRevision,
            currentRevision: outcome.currentRevision,
            revision: revisionOf(this.state),
          },
        };
      case 'invalid':
        this.emit('command-rejected', command.kind, revisionOf(this.state));
        return {
          result: {
            kind: 'invalid',
            errors: [...outcome.errors],
            revision: revisionOf(this.state),
          },
        };
      case 'no-op':
        this.emit('command-no-op', command.kind, revisionOf(this.state));
        return {
          result: {
            kind: 'no-op',
            reason: outcome.reason,
            revision: revisionOf(this.state),
          },
        };
      case 'confirmation-required':
        this.pendingConfirmations.set(outcome.pending.token, command);
        return {
          result: {
            kind: 'confirmation-required',
            pending: outcome.pending,
            revision: revisionOf(this.state),
          },
        };
      case 'discard-authorized':
        return this.authorizeDiscard(command);
      case 'save': {
        const saved = await this.saveRoute(outcome, signal);
        return { result: saved.result };
      }
      case 'candidate': {
        const committed = await this.commitRoute(outcome, command, signal);
        return { result: committed.result };
      }
      default:
        throw new Error('unreachable reduction outcome');
    }
  }

  /**
   * Turn a discard authorization into the replayed command, or reject an unexpected
   * token.
   */
  private authorizeDiscard(
    command: ProfileCommand,
  ):
    | { result: ProfileCommandResult; rewritten?: undefined }
    | { result?: undefined; rewritten: ProfileCommand } {
    if (command.kind !== 'confirm-discard') {
      this.emit('command-rejected', command.kind, revisionOf(this.state));
      return {
        result: {
          kind: 'invalid',
          errors: ['confirm-discard required for discard authorization'],
          revision: revisionOf(this.state),
        },
      };
    }
    const original = this.pendingConfirmations.get(command.pending.token);
    if (original === undefined) {
      this.emit('command-rejected', command.kind, revisionOf(this.state));
      return {
        result: {
          kind: 'invalid',
          errors: ['unknown confirmation token'],
          revision: revisionOf(this.state),
        },
      };
    }
    if (command.pending.commandKind !== original.kind) {
      this.emit('command-rejected', command.kind, revisionOf(this.state));
      return {
        result: {
          kind: 'invalid',
          errors: ['confirmation command kind mismatch'],
          revision: revisionOf(this.state),
        },
      };
    }
    this.pendingConfirmations.delete(command.pending.token);
    return { rewritten: this.withDiscardIntent(original) };
  }

  /**
   * Persist a save outcome and move the workspace to the bound saved state.
   *
   * The terminal event fires only after the state is adopted, so listeners observe the
   * committed workspace; a conflict result is announced as a rejection, not a commit.
   */
  private async saveRoute(
    outcome: Extract<ProfileReductionOutcome, { kind: 'save' }>,
    signal?: AbortSignal,
  ): Promise<SaveRouteOutcome> {
    const saved = await executeSaveRoute(
      this.state,
      outcome.name,
      outcome.document,
      outcome.revision,
      this.deps,
      () => this.closed,
      signal,
    );
    this.adoptState(saved.newState);
    const stopped = this.executionGuard(signal);
    if (stopped !== undefined) {
      return { result: stopped, newState: this.state };
    }
    this.emitResultEvent(saved.result, 'save');
    return saved;
  }

  /**
   * Commit a candidate: swap in the new runtime when one is produced, otherwise adopt
   * the new state when it moves forward.
   *
   * The commit route never emits; the terminal event fires here, after the controller
   * has adopted the outcome's state and runtime, so a listener reading state during the
   * event always sees the revision the event announces.
   */
  private async commitRoute(
    outcome: Extract<ProfileReductionOutcome, { kind: 'candidate' }>,
    command: ProfileCommand,
    signal: AbortSignal | undefined,
  ): Promise<CommitRouteOutcome> {
    const candidate: CommitCandidateInput = {
      document: outcome.document,
      identity: outcome.identity,
      ...(outcome.activeMember === undefined
        ? {}
        : { activeMember: outcome.activeMember }),
      commandKind: command.kind,
      baseRevision: outcome.baseRevision,
      nextRevision: outcome.nextRevision,
    };
    const committed = await commitCandidate(
      this.state,
      candidate,
      command,
      this.deps,
      this.runtime,
      () => this.closed,
      (committed) => this.adoptCommit(committed),
      signal,
    );
    this.emitResultEvent(committed.result, committed.commandKind);
    return committed;
  }

  private adoptCommit(committed: CommitRouteOutcome): void {
    if (committed.newRuntime !== undefined) {
      const prior = this.runtime;
      this.runtime = committed.newRuntime;
      this.adoptState(committed.newState);
      if (
        prior !== undefined &&
        prior.getBinding() !== committed.newRuntime.getBinding()
      ) {
        // The reuse path carries the prior binding into the new runtime; disposing
        // the prior runtime here would dispose the binding that is still live.
        void prior[Symbol.asyncDispose]().catch(() => {});
      }
    } else if (
      committed.newState !== this.state &&
      revisionOf(committed.newState) > revisionOf(this.state)
    ) {
      this.adoptState(committed.newState);
    }
  }

  /**
   * Replay a confirmed-destroy command with destructive intent.
   *
   * Workspace replacements replay with `discardUnsaved` set.
   */
  private withDiscardIntent(command: ProfileCommand): ProfileCommand {
    if (
      command.kind === 'load' ||
      command.kind === 'startup' ||
      command.kind === 'setup' ||
      command.kind === 'provider'
    ) {
      return { ...command, discardUnsaved: true };
    }
    return command;
  }

  /**
   * Drain the queue, then release the in-flight lock.
   *
   * Every queued command runs through {@link runCommand}, so a route that throws is
   * recorded as a typed failure plus a `command-rejected` event instead of escaping the
   * drain. The lock release sits in a finally around the whole loop: no failure path can
   * leave the controller permanently busy.
   */
  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next === undefined) {
          break;
        }
        this.activeKind = next.command.kind;
        await this.runCommand(next.command, next.signal);
      }
    } finally {
      this.inFlight = false;
      this.activeKind = undefined;
    }
  }

  /**
   * Emit the terminal event a command result announces.
   *
   * Committed results announce commits; conflicts, staleness, invalidity, build
   * failures, and cancellations all announce rejections or cancellations rather than a
   * commit. `queued` and `busy` results have no terminal event: queued callers were
   * answered at enqueue time and busy callers were never running.
   */
  private emitResultEvent(
    result: ProfileCommandResult,
    commandKind: ProfileCommandKind,
  ): void {
    switch (result.kind) {
      case 'committed':
        this.emit('committed', commandKind, result.revision);
        return;
      case 'cancelled':
        this.emit('command-cancelled', commandKind, result.revision);
        return;
      case 'no-op':
        this.emit('command-no-op', commandKind, result.revision);
        return;
      case 'queued':
      case 'busy':
      case 'confirmation-required':
        return;
      default:
        this.emit('command-rejected', commandKind, result.revision);
    }
  }

  /**
   * Fan a controller event out to the registered listeners, isolating each one.
   *
   * Events are deep-frozen before dispatch: a listener can neither mutate the event for
   * later listeners nor retain a mutable handle into controller state.
   */
  private emit(
    type: ProfileEvent['type'],
    commandKind: ProfileCommandKind | null,
    revision: number,
  ): void {
    if (this.closed) {
      return;
    }
    const event: ProfileEvent = deepFreeze({
      type,
      agentId: this.deps.agentId,
      commandKind,
      revision,
      at: Date.now(),
    });
    for (const listener of this.deps.listeners ?? []) {
      try {
        listener(event);
      } catch {
        // a throwing listener must not break command processing
      }
    }
  }
}
