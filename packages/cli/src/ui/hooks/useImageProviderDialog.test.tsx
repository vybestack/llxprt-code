/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { renderHook } from '../../test-utils/render.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import {
  createDialogStore,
  selectDialogOpen,
} from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { createCompletionHandler } from '../commands/schema/index.js';
import { MessageType } from '../types.js';

const aliases = {
  ...(await import(
    '@vybestack/llxprt-code-providers/composition/providerAliases.js'
  )),
};
void vi.mock('@vybestack/llxprt-code-providers/composition.js', () => aliases);
let runtimeSettings = new SettingsService();
const runtime = {
  getCliRuntimeServices: () => ({ settingsService: runtimeSettings }),
  getActiveProviderName: () => 'anthropic',
  listProviders: () => ['anthropic', 'text', 'custom-chat'],
};
void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => runtime,
  getRuntimeApi: () => runtime,
}));

import { useImageProviderDialog } from './useImageProviderDialog.js';
import { useProviderDialog } from './useProviderDialog.js';
import { providerCommandSchema } from '../commands/providerCommandSchema.js';

describe('image provider selection', () => {
  let directory: string;
  let settings: LoadedSettings;
  let oldDataHome: string | undefined;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'provider-image-dialog-'));
    oldDataHome = process.env.LLXPRT_DATA_HOME;
    process.env.LLXPRT_DATA_HOME = directory;
    runtimeSettings = new SettingsService();
    const empty = { settings: {}, path: join(directory, 'unused.json') };
    settings = new LoadedSettings(
      empty,
      empty,
      { settings: {}, path: join(directory, 'settings.json') },
      empty,
      true,
    );
  });
  afterEach(() => {
    if (oldDataHome === undefined) delete process.env.LLXPRT_DATA_HOME;
    else process.env.LLXPRT_DATA_HOME = oldDataHome;
    rmSync(directory, { recursive: true, force: true });
  });

  function renderDialogs() {
    const messages: Array<{ type: MessageType; content: string }> = [];
    const dialogStore = createDialogStore();
    const dialogs = createDialogOpeners(dialogStore);
    const dialogs_ = renderHook(() => ({
      image: useImageProviderDialog({
        settings,
        addMessage: (message) => messages.push(message),
        dialogs,
      }),
      text: useProviderDialog({
        addMessage: (message) => messages.push(message),
        dialogs,
      }),
    }));
    return { ...dialogs_, dialogStore, messages };
  }

  function imageDialogOpen(dialogStore: ReturnType<typeof createDialogStore>) {
    return selectDialogOpen(dialogStore.store.getState(), 'imageProvider');
  }

  it('offers exactly the same aliases and text providers as completion and selects the effective provider', async () => {
    aliases.writeProviderAliasConfig('local-art', {
      baseProvider: 'openai',
      'base-url': 'http://localhost:8321/v1',
    });
    const { result, rerender, dialogStore, unmount } = renderDialogs();
    act(() => {
      result.current.image.openDialog();
      result.current.text.openDialog();
    });
    rerender();
    expect(imageDialogOpen(dialogStore)).toBe(true);
    expect(result.current.image.currentProvider).toBe('anthropic');
    const complete = createCompletionHandler(providerCommandSchema);
    for (const kind of ['image', 'text'] as const) {
      const completion = await complete(
        createMockCommandContext(),
        '',
        `/provider ${kind} `,
      );
      expect(completion.suggestions.map((item) => item.value)).toStrictEqual(
        result.current[kind].providers,
      );
      expect(result.current[kind].providers.length).toBeGreaterThan(0);
    }
    expect(result.current.image.providers).toContain('local-art');
    expect(result.current.image.providers).not.toContain('custom-chat');
    settings.setValue(SettingScope.User, 'imageProvider', 'local-art');
    act(() => result.current.image.openDialog());
    expect(result.current.image.currentProvider).toBe('local-art');
    unmount();
  });

  it('persists the selection, syncs runtime settings, reports success and closes', () => {
    const { result, messages, dialogStore, unmount } = renderDialogs();
    act(() => result.current.image.openDialog());
    act(() => result.current.image.handleSelect('codex'));
    expect(settings.merged.imageProvider).toBe('codex');
    expect(runtimeSettings.get('imageProvider')).toBe('codex');
    expect(
      JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')),
    ).toMatchObject({ imageProvider: 'codex' });
    expect(messages).toMatchObject([
      { type: MessageType.INFO, content: 'Image provider set to codex' },
    ]);
    expect(imageDialogOpen(dialogStore)).toBe(false);
    unmount();
  });

  it('syncs the merged setting when a workspace override takes precedence over the user pin', () => {
    const empty = { settings: {}, path: join(directory, 'unused.json') };
    settings = new LoadedSettings(
      empty,
      empty,
      { settings: {}, path: join(directory, 'settings.json') },
      {
        settings: { imageProvider: 'openai' },
        path: join(directory, 'workspace.json'),
      },
      true,
    );
    const { result, unmount } = renderDialogs();
    act(() => result.current.image.handleSelect('codex'));
    expect(
      JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')),
    ).toMatchObject({ imageProvider: 'codex' });
    expect(runtimeSettings.get('imageProvider')).toBe('openai');
    expect(settings.merged.imageProvider).toBe('openai');
    unmount();
  });

  it('reports invalid selections without pinning and closes', () => {
    const { result, messages, dialogStore, unmount } = renderDialogs();
    act(() => result.current.image.openDialog());
    act(() => result.current.image.handleSelect('not-an-alias'));
    expect(settings.merged.imageProvider).toBeUndefined();
    expect(runtimeSettings.get('imageProvider')).toBeUndefined();
    expect(messages).toMatchObject([
      {
        type: MessageType.ERROR,
        content: expect.stringContaining('Available aliases:'),
      },
    ]);
    expect(imageDialogOpen(dialogStore)).toBe(false);
    unmount();
  });
});
