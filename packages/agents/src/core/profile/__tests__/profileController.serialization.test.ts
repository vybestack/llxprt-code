/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Serialization behavior tests for the profile controller.
 *
 * Every case drives the real ProfileController through its public execute surface
 * with deterministic infrastructure fakes: queued commands, busy rejections, discard
 * confirmations, optimistic-concurrency conflicts, and no-op detection are verified
 * against observable results, committed state, events, and live runtime identity.
 */

import { describe, expect, it } from 'bun:test';
import type {
  PendingConfirmation,
  ProfileCommand,
  ProfileCommandResult,
  ProfileEvent,
  SourceFingerprint,
} from '@vybestack/llxprt-code-core';
import { ProfileController } from '../profileController.js';
import {
  makeDeps,
  alphaFingerprint,
  loadAlpha,
  setupSavedAlpha,
  setupDraftAtRevision2,
  configuredState,
  settle,
  releaseAndAwait,
  committedSnapshot,
  seedAlpha,
  standardProvADocument,
  type ControllerTestHarness,
} from './controllerTestFakes.js';

async function setupLoadOverUnsavedDraft(
  harness: ControllerTestHarness,
  controller: ProfileController,
): Promise<{ pending: PendingConfirmation; fingerprint: SourceFingerprint }> {
  const fingerprint = await setupDraftAtRevision2(harness, controller);
  const load = await controller.execute({
    kind: 'load',
    name: 'alpha',
    expectedRevision: 2,
  });
  if (load.kind !== 'confirmation-required') {
    throw new Error(`expected confirmation-required, received ${load.kind}`);
  }
  return { pending: load.pending, fingerprint };
}

function committedModelResult(
  fingerprint: SourceFingerprint,
): ProfileCommandResult {
  return {
    kind: 'committed',
    revision: 2,
    snapshot: committedSnapshot(
      {
        kind: 'draft',
        derivedFrom: { name: 'alpha', source: fingerprint },
      },
      2,
      'm2',
    ),
  };
}

