/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  createImageProfileRuntimeState,
  type ActiveImageProfile,
} from '@vybestack/llxprt-code-core';
import { ImageProfileNotFoundError } from '@vybestack/llxprt-code-settings';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

const state = createImageProfileRuntimeState();
let textModel: string;
let imageName: string | undefined;
void mock.module('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({
    getActiveProviderName: () => 'codex',
    setActiveImageProfile: (selection: ActiveImageProfile) =>
      state.select(selection),
    setActiveModel: async (model: string) => {
      const previousModel = textModel;
      textModel = model;
      return { previousModel, nextModel: model, providerName: 'openai' };
    },
    listSavedProfiles: async () => ['art', 'image'],
    loadImageProfileByName: async (name: string) => {
      if (!['art', 'image'].includes(name))
        throw new ImageProfileNotFoundError(name);
      imageName = name;
    },
  }),
}));
const { modelCommand } = await import('./modelCommand.js');
const run = (args: string) =>
  modelCommand.action!(createMockCommandContext(), args);

describe('/model kind prefixes', () => {
  beforeEach(() => {
    state.reset();
    textModel = 'previous';
    imageName = undefined;
  });

  it.each(['', 'text'])('opens the text wizard for %j', async (args) => {
    expect(await run(args)).toMatchObject({ type: 'dialog', dialog: 'models' });
    expect(textModel).toBe('previous');
  });
  it.each(['gpt-4o', 'text Qwen3-Coder', 'text text', 'openai gpt-4o'])(
    'switches text model for %j',
    async (args) => {
      const result = await run(args);
      expect(textModel).toBe(args.split(' ').at(-1)!);
      expect(result).toMatchObject({ type: 'message', messageType: 'info' });
      expect(imageName).toBeUndefined();
    },
  );
  it.each(['gpt-4o --tools', 'text gpt-4o --tools', 'text --tools'])(
    'preserves filtered text browsing for %j',
    async (args) => {
      expect(await run(args)).toMatchObject({
        type: 'dialog',
        dialog: 'models',
        dialogData: {
          initialSearch: args.includes('gpt-4o') ? 'gpt-4o' : undefined,
          initialFilters: {
            tools: true,
            vision: false,
            reasoning: false,
            audio: false,
          },
          includeDeprecated: false,
          showAllProviders: false,
          providerOverride: undefined,
        },
      });
      expect(textModel).toBe('previous');
    },
  );
  it('opens image selection without switching text', async () => {
    expect(await run('image')).toMatchObject({
      type: 'dialog',
      dialog: 'imageModels',
    });
    expect(textModel).toBe('previous');
  });
  it.each(['art', 'image'])(
    'activates the saved image profile %s',
    async (name) => {
      expect(await run(`image ${name}`)).toMatchObject({
        type: 'message',
        messageType: 'info',
      });
      expect(imageName).toBe(name);
      expect(textModel).toBe('previous');
    },
  );
  it('treats a name without a saved profile as an image model id', async () => {
    const result = await run('image custom-image');
    expect(result).toMatchObject({ type: 'message', messageType: 'info' });
    expect(state.getActive()?.profile).toMatchObject({
      backend: 'codex',
      model: 'custom-image',
    });
    expect(state.getActive()?.name).toBeUndefined();
    expect(textModel).toBe('previous');
  });
  it('uses the configured image provider instead of the active chat provider', async () => {
    const context = createMockCommandContext();
    context.services.settings.merged.imageProvider = 'LM Studio';
    await modelCommand.action!(context, 'image local-image');
    expect(state.getActive()?.profile).toMatchObject({
      backend: 'openai-images',
      model: 'local-image',
      auth: { type: 'none' },
    });
    expect(textModel).toBe('previous');
  });
});
