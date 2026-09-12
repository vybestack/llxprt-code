/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agents-owned wrapper around a live profile runtime binding.
 *
 * The active runtime owns the health of the binding in use. The profile state is read
 * through a supplier the controller re-supplies on every adoption, so identity and
 * revision always track the committed workspace; health reporting only merges degraded
 * aspects and never touches state, identity, or revision. Disposal is best-effort
 * and bounded so a hanging binding cannot stall teardown.
 */

import type {
  ProfileRuntimeBinding,
  ProfileState,
  ProfileHealth,
  RedactedProfileSnapshot,
  EffectiveToolPolicy,
  PolicyCeiling,
  ProfileDocument,
} from '@vybestack/llxprt-code-core';
import {
  buildRedactedSnapshot,
  deepFreeze,
  intersectPolicy,
} from '@vybestack/llxprt-code-core';

/**
 * Build a redacted view of the active profile.
 */
function snapshotSummary(state: ProfileState): {
  revision: number;
  identityKind: string | null;
  providerOrLbSummary: string | null;
} {
  if (state.status !== 'configured') {
    return {
      revision: 0,
      identityKind: null,
      providerOrLbSummary: null,
    };
  }
  const identityKind = state.identity.kind === 'saved' ? 'saved' : 'draft';
  let providerOrLbSummary: string | null;
  if (state.document.type === 'loadbalancer') {
    providerOrLbSummary = `loadbalancer:${state.document.policy}:${state.document.profiles.length}`;
  } else {
    providerOrLbSummary = `${state.document.provider}/${state.document.model}`;
  }
  return { revision: state.revision, identityKind, providerOrLbSummary };
}

export class ProfileRuntimeDisposedError extends Error {
  constructor() {
    super('Profile role runtime is no longer valid');
    this.name = 'ProfileRuntimeDisposedError';
  }
}

/**
 * Wrapper that owns a profile runtime binding and its observed health.
 *
 * Identity, revision, and document are read through the state supplier on every
 * access, so the runtime always describes the workspace the controller has
 * committed — including transitions that reuse the runtime (a save or an
 * external-change promotion) and never rebuilt it. The binding and the disposal
 * bound stay construction-time facts. Health is mutable and separate from state.
 */
export class ActiveProfileRuntime {
  private invalidated = false;
  private roleRuntimes = new Set<WeakRef<ActiveProfileRuntime>>();
  private stateSupplier: () => ProfileState;
  private readonly disposeTimeoutMs: number;
  private binding: ProfileRuntimeBinding | undefined;
  private health: ProfileHealth;
  private disposed = false;
  private ownsBinding = true;
  private roleRuntimeCount = 0;
  private readonly policy: Readonly<EffectiveToolPolicy>;
  private restrictedAllowlist: boolean;

  constructor(
    currentState: () => ProfileState,
    disposeTimeoutMs = 5000,
    policy: EffectiveToolPolicy,
  ) {
    this.stateSupplier = currentState;
    this.disposeTimeoutMs = disposeTimeoutMs;
    this.health = { status: 'ok', degradedAspects: [] };
    this.policy = deepFreeze(structuredClone(policy));
    this.restrictedAllowlist = policy.allowedTools.length > 0;
  }

  getPolicy(): Readonly<EffectiveToolPolicy> {
    this.ensureValid();
    return this.policy;
  }

  getFilteredToolDeclarations(
    declarations: ReadonlyArray<{ name: string; description: string }>,
  ): ReadonlyArray<Readonly<{ name: string; description: string }>> {
    this.ensureValid();
    return Object.freeze(
      declarations
        .filter(
          ({ name }) =>
            !this.policy.disabledTools.includes(name) &&
            (!this.restrictedAllowlist ||
              this.policy.allowedTools.includes(name)),
        )
        .map((declaration) => Object.freeze({ ...declaration })),
    );
  }

  createRoleRuntime(
    roleRef: { name: string; document: ProfileDocument },
    rolePolicy?: PolicyCeiling,
  ): ActiveProfileRuntime {
    const parentState = this.getState();
    if (parentState.status !== 'configured') {
      throw new Error('role runtime requires a configured parent');
    }
    const state: ProfileState = deepFreeze({
      status: 'configured',
      revision: parentState.revision,
      identity: { kind: 'draft' },
      document: structuredClone(roleRef.document),
    });
    const policy = intersectPolicy(
      {
        ...this.policy,
        allowedTools: this.restrictedAllowlist
          ? this.policy.allowedTools
          : (rolePolicy?.allowedTools ?? []),
      },
      {},
      {},
      rolePolicy,
    ).policy;
    const child = new ActiveProfileRuntime(
      () => state,
      this.disposeTimeoutMs,
      policy,
    );
    // An empty intersection must not reopen an explicitly restricted allowlist.
    child.restrictedAllowlist =
      this.restrictedAllowlist || rolePolicy?.allowedTools !== undefined;
    child.binding = this.binding;
    child.ownsBinding = false;
    this.roleRuntimes.add(new WeakRef(child));
    this.roleRuntimeCount += 1;
    return child;
  }

  /**
   * The workspace state the runtime currently describes, read through the supplier.
   */
  getState(): ProfileState {
    this.ensureValid();
    return this.stateSupplier();
  }

