/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavior tests for the agents-side profile repository adapter.
 *
 * Real temp filesystem + the real ProfileManager: save/load round-trips and
 * optimistic-concurrency behavior are verified against actual JSON files, not stubs.
 */

import { describe, it, expect, afterEach, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import { channel } from 'node:diagnostics_channel';
import {
  withProfilesLock,
  LOCK_CONTENTION_CHANNEL,
} from '../../../../../settings/src/profiles/profileStore.js';
import os from 'node:os';
import path from 'node:path';
import { ProfileManager, type Profile } from '@vybestack/llxprt-code-settings';
import {
  ProfileRepositoryConflictError,
  isStandardProfileDocument,
  type LoadBalancerProfileDocument,
  type ProfileDocument,
  type SourceFingerprint,
} from '@vybestack/llxprt-code-core';
import {
  ProfileManagerProfileRepository,
  toProfileDocument,
  toSettingsProfile,
} from '../profileRepositoryAdapter.js';
import { ProfileController } from '../profileController.js';
import { makeDeps, releaseAndAwait } from './controllerTestFakes.js';

function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-agent-profile-'));
}

const standardDocument = (): ProfileDocument => ({
  version: 1,
  type: 'standard',
  provider: 'openai',
  model: 'gpt-4o',
  modelParams: { temperature: 0.2 },
  ephemeralSettings: {
    'auth-key': 'sk-test',
    'base-url': 'https://example.com',
  },
});

