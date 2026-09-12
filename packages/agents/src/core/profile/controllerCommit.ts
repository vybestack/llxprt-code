/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Commit route for the agents-side profile controller.
 *
 * Turns a reduction candidate into a live runtime. The candidate is first resolved into
 * a buildable spec (credential bindings and effective policy), then the scheduler
 * boundary holds a safe window across everything that follows: the state and on-disk
 * sources are rechecked against the command's expected revision inside the held window,
 * a binding is built or the prior one reused when the factory sees an effectively
 * unchanged spec, and the swap is committed by attaching the chosen binding to a new
 * {@link ActiveProfileRuntime} — all before the window closes, so no new work can
 * start between the recheck and the swap. The caller owns disposing the prior runtime
 * after the swap.
 *
 * Cancellation and controller disposal are rechecked after every await: an aborted or
 * disposed commit never lands, and every candidate binding built along the way is
 * disposed through a bounded ownership scope. Events are not emitted here; the
 * controller emits after it adopts the outcome.
 */

import {
  fingerprintsMatch,
  redactSecrets,
  resolveProfileCandidate,
  type CapturedStandardSource,
  type EffectiveToolPolicy,
  type ProfileCommand,
  type ProfileCommandKind,
  type ProfileCommandResult,
  type ProfileDocument,
  type ProfilePolicyIntent,
  type ProfileState,
  type ProfileRuntimeBinding,
  type WorkingProfileIdentity,
} from '@vybestack/llxprt-code-core';
import type { ProfileCandidateResolution } from '@vybestack/llxprt-code-core';
import type { ProfileControllerDeps } from './controllerTypes.js';
import { DEFAULT_DISPOSE_TIMEOUT_MS } from './controllerTypes.js';
import { ActiveProfileRuntime } from './activeProfileRuntime.js';

/**
 * Revision of a workspace state; the unconfigured workspace has revision zero.
 *
 * The reducer's revision gate treats an unconfigured state as revision zero, so every
 * stale check and result revision in the commit route must read revisions through this
 * helper instead of off the state directly.
 */
function revisionOf(state: ProfileState): number {
  return state.status === 'configured' ? state.revision : 0;
}

/**
 * Empty policy intent: resolves the candidate under the pure environment and session
 * ceilings, requesting no tools, shell mode, or approval narrowing of its own.
 */
const EMPTY_POLICY_INTENT: ProfilePolicyIntent = {};

/**
 * Proposed profile transition: the document, identity, and optional load-balancer member
 * capture to commit at the given revision range, plus the kind of the command that
 * produced the candidate (threaded into every outcome for event emission).
 */
export interface CommitCandidateInput {
  document: ProfileDocument;
  identity: WorkingProfileIdentity;
  activeMember?: CapturedStandardSource;
  commandKind: ProfileCommandKind;
  baseRevision: number;
  nextRevision: number;
}

/**
 * Outcome of the commit route: the command result, the state the workspace moves to,
 * the runtime swapped in, and the kind of the command that produced it (threaded so the
 * controller can emit the terminal event with the real command kind after adoption).
 * `newRuntime === undefined` keeps whatever runtime the caller already holds.
 */
export interface CommitRouteOutcome {
  result: ProfileCommandResult;
  commandKind: ProfileCommandKind;
  newState: ProfileState;
  newRuntime: ActiveProfileRuntime | undefined;
}

/**
 * A binding choice from the build/reuse step: either the binding to attach, or a
 * terminal failed result.
 */
type BindingChoice =
  | { chosen?: ProfileRuntimeBinding }
  | { outcome: CommitRouteOutcome };

/**
 * Result of a runtime swap: the fresh runtime, or a terminal failed result.
 */
type SwapResult =
  | { ok: true; newRuntime: ActiveProfileRuntime }
  | { ok: false; outcome: CommitRouteOutcome };

/**
 * Surface a resolution rejection as a terminal outcome, or proceed when valid.
 */
