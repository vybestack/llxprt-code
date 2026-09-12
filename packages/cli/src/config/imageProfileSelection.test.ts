/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createImageProfileRuntimeState } from '@vybestack/llxprt-code-core';
import {
  ImageProfileNotFoundError,
  ImageProfileLoadError,
  ProfileTypeConflictError,
  ProfileManager,
  type ImageProfile,
} from '@vybestack/llxprt-code-settings';
import {
  applyStartupImageProfile,
  createImageProfileOperationResolver,
} from './imageProfileSelection.js';

import { parseArguments } from './cliArgParser.js';
import { parseBootstrapArgs } from './profileBootstrap.js';
import { loadAndPrepareProfile } from './profileResolution.js';

const localProfile: ImageProfile = {
  version: 1,
  type: 'image',
  backend: 'openai-images',
  model: 'flux-klein',
  baseUrl: 'http://localhost:8321/v1',
  auth: { type: 'none' },
};

describe('image profile surface selection', () => {
  let directory = '';
  let manager: ProfileManager;
  const originalConfigHome = process.env.LLXPRT_CONFIG_HOME;
  const originalArgv = process.argv;
  beforeEach(async () => {
    let ready = false;
    try {
      directory = await mkdtemp(join(tmpdir(), 'llxprt-image-selector-'));
      process.env.LLXPRT_CONFIG_HOME = directory;
      process.argv = ['bun', 'cli.ts'];
      manager = new ProfileManager();
      await manager.saveImageProfile('local', localProfile);
      ready = true;
    } finally {
      if (!ready) await cleanup();
    }
  });
  async function cleanup(): Promise<void> {
    process.argv = originalArgv;
    if (originalConfigHome === undefined) {
      delete process.env.LLXPRT_CONFIG_HOME;
    } else {
      process.env.LLXPRT_CONFIG_HOME = originalConfigHome;
    }
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = '';
    }
  }
  afterEach(cleanup);

  async function loadFileProfile(imageProfile?: string) {
    await manager.saveProfile('chat', {
      version: 1,
      provider: 'openai',
      model: 'chat-model',
      modelParams: {},
      ephemeralSettings: {},
      ...(imageProfile === undefined ? {} : { imageProfile }),
    });
    return loadAndPrepareProfile({
      bootstrapArgs: parseBootstrapArgs().bootstrapArgs,
      settings: {},
      argv: await parseArguments({}),
      profileToLoad: 'chat',
      profileExplicitlySpecified: false,
    });
  }

  it.each(['file', 'inline'] as const)(
    'rejects invalid image auth while loading a %s profile',
    async (surface) => {
      await manager.saveImageProfile('invalid', {
        ...localProfile,
        auth: { type: 'named-key', keyName: 'remote-key' },
      });
      const pending =
        surface === 'file'
          ? loadFileProfile('invalid')
          : loadInlineProfile('invalid');
      await expect(pending).rejects.toMatchObject({
        name: 'ImageBackendAuthModeError',
      });
    },
  );

  it('loads a referenced image profile before runtime registration and applies it later', async () => {
    const result = await loadFileProfile('local');
    const state = createImageProfileRuntimeState();
    expect(state.getActive()).toBeUndefined();
    expect(result.activeImageProfile?.name).toBe('local');
    await applyStartupImageProfile({}, manager, state, result);
    expect(state.getActive()?.profile.model).toBe('flux-klein');
  });

  it('carries an explicit reset from a file profile without an image reference', async () => {
    const result = await loadFileProfile();
    const state = createImageProfileRuntimeState();
    state.select({ name: 'previous', profile: localProfile });
    expect(result).toHaveProperty('activeImageProfile', undefined);
    await applyStartupImageProfile({}, manager, state, result);
    expect(state.getActive()).toBeUndefined();
  });
  it.each(['', 42, null, {}])(
    'rejects malformed inline image reference %j',
    async (reference) => {
      await expect(loadInlineProfile(reference)).rejects.toMatchObject({
        name: 'ImageProfileLoadError',
        cause: { message: 'imageProfile must be a non-empty string' },
      });
    },
  );

  async function loadInlineProfile(imageProfile: unknown) {
    return loadAndPrepareProfile({
      bootstrapArgs: {
        ...parseBootstrapArgs().bootstrapArgs,
        profileJson: JSON.stringify({
          version: 1,
          provider: 'openai',
          model: 'chat-model',
          modelParams: {},
          ephemeralSettings: {},
          imageProfile,
        }),
      },
      settings: {},
      argv: await parseArguments({}),
      profileToLoad: undefined,
      profileExplicitlySpecified: false,
    });
  }

  it('rejects a dangling inline reference with its typed named error', async () => {
    const pending = loadInlineProfile('definitely-missing');
    await expect(pending).rejects.toBeInstanceOf(ImageProfileNotFoundError);
    await expect(pending).rejects.toThrow('definitely-missing');
  });

  it('resolves and selects a valid inline image reference', async () => {
    const result = await loadInlineProfile('local');
    const state = createImageProfileRuntimeState();
    await applyStartupImageProfile({}, manager, state, result);
    expect(state.getActive()?.profile.model).toBe('flux-klein');
  });

  it('fails default startup for a wrong-type linked image profile', async () => {
    const pending = loadFileProfile('chat');
    await expect(pending).rejects.toBeInstanceOf(ProfileTypeConflictError);
  });

  it.each(['{broken', '{"type":"image","model":12}'])(
    'fails default startup for an invalid linked image file %s',
    async (content) => {
      await writeFile(join(directory, 'profiles', 'invalid.json'), content);
      const pending = loadFileProfile('invalid');
      await expect(pending).rejects.toBeInstanceOf(ImageProfileLoadError);
      await expect(pending).rejects.toThrow('invalid');
    },
  );

  it('rejects a dangling file reference with a typed named error', async () => {
    const pending = loadFileProfile('missing-reference');
    await expect(pending).rejects.toBeInstanceOf(ImageProfileNotFoundError);
    await expect(pending).rejects.toThrow('missing-reference');
  });

  it('selects a standalone profile without conversational authentication', async () => {
    const state = createImageProfileRuntimeState();
    await applyStartupImageProfile({ imageProfile: 'local' }, manager, state);
    expect(state.getActive()).toStrictEqual({
      name: 'local',
      profile: localProfile,
    });
  });

  it('does not mutate session selection for a direct image operation', async () => {
    const state = createImageProfileRuntimeState();
    await applyStartupImageProfile(
      { imageProfile: 'local', imageOutput: 'out.png', imagePrompt: 'cat' },
      manager,
      state,
    );
    expect(state.getActive()).toBeUndefined();
  });

  it('applies a resolved file-profile selection after bootstrap', async () => {
    const state = createImageProfileRuntimeState();
    await applyStartupImageProfile({}, manager, state, {
      activeImageProfile: { name: 'referenced', profile: localProfile },
    });
    expect(state.getActive()).toStrictEqual({
      name: 'referenced',
      profile: localProfile,
    });
  });

  it('resets selection when a loaded file profile has no image reference', async () => {
    const state = createImageProfileRuntimeState();
    state.select({ name: 'previous', profile: localProfile });
    await applyStartupImageProfile({}, manager, state, {
      activeImageProfile: undefined,
    });
    expect(state.getActive()).toBeUndefined();
  });

  it('lets a standalone CLI selector override the file profile reference', async () => {
    const state = createImageProfileRuntimeState();
    await applyStartupImageProfile({ imageProfile: 'local' }, manager, state, {
      activeImageProfile: { name: 'referenced', profile: localProfile },
    });
    expect(state.getActive()?.name).toBe('local');
  });

  it('keeps the file profile active when a direct operation overrides it', async () => {
    const state = createImageProfileRuntimeState();
    await applyStartupImageProfile(
      { imageProfile: 'local', imageOutput: 'out.png', imagePrompt: 'cat' },
      manager,
      state,
      { activeImageProfile: { name: 'referenced', profile: localProfile } },
    );
    expect(state.getActive()?.name).toBe('referenced');
  });

  it('ignores blank selectors', async () => {
    const state = createImageProfileRuntimeState();
    await applyStartupImageProfile({ imageProfile: '  ' }, manager, state);
    expect(state.getActive()).toBeUndefined();
  });

  it('fails startup with a typed named error and preserves the prior selection', async () => {
    const state = createImageProfileRuntimeState();
    state.select({ name: 'local', profile: localProfile });
    const pending = applyStartupImageProfile(
      { imageProfile: 'missing-startup' },
      manager,
      state,
    );
    await expect(pending).rejects.toBeInstanceOf(ImageProfileNotFoundError);
    await expect(pending).rejects.toThrow('missing-startup');
    expect(state.getActive()?.name).toBe('local');
  });

  it('resolves a saved override for only that operation and keeps runtimes isolated', async () => {
    const first = createImageProfileRuntimeState();
    const second = createImageProfileRuntimeState();
    first.select({
      name: 'first',
      profile: { ...localProfile, model: 'first-model' },
    });
    second.select({
      name: 'second',
      profile: { ...localProfile, model: 'second-model' },
    });
    const deps = {
      oauthManager: undefined,
      getActiveProvider: () => undefined,
    };
    const resolveFirst = createImageProfileOperationResolver(
      manager,
      first,
      deps,
    );
    const resolveSecond = createImageProfileOperationResolver(
      manager,
      second,
      deps,
    );
    expect((await resolveFirst('local'))?.model).toBe('flux-klein');
    expect((await resolveFirst())?.model).toBe('first-model');
    expect((await resolveSecond())?.model).toBe('second-model');
    expect(first.getActive()?.name).toBe('first');
  });

  it.each(['active', 'override'] as const)(
    'names the offending %s profile when backend auth is invalid',
    async (surface) => {
      const state = createImageProfileRuntimeState();
      const invalid: ImageProfile = {
        ...localProfile,
        auth: { type: 'named-key', keyName: 'remote-key' },
      };
      state.select({ name: 'active-art', profile: invalid });
      await manager.saveImageProfile('override-art', invalid);
      const resolve = createImageProfileOperationResolver(manager, state, {
        oauthManager: undefined,
        getActiveProvider: () => undefined,
      });
      await expect(
        resolve(surface === 'override' ? 'override-art' : undefined),
      ).rejects.toMatchObject({
        name: 'ImageBackendAuthModeError',
        profileName: `${surface}-art`,
        message: expect.stringContaining(`${surface}-art`),
      });
      expect(state.getActive()?.name).toBe('active-art');
    },
  );

  it('rejects a dangling operation override instead of falling back to the active profile', async () => {
    const state = createImageProfileRuntimeState();
    state.select({ name: 'local', profile: localProfile });
    const resolve = createImageProfileOperationResolver(manager, state, {
      oauthManager: undefined,
      getActiveProvider: () => undefined,
    });
    const pending = resolve('missing-operation');
    await expect(pending).rejects.toBeInstanceOf(ImageProfileNotFoundError);
    await expect(pending).rejects.toThrow('missing-operation');
    expect(state.getActive()?.name).toBe('local');
  });
});