describe('ProfileController serialization', () => {
  it.each(['provider', 'startup-provider'])(
    'confirms %s replacement before resetting a draft',
    async (kind) => {
      const harness = makeDeps();
      seedAlpha(harness.repo);
      const controller = new ProfileController(harness.deps);
      const fingerprint = await setupDraftAtRevision2(harness, controller);
      const command: ProfileCommand =
        kind === 'provider'
          ? { kind: 'provider', provider: 'prov-a', expectedRevision: 2 }
          : { kind: 'startup', provider: 'prov-a', expectedRevision: 2 };
      let settled = false;
      const request = controller.execute(command).then((result) => {
        settled = true;
        return result;
      });
      await settle(() => settled || harness.boundary.pendingCount() === 1);
      if (harness.boundary.pendingCount() === 1) {
        harness.boundary.release('safe');
      }
      const result = await request;
      expect(result.kind).toStrictEqual('confirmation-required');
      if (result.kind !== 'confirmation-required') {
        throw new Error(`expected confirmation, got ${result.kind}`);
      }
      expect(controller.getState()).toStrictEqual({
        status: 'configured',
        revision: 2,
        identity: {
          kind: 'draft',
          derivedFrom: { name: 'alpha', source: fingerprint },
        },
        document: standardProvADocument('m2'),
      });
      const confirm = controller.execute({
        kind: 'confirm-discard',
        pending: result.pending,
        expectedRevision: 2,
      });
      expect((await releaseAndAwait(harness, confirm)).kind).toStrictEqual(
        'committed',
      );
      const state = configuredState(controller.getState());
      expect({
        identity: state.identity,
        revision: state.revision,
        document: state.document,
      }).toStrictEqual({
        identity: { kind: 'draft' },
        revision: 3,
        document: {
          ...standardProvADocument('m2'),
          modelParams: { temperature: 0.25 },
          ephemeralSettings: { 'base-url': 'https://restricted.example.com' },
        },
      });
      expect(controller.getPendingConfirmations()).toStrictEqual([]);
    },
  );

  it('rejects a valid token presented with a mismatched command kind without consuming it', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const { pending, fingerprint } = await setupLoadOverUnsavedDraft(
      harness,
      controller,
    );
    let settled = false;
    const confirm = controller
      .execute({
        kind: 'confirm-discard',
        pending: { ...pending, commandKind: 'setup' },
        expectedRevision: 2,
      })
      .then((result) => {
        settled = true;
        return result;
      });
    await settle(() => settled || harness.boundary.pendingCount() === 1);
    if (harness.boundary.pendingCount() === 1) {
      harness.boundary.release('safe');
    }
    expect(await confirm).toStrictEqual({
      kind: 'invalid',
      errors: ['confirmation command kind mismatch'],
      revision: 2,
    });
    expect(controller.getState()).toStrictEqual({
      status: 'configured',
      revision: 2,
      identity: {
        kind: 'draft',
        derivedFrom: { name: 'alpha', source: fingerprint },
      },
      document: standardProvADocument('m2'),
    });
    expect(controller.getPendingConfirmations()).toStrictEqual([pending.token]);
    const validConfirm = controller.execute({
      kind: 'confirm-discard',
      pending,
      expectedRevision: 2,
    });
    expect((await releaseAndAwait(harness, validConfirm)).kind).toStrictEqual(
      'committed',
    );
    expect(controller.getPendingConfirmations()).toStrictEqual([]);
  });

  for (const kind of ['startup', 'setup']) {
    it(`replays ${kind} after discard confirmation and commits`, async () => {
      const harness = makeDeps();
      seedAlpha(harness.repo);
      const controller = new ProfileController(harness.deps);
      await setupDraftAtRevision2(harness, controller);
      const command: ProfileCommand =
        kind === 'startup'
          ? { kind: 'startup', profileName: 'alpha', expectedRevision: 2 }
          : { kind: 'setup', expectedRevision: 2 };
      const result = await controller.execute(command);
      if (result.kind !== 'confirmation-required') {
        throw new Error(`expected confirmation, got ${result.kind}`);
      }
      const confirm = controller.execute({
        kind: 'confirm-discard',
        pending: result.pending,
        expectedRevision: 2,
      });
      expect((await releaseAndAwait(harness, confirm)).kind).toStrictEqual(
        'committed',
      );
      expect(configuredState(controller.getState()).revision).toStrictEqual(3);
      expect(
        configuredState(controller.getState()).document.model,
      ).toStrictEqual(kind === 'startup' ? 'm1' : '');
      expect(controller.getPendingConfirmations()).toStrictEqual([]);
    });
  }

  it('runs a queued command after the boundary release and the queued command sees the committed result', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const events: ProfileEvent[] = [];
    harness.deps.listeners = [
      (event) => {
        events.push(event);
      },
    ];
    const controller = new ProfileController(harness.deps);
    await loadAlpha(harness, controller);

    const first = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    const second = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 2,
    });
    await expect(second).resolves.toStrictEqual({
      kind: 'queued',
      baseRevision: 1,
      revision: 1,
    });

    harness.boundary.release('safe');
    expect(await first).toStrictEqual(
      committedModelResult(await alphaFingerprint(harness)),
    );

    const state = configuredState(controller.getState());
    expect(state.revision).toBe(2);
    expect(state.document).toStrictEqual({
      version: 1,
      type: 'standard',
      provider: 'prov-a',
      model: 'm2',
      modelParams: {},
      ephemeralSettings: {},
    });
    expect(
      events.some(
        (event) =>
          event.type === 'command-no-op' &&
          event.commandKind === 'model' &&
          event.revision === 2,
      ),
    ).toBe(true);
  });

  it('never rebases a queued stale command and rejects it after the boundary cancels', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const events: ProfileEvent[] = [];
    harness.deps.listeners = [
      (event) => {
        events.push(event);
      },
    ];
    const controller = new ProfileController(harness.deps);
    const fingerprint = await setupSavedAlpha(harness, controller);

    const first = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    const second = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 2,
    });
    await expect(second).resolves.toStrictEqual({
      kind: 'queued',
      baseRevision: 1,
      revision: 1,
    });

    harness.boundary.release('cancelled');
    await expect(first).resolves.toStrictEqual({
      kind: 'cancelled',
      reason: 'boundary cancelled',
      revision: 1,
    });

    expect(
      events.some(
        (event) =>
          event.type === 'command-rejected' &&
          event.commandKind === 'model' &&
          event.revision === 1,
      ),
    ).toBe(true);

    const state = configuredState(controller.getState());
    expect(state.revision).toBe(1);
    expect(state.identity).toStrictEqual({
      kind: 'saved',
      name: 'alpha',
      source: fingerprint,
    });
    expect(state.document).toStrictEqual(standardProvADocument('m1'));
  });

  it('answers a non-queueing caller with busy while a command is in flight', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await setupSavedAlpha(harness, controller);

    const first = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    const busy = await controller.execute(
      { kind: 'model', model: 'm2', expectedRevision: 2 },
      { queue: false },
    );
    expect(busy).toStrictEqual({
      kind: 'busy',
      activeCommandKind: 'model',
      revision: 1,
    });

    harness.boundary.release('safe');
    expect(await first).toStrictEqual(
      committedModelResult(await alphaFingerprint(harness)),
    );
    expect(configuredState(controller.getState()).revision).toBe(2);
  });

  it('requires confirmation when a load targets an unsaved draft', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const { pending } = await setupLoadOverUnsavedDraft(harness, controller);

    expect(pending.commandKind).toBe('load');
    expect(controller.getPendingConfirmations()).toStrictEqual([pending.token]);
    expect(configuredState(controller.getState()).revision).toBe(2);
  });

  it('replays the original load after confirm-discard and commits the saved identity', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const { pending, fingerprint } = await setupLoadOverUnsavedDraft(
      harness,
      controller,
    );

    const confirm = controller.execute({
      kind: 'confirm-discard',
      pending,
      expectedRevision: 2,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.boundary.release('safe');

    expect(await confirm).toStrictEqual({
      kind: 'committed',
      revision: 3,
      snapshot: committedSnapshot(
        { kind: 'saved', name: 'alpha', source: fingerprint },
        3,
        'm1',
      ),
    });
    expect(configuredState(controller.getState()).identity).toStrictEqual({
      kind: 'saved',
      name: 'alpha',
      source: fingerprint,
    });
    expect(controller.getPendingConfirmations()).toStrictEqual([]);
  });

  it('rejects a confirm-discard with an unknown token as invalid', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const fingerprint = await setupSavedAlpha(harness, controller);

    const result = await controller.execute({
      kind: 'confirm-discard',
      pending: {
        token: 'discard:never-issued',
        commandKind: 'load',
        description: 'no such confirmation',
      },
      expectedRevision: 1,
    });

    expect(result).toStrictEqual({
      kind: 'invalid',
      errors: ['unknown confirmation token'],
      revision: 1,
    });
    expect(controller.getPendingConfirmations()).toStrictEqual([]);
    const state = configuredState(controller.getState());
    expect(state.revision).toBe(1);
    expect(state.identity).toStrictEqual({
      kind: 'saved',
      name: 'alpha',
      source: fingerprint,
    });
  });

  it('refuses a save-as onto an existing profile with a destination-exists conflict', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const fingerprint = await setupSavedAlpha(harness, controller);

    harness.repo.seed('bravo', standardProvADocument('m1'));

    const result = await controller.execute({
      kind: 'save',
      name: 'bravo',
      expectedRevision: 1,
    });

    expect(result).toStrictEqual({
      kind: 'conflict',
      cause: 'destination-exists',
      revision: 1,
    });
    const state = configuredState(controller.getState());
    expect(state.revision).toBe(1);
    expect(state.identity).toStrictEqual({
      kind: 'saved',
      name: 'alpha',
      source: fingerprint,
    });
    expect(state.document).toStrictEqual(standardProvADocument('m1'));
    const bravo = await harness.repo.stat('bravo');
    expect(bravo).not.toBeNull();
  });

  it('refuses a draft save over an existing unrelated name with a destination-exists conflict', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await setupDraftAtRevision2(harness, controller);

    harness.repo.seed('bravo', standardProvADocument('m1'));
    const result = await controller.execute({
      kind: 'save',
      name: 'bravo',
      expectedRevision: 2,
    });

    expect(result).toStrictEqual({
      kind: 'conflict',
      cause: 'destination-exists',
      revision: 2,
    });
    const state = configuredState(controller.getState());
    expect(state.revision).toBe(2);
    if (state.identity.kind !== 'draft') {
      throw new Error('expected the workspace to stay an unsaved draft');
    }
    expect(state.document).toStrictEqual(standardProvADocument('m2'));
  });

  it('commits a save-as to a fresh name and leaves the source profile intact', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await setupSavedAlpha(harness, controller);

    const result = await controller.execute({
      kind: 'save',
      name: 'beta',
      expectedRevision: 1,
    });

    expect(result.kind).toBe('committed');
    const betaFingerprint = await harness.repo.stat('beta');
    if (betaFingerprint === null) {
      throw new Error('beta fingerprint missing from the repository');
    }
    const state = configuredState(controller.getState());
    expect(state.identity).toStrictEqual({
      kind: 'saved',
      name: 'beta',
      source: betaFingerprint,
    });
    expect(state.document).toStrictEqual(standardProvADocument('m1'));
    const alpha = await harness.repo.load('alpha');
    expect(alpha.document).toStrictEqual(standardProvADocument('m1'));
  });

  it('keeps the revision and the live runtime identity across a successful save', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const fingerprint = await setupSavedAlpha(harness, controller);
    const runtime = controller.getRuntime();
    const binding = runtime?.getBinding();
    if (runtime === undefined || binding === undefined) {
      throw new Error('expected a live runtime after the alpha load');
    }

    const result = await controller.execute({
      kind: 'save',
      name: 'charlie',
      expectedRevision: 1,
    });

    expect(result).toStrictEqual({
      kind: 'committed',
      revision: 1,
      snapshot: {
        identity: { kind: 'saved', name: 'charlie', source: fingerprint },
        revision: 1,
        provider: 'prov-a',
        model: 'm1',
        isLoadBalancer: false,
      },
    });
    const state = configuredState(controller.getState());
    expect(state.revision).toBe(1);
    expect(state.identity).toStrictEqual({
      kind: 'saved',
      name: 'charlie',
      source: fingerprint,
    });
    expect(controller.getRuntime()).toBe(runtime);
    expect(controller.getRuntime()?.getBinding()).toBe(binding);
  });

  it('treats a same-model /model command as a no-op', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await setupSavedAlpha(harness, controller);

    const result = await controller.execute({
      kind: 'model',
      model: 'm1',
      expectedRevision: 1,
    });

    expect(result).toStrictEqual({
      kind: 'no-op',
      reason: 'model unchanged',
      revision: 1,
    });
    const state = configuredState(controller.getState());
    expect(state.revision).toBe(1);
    expect(state.document).toStrictEqual(standardProvADocument('m1'));
  });

  it('keeps serialization healthy when a queued command throws inside the drain', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const events: ProfileEvent[] = [];
    harness.deps.listeners = [
      (event) => {
        events.push(event);
      },
    ];
    const controller = new ProfileController(harness.deps);
    await loadAlpha(harness, controller);

    const first = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.factory.holdNextBuild();
    harness.boundary.release('safe');
    await settle(() => harness.factory.built === 2);

    const second = controller.execute({
      kind: 'save',
      name: 'beta',
      expectedRevision: 2,
    });
    await expect(second).resolves.toStrictEqual({
      kind: 'queued',
      baseRevision: 1,
      revision: 1,
    });

    harness.repo.failNextRead();
    harness.factory.releaseHeldBuild();

    // The first command's promise must still resolve committed even though the
    // queued save-as threw on its destination stat inside the shared drain.
    expect(await first).toStrictEqual(
      committedModelResult(await alphaFingerprint(harness)),
    );

    expect(
      events.some(
        (event) =>
          event.type === 'command-rejected' &&
          event.commandKind === 'save' &&
          event.revision === 2,
      ),
    ).toBe(true);
    expect(configuredState(controller.getState()).revision).toBe(2);
    expect(await harness.repo.stat('beta')).toBeNull();

    const third = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 2,
    });
    expect(await third).toStrictEqual({
      kind: 'no-op',
      reason: 'model unchanged',
      revision: 2,
    });
  });

  it('emits the committed event only after the new state and runtime are adopted', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const revisionsAtCommit: number[] = [];
    const kindsAtCommit: Array<string | null> = [];
    harness.deps.listeners = [
      (event) => {
        if (event.type === 'committed') {
          const state = controller.getState();
          revisionsAtCommit.push(
            state.status === 'configured' ? state.revision : 0,
          );
          kindsAtCommit.push(event.commandKind);
        }
      },
    ];
    const controller = new ProfileController(harness.deps);

    await loadAlpha(harness, controller);
    const pending = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.boundary.release('safe');
    expect((await pending).kind).toBe('committed');

    expect(revisionsAtCommit).toStrictEqual([1, 2]);
    expect(kindsAtCommit).toStrictEqual(['startup', 'model']);
  });

  it('announces a save conflict as a rejection instead of a commit', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const events: ProfileEvent[] = [];
    harness.deps.listeners = [
      (event) => {
        events.push(event);
      },
    ];
    const controller = new ProfileController(harness.deps);
    await setupSavedAlpha(harness, controller);
    harness.repo.seed('bravo', standardProvADocument('m1'));
    const commitsBefore = events.filter(
      (event) => event.type === 'committed',
    ).length;

    const result = await controller.execute({
      kind: 'save',
      name: 'bravo',
      expectedRevision: 1,
    });

    expect(result).toStrictEqual({
      kind: 'conflict',
      cause: 'destination-exists',
      revision: 1,
    });
    expect(
      events.some(
        (event) =>
          event.type === 'command-rejected' &&
          event.commandKind === 'save' &&
          event.revision === 1,
      ),
    ).toBe(true);
    expect(events.filter((event) => event.type === 'committed').length).toBe(
      commitsBefore,
    );
  });

  it('dispatches deep-frozen events that listeners cannot mutate', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const frozenFlags: boolean[] = [];
    harness.deps.listeners = [
      (event) => {
        frozenFlags.push(Object.isFrozen(event));
      },
    ];
    const controller = new ProfileController(harness.deps);

    await loadAlpha(harness, controller);

    expect(frozenFlags.length).toBeGreaterThan(0);
    expect(frozenFlags.every((flag) => flag)).toBe(true);
  });

  it('hands out a committed state graph frozen against mutation', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await loadAlpha(harness, controller);

    const state = configuredState(controller.getState());
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.document)).toBe(true);
    expect(Object.isFrozen(state.document.modelParams)).toBe(true);
    expect(Object.isFrozen(state.document.ephemeralSettings)).toBe(true);
    expect(() => {
      state.document.model = 'mutated';
    }).toThrow(TypeError);
    expect(configuredState(controller.getState()).document.model).toBe('m1');
  });

  it('executes a queued command from an immutable copy, not the caller object', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await loadAlpha(harness, controller);

    const first = controller.execute({
      kind: 'model',
      model: 'm2',
      expectedRevision: 1,
    });
    await settle(() => harness.boundary.pendingCount() === 1);

    const queuedCommand: ProfileCommand = {
      kind: 'model',
      model: 'm1',
      expectedRevision: 2,
    };
    const second = controller.execute(queuedCommand);
    await expect(second).resolves.toStrictEqual({
      kind: 'queued',
      baseRevision: 1,
      revision: 1,
    });

    // Tampering toward the no-op model must not reach the queue: the protected
    // copy still carries 'm1', so the drain forks back to m1 at revision 3. A
    // leaked reference would run 'm2' and no-op, leaving m2 committed at 2.
    queuedCommand.model = 'm2';

    harness.boundary.release('safe');
    await settle(() => harness.boundary.pendingCount() === 1);
    harness.boundary.release('safe');
    expect(await first).toStrictEqual(
      committedModelResult(await alphaFingerprint(harness)),
    );
    const state = configuredState(controller.getState());
    expect(state.revision).toBe(3);
    expect(state.document).toStrictEqual(standardProvADocument('m1'));
  });

  it('reflects a save in the live runtime snapshot at the new fingerprint', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    const runtime = await setupSavedAlpha(harness, controller).then(() =>
      controller.getRuntime(),
    );
    if (runtime === undefined) {
      throw new Error('expected a live runtime after the alpha load');
    }

    const result = await controller.execute({
      kind: 'save',
      name: 'charlie',
      expectedRevision: 1,
    });
    expect(result.kind).toBe('committed');

    const charlieFingerprint = await harness.repo.stat('charlie');
    if (charlieFingerprint === null) {
      throw new Error('charlie fingerprint missing from the repository');
    }
    expect(controller.getRuntime()).toBe(runtime);
    expect(runtime.snapshot()).toStrictEqual(
      committedSnapshot(
        {
          kind: 'saved',
          name: 'charlie',
          source: charlieFingerprint,
        },
        1,
        'm1',
      ),
    );
  });
});