function resolutionFailure(
  state: ProfileState,
  commandKind: ProfileCommandKind,
  resolved: ProfileCandidateResolution,
): CommitRouteOutcome | undefined {
  if (resolved.status === 'invalid') {
    return {
      result: {
        kind: 'invalid',
        errors: [...resolved.errors],
        revision: revisionOf(state),
      },
      commandKind,
      newState: state,
      newRuntime: undefined,
    };
  }
  if (resolved.status === 'unverified') {
    return {
      result: {
        kind: 'unverified',
        constraints: [...resolved.unverifiedConstraints],
        revision: revisionOf(state),
      },
      commandKind,
      newState: state,
      newRuntime: undefined,
    };
  }
  return undefined;
}

/**
 * Terminal outcome for an aborted or disposed commit, or undefined when the commit may
 * proceed. Checked after every await so a cancellation or controller disposal that lands
 * mid-route stops the commit before anything is attached or adopted.
 */
function guardOutcome(
  state: ProfileState,
  commandKind: ProfileCommandKind,
  signal?: AbortSignal,
  isClosed?: () => boolean,
): CommitRouteOutcome | undefined {
  if (signal?.aborted === true) {
    return {
      result: {
        kind: 'cancelled',
        reason: 'execute cancelled',
        revision: revisionOf(state),
      },
      commandKind,
      newState: state,
      newRuntime: undefined,
    };
  }
  if (isClosed?.() === true) {
    return {
      result: {
        kind: 'failed',
        error: 'controller disposed',
        revision: revisionOf(state),
      },
      commandKind,
      newState: state,
      newRuntime: undefined,
    };
  }
  return undefined;
}

/**
 * Dispose one resource with a bounded race: a binding whose dispose hangs is abandoned
 * after `timeoutMs` instead of stalling the exit path, and the losing promise never
 * becomes an unhandled rejection. Dispose failures are swallowed; disposal is
 * best-effort by contract.
 */
