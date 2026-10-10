/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { WorkspaceDefinitionOwner } from './workspace-definition-owner.js';

const profile: Profile = {
  version: 1,
  provider: 'openai',
  model: 'definition-model',
  modelParams: { temperature: 0.25 },
  ephemeralSettings: { 'context-limit': 8192 },
};

describe('workspace profile and subagent definitions', () => {
  let directory: string;
  let owner: WorkspaceDefinitionOwner;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'llxprt-definition-'));
    owner = new WorkspaceDefinitionOwner(
      path.join(directory, 'custom-profiles'),
      path.join(directory, 'custom-subagents'),
    );
  });
  afterEach(async () => {
    await owner.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it('persists validated profile and subagent JSON in the selected directories', async () => {
    await owner.profileWrites.saveProfile('route', profile);
    await owner.subagentWrites.saveSubagent(
      'worker',
      'route',
      'Read physical files',
    );
    const diskProfile = JSON.parse(
      await readFile(
        path.join(directory, 'custom-profiles/route.json'),
        'utf8',
      ),
    );
    const diskSubagent = JSON.parse(
      await readFile(
        path.join(directory, 'custom-subagents/worker.json'),
        'utf8',
      ),
    );
    expect(diskProfile.modelParams.temperature).toBeGreaterThan(0);
    expect(diskSubagent.profile).toBe(
      (await owner.profileReads.listProfiles())[0],
    );
    expect(await owner.subagentReads.listSubagents()).toStrictEqual(['worker']);
    await owner.subagentWrites.deleteSubagent('worker');
    await owner.profileWrites.deleteProfile('route');
    expect(await owner.profileReads.listProfiles()).toHaveLength(0);
    expect(await owner.subagentReads.listSubagents()).toHaveLength(0);
  });

  it('returns deeply immutable data and observes a physical profile replacement', async () => {
    await owner.profileWrites.saveProfile('route', profile);
    const first = await owner.profileReads.loadProfile('route');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.modelParams)).toBe(true);
    await writeFile(
      path.join(directory, 'custom-profiles/route.json'),
      JSON.stringify({ ...profile, modelParams: { temperature: 0.75 } }),
    );
    const second = await owner.profileReads.loadProfile('route');
    expect(second.modelParams.temperature).toBeGreaterThan(
      first.modelParams.temperature ?? 0,
    );
    expect(first.modelParams.temperature).toBeLessThan(
      second.modelParams.temperature ?? 1,
    );
  });

  it('keeps same-label repositories independent and explicit shared readers see disk changes', async () => {
    const independent = new WorkspaceDefinitionOwner(
      path.join(directory, 'other-profiles'),
      path.join(directory, 'other-subagents'),
    );
    try {
      await owner.profileWrites.saveProfile('route', profile);
      await independent.profileWrites.saveProfile('route', {
        ...profile,
        modelParams: { temperature: 0.9 },
      });
      const borrowed = owner.profileReads;
      await owner.profileWrites.saveProfile('route', {
        ...profile,
        modelParams: { temperature: 0.5 },
      });
      expect(
        (await independent.profileReads.loadProfile('route')).modelParams
          .temperature,
      ).toBeGreaterThan(
        (await borrowed.loadProfile('route')).modelParams.temperature ?? 0,
      );
    } finally {
      await independent.dispose();
    }
  });

  it('preserves corrupt-file errors and rejects invalid data before writing', async () => {
    await mkdir(path.join(directory, 'custom-profiles'), { recursive: true });
    await writeFile(path.join(directory, 'custom-profiles/broken.json'), '{');
    await expect(owner.profileReads.loadProfile('broken')).rejects.toThrow(
      'corrupted',
    );
    await expect(
      owner.profileWrites.saveProfile('invalid', { provider: 'openai' }),
    ).rejects.toThrow('missing required fields');
    expect(await owner.profileReads.profileExists('invalid')).toBe(false);
    await expect(
      owner.subagentWrites.saveSubagent('worker', 'missing', 'Read'),
    ).rejects.toThrow("Profile 'missing' not found");
    expect(await owner.subagentReads.subagentExistsOnDisk('worker')).toBe(
      false,
    );
  });

  it('publishes contributed definitions with disk and settings precedence and live trust filtering', async () => {
    await owner.profileWrites.saveProfile('route', profile);
    owner.replaceSettingsSubagents({
      worker: { profile: 'route', systemPrompt: 'settings prompt' },
    });
    owner.replaceExtensionSubagents([
      {
        name: 'extension',
        subagents: [
          {
            name: 'worker',
            profile: 'route',
            systemPrompt: 'extension prompt',
          },
          {
            name: 'extension-only',
            profile: 'route',
            systemPrompt: 'extension-only prompt',
          },
        ],
      },
    ]);
    expect(
      (await owner.subagentReads.loadSubagent('worker', false)).source,
    ).toBe('settings');
    expect(await owner.subagentReads.listSubagents(false)).toStrictEqual([
      'worker',
    ]);
    expect(await owner.subagentReads.listSubagents(true)).toStrictEqual([
      'extension-only',
      'worker',
    ]);
    await expect(
      owner.subagentReads.loadSubagent('extension-only', false),
    ).rejects.toThrow('not found');
    await owner.subagentWrites.saveSubagent('worker', 'route', 'disk prompt');
    expect(
      (await owner.subagentReads.loadSubagent('worker', false)).source,
    ).toBe('user');
    owner.replaceExtensionSubagents([]);
    expect(await owner.subagentReads.listSubagents()).toStrictEqual(['worker']);
  });

  it('retains the published catalogue when a replacement cannot be captured', async () => {
    owner.replaceExtensionSubagents([
      {
        name: 'retained',
        subagents: [
          { name: 'reader', profile: 'route', systemPrompt: 'Read files' },
        ],
      },
    ]);
    expect(() =>
      owner.replaceExtensionSubagents([
        {
          name: 'broken',
          subagents: [
            {
              get name(): string {
                throw new Error('unreadable contribution');
              },
              profile: 'route',
              systemPrompt: 'Read files',
            },
          ],
        },
      ]),
    ).toThrow('unreadable contribution');
    expect(await owner.subagentReads.listSubagents()).toStrictEqual(['reader']);
    expect(
      (await owner.subagentReads.loadSubagent('reader')).sourceExtension,
    ).toBe('retained');
  });

  it('closes admission synchronously and joins an accepted physical profile read', async () => {
    await mkdir(path.join(directory, 'custom-profiles'), { recursive: true });
    const fifo = path.join(directory, 'custom-profiles/held.json');
    execFileSync('mkfifo', [fifo]);
    const accepted = owner.profileReads.loadProfile('held');
    let finished = false;
    const disposal = owner.dispose().then(() => {
      finished = true;
    });
    expect(() => owner.profileReads.listProfiles()).toThrow('closed');
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(finished).toBe(false);
    await writeFile(fifo, JSON.stringify(profile));
    expect((await accepted).modelParams.temperature).toBeGreaterThan(0);
    await disposal;
    expect(finished).toBe(true);
  });
  it('shares physical files while isolating workspace contribution catalogues', async () => {
    const workspace = owner.forkContributions();
    try {
      await owner.profileWrites.saveProfile('route', profile);
      owner.replaceSettingsSubagents({
        primary: { profile: 'route', systemPrompt: 'primary settings' },
      });
      workspace.replaceSettingsSubagents({
        peer: { profile: 'route', systemPrompt: 'peer settings' },
      });
      owner.replaceExtensionSubagents([
        {
          name: 'primary',
          subagents: [
            {
              name: 'primary-extension',
              profile: 'route',
              systemPrompt: 'Primary',
            },
          ],
        },
      ]);
      workspace.replaceExtensionSubagents([
        {
          name: 'peer',
          subagents: [
            { name: 'peer-extension', profile: 'route', systemPrompt: 'Peer' },
          ],
        },
      ]);
      await workspace.subagentWrites.saveSubagent(
        'durable',
        'route',
        'Shared physical definition',
      );
      expect(await owner.subagentReads.listSubagents()).toStrictEqual([
        'durable',
        'primary',
        'primary-extension',
      ]);
      expect(await workspace.subagentReads.listSubagents()).toStrictEqual([
        'durable',
        'peer',
        'peer-extension',
      ]);
      await workspace.dispose();
      expect(await owner.subagentReads.listSubagents()).toContain(
        'primary-extension',
      );
      await owner.subagentWrites.deleteSubagent('durable');
      expect(await owner.subagentReads.subagentExistsOnDisk('durable')).toBe(
        false,
      );
    } finally {
      await workspace.dispose();
    }
  });

  it('serializes accepted extension transitions and joins their final publication during close', async () => {
    let releaseFirst!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let enterFirst!: () => void;
    const entered = new Promise<void>((resolve) => {
      enterFirst = resolve;
    });
    const published: Array<{
      name: string;
      subagents: Array<{ name: string; profile: string; systemPrompt: string }>;
    }> = [];
    let secondEntered = false;
    const first = owner.withExtensionUpdate(
      async () => {
        enterFirst();
        await released;
        published.push({
          name: 'first',
          subagents: [
            { name: 'first-worker', profile: 'route', systemPrompt: 'First' },
          ],
        });
      },
      () => published,
    );
    await entered;
    const second = owner.withExtensionUpdate(
      async () => {
        secondEntered = true;
        published.push({
          name: 'second',
          subagents: [
            { name: 'second-worker', profile: 'route', systemPrompt: 'Second' },
          ],
        });
      },
      () => published,
    );
    const closing = owner.dispose();
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(secondEntered).toBe(false);
    } finally {
      releaseFirst();
      await Promise.all([first, second, closing]);
    }
    expect(secondEntered).toBe(true);
    expect(() => owner.subagentReads.listSubagents()).toThrow('closed');
  });
  it('joins physical work accepted by a contribution fork when its shared root closes', async () => {
    const profiles = path.join(directory, 'custom-profiles');
    await mkdir(profiles, { recursive: true });
    const fifo = path.join(profiles, 'shared-held.json');
    execFileSync('mkfifo', [fifo]);
    const fork = owner.forkContributions();
    const accepted = fork.profileReads.loadProfile('shared-held');
    let closed = false;
    const closing = owner.dispose().then(() => {
      closed = true;
    });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(closed).toBe(false);
      expect(() => fork.subagentReads.listSubagents()).toThrow('closed');
    } finally {
      await writeFile(fifo, JSON.stringify(profile));
      await Promise.all([accepted, closing]);
      await fork.dispose();
    }
    expect(closed).toBe(true);
  });
});
