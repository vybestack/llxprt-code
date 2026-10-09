/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: a provider or model picked in a dialog must reach the session
 * recording. The recorded `session_start` header names the provider/model in
 * effect when the file is first written, and the change is kept as a
 * `provider_switch` event. These tests drive the real dialog hooks, a real
 * Config and a real recorder; only the runtime API (which would otherwise need
 * a whole provider stack) is replaced by an adapter over that Config.
 */

// Enable React's act() environment so hook state updates are flushed.
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  RecordingIntegration,
  isSessionStartHeader,
  type HydratedModel,
  type SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { hasDialogRequest } from '../../__tests__/dialogStore.js';
import { buildNewRecordingService } from '../../cliSessionBootstrap.js';
import { MessageType } from '../types.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';

interface ConfigBackedRuntime {
  setProvider(provider: string): Promise<{
    nextProvider: string;
    infoMessages: string[];
  }>;
  setActiveModel(model: string): Promise<{
    nextModel: string;
    providerName: string;
    previousModel: string | null;
  }>;
  getActiveProviderStatus(): {
    providerName: string | null;
    modelName: string | null;
  };
  getActiveProviderName(): string | null;
  listSavedProfiles(): Promise<string[]>;
  loadProfileByName(name: string): Promise<{
    infoMessages: string[];
    warnings: string[];
  }>;
  getRuntimeDiagnosticsSnapshot(): { profileName: string | null };
}

const SAVED_PROFILES: Readonly<
  Record<string, { provider: string; model: string }>
> = {
  lunahigh: { provider: 'codex', model: 'gpt-6-luna' },
};

/** The runtime API as the dialogs see it, switching the real Config. */
function createConfigBackedRuntime(config: Config): ConfigBackedRuntime {
  const status = () => ({
    providerName: config.getProvider() ?? null,
    modelName: config.getModel() === '' ? null : config.getModel(),
  });
  return {
    setProvider: async (provider) => {
      config.setProvider(provider);
      return { nextProvider: provider, infoMessages: [] };
    },
    setActiveModel: async (model) => {
      const previousModel = config.getModel() === '' ? null : config.getModel();
      config.setModel(model);
      return {
        nextModel: model,
        providerName: config.getProvider() ?? '',
        previousModel,
      };
    },
    getActiveProviderStatus: status,
    getActiveProviderName: () => config.getProvider() ?? null,
    listSavedProfiles: async () => Object.keys(SAVED_PROFILES),
    loadProfileByName: async (name) => {
      const profile = SAVED_PROFILES[name];
      config.setProvider(profile.provider);
      config.setModel(profile.model);
      return { infoMessages: [], warnings: [] };
    },
    getRuntimeDiagnosticsSnapshot: () => ({ profileName: null }),
  };
}

const runtimeHolder: { current: ConfigBackedRuntime | null } = {
  current: null,
};

function requireRuntime(): ConfigBackedRuntime {
  if (runtimeHolder.current === null) throw new Error('runtime not set up');
  return runtimeHolder.current;
}

void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => runtimeHolder.current,
}));

// Import after mocks are set up
import { useModelDialogHandler } from '../components/modelDialogHandler.js';
import { useLoadProfileDialog } from './useLoadProfileDialog.js';
import { useProfileManagement } from './useProfileManagement.js';

const PROJECT_HASH = 'provider-switch-recording';

function noProviderConfig(root: string): Config {
  return new Config({
    cwd: root,
    targetDir: root,
    debugMode: false,
    question: undefined,
    userMemory: '',
    sessionId: 'switch-recording-session',
    model: '',
    settingsService: new SettingsService(),
  });
}

function pickerModel(provider: string, id: string): HydratedModel {
  return { id, name: id, provider, supportedToolFormats: [] };
}