async function boundedDispose(
  disposable: AsyncDisposable,
  timeoutMs: number,
): Promise<void> {
  const dispose = disposable[Symbol.asyncDispose]();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      dispose.then(undefined, () => {});
      reject(new Error(`dispose timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([dispose, timeoutPromise]);
  } catch {
    // bounded best-effort disposal: a hanging or failing dispose must not surface
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Ownership scope for resources created while committing a candidate.
 *
 * Every candidate binding built inside the commit route is tracked here. Success calls
 * {@link release} to hand ownership to the runtime; every other exit path calls
 * {@link disposeAll}, which disposes each tracked resource with a bounded race.
 */
class CandidateScope {
  private readonly tracked: AsyncDisposable[] = [];

  constructor(private readonly disposeTimeoutMs: number) {}

  track(disposable: AsyncDisposable): void {
    this.tracked.push(disposable);
  }

  /**
   * Success path: tracked resources now belong to the adopted runtime.
   */
  release(): void {
    this.tracked.length = 0;
  }

  /**
   * Failure/cancellation path: dispose every tracked resource.
   */
  async disposeAll(): Promise<void> {
    const pending = [...this.tracked];
    this.tracked.length = 0;
    for (const disposable of pending) {
      try {
        await boundedDispose(disposable, this.disposeTimeoutMs);
      } catch {
        // A synchronous dispose failure must not skip remaining resources.
      }
    }
  }
}

/**
 * Resolve a candidate into a buildable spec under the controller's ceilings.
 */
async function resolveCandidate(
  candidate: CommitCandidateInput,
  deps: ProfileControllerDeps,
): Promise<ProfileCandidateResolution> {
  return resolveProfileCandidate(
    {
      document: candidate.document,
      policyIntent:
        deps.getPolicyIntent?.(candidate.document) ?? EMPTY_POLICY_INTENT,
    },
    {
      catalog: deps.catalog,
      trust: deps.trust,
      session: deps.session,
      role: deps.role,
      repository: deps.repository,
    },
  );
}

/**
 * Recheck the workspace after the boundary gate: reject a stale command, detach a
 * saved identity to a draft when its source changed on disk, and reject the commit
 * when the candidate's own saved source (a load or startup target) changed between
 * the environment build and the boundary release. The controller emits the terminal
 * event for the returned outcome after it adopts the (possibly promoted) state.
 */
async function recheckForStale(
  state: ProfileState,
  candidate: CommitCandidateInput,
  command: ProfileCommand,
  deps: ProfileControllerDeps,
): Promise<CommitRouteOutcome | undefined> {
  if (revisionOf(state) !== command.expectedRevision) {
    return staleOutcome(state, command);
  }
  if (state.status === 'configured' && state.identity.kind === 'saved') {
    const now = await deps.repository.stat(state.identity.name);
    if (now === null || !fingerprintsMatch(now, state.identity.source)) {
      const externalNewState: ProfileState = {
        ...state,
        revision: state.revision + 1,
        identity: {
          kind: 'draft',
          derivedFrom: {
            name: state.identity.name,
            source: state.identity.source,
          },
        },
      };
      return {
        result: staleResult(
          command.expectedRevision,
          externalNewState.revision,
          state.revision,
        ),
        commandKind: candidate.commandKind,
        newState: externalNewState,
        newRuntime: undefined,
      };
    }
  }
  // The candidate's own source was loaded before the boundary was awaited; a file
  // that moved underneath it since must not commit as if it were fresh.
  if (candidate.identity.kind === 'saved') {
    const candidateNow = await deps.repository.stat(candidate.identity.name);
    if (
      candidateNow === null ||
      !fingerprintsMatch(candidateNow, candidate.identity.source)
    ) {
      return {
        result: staleResult(
          command.expectedRevision,
          revisionOf(state),
          revisionOf(state),
        ),
        commandKind: candidate.commandKind,
        newState: state,
        newRuntime: undefined,
      };
    }
  }
  return undefined;
}

function staleOutcome(
  state: ProfileState,
  command: ProfileCommand,
): CommitRouteOutcome {
  return {
    result: staleResult(
      command.expectedRevision,
      revisionOf(state),
      revisionOf(state),
    ),
    commandKind: command.kind,
    newState: state,
    newRuntime: undefined,
  };
}

function staleResult(
  expectedRevision: number,
  currentRevision: number,
  revision: number,
): ProfileCommandResult {
  return { kind: 'stale', expectedRevision, currentRevision, revision };
}

/**
 * Build or reuse the binding for a resolved candidate.
 *
 * A blank setup draft (empty provider and model) commits with no binding; the shortcut
 * applies to standard documents only, because v1 load-balancer parent documents carry
 * those same blank values and must always resolve through the runtime factory.
 * Otherwise the factory builds one, receiving the prior binding so the factory itself
 * can return it unchanged when the resolved spec is effectively unchanged — the
 * controller never constructs a duplicate just to throw it away.
 */
async function chooseBinding(
  state: ProfileState,
  candidate: CommitCandidateInput,
  resolved: ProfileCandidateResolution,
  deps: ProfileControllerDeps,
  priorRuntime: ActiveProfileRuntime | undefined,
  scope: CandidateScope,
): Promise<BindingChoice> {
  if (
    candidate.document.type !== 'loadbalancer' &&
    candidate.document.provider === '' &&
    candidate.document.model === ''
  ) {
    return {};
  }
  const priorBinding = priorRuntime?.getBinding();
  let binding: ProfileRuntimeBinding;
  try {
    binding = await deps.runtimeFactory.build(resolved.resolved, priorBinding);
  } catch (error) {
    return {
      outcome: {
        result: {
          kind: 'failed',
          error: redactSecrets(String(error)),
          revision: revisionOf(state),
        },
        commandKind: candidate.commandKind,
        newState: state,
        newRuntime: undefined,
      },
    };
  }
  if (binding !== priorBinding) {
    // A freshly built binding is a candidate resource until the swap lands: the scope
    // disposes it on any later failure, cancellation, or disposal exit path.
    scope.track(binding);
  }
  return { chosen: binding };
}

/**
 * Attach the chosen binding to a runtime for the next state.
 *
 * When the chosen binding is the prior runtime's binding (the factory reused it), the
 * new runtime inherits the prior runtime's health so degraded aspects survive the
 * wrapper swap. On failure the outcome is returned and the candidate scope — not this
 * function — disposes any fresh binding.
 */
function swapRuntime(
  state: ProfileState,
  commandKind: ProfileCommandKind,
  nextState: ProfileState,
  chosen: ProfileRuntimeBinding | undefined,
  priorRuntime: ActiveProfileRuntime | undefined,
  disposeTimeoutMs: number,
  policy: EffectiveToolPolicy,
): SwapResult {
  const newRuntime = new ActiveProfileRuntime(
    () => nextState,
    disposeTimeoutMs,
    policy,
  );
  try {
    if (chosen !== undefined) {
      const reusing =
        priorRuntime !== undefined && priorRuntime.getBinding() === chosen;
      if (reusing) {
        newRuntime.inheritHealthFrom(priorRuntime);
      }
      newRuntime.attach(chosen);
      if (reusing) {
        priorRuntime.releaseOwnership();
      }
    }
  } catch {
    return {
      ok: false,
      outcome: {
        result: {
          kind: 'failed',
          error: 'runtime swap failed',
          revision: revisionOf(state),
        },
        commandKind,
        newState: state,
        newRuntime: undefined,
      },
    };
  }
  return { ok: true, newRuntime };
}

/**
 * Result of the resolve/boundary/recheck preamble: either a terminal outcome that stops
 * the commit, or the resolved spec the commit may proceed with.
 */
type GateResult =
  | { kind: 'stop'; outcome: CommitRouteOutcome }
  | { kind: 'proceed'; resolved: ProfileCandidateResolution };

/**
 * Resolve the candidate and reject it before any boundary waiting.
 *
 * Resolution precedes the safe window so invalid or unverifiable candidates are
 * rejected without gating on the scheduler. The execute signal and the controller's
 * closed flag are rechecked after the await.
 */
async function resolveCandidateGate(
  state: ProfileState,
  candidate: CommitCandidateInput,
  deps: ProfileControllerDeps,
  isClosed: () => boolean,
  signal?: AbortSignal,
): Promise<GateResult> {
  const commandKind = candidate.commandKind;
  const resolved = await resolveCandidate(candidate, deps);
  const afterResolve = guardOutcome(state, commandKind, signal, isClosed);
  if (afterResolve !== undefined) {
    return { kind: 'stop', outcome: afterResolve };
  }
  const rejected = resolutionFailure(state, commandKind, resolved);
  if (rejected !== undefined) {
    return { kind: 'stop', outcome: rejected };
  }
  return { kind: 'proceed', resolved };
}

interface SafeWindowInput {
  state: ProfileState;
  candidate: CommitCandidateInput;
  command: ProfileCommand;
  resolved: ProfileCandidateResolution;
  deps: ProfileControllerDeps;
  priorRuntime: ActiveProfileRuntime | undefined;
  scope: CandidateScope;
  isClosed: () => boolean;
  signal: AbortSignal | undefined;
  disposeTimeoutMs: number;
  adopt: (outcome: CommitRouteOutcome) => void;
}

/**
 * Recheck, build, and swap inside a held safe window.
 *
 * Everything between the window opening and the swap landing runs here: the
 * stale/external-change recheck protects the commit from a workspace that moved or a
 * saved source that changed on disk, the binding is built or reused, and the swap is
 * prepared. Because the boundary holds the window across this whole function, no new
 * work can start between the recheck and the swap. The execute signal (or the
 * boundary's own signal) and the controller's closed flag are rechecked after every
 * await.
 */
async function commitUnderSafeWindow(
  input: SafeWindowInput,
): Promise<CommitRouteOutcome> {
  const { state, candidate, command, resolved, deps, priorRuntime, scope } =
    input;
  const { isClosed, signal, disposeTimeoutMs } = input;
  const commandKind = candidate.commandKind;

  const afterWindow = guardOutcome(state, commandKind, signal, isClosed);
  if (afterWindow !== undefined) {
    return afterWindow;
  }
  const rechecked = await recheckForStale(state, candidate, command, deps);
  const afterRecheck = guardOutcome(state, commandKind, signal, isClosed);
  if (afterRecheck !== undefined) {
    return afterRecheck;
  }
  if (rechecked !== undefined) {
    input.adopt(rechecked);
    return rechecked;
  }

  const choice = await chooseBinding(
    state,
    candidate,
    resolved,
    deps,
    priorRuntime,
    scope,
  );
  if ('outcome' in choice) {
    await scope.disposeAll();
    return choice.outcome;
  }
  const afterBuild = guardOutcome(state, commandKind, signal, isClosed);
  if (afterBuild !== undefined) {
    await scope.disposeAll();
    return afterBuild;
  }

  const nextState: ProfileState = {
    status: 'configured',
    revision: candidate.nextRevision,
    identity: candidate.identity,
    document: candidate.document,
    ...(candidate.activeMember === undefined
      ? {}
      : { activeMember: candidate.activeMember }),
  };

  const swap = swapRuntime(
    state,
    commandKind,
    nextState,
    choice.chosen,
    priorRuntime,
    disposeTimeoutMs,
    resolved.resolved.policy,
  );
  if (!swap.ok) {
    await scope.disposeAll();
    return swap.outcome;
  }

  const outcome: CommitRouteOutcome = {
    result: {
      kind: 'committed',
      revision: candidate.nextRevision,
      snapshot: swap.newRuntime.snapshot(),
    },
    commandKind,
    newState: nextState,
    newRuntime: swap.newRuntime,
  };
  input.adopt(outcome);
  scope.release();
  return outcome;
}

/**
 * Commit a resolved candidate into a live runtime.
 *
 * The candidate is resolved first, outside the safe window, so invalid or
 * unverifiable candidates never gate on the scheduler. The boundary then holds a safe
 * window across the whole recheck/build/swap sequence: no new work can start between
 * the recheck and the swap. After every await the route rechecks the execute signal
 * and the controller's closed flag: an aborted or disposed commit returns a typed
 * terminal outcome and the candidate scope disposes anything built so far. The caller
 * disposes the prior runtime after the swap; this route never does.
 */
export async function commitCandidate(
  state: ProfileState,
  candidate: CommitCandidateInput,
  command: ProfileCommand,
  deps: ProfileControllerDeps,
  priorRuntime: ActiveProfileRuntime | undefined,
  isClosed: () => boolean,
  adopt: (outcome: CommitRouteOutcome) => void,
  signal?: AbortSignal,
): Promise<CommitRouteOutcome> {
  const commandKind = candidate.commandKind;
  const disposeTimeoutMs = deps.disposeTimeoutMs ?? DEFAULT_DISPOSE_TIMEOUT_MS;
  const scope = new CandidateScope(disposeTimeoutMs);

  const gate = await resolveCandidateGate(
    state,
    candidate,
    deps,
    isClosed,
    signal,
  );
  if (gate.kind === 'stop') {
    return gate.outcome;
  }

  const boundaryOutcome = await deps.boundary.withSafeBoundary(
    (boundarySignal) =>
      commitUnderSafeWindow({
        state,
        candidate,
        command,
        resolved: gate.resolved,
        deps,
        priorRuntime,
        scope,
        isClosed,
        signal:
          boundarySignal !== undefined && signal !== undefined
            ? AbortSignal.any([boundarySignal, signal])
            : (boundarySignal ?? signal),
        disposeTimeoutMs,
        adopt,
      }),
    signal,
  );
  if (boundaryOutcome.status === 'cancelled') {
    return {
      result: {
        kind: 'cancelled',
        reason: 'boundary cancelled',
        revision: revisionOf(state),
      },
      commandKind,
      newState: state,
      newRuntime: undefined,
    };
  }
  return boundaryOutcome.value;
}
