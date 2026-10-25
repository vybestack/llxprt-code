/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { gate } from './helpers/async-child-disposal-join-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';

describe('activation media owner lifetime', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  it('joins accepted activation before closing the preflight', async () => {
    const route = await openRouteBPreflight();
    const settingsOwner = new SessionSettingsOwner(route.settings);
    const entered = gate();
    const released = gate();
    const telemetry = spyOn(settingsOwner, 'startTelemetry').mockImplementation(
      async () => {
        entered.release();
        await released.promise;
      },
    );
    let pending: Promise<unknown> | undefined;
    let closing: Promise<void> | undefined;
    try {
      await route.prepare({ settingsOwner });
      pending = route.preflight.preflight({ provider: 'fake' });
      await entered.promise;
      closing = route.disposePreflight();
      expect(
        await Promise.race([
          closing.then(() => 'closed'),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve('joining'), 20),
          ),
        ]),
      ).toBe('joining');
    } finally {
      released.release();
      await pending?.catch(() => undefined);
      await closing;
      telemetry.mockRestore();
      await settingsOwner.dispose();
      await route.close();
    }
  });

  it('closes the media store when its owner is disposed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-owner-lifetime-'));
    const owner = new SessionMediaOwner(directory, 1024);
    try {
      await owner.store.admit({
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      expect(await owner.store.getStoredByteLength()).toBeGreaterThan(0);
      await owner.dispose();
      await expect(owner.store.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
    } finally {
      await owner.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('releases the owned filesystem after an accepted memory publication fails during teardown', async () => {
    const route = await openRouteBPreflight();
    const entered = gate();
    const release = gate();
    route.memory.operations.subscribe(async () => {
      entered.release();
      await release.promise;
      throw new Error('publication rejected during teardown');
    });
    try {
      await route.prepare();
      const refreshing = route.memory.operations.refresh();
      await entered.promise;
      const closing = route.disposePreflight();
      const settled = Promise.allSettled([refreshing, closing]);
      release.release();
      await settled;
      await expect(refreshing).rejects.toThrow(
        'Memory publication and rollback failed',
      );
      await expect(closing).rejects.toThrow('Activation owner cleanup');
      expect(() => route.filesystem.paths.directories()).toThrow('disposed');
    } finally {
      release.release();
      // The workspace memory owner retains its failed publication, so the
      // host's own disposal of it reports the same failure again.
      await expect(route.close()).rejects.toThrow(
        'Workspace memory cleanup failed',
      );
    }
  });
});
