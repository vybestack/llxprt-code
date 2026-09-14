/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deterministic infrastructure fakes for the profile controller tests.
 *
 * Each fake implements one core port the agents controller consumes: an in-memory
 * repository with content-hash fingerprints, a scheduler boundary that resolves only
 * when a test releases it, a counting runtime factory whose fingerprint is derived
 * from document content, a static provider catalog, and a permissive trust ceiling.
 */

import {
  fingerprintsMatch,
  ProfileRepositoryConflictError,
  type ProfileDocument,
  type ProfileState,
  type ProfileCommandResult,
  type WorkingProfileIdentity,
  type ProfileRepositoryPort,
  type ProfileRuntimeBinding,
  type ProfileRuntimeFactoryPort,
  type ProviderModelCatalogPort,
  type ResolvedProfileSpec,
  type SafeBoundaryOutcome,
  type SchedulerBoundaryPort,
  type SourceFingerprint,
  type StandardProfileDocument,
  type TrustToolEnvironmentPort,
} from '@vybestack/llxprt-code-core';
import type { ProfileController } from '../profileController.js';
import type { ActiveProfileRuntime } from '../activeProfileRuntime.js';
import type { ProfileControllerDeps } from '../controllerTypes.js';

/**
 * Build a standard `prov-a` document for the given model.
 */
export function standardProvADocument(model: string): StandardProfileDocument {
  return {
    version: 1,
    type: 'standard',
    provider: 'prov-a',
    model,
    modelParams: {},
    ephemeralSettings: {},
  };
}

/**
 * Content-derived fingerprint: identical documents always carry identical
 * fingerprints, and the value is stable across repeated stat calls.
 */
function contentFingerprint(document: ProfileDocument): SourceFingerprint {
  return { kind: 'hash', hash: `content:${JSON.stringify(document)}` };
}

interface RepositoryEntry {
  document: ProfileDocument;
  fingerprint: SourceFingerprint;
}

/**
 * Map-backed repository fake. Fingerprints are content hashes, so a save with an
 * expected fingerprint only conflicts when the stored entry was tampered with or
 * holds different content. Loading a missing profile throws; saving with an
 * expected fingerprint against a missing or mismatched entry raises
 * {@link ProfileRepositoryConflictError} exactly like the real adapter.
 */
export class InMemoryRepository implements ProfileRepositoryPort {
  private readonly entries = new Map<string, RepositoryEntry>();
  private readFailureArmed = false;

  async load(
    name: string,
  ): Promise<{ document: ProfileDocument; fingerprint: SourceFingerprint }> {
    this.maybeFailRead();
    const entry = this.entries.get(name);
    if (entry === undefined) {
      throw new Error(`Profile '${name}' not found`);
    }
    return { document: entry.document, fingerprint: entry.fingerprint };
  }

  async save(
    name: string,
    document: ProfileDocument,
    expected?: SourceFingerprint,
    opts?: { mustCreate?: boolean },
  ): Promise<SourceFingerprint> {
    if (opts?.mustCreate === true && this.entries.has(name)) {
      throw new ProfileRepositoryConflictError(
        `Profile '${name}' already exists`,
      );
    }
    if (expected !== undefined) {
      const current = this.entries.get(name);
      if (
        current === undefined ||
        !fingerprintsMatch(current.fingerprint, expected)
      ) {
        throw new ProfileRepositoryConflictError(
          `Profile '${name}' changed on disk`,
        );
      }
    }
    const fingerprint = contentFingerprint(document);
    this.entries.set(name, { document, fingerprint });
    return fingerprint;
  }

  async list(): Promise<ReadonlyArray<{ name: string }>> {
    return [...this.entries.keys()].map((name) => ({ name }));
  }

  async delete(name: string): Promise<void> {
    this.entries.delete(name);
  }

  async stat(name: string): Promise<SourceFingerprint | null> {
    this.maybeFailRead();
    return this.entries.get(name)?.fingerprint ?? null;
  }

  /**
   * Make the next repository read (load or stat) throw once, simulating an I/O
   * failure underneath the port. Either read can fail so a failure can be injected at
   * any point of a command's repository interaction.
   */
  failNextRead(): void {
    this.readFailureArmed = true;
  }

  private maybeFailRead(): void {
    if (this.readFailureArmed) {
      this.readFailureArmed = false;
      throw new Error('repository I/O failed');
    }
  }

  /**
   * Seed a profile under `name`, defaulting to the standard `prov-a`/`m1` document.
   */
  seed(
    name: string,
    document: ProfileDocument = standardProvADocument('m1'),
  ): void {
    this.entries.set(name, {
      document,
      fingerprint: contentFingerprint(document),
    });
  }

