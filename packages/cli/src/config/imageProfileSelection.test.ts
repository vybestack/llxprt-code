/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createImageProfileRuntimeState } from '@vybestack/llxprt-code-core';
import {
  ImageProfileNotFoundError,
  ProfileManager,
  type ImageProfile,
} from '@vybestack/llxprt-code-settings';
import {
  applyStartupImageProfile,
  createImageProfileOperationResolver,
} from './imageProfileSelection.js';

const localProfile: ImageProfile = {
  version: 1,
  type: 'image',
  backend: 'openai-images',
  model: 'flux-klein',
  baseUrl: 'http://localhost:8321/v1',
  auth: { type: 'none' },
};

describe('image profile surface selection', () => {
  let directory: string;
  let manager: ProfileManager;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-image-selector-'));
    manager = new ProfileManager(directory);
    await manager.saveImageProfile('local', localProfile);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
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
