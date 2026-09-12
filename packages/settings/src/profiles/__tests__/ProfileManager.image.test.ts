/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import { ZodError } from 'zod';
import os from 'node:os';
import path from 'node:path';
import {
  ImageProfileNotFoundError,
  LoadBalancerMemberTypeError,
  ProfileManager,
  ProfileTypeConflictError,
} from '../ProfileManager.js';
import { parseImageProfile } from '../../settings/validation.js';
import type { ImageProfile, StandardProfile } from '../types.js';

function imageProfile(overrides: Partial<ImageProfile> = {}): ImageProfile {
  return {
    version: 1,
    type: 'image',
    backend: 'openai-images',
    model: 'gpt-image-2.5-flare',
    baseUrl: 'https://api.openai.com/v1',
    auth: { type: 'named-key', keyName: 'openai-images' },
    ...overrides,
  };
}

describe('ProfileManager typed image profiles', () => {
  let tempDir: string;
  let manager: ProfileManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-image-profile-'));
    manager = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  it('preserves schema issue details for invalid image fields', () => {
    let failure: unknown;
    try {
      parseImageProfile('typo', { ...imageProfile(), model: 42 });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'ZodError',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ['model'], code: 'invalid_type' }),
      ]),
    });
  });

  it.each([
    [{ type: 'loadbalancer' }, 'loadbalancer'],
    [null, 'unknown'],
  ])(
    'reports stored type when loading %j as an image',
    async (content, existingType) => {
      await fs.writeFile(
        path.join(tempDir, 'wrong.json'),
        JSON.stringify(content),
      );
      await expect(manager.loadImageProfile('wrong')).rejects.toMatchObject({
        name: 'ProfileTypeConflictError',
        existingType,
        message: expect.stringContaining('Cannot load image profile'),
      });
    },
  );

  it.each([
    '../evil',
    '/absolute',
    '.',
    '..',
    'nested/name',
    String.raw`nested\name`,
  ])('rejects unsafe image profile name %s before reading', async (name) => {
    await expect(manager.loadImageProfile(name)).rejects.toMatchObject({
      name: 'ImageProfileLoadError',
      cause: { message: `Invalid profile name: ${JSON.stringify(name)}` },
    });
  });

  it.each(['garbage', '{}', '{"type":"image"}'])(
    'replaces invalid stored profile content %s',
    async (content) => {
      await fs.writeFile(path.join(tempDir, 'art.json'), content);
      await manager.saveImageProfile('art', imageProfile());
      expect(await manager.loadImageProfile('art')).toStrictEqual(
        imageProfile(),
      );
    },
  );

  it('skips unreadable and corrupt entries without hiding valid profiles', async () => {
    await manager.saveImageProfile('art', imageProfile());
    await fs.mkdir(path.join(tempDir, 'unreadable.json'));
    await fs.writeFile(path.join(tempDir, 'corrupt.json'), 'garbage');
    expect(await manager.listImageProfiles()).toStrictEqual(['art']);
  });

  it('discovers model and image profiles separately from persisted kinds', async () => {
    await manager.saveImageProfile('art', imageProfile());
    await manager.saveProfile('chat', {
      version: 1,
      provider: 'openai',
      model: 'chat',
      modelParams: {},
      ephemeralSettings: {},
    });
    await manager.saveProfile('second', {
      version: 1,
      provider: 'openai',
      model: 'second',
      modelParams: {},
      ephemeralSettings: {},
    });
    await manager.saveLoadBalancerProfile('balanced', {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['chat', 'second'],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    });
    expect((await manager.listModelProfiles()).sort()).toStrictEqual([
      'balanced',
      'chat',
      'second',
    ]);
    expect((await manager.listProfiles('standard')).sort()).toStrictEqual([
      'chat',
      'second',
    ]);
    expect(await manager.loadProfile('balanced')).toMatchObject({
      profiles: ['chat', 'second'],
    });
    expect(await manager.listImageProfiles()).toStrictEqual(['art']);
  });

  it.each(['save', 'load'] as const)(
    'rejects image members on load balancer %s',
    async (operation) => {
      await manager.saveImageProfile('art', imageProfile());
      await manager.saveProfile('chat', {
        version: 1,
        provider: 'openai',
        model: 'chat',
        modelParams: {},
        ephemeralSettings: {},
      });
      const profile = {
        version: 1,
        type: 'loadbalancer',
        policy: 'roundrobin',
        profiles: ['chat', 'art'],
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
      };
      await fs.writeFile(
        path.join(tempDir, 'lb.json'),
        JSON.stringify(profile),
      );
      const pending =
        operation === 'save'
          ? manager.saveLoadBalancerProfile('lb', profile)
          : manager.loadProfile('lb');
      await expect(pending).rejects.toBeInstanceOf(LoadBalancerMemberTypeError);
      await expect(pending).rejects.toThrow('art');
    },
  );

  it.each([
    { operations: [] },
    { operations: ['generate', 'generate'] },
    { operations: ['inpaint'] },
    { operations: 'generate' },
  ])('rejects invalid operation declarations %j', ({ operations }) => {
    expect(() =>
      parseImageProfile('invalid', { ...imageProfile(), operations }),
    ).toThrow(ZodError);
  });

  it.each(['256x256', '512x512', '1024x1024'] as const)(
    'persists MLX size %s and declared operations through parsing and save/load',
    async (size) => {
      const profile = parseImageProfile(
        'mlx',
        imageProfile({
          baseUrl: 'http://localhost:8321/v1',
          auth: { type: 'none' },
          operations: ['generate'],
          defaults: { size },
        }),
      );
      await manager.saveImageProfile('mlx', profile);
      const loaded = await manager.loadImageProfile('mlx');
      expect(loaded.defaults?.size).toBe(size);
      expect(loaded.operations).toStrictEqual(['generate']);
    },
  );

  it('round trips optional image overrides without synthesizing omitted knobs', async () => {
    const profile = imageProfile({
      label: 'Illustration',
      description: 'OpenAI image generation',
      defaults: { size: '1024x1536' },
    });

    await manager.saveImageProfile('art', profile);

    expect(await manager.loadImageProfile('art')).toStrictEqual(profile);
  });

  it('round trips an image profile with no operation overrides', async () => {
    const profile = imageProfile();

    await manager.saveImageProfile('art', profile);

    const loaded = await manager.loadImageProfile('art');
    expect(loaded.defaults).toBeUndefined();
  });

  it('rejects overwriting a model profile with an image profile', async () => {
    const modelProfile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-5',
      modelParams: {},
      ephemeralSettings: {},
    } satisfies StandardProfile;
    await manager.saveProfile('shared-name', modelProfile);

    const save = manager.saveImageProfile('shared-name', imageProfile());

    await expect(save).rejects.toBeInstanceOf(ProfileTypeConflictError);
    expect(await manager.loadProfile('shared-name')).toStrictEqual(
      modelProfile,
    );
  });

  it('rejects overwriting an image profile with a model profile', async () => {
    const existingImageProfile = imageProfile();
    await manager.saveImageProfile('shared-name', existingImageProfile);

    const save = manager.saveProfile('shared-name', {
      version: 1,
      provider: 'openai',
      model: 'gpt-5',
      modelParams: {},
      ephemeralSettings: {},
    });

    await expect(save).rejects.toBeInstanceOf(ProfileTypeConflictError);
    expect(await manager.loadImageProfile('shared-name')).toStrictEqual(
      existingImageProfile,
    );
  });

  it('reports missing image profiles with a typed error', async () => {
    const load = manager.loadImageProfile('missing-image');

    await expect(load).rejects.toBeInstanceOf(ImageProfileNotFoundError);
    await expect(load).rejects.toThrow(
      "Image profile 'missing-image' not found",
    );
  });

  it('rejects loading a model profile as an image profile', async () => {
    await manager.saveProfile('chat', {
      version: 1,
      provider: 'openai',
      model: 'gpt-5',
      modelParams: {},
      ephemeralSettings: {},
    });

    await expect(manager.loadImageProfile('chat')).rejects.toBeInstanceOf(
      ProfileTypeConflictError,
    );
  });

  it('rejects loading an image profile as a model profile', async () => {
    await manager.saveImageProfile('art', imageProfile());

    await expect(manager.loadProfile('art')).rejects.toMatchObject({
      name: 'ProfileTypeConflictError',
      message:
        "Cannot load model profile 'art' because that name belongs to an image profile",
    });
  });

  it('preserves an explicitly standard profile type through save and load', async () => {
    const profile: StandardProfile = {
      version: 1,
      type: 'standard',
      provider: 'openai',
      model: 'chat',
      modelParams: {},
      ephemeralSettings: {},
    };

    await manager.saveProfile('standard-chat', profile);

    expect(await manager.loadProfile('standard-chat')).toStrictEqual(profile);
  });

  it('loads legacy files without a type as model profiles', async () => {
    await fs.writeFile(
      path.join(tempDir, 'legacy.json'),
      JSON.stringify({
        version: 1,
        provider: 'openai',
        model: 'gpt-5',
        modelParams: {},
        ephemeralSettings: {},
      }),
    );

    expect((await manager.loadProfile('legacy')).type).toBeUndefined();
  });
});