  /**
   * Simulate an external edit by replacing the stored fingerprint with a different
   * value: either the explicit fingerprint a test supplies, or a derived variant of
   * the current one. The document content is left alone; only the fingerprint moves.
   */
  tamperFingerprint(name: string, fingerprint?: SourceFingerprint): void {
    const entry = this.entries.get(name);
    if (entry === undefined) {
      throw new Error(`cannot tamper fingerprint of unknown profile '${name}'`);
    }
    entry.fingerprint =
      fingerprint ??
      (entry.fingerprint.kind === 'hash'
        ? { kind: 'hash', hash: `${entry.fingerprint.hash}:tampered` }
        : {
            kind: 'stat',
            mtimeMs: entry.fingerprint.mtimeMs + 1,
            size: entry.fingerprint.size,
          });
  }
}

/**
 * Scheduler boundary fake that never opens its window on its own: every caller is
 * parked until a test releases it. `release('safe')` runs the parked work inside the
 * held window and settles the caller with the committed value; `release('cancelled')`
 * settles the caller as cancelled without ever running the parked work.
 */
export class DeferredBoundary implements SchedulerBoundaryPort {
  private readonly parked: Array<{
    commit: () => void;
    cancel: () => void;
  }> = [];

  withSafeBoundary<T>(
    fn: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<SafeBoundaryOutcome<T>> {
    return new Promise<SafeBoundaryOutcome<T>>((resolve, reject) => {
      this.parked.push({
        commit: () => {
          fn(signal).then(
            (value) => {
              resolve({ status: 'committed', value });
            },
            (error: unknown) => {
              reject(error);
            },
          );
        },
        cancel: () => {
          resolve({ status: 'cancelled' });
        },
      });
    });
  }

  /**
   * Release the oldest parked caller with the given result.
   */
  release(result: 'safe' | 'cancelled'): void {
    const next = this.parked.shift();
    if (next === undefined) {
      return;
    }
    if (result === 'safe') {
      next.commit();
    } else {
      next.cancel();
    }
  }

  /**
   * Number of callers parked at the boundary; a commit route in flight shows up
   * here as exactly one.
   */
  pendingCount(): number {
    return this.parked.length;
  }
}

/**
 * Runtime binding fake that counts disposals.
 */
export class FakeBinding implements ProfileRuntimeBinding {
  readonly bindingId: string;
  readonly configFingerprint: string;
  disposeCount = 0;
  disposed = false;

  constructor(bindingId: string, configFingerprint: string) {
    this.bindingId = bindingId;
    this.configFingerprint = configFingerprint;
  }

  [Symbol.asyncDispose](): Promise<void> {
    this.disposeCount += 1;
    this.disposed = true;
    return Promise.resolve();
  }
}

/**
 * Runtime factory fake. The config fingerprint is derived from the document
 * content, so identical documents produce identical fingerprints and the factory
 * returns the prior binding unchanged on the reuse path. `failNextBuild`
 * makes exactly one build call throw; `holdNextBuild` parks exactly one build
 * inside the factory until a test releases it, so tests can inject failures or
 * cancellations mid-build.
 */
export class CountingFactory implements ProfileRuntimeFactoryPort {
  private builds = 0;
  private failOnce = false;
  private failMessage: string | undefined;
  private heldBuilds = 0;
  private releaseBuild: (() => void) | undefined;
  lastBinding: FakeBinding | undefined;
  /** The most recent spec handed to build; lets tests inspect what construction received. */
  lastSpec: ResolvedProfileSpec | undefined;

  /**
   * Number of build calls that constructed a fresh binding; reuse returns the
   * prior binding without touching this count.
   */
  get built(): number {
    return this.builds;
  }

  async build(
    spec: ResolvedProfileSpec,
    prior?: ProfileRuntimeBinding,
  ): Promise<ProfileRuntimeBinding> {
    this.lastSpec = spec;
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error(this.failMessage ?? 'runtime factory build failed');
    }
    const configFingerprint = `config:${JSON.stringify(spec.document)}`;
    if (prior !== undefined && prior.configFingerprint === configFingerprint) {
      return prior;
    }
    this.builds += 1;
    if (this.heldBuilds > 0) {
      this.heldBuilds -= 1;
      await new Promise<void>((resolve) => {
        this.releaseBuild = resolve;
      });
    }
    const binding = new FakeBinding(
      `binding-${this.builds}`,
      configFingerprint,
    );
    this.lastBinding = binding;
    return binding;
  }

