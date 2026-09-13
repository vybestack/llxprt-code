/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act } from 'react';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import {
  createImageProfileRuntimeState,
  type ActiveImageProfile,
} from '@vybestack/llxprt-code-core';
import { loadAndSelectImageProfile } from '@vybestack/llxprt-code-providers/runtime/profileSnapshotTransition.js';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';

let directory: string;
let manager: ProfileManager;
let state = createImageProfileRuntimeState();
const runtime = {
  getCliRuntimeServices: () => ({ profileManager: manager }),
  loadImageProfileByName: (name: string) =>
    loadAndSelectImageProfile(manager, state, name),
  listSavedProfiles: () => manager.listImageProfiles(),
  setActiveImageProfile: (active: ActiveImageProfile) => state.select(active),
};
void mock.module('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => runtime,
  useRuntimeApi: () => runtime,
}));
const { ImageModelsDialog } = await import('./ImageModelsDialog.js');
let view: ReturnType<typeof renderWithProviders> | undefined;
let closed: boolean;
describe('image model dialog selection', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-image-dialog-'));
    manager = new ProfileManager(directory);
    state = createImageProfileRuntimeState();
    closed = false;
    await manager.saveImageProfile('art', {
      version: 1,
      type: 'image',
      backend: 'openai-images',
      model: 'local-image',
      baseUrl: 'http://localhost:8321/v1',
      auth: { type: 'none' },
    });
  });
  afterEach(async () => {
    view?.unmount();
    view = undefined;
    await rm(directory, { recursive: true, force: true });
  });
  async function openDialog() {
    view = renderWithProviders(
      <ImageModelsDialog
        onClose={() => {
          closed = true;
        }}
      />,
    );
    await waitFor(() =>
      expect(view?.lastFrame()).toContain('New openai-images configuration'),
    );
    return view;
  }
  async function key(input: string): Promise<void> {
    await act(async () => {
      view?.stdin.write(input);
    });
  }

  async function typeText(text: string): Promise<void> {
    for (const character of text) await key(character);
  }

  it('dispatches a saved selection through the typed runtime load path', async () => {
    await openDialog();
    await key('\r');
    await waitFor(() => expect(state.getActive()?.name).toBe('art'));
    expect(view?.lastFrame()).toContain("Image profile 'art' loaded");
  });
  it('shows typed load errors when a listed profile disappears before selection', async () => {
    await openDialog();
    await manager.deleteProfile('art');
    await key('\r');
    await waitFor(() =>
      expect(view?.lastFrame()).toContain('Available image profiles: (none)'),
    );
    expect(state.getActive()).toBeUndefined();
  });
  it('walks the interactive new-backend fields and activates without saving', async () => {
    await openDialog();
    await key('\x1b[B');
    await key('\x1b[B');
    await key('\r');
    await waitFor(() => expect(view?.lastFrame()).toContain('Model name'));
    await typeText('new-local');
    await key('\r');
    await waitFor(() => expect(view?.lastFrame()).toContain('Base URL'));
    await typeText('http://localhost:9000/v1');
    await key('\r');
    await waitFor(() =>
      expect(view?.lastFrame()).toContain('No authentication'),
    );
    expect(state.getActive()).toBeUndefined();
    await key('\r');
    await waitFor(() =>
      expect(view?.lastFrame()).toContain(
        'Image configuration active (not saved)',
      ),
    );
    expect(state.getActive()?.profile).toMatchObject({
      backend: 'openai-images',
      model: 'new-local',
      baseUrl: 'http://localhost:9000/v1',
      auth: { type: 'none' },
    });
    expect(await manager.listImageProfiles()).toStrictEqual(['art']);
  });
  it('cancels staged configuration without activating it', async () => {
    await openDialog();
    await key('\x1b[B');
    await key('\r');
    await key('unfinished');
    await key('\x1b[27u');
    expect(closed).toBe(true);
    expect(state.getActive()).toBeUndefined();
  });
});
