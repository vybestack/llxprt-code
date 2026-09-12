/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lifecycle behavior tests for the profile controller.
 *
 * Every case drives the real ProfileController through its public execute surface with
 * deterministic infrastructure fakes: invalid-input atomicity, listener isolation,
 * unverified candidates, boundary cancellation, external-change draft promotion,
 * load-balancer binding reuse, per-agent independence over a shared repository, failed
 * builds, and the immutability of previously captured state objects.
 */

import { describe, expect, it } from 'bun:test';
import type {
  ProfileEvent,
  ProfileCommand,
  ProfileState,
  StandardProfileDocument,
} from '@vybestack/llxprt-code-core';
import { ProfileController } from '../profileController.js';
import { buildReductionEnvironment } from '../controllerEnv.js';
import {
  FakeBinding,
  FakeCatalog,
  InMemoryRepository,
  makeDeps,
  configuredState,
  committed,
  settle,
  releaseAndAwait,
  committedSnapshot,
  type CommittedResult,
  seedAlpha,
  seedBlankLb,
  seedMyLb,
  standardProvADocument,
  type ControllerTestHarness,
} from './controllerTestFakes.js';

class TemplateCatalog extends FakeCatalog {
  constructor(private readonly template: StandardProfileDocument | undefined) {
    super();
  }

  override async getProviderTemplate(): Promise<
    StandardProfileDocument | undefined
  > {
    return this.template;
  }

  override async getDefaultModel(): Promise<string | undefined> {
    return 'm1';
  }
}

function requireBinding(controller: ProfileController): FakeBinding {
  const binding = controller.getRuntime()?.getBinding();
  if (binding === undefined || !(binding instanceof FakeBinding)) {
    throw new Error('expected a live runtime with a bound binding');
  }
  return binding;
}

/**
 * Bring a named profile up from the unconfigured workspace through the controller's
 * startup path, releasing the boundary the commit route waits on.
 */
async function startupNamed(
  harness: ControllerTestHarness,
  controller: ProfileController,
  name: string,
): Promise<CommittedResult> {
  const pending = controller.execute({
    kind: 'startup',
    profileName: name,
    expectedRevision: 0,
  });
  return committed(await releaseAndAwait(harness, pending));
}

/**
 * Bring the seeded alpha profile up to revision 1 and return the live binding.
 */
async function bringUpAlpha(
  harness: ControllerTestHarness,
  controller: ProfileController,
): Promise<FakeBinding> {
  await startupNamed(harness, controller, 'alpha');
  return requireBinding(controller);
}