describe('provider changes made in dialogs reach the session recording (issue #3732)', () => {
  let root: string;
  let chatsDir: string;
  let config: Config;
  let recording: SessionRecordingService;
  let integration: RecordingIntegration;
  let addedMessages: string[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'switch-recording-'));
    chatsDir = join(root, 'chats');
    config = noProviderConfig(root);
    runtimeHolder.current = createConfigBackedRuntime(config);
    recording = await buildNewRecordingService(config, PROJECT_HASH, chatsDir);
    integration = new RecordingIntegration(recording);
    addedMessages = [];
  });

  afterEach(async () => {
    runtimeHolder.current = null;
    await integration.dispose();
    await recording.dispose();
    await rm(root, { recursive: true, force: true });
  });

  /** Send the first message, then read back what reached the file. */
  async function recordedFile(): Promise<{
    header: { provider: string; model: string };
    switches: Array<{ provider: unknown; model: unknown }>;
  }> {
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'first message' }],
    });
    await recording.flush();
    const lines = (await readFile(recording.getFilePath()!, 'utf-8'))
      .trim()
      .split('\n')
      .map((line): unknown => JSON.parse(line));
    const [first] = lines;
    const header =
      typeof first === 'object' && first !== null
        ? Reflect.get(first, 'payload')
        : undefined;
    if (!isSessionStartHeader(header)) {
      throw new Error('First recorded line is not a valid session_start');
    }
    const switches = lines.flatMap((line) => {
      if (
        typeof line !== 'object' ||
        line === null ||
        Reflect.get(line, 'type') !== 'provider_switch'
      ) {
        return [];
      }
      const payload: unknown = Reflect.get(line, 'payload');
      return typeof payload === 'object' && payload !== null
        ? [
            {
              provider: Reflect.get(payload, 'provider'),
              model: Reflect.get(payload, 'model'),
            },
          ]
        : [];
    });
    return {
      header: { provider: header.provider, model: header.model },
      switches,
    };
  }

  function addMessage(message: {
    type: MessageType;
    content: string;
    timestamp: Date;
  }): void {
    addedMessages.push(message.content);
  }

  it('records a cross-provider model picker selection in the header and as a provider_switch', async () => {
    const store = createDialogStore();
    store.commands.openDialog({ kind: 'models', payload: {} });
    const { result } = renderHook(() =>
      useModelDialogHandler(
        requireRuntime(),
        (item) => {
          addedMessages.push(String(item.type));
          return 0;
        },
        store,
        null,
        { recordingIntegration: integration },
      ),
    );

    result.current(pickerModel('codex', 'gpt-6-luna'));
    await waitFor(() => {
      expect(hasDialogRequest(store, 'modelConfig')).toBe(true);
    });

    expect(await recordedFile()).toStrictEqual({
      header: { provider: 'codex', model: 'gpt-6-luna' },
      switches: [{ provider: 'codex', model: 'gpt-6-luna' }],
    });
    expect(addedMessages).not.toContain('error');
  });

  it('records a same-provider model picker selection as a provider_switch', async () => {
    config.setProvider('codex');
    const store = createDialogStore();
    store.commands.openDialog({ kind: 'models', payload: {} });
    const { result } = renderHook(() =>
      useModelDialogHandler(
        requireRuntime(),
        (item) => {
          addedMessages.push(String(item.type));
          return 0;
        },
        store,
        'codex',
        { recordingIntegration: integration },
      ),
    );

    result.current(pickerModel('codex', 'gpt-6-luna'));
    await waitFor(() => {
      expect(hasDialogRequest(store, 'modelConfig')).toBe(true);
    });

    expect(await recordedFile()).toStrictEqual({
      header: { provider: 'codex', model: 'gpt-6-luna' },
      switches: [{ provider: 'codex', model: 'gpt-6-luna' }],
    });
  });

  it('records a profile chosen in the load-profile dialog in the header and as a provider_switch', async () => {
    const dialogs = createDialogOpeners(createDialogStore());
    const { result } = renderHook(() =>
      useLoadProfileDialog({
        addMessage,
        dialogs,
        recordingIntegrationRef: { current: integration },
      }),
    );

    await act(async () => {
      await result.current.handleSelect('lunahigh');
    });

    expect(await recordedFile()).toStrictEqual({
      header: { provider: 'codex', model: 'gpt-6-luna' },
      switches: [{ provider: 'codex', model: 'gpt-6-luna' }],
    });
    expect(addedMessages).toStrictEqual(["Profile 'lunahigh' loaded"]);
  });

  it('records a profile loaded from the profile management dialogs in the header and as a provider_switch', async () => {
    const dialogs = createDialogOpeners(createDialogStore());
    const { result } = renderHook(() =>
      useProfileManagement({
        addMessage,
        dialogs,
        recordingIntegrationRef: { current: integration },
      }),
    );

    await act(async () => {
      await result.current.loadProfile('lunahigh');
    });

    expect(await recordedFile()).toStrictEqual({
      header: { provider: 'codex', model: 'gpt-6-luna' },
      switches: [{ provider: 'codex', model: 'gpt-6-luna' }],
    });
  });

  it('reads the recording integration current at selection time, so a resumed session records the switch', async () => {
    const swapped: { current: RecordingIntegration | null } = {
      current: null,
    };
    const dialogs = createDialogOpeners(createDialogStore());
    const { result } = renderHook(() =>
      useLoadProfileDialog({
        addMessage,
        dialogs,
        recordingIntegrationRef: swapped,
      }),
    );

    swapped.current = integration;
    await act(async () => {
      await result.current.handleSelect('lunahigh');
    });

    expect((await recordedFile()).switches).toStrictEqual([
      { provider: 'codex', model: 'gpt-6-luna' },
    ]);
  });
});
