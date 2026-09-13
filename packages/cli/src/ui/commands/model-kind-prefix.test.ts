/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { ImageProfileNotFoundError } from '@vybestack/llxprt-code-settings';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

let textModel: string;
let imageName: string | undefined;
void mock.module('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({
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
  it('reports a typed missing-image error and available names without switching text', async () => {
    const result = await run('image missing');
    expect(result).toMatchObject({ type: 'message', messageType: 'error' });
    if (!result || result.type !== 'message')
      throw new Error('Expected message');
    expect(result.content).toContain('art, image');
    expect(result.content).toContain('missing');
    expect(imageName).toBeUndefined();
    expect(textModel).toBe('previous');
  });
});