describe('ProfileController lifecycle', () => {
  it('transfers reused binding ownership away from the prior runtime', async () => {
    const harness = makeDeps();
    seedMyLb(harness.repo);
    const controller = new ProfileController(harness.deps);
    await startupNamed(harness, controller, 'mylb');
    const prior = controller.getRuntime();
    if (prior === undefined) {
      throw new Error('expected prior runtime');
    }
    const binding = requireBinding(controller);
    await releaseAndAwait(
      harness,
      controller.execute({ kind: 'load', name: 'mylb', expectedRevision: 1 }),
    );
    await prior[Symbol.asyncDispose]();
    expect(binding.disposeCount).toStrictEqual(0);
    await controller.dispose();
    expect(binding.disposeCount).toStrictEqual(1);
  });

  it('keeps member menu outages unverified instead of failing commands', async () => {
    const harness = makeDeps();
    seedMyLb(harness.repo);
    const controller = new ProfileController(harness.deps);
    await startupNamed(harness, controller, 'mylb');
    class UnavailableCatalog extends FakeCatalog {
      override async listModels(provider: string): Promise<readonly string[]> {
        if (provider === 'prov-a') {
          throw new Error('catalog offline');
        }
        return super.listModels(provider);
      }
    }
    harness.deps.catalog = new UnavailableCatalog();
    const before = structuredClone(controller.getState());
    const command = {
      kind: 'model',
      member: 'm2p',
      model: 'm1',
      expectedRevision: 1,
    } satisfies ProfileCommand;
    const env = await buildReductionEnvironment(before, command, harness.deps);
    expect(env.memberCaptures['m2p'].models).toStrictEqual([]);
    expect(await controller.execute(command)).toStrictEqual({
      kind: 'unverified',
      constraints: ['model menu unavailable for provider prov-a'],
      revision: 1,
    });
    expect(controller.getState()).toStrictEqual(before);
  });

  it('exposes the resolved policy on the committed runtime', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    harness.deps.getPolicyIntent = () => ({
      allowedTools: ['read', 'edit'],
      disabledTools: ['edit'],
    });
    const controller = new ProfileController(harness.deps);
    await bringUpAlpha(harness, controller);
    expect(controller.getRuntime()?.getPolicy()).toStrictEqual({
      allowedTools: ['read'],
      disabledTools: ['edit'],
      shellMode: 'allowlist',
      approvalCeiling: 'standard',
    });
    expect(
      controller.getRuntime()?.getFilteredToolDeclarations([
        { name: 'read', description: 'Read' },
        { name: 'edit', description: 'Edit' },
      ]),
    ).toStrictEqual([{ name: 'read', description: 'Read' }]);
  });

  it('rejects unsupported model params before entering the boundary', async () => {
    const harness = makeDeps();
    harness.repo.seed('bad', {
      ...standardProvADocument('m1'),
      modelParams: { 'bogus-param': true },
    });
    const controller = new ProfileController(harness.deps);
    const result = await controller.execute({
      kind: 'startup',
      profileName: 'bad',
      expectedRevision: 0,
    });
    expect(result).toStrictEqual({
      kind: 'invalid',
      errors: [
        "unknown model parameter 'bogus-param' for prov-a/m1",
        'model m1 is not supported by provider prov-a',
      ],
      revision: 0,
    });
    expect(controller.getState()).toStrictEqual({ status: 'unconfigured' });
    expect(harness.boundary.pendingCount()).toStrictEqual(0);
  });

  it('uses catalog template fields instead of fabricating provider defaults', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const template: StandardProfileDocument = {
      ...standardProvADocument('m2'),
      modelParams: { temperature: 0.25 },
      ephemeralSettings: { 'base-url': 'https://restricted.example.com' },
      auth: { type: 'oauth', buckets: ['restricted'] },
    };
    harness.deps.catalog = new TemplateCatalog(template);
    const controller = new ProfileController(harness.deps);
    await bringUpAlpha(harness, controller);
    const result = await releaseAndAwait(
      harness,
      controller.execute({
        kind: 'provider',
        provider: 'prov-a',
        expectedRevision: 1,
      }),
    );
    expect(result.kind).toStrictEqual('committed');
    expect(configuredState(controller.getState()).document).toStrictEqual(
      template,
    );
  });

  it('uses the default model only when no catalog template is available', async () => {
    const harness = makeDeps();
    harness.deps.catalog = new TemplateCatalog(undefined);
    const controller = new ProfileController(harness.deps);
    const result = await releaseAndAwait(
      harness,
      controller.execute({
        kind: 'startup',
        provider: 'prov-a',
        expectedRevision: 0,
      }),
    );
    expect(result.kind).toStrictEqual('committed');
    expect(configuredState(controller.getState()).document).toStrictEqual(
      standardProvADocument('m1'),
    );
  });

  it('holds the safe window until the controller has adopted the new state and binding', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    let held = false;
    const statesAtRelease: ProfileState[] = [];
    const bindingIdsAtRelease: Array<string | undefined> = [];
    harness.deps.boundary = {
      withSafeBoundary: (fn, signal) =>
        harness.boundary.withSafeBoundary(async (boundarySignal) => {
          held = true;
          try {
            const value = await fn(boundarySignal);
            statesAtRelease.push(controller.getState());
            bindingIdsAtRelease.push(controller.getRuntime()?.getBindingId());
            return value;
          } finally {
            held = false;
          }
        }, signal),
    };
    const controller = new ProfileController(harness.deps);
    harness.factory.holdNextBuild();
    const pending = controller.execute({
      kind: 'startup',
      profileName: 'alpha',
      expectedRevision: 0,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.boundary.release('safe');
    await settle(() => harness.factory.built === 1);
    expect(held).toStrictEqual(true);
    expect(controller.getState()).toStrictEqual({ status: 'unconfigured' });
    harness.factory.releaseHeldBuild();
    expect((await pending).kind).toStrictEqual('committed');
    expect(held).toStrictEqual(false);
    expect(statesAtRelease).toStrictEqual([controller.getState()]);
    expect(bindingIdsAtRelease).toStrictEqual([
      controller.getRuntime()?.getBindingId(),
    ]);
  });

  it('rejects an unknown provider as invalid and leaves state and runtime intact', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const binding = await bringUpAlpha(harness, controller);

    const result = await controller.execute({
      kind: 'provider',
      provider: 'nope',
      expectedRevision: 1,
    });

    expect(result).toStrictEqual({
      kind: 'invalid',
      errors: ['unknown provider template'],
      revision: 1,
    });
    expect(configuredState(controller.getState()).revision).toBe(1);
    expect(controller.getRuntime()?.getBinding()).toBe(binding);
  });

  it('isolates a throwing listener so the other listeners still fire and the command commits', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const events: ProfileEvent[] = [];
    harness.deps.listeners = [
      () => {
        throw new Error('boom');
      },
      (event) => {
        events.push(event);
      },
    ];
    const controller = new ProfileController(harness.deps);

    const result = await startupNamed(harness, controller, 'alpha');

    expect(result.revision).toBe(1);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((event) => event.type === 'committed')).toBe(true);
  });

  it('reports an unknown model as unverified without committing', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const binding = await bringUpAlpha(harness, controller);

    const result = await controller.execute({
      kind: 'model',
      model: 'm-unknown',
      expectedRevision: 1,
    });

    expect(result).toStrictEqual({
      kind: 'unverified',
      constraints: ['model support unknown for provider prov-a'],
      revision: 1,
    });
    expect(configuredState(controller.getState()).revision).toBe(1);
    expect(controller.getRuntime()?.getBinding()).toBe(binding);
  });

  it('cancels at the boundary and keeps the prior runtime bound and undisposed', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const binding = await bringUpAlpha(harness, controller);

    const pending = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.boundary.release('cancelled');

    expect(await pending).toStrictEqual({
      kind: 'cancelled',
      reason: 'boundary cancelled',
      revision: 1,
    });
    expect(controller.getRuntime()?.getBinding()).toBe(binding);
    expect(binding.disposeCount).toBe(0);
  });

  it('promotes a saved identity to a stale draft when the source changed before the boundary released', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const binding = await bringUpAlpha(harness, controller);

    const pending = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.repo.tamperFingerprint('alpha', {
      kind: 'stat',
      mtimeMs: 999,
      size: 999,
    });
    harness.boundary.release('safe');

    expect(await pending).toStrictEqual({
      kind: 'stale',
      expectedRevision: 1,
      currentRevision: 2,
      revision: 1,
    });
    const state = configuredState(controller.getState());
    expect(state.revision).toBe(2);
    if (state.identity.kind !== 'draft') {
      throw new Error('expected the identity to be promoted to a draft');
    }
    expect(state.identity.derivedFrom?.name).toBe('alpha');
    expect(state.document).toStrictEqual(standardProvADocument('m1'));
    expect(controller.getRuntime()?.getBinding()).toBe(binding);
  });

  it('reuses the live binding when an unchanged load balancer is reapplied without building a duplicate', async () => {
    const harness = makeDeps();
    seedMyLb(harness.repo);
    const controller = new ProfileController(harness.deps);
    await startupNamed(harness, controller, 'mylb');
    const bindingA = requireBinding(controller);
    expect(harness.factory.built).toBe(1);

    const pending = controller.execute({
      kind: 'load',
      name: 'mylb',
      expectedRevision: 1,
    });
    const result = committed(await releaseAndAwait(harness, pending));

    expect(result.revision).toBe(2);
    expect(controller.getRuntime()?.getBinding()).toBe(bindingA);
    expect(harness.factory.built).toBe(1);
    expect(bindingA.disposeCount).toBe(0);
  });

  it('commits a v1 blank load-balancer parent with a live binding instead of half-applied state', async () => {
    const harness = makeDeps();
    seedBlankLb(harness.repo);
    const controller = new ProfileController(harness.deps);

    const result = await startupNamed(harness, controller, 'blanklb');

    expect(result.revision).toBe(1);
    const binding = requireBinding(controller);
    expect(harness.factory.built).toBe(1);
    expect(binding.disposeCount).toBe(0);
  });

  it('builds a fresh binding and disposes the old one when the config genuinely changes', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const bindingA = await bringUpAlpha(harness, controller);
    expect(harness.factory.built).toBe(1);

    const pending = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });
    const result = committed(await releaseAndAwait(harness, pending));

    expect(result.revision).toBe(2);
    expect(harness.factory.built).toBe(2);
    const bindingB = requireBinding(controller);
    expect(bindingB).not.toBe(bindingA);
    expect(bindingA.disposeCount).toBe(1);
    expect(bindingB.disposeCount).toBe(0);
  });

  it('carries degraded health across a load-balancer binding reuse', async () => {
    const harness = makeDeps();
    seedMyLb(harness.repo);
    const controller = new ProfileController(harness.deps);
    await startupNamed(harness, controller, 'mylb');
    controller.getRuntime()?.reportDegradation(['lb-member-down']);

    const pending = controller.execute({
      kind: 'load',
      name: 'mylb',
      expectedRevision: 1,
    });
    const result = committed(await releaseAndAwait(harness, pending));

    expect(result.revision).toBe(2);
    const runtime = controller.getRuntime();
    if (runtime === undefined) {
      throw new Error('expected a live runtime after the reuse commit');
    }
    expect(runtime.getHealth()).toStrictEqual({
      status: 'degraded',
      degradedAspects: ['lb-member-down'],
    });
  });

  it('cancels a commit whose build was aborted and disposes the candidate binding', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const bindingA = await bringUpAlpha(harness, controller);
    const abort = new AbortController();
    harness.factory.holdNextBuild();

    const pending = controller.execute(
      { kind: 'model', model: 'm2', expectedRevision: 1 },
      { signal: abort.signal },
    );
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.boundary.release('safe');
    await settle(() => harness.factory.built === 2);
    abort.abort();
    harness.factory.releaseHeldBuild();

    expect(await pending).toStrictEqual({
      kind: 'cancelled',
      reason: 'execute cancelled',
      revision: 1,
    });
    expect(controller.getRuntime()?.getBinding()).toBe(bindingA);
    expect(bindingA.disposeCount).toBe(0);
    expect(configuredState(controller.getState()).revision).toBe(1);
    expect(harness.factory.lastBinding?.disposed).toBe(true);
  });

  it('honors execute cancellation when the held boundary supplies its own signal', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const boundaryAbort = new AbortController();
    harness.deps.boundary = {
      withSafeBoundary: (fn, signal) =>
        harness.boundary.withSafeBoundary(
          () => fn(boundaryAbort.signal),
          signal,
        ),
    };
    const controller = new ProfileController(harness.deps);
    const binding = await bringUpAlpha(harness, controller);
    const abort = new AbortController();
    harness.factory.holdNextBuild();
    const pending = controller.execute(
      { kind: 'model', model: 'm2', expectedRevision: 1 },
      { signal: abort.signal },
    );
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.boundary.release('safe');
    await settle(() => harness.factory.built === 2);
    abort.abort();
    harness.factory.releaseHeldBuild();
    expect(await pending).toStrictEqual({
      kind: 'cancelled',
      reason: 'execute cancelled',
      revision: 1,
    });
    expect(controller.getRuntime()?.getBinding()).toBe(binding);
    expect(harness.factory.lastBinding?.disposed).toStrictEqual(true);
  });

  it('fails a commit when the controller is disposed mid-build and leaves no leak', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await bringUpAlpha(harness, controller);
    harness.factory.holdNextBuild();

    const pending = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.boundary.release('safe');
    await settle(() => harness.factory.built === 2);
    await controller.dispose();
    harness.factory.releaseHeldBuild();

    expect(await pending).toStrictEqual({
      kind: 'failed',
      error: 'controller disposed',
      revision: 1,
    });
    expect(controller.getRuntime()).toBeUndefined();
    expect(configuredState(controller.getState()).revision).toBe(1);
    expect(harness.factory.lastBinding?.disposed).toBe(true);
  });

  it('keeps two controllers over one repository independent', async () => {
    const repo = new InMemoryRepository();
    seedAlpha(repo);
    const harness1 = makeDeps(repo);
    const harness2 = makeDeps(repo);
    const controller1 = new ProfileController(harness1.deps);
    const controller2 = new ProfileController(harness2.deps);
    await startupNamed(harness1, controller1, 'alpha');
    await startupNamed(harness2, controller2, 'alpha');
    const binding2 = requireBinding(controller2);

    const setPending = controller1.execute({
      kind: 'set',
      patch: { temperature: 0.2 },
      expectedRevision: 1,
    });
    const setResult = committed(await releaseAndAwait(harness1, setPending));
    expect(setResult.revision).toBe(2);

    const state2 = configuredState(controller2.getState());
    expect(state2.revision).toBe(1);
    if (state2.identity.kind !== 'saved') {
      throw new Error('expected controller2 to keep its saved identity');
    }
    expect(state2.identity.name).toBe('alpha');
    expect(state2.document.ephemeralSettings).toStrictEqual({});

    const binding1 = requireBinding(controller1);
    expect(binding1).not.toBe(binding2);

    await controller1.dispose();
    expect(controller2.getRuntime()?.getBinding()).toBe(binding2);
    expect(binding2.disposeCount).toBe(0);
  });

  it('reports a failed build and keeps the prior runtime bound', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const binding = await bringUpAlpha(harness, controller);
    harness.factory.failNextBuild();

    const pending = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });

    expect(await releaseAndAwait(harness, pending)).toStrictEqual({
      kind: 'failed',
      error: 'Error: runtime factory build failed',
      revision: 1,
    });
    expect(controller.getRuntime()?.getBinding()).toBe(binding);
    expect(configuredState(controller.getState()).revision).toBe(1);
  });

  it('never mutates a previously captured state object when later commits land', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await bringUpAlpha(harness, controller);

    const captured = controller.getState();
    const before = structuredClone(captured);

    const setPending = controller.execute({
      kind: 'set',
      patch: { temperature: 0.3 },
      expectedRevision: 1,
    });
    expect(committed(await releaseAndAwait(harness, setPending)).revision).toBe(
      2,
    );

    expect(captured).toStrictEqual(before);
    expect(configuredState(controller.getState()).revision).toBe(2);
  });

  it('reports the promoted draft identity in the runtime snapshot after an external change', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const binding = await bringUpAlpha(harness, controller);
    const sourceFingerprint = await harness.repo.stat('alpha');
    if (sourceFingerprint === null) {
      throw new Error('alpha fingerprint missing from the repository');
    }

    const pending = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.repo.tamperFingerprint('alpha', {
      kind: 'stat',
      mtimeMs: 999,
      size: 999,
    });
    harness.boundary.release('safe');

    expect(await pending).toStrictEqual({
      kind: 'stale',
      expectedRevision: 1,
      currentRevision: 2,
      revision: 1,
    });
    const runtime = controller.getRuntime();
    expect(controller.getRuntime()?.getBinding()).toBe(binding);
    if (runtime === undefined) {
      throw new Error('expected the runtime to survive the promotion');
    }
    expect(runtime.snapshot()).toStrictEqual(
      committedSnapshot(
        {
          kind: 'draft',
          derivedFrom: { name: 'alpha', source: sourceFingerprint },
        },
        2,
        'm1',
      ),
    );
  });

  it('rejects a load whose candidate source changed on disk before the boundary released', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);

    const pending = controller.execute({
      kind: 'startup',
      profileName: 'alpha',
      expectedRevision: 0,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.repo.tamperFingerprint('alpha', {
      kind: 'stat',
      mtimeMs: 999,
      size: 999,
    });
    harness.boundary.release('safe');

    expect(await pending).toStrictEqual({
      kind: 'stale',
      expectedRevision: 0,
      currentRevision: 0,
      revision: 0,
    });
    expect(controller.getState()).toStrictEqual({ status: 'unconfigured' });
    expect(controller.getRuntime()).toBeUndefined();
  });

  it('promotes a deleted source to a draft before a no-op model command runs', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await bringUpAlpha(harness, controller);
    const sourceFingerprint = await harness.repo.stat('alpha');
    if (sourceFingerprint === null) {
      throw new Error('alpha fingerprint missing from the repository');
    }

    await harness.repo.delete('alpha');
    const firstAttempt = await controller.execute({
      kind: 'model',
      model: 'm1',
      expectedRevision: 1,
    });
    expect(firstAttempt).toStrictEqual({
      kind: 'stale',
      expectedRevision: 1,
      currentRevision: 2,
      revision: 2,
    });
    const promoted = configuredState(controller.getState());
    expect(promoted.revision).toBe(2);
    expect(promoted.identity).toStrictEqual({
      kind: 'draft',
      derivedFrom: { name: 'alpha', source: sourceFingerprint },
    });
    expect(promoted.document).toStrictEqual(standardProvADocument('m1'));

    // The resubmission runs against the promoted draft: no-op detection sees the
    // same model on the preserved document and commits nothing.
    const result = await controller.execute({
      kind: 'model',
      model: 'm1',
      expectedRevision: 2,
    });
    expect(result).toStrictEqual({
      kind: 'no-op',
      reason: 'model unchanged',
      revision: 2,
    });
    const state = configuredState(controller.getState());
    expect(state.revision).toBe(2);
    expect(state.identity).toStrictEqual({
      kind: 'draft',
      derivedFrom: { name: 'alpha', source: sourceFingerprint },
    });
    expect(state.document).toStrictEqual(standardProvADocument('m1'));
  });

  it('forks an explicit member from the captured source instead of rereading the edited file', async () => {
    const harness = makeDeps();
    const capturedMember = (): StandardProfileDocument => ({
      ...standardProvADocument('m1'),
      modelParams: { temperature: 0.1 },
      ephemeralSettings: { 'base-url': 'https://old.example.com' },
    });
    harness.repo.seed('m1p', capturedMember());
    harness.repo.seed('m2p', standardProvADocument('m2'));
    harness.repo.seed('mylb', {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['m1p', 'm2p'],
      provider: 'prov-a',
      model: 'm1',
      modelParams: {},
      ephemeralSettings: {},
    });
    const controller = new ProfileController(harness.deps);
    await startupNamed(harness, controller, 'mylb');

    harness.repo.seed('m1p', {
      ...standardProvADocument('m1'),
      modelParams: { temperature: 0.9 },
      ephemeralSettings: { 'base-url': 'https://new.example.com' },
    });

    const pending = controller.execute({
      kind: 'model',
      model: 'm2',
      member: 'm1p',
      expectedRevision: 1,
    });
    const result = committed(await releaseAndAwait(harness, pending));

    expect(result.revision).toBe(2);
    const state = configuredState(controller.getState());
    expect(state.document).toStrictEqual({
      ...capturedMember(),
      model: 'm2',
    });
  });

  it('carries the resolved member documents to the factory on a load-balancer commit', async () => {
    const harness = makeDeps();
    seedMyLb(harness.repo);
    const controller = new ProfileController(harness.deps);

    await startupNamed(harness, controller, 'mylb');

    const spec = harness.factory.lastSpec;
    if (spec === undefined) {
      throw new Error('expected the load-balancer commit to reach the factory');
    }
    expect(spec.memberDocuments).toStrictEqual({
      m1p: standardProvADocument('m1'),
      m2p: standardProvADocument('m2'),
    });
  });

  it('redacts secret material in a failed build error', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const binding = await bringUpAlpha(harness, controller);
    harness.factory.failNextBuild('build failed with auth-key: sk-123 in env');

    const pending = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });

    expect(await releaseAndAwait(harness, pending)).toStrictEqual({
      kind: 'failed',
      error: 'Error: build failed with auth-key: [redacted]',
      revision: 1,
    });
    expect(controller.getRuntime()?.getBinding()).toBe(binding);
    expect(configuredState(controller.getState()).document.model).toBe('m1');
  });
});