const loadBalancerDocument = (): LoadBalancerProfileDocument => ({
  version: 1,
  type: 'loadbalancer',
  policy: 'roundrobin',
  profiles: ['member-a', 'member-b'],
  contextLimit: 128000,
  provider: '',
  model: '',
  modelParams: {},
  ephemeralSettings: { 'context-limit': 128000 },
});

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('ProfileManagerProfileRepository', () => {
  let repository: ProfileManagerProfileRepository;

  const tempDirs: string[] = [];

  async function setupRepository(
    manager: (dir: string) => ProfileManager = (dir) => new ProfileManager(dir),
  ): Promise<void> {
    const dir = await makeTempDir();
    tempDirs.push(dir);
    const profileManager = manager(dir);
    repository = new ProfileManagerProfileRepository(profileManager, dir);
  }

  afterEach(async () => {
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tempDirs.length = 0;
  });

  it('checks the overwrite anchor after acquiring a contended profiles lock', async () => {
    await setupRepository();
    const expected = await repository.save('contended', standardDocument());
    const contention = channel(LOCK_CONTENTION_CHANNEL);
    let observed: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const onContention = (): void => observed();
    contention.subscribe(onContention);
    let saving: Promise<SourceFingerprint> | undefined;
    try {
      await withProfilesLock(repository.profilesDir, async () => {
        saving = repository.save(
          'contended',
          { ...standardDocument(), model: 'loser' },
          expected,
        );
        await waiting;
        await fs.writeFile(
          path.join(repository.profilesDir, 'contended.json'),
          JSON.stringify({ ...standardDocument(), model: 'external-winner' }),
        );
      });
      await expect(saving).rejects.toBeInstanceOf(
        ProfileRepositoryConflictError,
      );
      expect((await repository.load('contended')).document.model).toStrictEqual(
        'external-winner',
      );
    } finally {
      contention.unsubscribe(onContention);
    }
  });

  it.each(['EACCES', 'EMFILE'])(
    'propagates %s from stat through load and anchored save',
    async (code) => {
      await setupRepository();
      const expected = await repository.save('unreadable', standardDocument());
      const failure = Object.assign(new Error('filesystem unavailable'), {
        code,
      });
      const stat = spyOn(fs, 'stat').mockRejectedValue(failure);
      try {
        await expect(repository.stat('unreadable')).rejects.toBe(failure);
        await expect(repository.load('unreadable')).rejects.toBe(failure);
        await expect(
          repository.save('unreadable', standardDocument(), expected),
        ).rejects.toBe(failure);
      } finally {
        stat.mockRestore();
      }
    },
  );

  it.each(['ENOENT', 'ENOTDIR'])(
    'treats %s as a missing source',
    async (code) => {
      await setupRepository();
      const stat = spyOn(fs, 'stat').mockRejectedValue(
        Object.assign(new Error('missing'), { code }),
      );
      try {
        expect(await repository.stat('missing')).toStrictEqual(null);
      } finally {
        stat.mockRestore();
      }
    },
  );

  it('isolates nested values in both document conversion directions', () => {
    const original: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: { extra: { nested: ['original'] } },
      ephemeralSettings: {
        'custom-headers': { header: 'original' },
        'disabled-tools': ['shell'],
        'tools.allowed': ['read'],
      },
    };
    const untouched = structuredClone(original);
    const document = toProfileDocument(original);
    const settings = toSettingsProfile(document);
    for (const value of [
      settings.ephemeralSettings,
      document.ephemeralSettings,
    ]) {
      const headers = value['custom-headers'];
      if (typeof headers !== 'object' || headers === null)
        throw new Error('expected headers');
      Object.assign(headers, { header: 'changed' });
      const tools = value['disabled-tools'];
      if (!Array.isArray(tools)) throw new Error('expected tools');
      tools.push('edit');
    }
    expect(original).toStrictEqual(untouched);
    expect(document.ephemeralSettings['disabled-tools']).toStrictEqual([
      'shell',
      'edit',
    ]);
    const nested = settings.modelParams.extra;
    if (typeof nested !== 'object' || nested === null)
      throw new Error('expected nested model params');
    Object.assign(nested, { nested: ['changed'] });
    expect(document.modelParams).toStrictEqual(untouched.modelParams);
  });

  it('skips binding construction for an untagged blank returned by the manager', async () => {
    class CoreDocumentManager extends ProfileManager {
      constructor(private readonly directory: string) {
        super(directory);
      }
      override async loadProfile(name: string): Promise<Profile> {
        const raw: unknown = JSON.parse(
          await fs.readFile(path.join(this.directory, `${name}.json`), 'utf8'),
        );
        if (!isStandardProfileDocument(raw)) {
          throw new Error('expected a standard document');
        }
        return toSettingsProfile(raw);
      }
    }
    await setupRepository((dir) => new CoreDocumentManager(dir));
    const harness = makeDeps();
    harness.deps.repository = repository;
    const writer = new ProfileController(harness.deps);
    expect(
      (
        await releaseAndAwait(
          harness,
          writer.execute({ kind: 'setup', expectedRevision: 0 }),
        )
      ).kind,
    ).toStrictEqual('committed');
    expect(
      (
        await writer.execute({
          kind: 'save',
          name: 'blank',
          expectedRevision: 1,
        })
      ).kind,
    ).toStrictEqual('committed');
    expect((await repository.load('blank')).document.type).toBeUndefined();
    const reader = new ProfileController(harness.deps);
    expect(
      (
        await releaseAndAwait(
          harness,
          reader.execute({
            kind: 'startup',
            profileName: 'blank',
            expectedRevision: 0,
          }),
        )
      ).kind,
    ).toStrictEqual('committed');
    expect(harness.factory.built).toStrictEqual(0);
    expect(reader.getRuntime()?.getBinding()).toBeUndefined();
  });

  async function setupRacingRepository(
    keepRacing: boolean,
  ): Promise<() => number> {
    let loads = 0;
    class RacingManager extends ProfileManager {
      override async loadProfile(name: string): Promise<Profile> {
        const loaded = await super.loadProfile(name);
        loads += 1;
        if (keepRacing || loads === 1) {
          await this.saveProfile(name, {
            ...loaded,
            model: `${loaded.model}-changed`,
          });
        }
        return loaded;
      }
    }
    await setupRepository((dir) => new RacingManager(dir));
    await repository.save('racing', standardDocument());
    return () => loads;
  }

  it('throws a typed conflict after two unstable reads and maps it to controller failure', async () => {
    const loads = await setupRacingRepository(true);
    await expect(repository.load('racing')).rejects.toBeInstanceOf(
      ProfileRepositoryConflictError,
    );
    expect(loads()).toStrictEqual(2);
    const harness = makeDeps();
    harness.deps.repository = repository;
    const controller = new ProfileController(harness.deps);
    expect(
      await controller.execute({
        kind: 'startup',
        profileName: 'racing',
        expectedRevision: 0,
      }),
    ).toStrictEqual({
      kind: 'failed',
      error: "Profile 'racing' changed while loading",
      revision: 0,
    });
  });

  it('retries a racing read and returns a coherent document and fingerprint', async () => {
    const loads = await setupRacingRepository(false);
    const loaded = await repository.load('racing');
    expect(loaded.document.model).toStrictEqual('gpt-4o-changed');
    expect(await repository.stat('racing')).toStrictEqual(loaded.fingerprint);
    expect(loads()).toStrictEqual(2);
  });

  it.each(['', '.', '..', 'a/../b', '/etc/passwd', 'a\\b', 'bad\u0000name'])(
    'rejects invalid name %j before filesystem or manager access',
    async (name) => {
      let calls = 0;
      class ObservedManager extends ProfileManager {
        override async loadProfile(): Promise<Profile> {
          calls += 1;
          return toSettingsProfile(standardDocument());
        }
        override async saveProfile(): Promise<void> {
          calls += 1;
        }
        override async deleteProfile(): Promise<void> {
          calls += 1;
        }
      }
      await setupRepository((dir) => new ObservedManager(dir));
      const statSpy = spyOn(fs, 'stat');
      try {
        await expect(repository.load(name)).rejects.toBeInstanceOf(RangeError);
        await expect(
          repository.save(name, standardDocument()),
        ).rejects.toBeInstanceOf(RangeError);
        await expect(repository.stat(name)).rejects.toBeInstanceOf(RangeError);
        await expect(repository.delete(name)).rejects.toBeInstanceOf(
          RangeError,
        );
        expect(calls).toStrictEqual(0);
        expect(statSpy.mock.calls.length).toStrictEqual(0);
      } finally {
        statSpy.mockRestore();
      }
    },
  );

  it('rejects invalid names returned by the manager listing', async () => {
    class InvalidListingManager extends ProfileManager {
      override async listProfiles(): Promise<string[]> {
        return ['ok', '../escape'];
      }
    }
    await setupRepository((dir) => new InvalidListingManager(dir));
    await expect(repository.list()).rejects.toBeInstanceOf(RangeError);
  });

  it('atomically refuses concurrent create-only saves without overwriting the winner', async () => {
    await setupRepository();
    const documents = [
      standardDocument(),
      { ...standardDocument(), model: 'gpt-4o-mini' },
    ];
    const results = await Promise.allSettled(
      documents.map((document) =>
        repository.save('exclusive', document, undefined, { mustCreate: true }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled').length,
    ).toStrictEqual(1);
    const loser = results.find((result) => result.status === 'rejected');
    if (loser === undefined) {
      throw new Error('expected one conflict');
    }
    expect(loser.reason).toBeInstanceOf(ProfileRepositoryConflictError);
    const winnerIndex = results.findIndex(
      (result) => result.status === 'fulfilled',
    );
    expect((await repository.load('exclusive')).document.model).toStrictEqual(
      documents[winnerIndex].model,
    );
  });

  it('round-trips a standard document through save and load', async () => {
    await setupRepository();
    const name = uniqueName('std');
    await repository.save(name, standardDocument());
    const loaded = await repository.load(name);
    // The settings parser drops the optional `type` on a standard profile, so
    // the persisted document is the standard shape without an explicit type field.
    const { type: _type, ...expected } = standardDocument();
    expect(loaded.document).toStrictEqual(expected);
    expect(loaded.fingerprint.kind).toBe('stat');
    const fingerprint: SourceFingerprint = loaded.fingerprint;
    if (fingerprint.kind !== 'stat') {
      throw new Error('expected a stat fingerprint');
    }
    expect(fingerprint.size).toBeGreaterThan(0);
  });

  it('round-trips a load balancer document through save and load', async () => {
    await setupRepository();
    const memberName = uniqueName('member-a');
    const memberB = uniqueName('member-b');
    const memberDoc: ProfileDocument = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-3-7-sonnet',
      modelParams: {},
      ephemeralSettings: {},
    };
    await repository.save(memberName, memberDoc);
    await repository.save(memberB, memberDoc);
    const lbName = uniqueName('lb');
    const lbDoc = loadBalancerDocument();
    const lbWithNames: ProfileDocument = {
      ...lbDoc,
      type: 'loadbalancer',
      profiles: [memberName, memberB],
    };
    await repository.save(lbName, lbWithNames);
    const loaded = await repository.load(lbName);
    expect(loaded.document).toStrictEqual(lbWithNames);
  });

  it('stat returns a fingerprint that changes after re-save', async () => {
    await setupRepository();
    const name = uniqueName('stat');
    await repository.save(name, standardDocument());
    const first = await repository.stat(name);
    expect(first).not.toBeNull();
    // Re-save with different content so mtime/size can change.
    await repository.save(name, {
      ...standardDocument(),
      model: 'gpt-4o-mini',
    });
    const second = await repository.stat(name);
    expect(second).not.toBeNull();
    if (
      first === null ||
      second === null ||
      first.kind !== 'stat' ||
      second.kind !== 'stat'
    ) {
      throw new Error('expected stat fingerprints for both saves');
    }
    expect(second).not.toStrictEqual(first);
    expect(second.size).toBeGreaterThan(first.size);
  });

  it('save with the matching expected fingerprint succeeds', async () => {
    await setupRepository();
    const name = uniqueName('match');
    await repository.save(name, standardDocument());
    const expected = await repository.stat(name);
    if (expected === null) {
      throw new Error('expected persisted fingerprint');
    }
    const updated = { ...standardDocument(), model: 'gpt-4o-mini' };
    const fingerprint = await repository.save(name, updated, expected);
    expect(fingerprint.kind).toBe('stat');
    const loaded = await repository.load(name);
    expect(loaded.document.model).toBe('gpt-4o-mini');
  });

  it('save with a stale expected fingerprint throws and leaves the file untouched', async () => {
    await setupRepository();
    const name = uniqueName('stale');
    await repository.save(name, standardDocument());
    const stale: SourceFingerprint = {
      kind: 'stat',
      mtimeMs: 1,
      size: 1,
    };
    await expect(
      repository.save(
        name,
        { ...standardDocument(), model: 'gpt-4o-mini' },
        stale,
      ),
    ).rejects.toBeInstanceOf(ProfileRepositoryConflictError);
    const loaded = await repository.load(name);
    // The save was refused, so the file still holds the original document. The
    // settings parser drops the optional `type` field on standard profiles.
    const { type: _type, ...untouched } = standardDocument();
    expect(loaded.document).toStrictEqual(untouched);
  });

  it('list returns saved profile names without extensions', async () => {
    await setupRepository();
    const nameA = uniqueName('list-a');
    const nameB = uniqueName('list-b');
    await repository.save(nameA, standardDocument());
    await repository.save(nameB, standardDocument());
    const names = (await repository.list()).map((entry) => entry.name);
    expect(names).toContain(nameA);
    expect(names).toContain(nameB);
  });

  it('delete removes the file so stat returns null', async () => {
    await setupRepository();
    const name = uniqueName('del');
    await repository.save(name, standardDocument());
    const before = await repository.stat(name);
    expect(before).not.toBeNull();
    await repository.delete(name);
    const after = await repository.stat(name);
    expect(after).toBeNull();
  });

  it('converts a settings profile to a core document without shared records', () => {
    const settings: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o',
      modelParams: { temperature: 0.2 },
      ephemeralSettings: { 'auth-key': 'sk-test' },
    };
    const doc = toProfileDocument(settings);
    expect(doc.modelParams).not.toBe(settings.modelParams);
    expect(doc.ephemeralSettings).not.toBe(settings.ephemeralSettings);
  });

  it('converts a core document into a structurally compatible profile', () => {
    const { type: _type, ...document } = standardDocument();
    const settingsDoc = toSettingsProfile(document);
    expect(settingsDoc.version).toBe(1);
    expect(settingsDoc.provider).toBe('openai');
    expect(settingsDoc.model).toBe('gpt-4o');
    expect(settingsDoc.ephemeralSettings['auth-key']).toBe('sk-test');
  });
});
