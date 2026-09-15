/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import { act } from 'react';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  getModelRegistry,
  createImageProfileRuntimeState,
  type ActiveImageProfile,
} from '@vybestack/llxprt-code-core';
import { validateImageProfileAuth } from '@vybestack/llxprt-code-providers/openai/codexImageBackendResolver.js';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';

let state = createImageProfileRuntimeState();
const runtime = {
  getActiveProviderName: () => 'codex',
  setActiveImageProfile: (active: ActiveImageProfile) => {
    validateImageProfileAuth(active.profile);
    state.select(active);
  },
};
void mock.module('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => runtime,
  useRuntimeApi: () => runtime,
}));
const { ImageModelsDialog } = await import('./ImageModelsDialog.js');
let view: ReturnType<typeof renderWithProviders> | undefined;
let closed: boolean;
describe('provider-driven image model dialog', () => {
  let directory: string;
  let data: ReturnType<typeof spyOn<typeof Storage, 'getGlobalDataDir'>>;
  let cache: ReturnType<typeof spyOn<typeof Storage, 'getGlobalCacheDir'>>;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'llxprt-image-dialog-'));
    mkdirSync(join(directory, 'providers'));
    data = spyOn(Storage, 'getGlobalDataDir').mockReturnValue(directory);
    cache = spyOn(Storage, 'getGlobalCacheDir').mockReturnValue(directory);
    writeFileSync(
      join(directory, 'models.json'),
      JSON.stringify({
        openai: {
          id: 'openai',
          name: 'OpenAI',
          env: [],
          models: {
            painter: {
              id: 'painter',
              name: 'Painter',
              modalities: { input: ['text'], output: ['image'] },
              limit: { context: 4096, output: 1024 },
              release_date: '2026-09-14',
              open_weights: false,
            },
          },
        },
      }),
    );
    await getModelRegistry().initialize();
    state = createImageProfileRuntimeState();
    closed = false;
  });
  afterEach(() => {
    view?.unmount();
    view = undefined;
    getModelRegistry().dispose();
    data.mockRestore();
    cache.mockRestore();
    rmSync(directory, { recursive: true, force: true });
  });
  async function key(input: string): Promise<void> {
    await act(async () => {
      view?.stdin.write(input);
    });
  }
  function open(imageProvider?: string, fetchImpl?: typeof fetch): void {
    view = renderWithProviders(
      <ImageModelsDialog
        imageProvider={imageProvider}
        fetchImpl={fetchImpl}
        onClose={() => {
          closed = true;
        }}
      />,
    );
  }
  it('shows the active provider list and selects an unnamed configuration with arrow keys', async () => {
    open();
    await waitFor(() => expect(view?.lastFrame()).toContain('gpt-image-1'));
    expect(view?.lastFrame()).not.toContain('Base URL');
    expect(view?.lastFrame()).not.toContain('New codex');
    await key('\x1b[B');
    await key('\r');
    await waitFor(() =>
      expect(state.getActive()?.profile.model).toBe('gpt-image-1'),
    );
    expect(state.getActive()?.name).toBeUndefined();
    expect(state.getActive()?.profile.auth).toStrictEqual({
      type: 'oauth',
      provider: 'codex',
    });
    expect(closed).toBe(true);
  });
  it('lists and selects all local endpoint models for the configured image provider', async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ data: [{ id: 'text-only' }, { id: 'local-image' }] });
    open('LM Studio', fetchImpl);
    await waitFor(() => expect(view?.lastFrame()).toContain('text-only'));
    expect(view?.lastFrame()).toContain('local-image');
    await key('\r');
    await waitFor(() =>
      expect(state.getActive()?.profile.model).toBe('text-only'),
    );
    expect(state.getActive()?.profile.backend).toBe('openai-images');
    expect(state.getActive()?.name).toBeUndefined();
  });
  it('renders endpoint errors without offering manual input or changing selection', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(null, { status: 503 });
    open('LM Studio', fetchImpl);
    await waitFor(() =>
      expect(view?.lastFrame()).toContain('Model listing endpoint failed'),
    );
    expect(view?.lastFrame()).not.toContain('manually');
    await key('\r');
    expect(state.getActive()).toBeUndefined();
  });
  it('shows when no image models are known instead of a free-text prompt', async () => {
    open('anthropic');
    await waitFor(() =>
      expect(view?.lastFrame()).toContain('No image models are known'),
    );
    expect(view?.lastFrame()).not.toContain('Model name');
    await key('\r');
    expect(state.getActive()).toBeUndefined();
  });
  it('renders unknown alias errors', async () => {
    open('no-such-alias');
    await waitFor(() =>
      expect(view?.lastFrame()).toContain('Unknown image provider alias'),
    );
    expect(state.getActive()).toBeUndefined();
  });
  it('selects a registry image model using the remote alias named key', async () => {
    open('openai');
    await waitFor(() => expect(view?.lastFrame()).toContain('painter'));
    await key('\r');
    await waitFor(() =>
      expect(state.getActive()?.profile.model).toBe('painter'),
    );
    expect(state.getActive()?.profile.auth).toStrictEqual({
      type: 'named-key',
      keyName: 'openai',
    });
  });
  it('surfaces remote no-auth validation errors without changing the active profile', async () => {
    writeFileSync(
      join(directory, 'providers', 'openai.config'),
      JSON.stringify({
        name: 'openai',
        baseProvider: 'openai',
        'base-url': 'https://example.com/v1',
        defaultModel: 'painter',
        'requires-auth': false,
      }),
    );
    open('openai');
    await waitFor(() => expect(view?.lastFrame()).toContain('painter'));
    await key('\r');
    await waitFor(() =>
      expect(view?.lastFrame()).toContain("cannot use auth mode 'none'"),
    );
    expect(state.getActive()).toBeUndefined();
    expect(closed).toBe(false);
  });
  it('closes on escape without changing the image selection', async () => {
    open();
    await waitFor(() => expect(view?.lastFrame()).toContain('gpt-image-2'));
    await key('\x1b[27u');
    expect(closed).toBe(true);
    expect(state.getActive()).toBeUndefined();
  });
});
