/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProfileManager,
  type ImageProfile,
} from '@vybestack/llxprt-code-settings';
import { createImageProfileRuntimeState } from '@vybestack/llxprt-code-core';
import { ImageModelWizard, listImageModelChoices } from './imageModelWizard.js';

const profile: ImageProfile = {
  version: 1,
  type: 'image',
  backend: 'openai-images',
  model: 'local-image',
  baseUrl: 'http://localhost:8321/v1',
  auth: { type: 'none' },
};
let directory: string;
let manager: ProfileManager;
describe('image model wizard', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-model-wizard-'));
    manager = new ProfileManager(directory);
    await manager.saveImageProfile('art', profile);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('lists saved profiles with backend and model alongside both new backend options', async () => {
    const choices = await listImageModelChoices(manager);
    expect(choices.map((choice) => choice.label)).toStrictEqual([
      'art (openai-images: local-image)',
      'New codex configuration',
      'New openai-images configuration',
    ]);
    expect(choices[0]?.value).toStrictEqual({ kind: 'saved', name: 'art' });
    expect(choices.slice(1).map((choice) => choice.value)).toStrictEqual([
      { kind: 'new', backend: 'codex' },
      { kind: 'new', backend: 'openai-images' },
    ]);
  });
  it.each(['none', 'oauth', 'api-key', 'named-key', 'keyfile'] as const)(
    'configures %s authentication and activates only on completion without persisting',
    async (authType) => {
      const state = createImageProfileRuntimeState();
      const backend = authType === 'oauth' ? 'codex' : 'openai-images';
      const remoteUrl =
        backend === 'codex'
          ? 'https://chatgpt.com/backend-api/codex'
          : 'https://api.openai.com/v1';
      const baseUrl =
        authType === 'none' ? 'http://localhost:8321/v1' : remoteUrl;
      const wizard = new ImageModelWizard(backend, (active) =>
        state.select(active),
      );
      expect(wizard.step).toBe('model');
      wizard.submit('gpt-image-2');
      expect(wizard.step).toBe('baseUrl');
      wizard.submit(baseUrl);
      expect(wizard.step).toBe('auth');
      expect(state.getActive()).toBeUndefined();
      wizard.chooseAuth(authType);
      const needsCredential = authType !== 'none' && authType !== 'oauth';
      expect(wizard.step).toBe(needsCredential ? 'credential' : 'done');
      expect(state.getActive() === undefined).toBe(needsCredential);
      if (authType !== 'none' && authType !== 'oauth') {
        wizard.submit('credential-value');
      }
      expect(wizard.step).toBe('done');
      expect(state.getActive()?.profile).toMatchObject({
        backend,
        model: 'gpt-image-2',
        baseUrl,
        auth: { type: authType },
      });
      const expectedAuth = {
        none: { type: 'none' },
        oauth: { type: 'oauth', provider: 'codex' },
        'api-key': { type: 'api-key', apiKey: 'credential-value' },
        'named-key': { type: 'named-key', keyName: 'credential-value' },
        keyfile: { type: 'keyfile', path: 'credential-value' },
      } satisfies Record<ImageProfile['auth']['type'], ImageProfile['auth']>;
      expect(state.getActive()?.profile.auth).toStrictEqual(
        expectedAuth[authType],
      );
      expect(state.getActive()?.name).toBeUndefined();
      expect(await manager.listImageProfiles()).toStrictEqual(['art']);
    },
  );
  it('rejects invalid external input before activation and allows correction', () => {
    const state = createImageProfileRuntimeState();
    const wizard = new ImageModelWizard('openai-images', (active) =>
      state.select(active),
    );
    expect(() => wizard.submit('')).toThrow('A value is required.');
    expect(wizard.step).toBe('model');
    wizard.submit('local-image');
    expect(() => wizard.submit('not-a-url')).toThrow('Invalid url');
    expect(wizard.step).toBe('baseUrl');
    wizard.submit('http://localhost:8321/v1');
    wizard.chooseAuth('api-key');
    expect(() => wizard.submit('')).toThrow('A value is required.');
    expect(state.getActive()).toBeUndefined();
    wizard.submit('secret');
    expect(state.getActive()?.profile.auth).toStrictEqual({
      type: 'api-key',
      apiKey: 'secret',
    });
  });
  it('leaves the wizard editable when runtime activation rejects the configuration', () => {
    const wizard = new ImageModelWizard('openai-images', () => {
      throw new Error('Unsupported image auth');
    });
    wizard.submit('local-image');
    wizard.submit('http://localhost:8321/v1');
    expect(() => wizard.chooseAuth('oauth')).toThrow('Unsupported image auth');
    expect(wizard.step).toBe('auth');
  });
});