  /**
   * Make the next build call throw once, optionally with a caller-supplied message.
   */
  failNextBuild(message?: string): void {
    this.failOnce = true;
    this.failMessage = message;
  }

  /**
   * Park the next fresh build inside the factory until released.
   */
  holdNextBuild(): void {
    this.heldBuilds += 1;
  }

  /**
   * Release a build parked by {@link holdNextBuild}.
   */
  releaseHeldBuild(): void {
    this.releaseBuild?.();
    this.releaseBuild = undefined;
  }
}

/**
 * Static catalog fake for `prov-a`: default model `def-model`, models `m1`/`m2`,
 * `valid` support for exactly those models — rejecting the unknown `bogus-param`
 * model parameter — and the restricted blank template for the provider. Every other
 * provider or model is `unknown` and carries no template.
 */
export class FakeCatalog implements ProviderModelCatalogPort {
  async getDefaultModel(provider: string): Promise<string | undefined> {
    return provider === 'prov-a' ? 'def-model' : undefined;
  }

  async listModels(provider: string): Promise<readonly string[]> {
    return provider === 'prov-a' ? ['m1', 'm2'] : [];
  }

  async validateModelSupport(
    provider: string,
    model: string,
    params?: Readonly<Record<string, unknown>>,
  ): Promise<
    | { status: 'valid' }
    | { status: 'invalid'; reason: string }
    | { status: 'unknown' }
  > {
    if (provider === 'prov-a' && (model === 'm1' || model === 'm2')) {
      if (params !== undefined && 'bogus-param' in params) {
        return {
          status: 'invalid',
          reason: `unknown model parameter 'bogus-param' for ${provider}/${model}`,
        };
      }
      return { status: 'valid' };
    }
    return { status: 'unknown' };
  }

  async getProviderTemplate(
    provider: string,
  ): Promise<StandardProfileDocument | undefined> {
    // Materialized fresh per call: the committed workspace adopts the template
    // object, so a shared instance would be frozen by the first adoption.
    if (provider !== 'prov-a') {
      return undefined;
    }
    return {
      version: 1,
      type: 'standard',
      provider: 'prov-a',
      model: 'm2',
      modelParams: { temperature: 0.25 },
      ephemeralSettings: { 'base-url': 'https://restricted.example.com' },
    };
  }
}

/**
 * Permissive trust ceiling: `shell`/`edit`/`read` allowed, nothing disabled, every
 * tool available, `allowlist` shell mode, `standard` approval ceiling.
 */
export class FakeTrust implements TrustToolEnvironmentPort {
  getToolCeiling(): {
    allowedTools: readonly string[];
    disabledTools: readonly string[];
  } {
    return { allowedTools: ['shell', 'edit', 'read'], disabledTools: [] };
  }

  isToolAvailable(_toolId: string): boolean {
    return true;
  }

  getShellCeiling(): 'allowlist' | 'all' | 'none' {
    return 'allowlist';
  }

  getApprovalCeiling(): 'yolo' | 'standard' | 'strict' {
    return 'standard';
  }
}

/**
 * Everything a controller test needs: the assembled deps plus the concrete fakes
 * behind them so tests can seed, release, and inspect.
 */
export interface ControllerTestHarness {
  deps: ProfileControllerDeps;
  repo: InMemoryRepository;
  factory: CountingFactory;
  boundary: DeferredBoundary;
}

/**
 * Assemble {@link ProfileControllerDeps} over the fakes, optionally sharing a
 * caller-provided repository between harnesses. The session ceiling is permissive
 * (`{}`), and only `ui.theme` counts as an application-owned key.
 */
export function makeDeps(
  repository?: InMemoryRepository,
): ControllerTestHarness {
  const repo = repository ?? new InMemoryRepository();
  const factory = new CountingFactory();
  const boundary = new DeferredBoundary();
  const deps: ProfileControllerDeps = {
    agentId: 'test-agent',
    repository: repo,
    runtimeFactory: factory,
    boundary,
    catalog: new FakeCatalog(),
    trust: new FakeTrust(),
    session: {},
    isApplicationOwnedKey: (key: string) => key === 'ui.theme',
  };
  return { deps, repo, factory, boundary };
}

/**
 * Seed the standard `alpha` profile (`prov-a`/`m1`).
 */
export function seedAlpha(repo: InMemoryRepository): void {
  repo.seed('alpha', standardProvADocument('m1'));
}

/**
 * Seed the `mylb` load balancer with members `m1p` and `m2p`, both on `prov-a`.
 */
