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
  type StandardProfile,
} from '@vybestack/llxprt-code-settings';
import {
  loadAndApplyProfileTransition,
  saveAndSelectImageProfile,
} from './profileSnapshotTransition.js';

function imageProfile(model: string): ImageProfile {
  return {
    version: 1,
    type: 'image',
    backend: 'codex',
    model,
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    auth: { type: 'oauth', provider: 'codex' },
  };
}

function modelProfile(
  model: string,
  imageProfileName?: string,
): StandardProfile {
  return {
    version: 1,
    type: 'model',
    provider: 'openai',
    model,
    modelParams: {},
    ephemeralSettings: {},
    ...(imageProfileName === undefined
      ? {}
      : { imageProfile: imageProfileName }),
  };
}

describe('runtime image-profile transitions', () => {
  let profilesDir: string;
  let manager: ProfileManager;

  beforeEach(async () => {
    profilesDir = await mkdtemp(join(tmpdir(), 'llxprt-image-transition-'));
    manager = new ProfileManager(profilesDir);
  });

  afterEach(async () => {
    await rm(profilesDir, { recursive: true, force: true });
  });

  it('applies linked model and image profiles as one transition', async () => {
    const state = createImageProfileRuntimeState();
    state.select({
      name: 'old-image',
      profile: imageProfile('old-image-model'),
    });
    await manager.saveImageProfile(
      'new-image',
      imageProfile('new-image-model'),
    );
    await manager.saveProfile(
      'new-model-profile',
      modelProfile('new-model', 'new-image'),
    );
    let appliedModel = 'old-model';

    await loadAndApplyProfileTransition(
      manager,
      state,
      'new-model-profile',
      async (profile) => {
        appliedModel = profile.model;
      },
    );

    expect(appliedModel).toBe('new-model');
    expect(state.getActive()).toStrictEqual({
      name: 'new-image',
      profile: imageProfile('new-image-model'),
    });
  });

  it('preserves model and image state when a linked image profile is missing', async () => {
    const state = createImageProfileRuntimeState();
    state.select({
      name: 'old-image',
      profile: imageProfile('old-image-model'),
    });
    await manager.saveProfile(
      'new-model-profile',
      modelProfile('new-model', 'missing-image'),
    );
    let appliedModel = 'old-model';

    const load = loadAndApplyProfileTransition(
      manager,
      state,
      'new-model-profile',
      async (profile) => {
        appliedModel = profile.model;
      },
    );

    await expect(load).rejects.toBeInstanceOf(ImageProfileNotFoundError);
    expect(appliedModel).toBe('old-model');
    expect(state.getActive()?.name).toBe('old-image');
  });

  for (const linkedImage of ['new-image', undefined]) {
    it(`publishes the coherent model and image selection before observer refresh (${linkedImage ?? 'reset-to-none'})`, async () => {
      const state = createImageProfileRuntimeState();
      state.select({
        name: 'old-image',
        profile: imageProfile('old-image-model'),
      });
      await manager.saveImageProfile(
        'new-image',
        imageProfile('new-image-model'),
      );
      await manager.saveProfile('next', modelProfile('new-model', linkedImage));
      let appliedModel = 'old-model';
      const observations: Array<{ model: string; image: string | undefined }> =
        [];

      await loadAndApplyProfileTransition(
        manager,
        state,
        'next',
        async (profile) => {
          appliedModel = profile.model;
          return appliedModel;
        },
        (model) => {
          observations.push({ model, image: state.getActive()?.name });
        },
      );

      expect(observations).toStrictEqual([
        { model: 'new-model', image: linkedImage },
      ]);
      expect(appliedModel).toBe('new-model');
    });
  }

  it('preserves image state and the typed error after model application mutates then fails', async () => {
    const state = createImageProfileRuntimeState();
    state.select({
      name: 'old-image',
      profile: imageProfile('old-image-model'),
    });
    await manager.saveImageProfile(
      'new-image',
      imageProfile('new-image-model'),
    );
    await manager.saveProfile(
      'new-model-profile',
      modelProfile('new-model', 'new-image'),
    );

    const error = new TypeError('model application failed');
    let appliedModel = 'old-model';
    let published = false;
    const load = loadAndApplyProfileTransition(
      manager,
      state,
      'new-model-profile',
      async (profile) => {
        appliedModel = profile.model;
        throw error;
      },
      () => {
        published = true;
      },
    );

    await expect(load).rejects.toBe(error);
    expect(appliedModel).toBe('new-model');
    expect(state.getActive()).toStrictEqual({
      name: 'old-image',
      profile: imageProfile('old-image-model'),
    });
    expect(published).toBe(false);
  });

  it('clears stale image state when a loaded model has no reference', async () => {
    const state = createImageProfileRuntimeState();
    state.select({
      name: 'old-image',
      profile: imageProfile('old-image-model'),
    });
    await manager.saveProfile('plain-model', modelProfile('new-model'));

    await loadAndApplyProfileTransition(manager, state, 'plain-model', () =>
      Promise.resolve(),
    );

    expect(state.getActive()).toBeUndefined();
  });

  it('saves and selects the new image profile name', async () => {
    const state = createImageProfileRuntimeState();
    state.select({
      name: 'source-image',
      profile: imageProfile('source-model'),
    });

    await saveAndSelectImageProfile(manager, state, 'copied-image');

    expect(state.getActive()?.name).toBe('copied-image');
    expect(await manager.loadImageProfile('copied-image')).toStrictEqual(
      imageProfile('source-model'),
    );
  });
});