  /**
   * Point the runtime's state view at a new supplier.
   *
   * The controller calls this on every state adoption so snapshot reads never lag
   * behind the committed workspace, even when the runtime object itself was reused.
   */
  resupplyState(currentState: () => ProfileState): void {
    this.ensureValid();
    this.stateSupplier = currentState;
  }

  /** Current health of the bound runtime. */
  getHealth(): ProfileHealth {
    this.ensureValid();
    return {
      status: this.health.status,
      degradedAspects: [...this.health.degradedAspects],
    };
  }

  /** The bound runtime, if any. */
  getBinding(): ProfileRuntimeBinding | undefined {
    this.ensureValid();
    return this.binding;
  }

  releaseOwnership(): void {
    this.ensureValid();
    this.ownsBinding = false;
  }

  /** Identifier of the bound runtime. */
  getBindingId(): string | undefined {
    this.ensureValid();
    return this.binding?.bindingId;
  }

  /**
   * Attach a runtime binding.
   *
   * Replaces any prior binding. Health is preserved: observed degradation belongs to
   * the workspace's runtime history, and a fresh runtime starts healthy anyway, so
   * attaching never resets health to ok.
   */
  attach(binding: ProfileRuntimeBinding): void {
    this.ensureValid();
    if (this.binding !== binding) this.invalidateRoleRuntimes();
    this.binding = binding;
  }

  /**
   * Carry a prior runtime's observed health into this runtime.
   *
   * Used when the prior binding is reused across a state transition: the binding's
   * operational history, including degraded aspects, belongs to the binding and must
   * survive the wrapper swap.
   */
  inheritHealthFrom(prior: ActiveProfileRuntime): void {
    this.ensureValid();
    this.health = prior.getHealth();
  }

  /**
   * Record degraded aspects. Health becomes `'degraded'`; state, identity,
   * and revision are never touched.
   */
  reportDegradation(aspects: readonly string[]): void {
    this.ensureValid();
    const merged = new Set(this.health.degradedAspects);
    for (const aspect of aspects) {
      merged.add(aspect);
    }
    this.health = {
      status: 'degraded',
      degradedAspects: [...merged],
    };
  }

  /**
   * Clear degraded aspects. Health returns to `'ok'` when none remain.
   */
  reportRecovery(aspects: readonly string[]): void {
    this.ensureValid();
    const remaining = [...this.health.degradedAspects].filter(
      (aspect) => !aspects.includes(aspect),
    );
    this.health = {
      status: remaining.length > 0 ? 'degraded' : 'ok',
      degradedAspects: remaining,
    };
  }

  /**
   * Redacted snapshot of the active profile plus health.
   *
   * Only safe fields are exposed: no secret values, no document body. Identity and
   * revision are derived from the current state at call time, so a save or an
   * external-change promotion that reused this runtime is reflected immediately.
   */
  snapshot(): RedactedProfileSnapshot & {
    health: ProfileHealth;
    roleRuntimeCount: number;
  } {
    this.ensureValid();
    const state = this.stateSupplier();
    // The unconfigured workspace has no source to derive from, so it presents as
    // an underived draft; the committed-result contract requires an identity.
    const base: RedactedProfileSnapshot =
      state.status === 'configured'
        ? buildRedactedSnapshot(state)
        : {
            identity: { kind: 'draft' },
            revision: 0,
            provider: '',
            model: '',
            isLoadBalancer: false,
          };
    const summary = snapshotSummary(state);
    return {
      ...base,
      ...summary,
      health: this.getHealth(),
      roleRuntimeCount: this.roleRuntimeCount,
    };
  }

  /**
   * Best-effort bounded disposal of the bound binding.
   *
   * A binding whose dispose hangs is abandoned after a bounded race; the losing
   * promise never becomes an unhandled rejection. A failed disposal is recorded as a
   * degraded aspect and never rethrown.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    if (this.disposed) return;
    const binding = this.binding;
    this.disposed = true;
    this.binding = undefined;
    this.invalidateRoleRuntimes();
    if (!this.ownsBinding) {
      this.invalidated = true;
      return;
    }
    if (binding === undefined) return;
    const disposeResult = binding[Symbol.asyncDispose]();
    try {
      await this.boundedRace(disposeResult);
    } catch (error) {
      this.reportDegradation([
        `dispose-failed:${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
  }

  retainRoleRuntimesFrom(prior: ActiveProfileRuntime): void {
    this.ensureValid();
    // Keep child invalidation reachable even if the prior wrapper is collected.
    this.roleRuntimes = prior.roleRuntimes;
    this.roleRuntimes.add(new WeakRef(prior));
  }

  private ensureValid(): void {
    if (this.invalidated) throw new ProfileRuntimeDisposedError();
  }

  private invalidateRoleRuntimes(): void {
    const references = [...this.roleRuntimes];
    this.roleRuntimes.clear();
    for (const reference of references) {
      reference.deref()?.invalidate();
    }
  }

  private invalidate(): void {
    this.invalidated = true;
    this.disposed = true;
    this.binding = undefined;
    this.invalidateRoleRuntimes();
  }

  private async boundedRace(dispose: PromiseLike<void>): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(
          `runtime binding dispose timed out after ${this.disposeTimeoutMs}ms`,
        );
        dispose.then(undefined, () => {});
        reject(error);
      }, this.disposeTimeoutMs);
    });
    try {
      await Promise.race([dispose, timeoutPromise]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}