export function seedMyLb(repo: InMemoryRepository): void {
  repo.seed('m1p', standardProvADocument('m1'));
  repo.seed('m2p', standardProvADocument('m2'));
  repo.seed('mylb', {
    version: 1,
    type: 'loadbalancer',
    policy: 'roundrobin',
    profiles: ['m1p', 'm2p'],
    provider: 'prov-a',
    model: 'm1',
    modelParams: {},
    ephemeralSettings: {},
  });
}

/**
 * Seed a v1-style `blanklb` load balancer parent whose provider and model fields are
 * blank, exactly as v1 repository documents carried them. Members `m1p` and `m2p` are
 * standard `prov-a` profiles.
 */
export function seedBlankLb(repo: InMemoryRepository): void {
  repo.seed('m1p', standardProvADocument('m1'));
  repo.seed('m2p', standardProvADocument('m2'));
  repo.seed('blanklb', {
    version: 1,
    type: 'loadbalancer',
    policy: 'roundrobin',
    profiles: ['m1p', 'm2p'],
    provider: '',
    model: '',
    modelParams: {},
    ephemeralSettings: {},
  });
}

export type ConfiguredProfileState = Extract<
  ProfileState,
  { status: 'configured' }
>;
export type CommittedResult = Extract<
  ProfileCommandResult,
  { kind: 'committed' }
>;

/**
 * Poll until the predicate holds, failing after a bounded deadline instead of
 * hanging the suite on an async drain that never lands.
 */
export async function settle(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('settle timed out before the condition was met');
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1);
    });
  }
}

export function configuredState(state: ProfileState): ConfiguredProfileState {
  if (state.status !== 'configured') {
    throw new Error('expected a configured workspace state');
  }
  return state;
}

export function committed(result: ProfileCommandResult): CommittedResult {
  if (result.kind !== 'committed') {
    throw new Error(`expected a committed result, received ${result.kind}`);
  }
  return result;
}

/**
 * Await a command that parks at the scheduler boundary, release it as safe, and
 * return its settled result.
 */
export async function releaseAndAwait(
  harness: ControllerTestHarness,
  pending: Promise<ProfileCommandResult>,
): Promise<ProfileCommandResult> {
  await settle(() => harness.boundary.pendingCount() === 1);
  harness.boundary.release('safe');
  return pending;
}

export function committedSnapshot(
  identity: WorkingProfileIdentity,
  revision: number,
  model: string,
): ReturnType<ActiveProfileRuntime['snapshot']> {
  return {
    identity,
    revision,
    provider: 'prov-a',
    model,
    isLoadBalancer: false,
    identityKind: identity.kind,
    providerOrLbSummary: `prov-a/${model}`,
    health: { status: 'ok', degradedAspects: [] },
    roleRuntimeCount: 0,
  };
}

export async function alphaFingerprint(
  harness: ControllerTestHarness,
): Promise<SourceFingerprint> {
  const fingerprint = await harness.repo.stat('alpha');
  if (fingerprint === null) {
    throw new Error('alpha fingerprint missing from the repository');
  }
  return fingerprint;
}

/**
 * Bring the seeded alpha profile up through the controller, releasing the boundary
 * the commit route waits on. A named-profile startup is the unconfigured
 * workspace's load path; a bare load requires an already configured workspace.
 */
export async function loadAlpha(
  harness: ControllerTestHarness,
  controller: ProfileController,
): Promise<ProfileCommandResult> {
  const pending = controller.execute({
    kind: 'startup',
    profileName: 'alpha',
    expectedRevision: 0,
  });
  return releaseAndAwait(harness, pending);
}

export async function setupSavedAlpha(
  harness: ControllerTestHarness,
  controller: ProfileController,
): Promise<SourceFingerprint> {
  const result = await loadAlpha(harness, controller);
  if (result.kind !== 'committed') {
    throw new Error(`alpha load did not commit, received ${result.kind}`);
  }
  return alphaFingerprint(harness);
}

/**
 * Move the workspace to an unsaved draft at revision 2 by switching the model.
 */
export async function setupDraftAtRevision2(
  harness: ControllerTestHarness,
  controller: ProfileController,
): Promise<SourceFingerprint> {
  const fingerprint = await setupSavedAlpha(harness, controller);
  const model = controller.execute({
    kind: 'model',
    model: 'm2',
    expectedRevision: 1,
  });
  await settle(() => harness.boundary.pendingCount() === 1);
  harness.boundary.release('safe');
  const modelResult = await model;
  if (modelResult.kind !== 'committed') {
    throw new Error(
      `model change did not commit, received ${modelResult.kind}`,
    );
  }
  return fingerprint;
}
