/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type {
  ProfileDocument,
  ProfileRepositoryPort,
  ProfileEvent,
  SourceFingerprint,
} from '@vybestack/llxprt-code-core';
import { ProfileController } from '../profileController.js';
import {
  InMemoryRepository,
  makeDeps,
  seedAlpha,
  standardProvADocument,
  settle,
  setupSavedAlpha,
  setupDraftAtRevision2,
} from './controllerTestFakes.js';

describe('ProfileController persistence', () => {
  for (const stage of ['stat', 'save']) {
    for (const stop of ['abort', 'dispose']) {
      it(`reconciles persisted state after ${stop} during save ${stage}`, async () => {
        let release: () => void = () => {};
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        let entered = false;
        let armed = false;
        let writes = 0;
        class HeldRepository extends InMemoryRepository {
          override async stat(name: string): Promise<SourceFingerprint | null> {
            if (armed && stage === 'stat') {
              entered = true;
              await held;
            }
            return super.stat(name);
          }
          override async save(
            name: string,
            document: ProfileDocument,
            expected?: SourceFingerprint,
            opts?: Parameters<ProfileRepositoryPort['save']>[3],
          ): Promise<SourceFingerprint> {
            if (armed && stage === 'save') {
              entered = true;
              await held;
            }
            writes += 1;
            return super.save(name, document, expected, opts);
          }
        }
        const harness = makeDeps(new HeldRepository());
        seedAlpha(harness.repo);
        const events: ProfileEvent[] = [];
        harness.deps.listeners = [
          (event) => {
            events.push(event);
          },
        ];
        const controller = new ProfileController(harness.deps);
        await setupDraftAtRevision2(harness, controller);
        const before = structuredClone(controller.getState());
        if (before.status !== 'configured')
          throw new Error('expected configured state');
        const abort = new AbortController();
        armed = true;
        const pending = controller.execute(
          { kind: 'save', name: 'beta', expectedRevision: 2 },
          { signal: abort.signal },
        );
        await settle(() => entered);
        const eventsBefore = [...events];
        if (stop === 'abort') {
          abort.abort();
        } else {
          await controller.dispose();
        }
        release();
        expect(await pending).toStrictEqual(
          stop === 'abort'
            ? { kind: 'cancelled', reason: 'execute cancelled', revision: 2 }
            : { kind: 'failed', error: 'controller disposed', revision: 2 },
        );
        const source = await harness.repo.stat('beta');
        expect(controller.getState()).toStrictEqual(
          source === null
            ? before
            : {
                ...before,
                identity: { kind: 'saved', name: 'beta', source },
              },
        );
        expect(
          events.filter((event) => event.type === 'committed'),
        ).toStrictEqual(
          eventsBefore.filter((event) => event.type === 'committed'),
        );
        expect(writes).toStrictEqual(stage === 'stat' ? 0 : 1);
      });
    }
  }

  it('retains the persisted fingerprint when an anchored save aborts after writing', async () => {
    const abort = new AbortController();
    class AbortingRepository extends InMemoryRepository {
      override async save(
        ...args: Parameters<ProfileRepositoryPort['save']>
      ): Promise<SourceFingerprint> {
        await super.save(...args);
        this.tamperFingerprint(args[0]);
        const fingerprint = await super.stat(args[0]);
        if (fingerprint === null) throw new Error('expected persisted profile');
        abort.abort();
        return fingerprint;
      }
    }
    const harness = makeDeps(new AbortingRepository());
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await setupDraftAtRevision2(harness, controller);
    expect(
      await controller.execute(
        { kind: 'save', name: 'alpha', expectedRevision: 2 },
        { signal: abort.signal },
      ),
    ).toStrictEqual({
      kind: 'cancelled',
      reason: 'execute cancelled',
      revision: 2,
    });
    expect(
      await controller.execute({
        kind: 'model',
        model: 'm2',
        expectedRevision: 2,
      }),
    ).toStrictEqual({ kind: 'no-op', reason: 'model unchanged', revision: 2 });
    const source = await harness.repo.stat('alpha');
    if (source === null) throw new Error('expected persisted source');
    expect(controller.getState()).toStrictEqual({
      status: 'configured',
      revision: 2,
      document: standardProvADocument('m2'),
      identity: { kind: 'saved', name: 'alpha', source },
    });
  });

  it('rejects commands after disposal without repository interaction', async () => {
    let reads = 0;
    class ObservedRepository extends InMemoryRepository {
      override async stat(name: string): Promise<SourceFingerprint | null> {
        reads += 1;
        return super.stat(name);
      }
      override async load(
        name: string,
      ): ReturnType<ProfileRepositoryPort['load']> {
        reads += 1;
        return super.load(name);
      }
    }
    const harness = makeDeps(new ObservedRepository());
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await setupSavedAlpha(harness, controller);
    await controller.dispose();
    const before = reads;
    expect(
      await controller.execute({
        kind: 'load',
        name: 'alpha',
        expectedRevision: 1,
      }),
    ).toStrictEqual({
      kind: 'failed',
      error: 'controller disposed',
      revision: 1,
    });
    expect(reads - before).toStrictEqual(0);
  });

  it('saves a modified draft over its unchanged source', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await setupDraftAtRevision2(harness, controller);
    const result = await controller.execute({
      kind: 'save',
      name: 'alpha',
      expectedRevision: 2,
    });
    expect(result.kind).toStrictEqual('committed');
    expect((await harness.repo.load('alpha')).document.model).toStrictEqual(
      'm2',
    );
    const source = await harness.repo.stat('alpha');
    if (source === null) {
      throw new Error('expected saved source');
    }
    expect(controller.getState()).toStrictEqual({
      status: 'configured',
      revision: 2,
      document: standardProvADocument('m2'),
      identity: { kind: 'saved', name: 'alpha', source },
    });
  });

  it('anchors a promoted draft save to its original source fingerprint', async () => {
    const harness = makeDeps();
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await setupSavedAlpha(harness, controller);
    harness.repo.seed('alpha', standardProvADocument('m2'));
    await controller.execute({
      kind: 'save',
      name: 'alpha',
      expectedRevision: 1,
    });
    const before = structuredClone(controller.getState());
    expect(
      await controller.execute({
        kind: 'save',
        name: 'alpha',
        expectedRevision: 2,
      }),
    ).toStrictEqual({ kind: 'conflict', cause: 'source-changed', revision: 2 });
    expect(controller.getState()).toStrictEqual(before);
    expect((await harness.repo.load('alpha')).document.model).toStrictEqual(
      'm2',
    );
  });

  it('refuses a save-as destination created between stat and save', async () => {
    class RacingRepository extends InMemoryRepository {
      override async stat(name: string): Promise<SourceFingerprint | null> {
        const found = await super.stat(name);
        if (name === 'beta' && found === null) {
          this.seed(name, standardProvADocument('m2'));
        }
        return found;
      }
    }
    const harness = makeDeps(new RacingRepository());
    seedAlpha(harness.repo);
    const controller = new ProfileController(harness.deps);
    await setupSavedAlpha(harness, controller);
    const before = structuredClone(controller.getState());
    expect(
      await controller.execute({
        kind: 'save',
        name: 'beta',
        expectedRevision: 1,
      }),
    ).toStrictEqual({
      kind: 'conflict',
      cause: 'destination-exists',
      revision: 1,
    });
    expect(controller.getState()).toStrictEqual(before);
    expect((await harness.repo.load('beta')).document.model).toStrictEqual(
      'm2',
    );
  });
});
