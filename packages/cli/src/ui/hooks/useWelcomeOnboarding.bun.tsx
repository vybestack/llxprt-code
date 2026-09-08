/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createMockSettings, renderHook } from '../../test-utils/render.js';
import { createFakeAgent } from './agentStream/__tests__/helpers/createFakeAgent.js';

interface RuntimeStub {
  getCliProviderManager: () => {
    listProviders: () => string[];
    getActiveProviderName: () => string | null;
  };
  listAvailableModels: (provider?: string) => Promise<unknown[]>;
  setActiveModel: (modelId: string) => Promise<void>;
  listSavedProfiles: () => Promise<string[]>;
  saveProfileSnapshot: (name: string) => Promise<void>;
  setDefaultProfileName: (name: string) => void;
  loadProfileByName: (name: string) => Promise<unknown>;
}

const defaultRuntime: RuntimeStub = {
  getCliProviderManager: () => ({
    listProviders: () => [],
    getActiveProviderName: () => null,
  }),
  listAvailableModels: async () => [],
  setActiveModel: async () => {},
  listSavedProfiles: async () => [],
  saveProfileSnapshot: async () => {},
  setDefaultProfileName: () => {},
  loadProfileByName: async () => undefined,
};

// Mutable runtime stub. The mock factory dereferences `currentRuntime` lazily on
// every useRuntimeApi() call (vi.mock factories are hoisted, so the factory must
// not capture the value at registration time — it reads through the `let` binding),
// letting each test plug in a different fake runtime API.
let currentRuntime: RuntimeStub = defaultRuntime;
void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => currentRuntime,
}));

import { useWelcomeOnboarding } from './useWelcomeOnboarding.js';
import {
  isWelcomeCompleted,
  resetWelcomeConfigForTesting,
} from '../../config/welcomeConfig.js';

const agent = createFakeAgent([]);

interface PersistedWelcomeConfig {
  welcomeCompleted: boolean;
  completedAt?: string;
  skipped?: boolean;
}

function isPersistedWelcomeConfig(
  value: unknown,
): value is PersistedWelcomeConfig {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.welcomeCompleted !== 'boolean') return false;
  if ('completedAt' in candidate && typeof candidate.completedAt !== 'string') {
    return false;
  }
  if ('skipped' in candidate && typeof candidate.skipped !== 'boolean') {
    return false;
  }
  return true;
}

function readWelcomeConfig(configPath: string): PersistedWelcomeConfig {
  const onDisk: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  if (!isPersistedWelcomeConfig(onDisk)) {
    throw new Error(`Malformed welcome config at ${configPath}`);
  }
  return onDisk;
}

interface FakeProfileStore {
  readonly runtime: Pick<
    RuntimeStub,
    | 'listSavedProfiles'
    | 'saveProfileSnapshot'
    | 'setDefaultProfileName'
    | 'loadProfileByName'
  >;
  savedProfiles: () => string[];
  defaultProfileName: () => string | undefined;
  loadedProfiles: () => string[];
  overwriteAttempts: () => number;
}

/**
 * An in-memory stand-in for the runtime's profile storage. It enforces the
 * invariants the real store has — a profile cannot be defaulted or loaded
 * before it is saved — so tests can assert resulting state instead of
 * recording which stub methods were called in which order.
 */
function createFakeProfileStore(initial: string[]): FakeProfileStore {
  const saved = [...initial];
  const loaded: string[] = [];
  let defaultName: string | undefined;
  let overwrites = 0;

  return {
    runtime: {
      listSavedProfiles: async () => [...saved],
      saveProfileSnapshot: async (name: string) => {
        if (saved.includes(name)) {
          overwrites += 1;
          return;
        }
        saved.push(name);
      },
      setDefaultProfileName: (name: string) => {
        if (!saved.includes(name)) {
          throw new Error(
            `Cannot default a profile that was never saved: ${name}`,
          );
        }
        defaultName = name;
      },
      loadProfileByName: async (name: string) => {
        if (!saved.includes(name)) {
          throw new Error(
            `Cannot load a profile that was never saved: ${name}`,
          );
        }
        loaded.push(name);
        return undefined;
      },
    },
    savedProfiles: () => [...saved],
    defaultProfileName: () => defaultName,
    loadedProfiles: () => [...loaded],
    overwriteAttempts: () => overwrites,
  };
}

let tempConfigDir: string | undefined;
let originalEnv: string | undefined;

function isolateWelcomeConfig(): string {
  tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'welcome-suppress-'));
  const configPath = path.join(tempConfigDir, 'welcomeConfig.json');
  process.env.LLXPRT_CODE_WELCOME_CONFIG_PATH = configPath;
  resetWelcomeConfigForTesting();
  return configPath;
}

describe('useWelcomeOnboarding', () => {
  beforeEach(() => {
    originalEnv = process.env.LLXPRT_CODE_WELCOME_CONFIG_PATH;
    currentRuntime = defaultRuntime;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LLXPRT_CODE_WELCOME_CONFIG_PATH;
    } else {
      process.env.LLXPRT_CODE_WELCOME_CONFIG_PATH = originalEnv;
    }
    resetWelcomeConfigForTesting();
    if (tempConfigDir) {
      fs.rmSync(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = undefined;
    }
  });

  describe('useWelcomeOnboarding startup suppression', () => {
    it('shows the welcome dialog when welcome is incomplete and not suppressed after trust', () => {
      isolateWelcomeConfig();
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: true,
          agent,
        }),
      );
      expect(result.current.showWelcome).toBe(true);
    });

    it('hides the welcome dialog at startup when an explicit selector suppresses it', () => {
      isolateWelcomeConfig();
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: true,
          agent,
          suppressStartup: true,
        }),
      );
      expect(result.current.showWelcome).toBe(false);
    });

    it('does not show the dialog before folder trust completes even without suppression', () => {
      isolateWelcomeConfig();
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: false,
          agent,
        }),
      );
      expect(result.current.showWelcome).toBe(false);
    });

    it('keeps the dialog hidden when welcome is already completed', () => {
      const configPath = isolateWelcomeConfig();
      fs.writeFileSync(configPath, JSON.stringify({ welcomeCompleted: true }));
      resetWelcomeConfigForTesting();
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: true,
          agent,
        }),
      );
      expect(result.current.showWelcome).toBe(false);
    });

    it('does not persist welcome completion when startup suppression is active', () => {
      const configPath = isolateWelcomeConfig();
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: true,
          agent,
          suppressStartup: true,
        }),
      );
      expect(result.current.showWelcome).toBe(false);
      expect(fs.existsSync(configPath)).toBe(false);
      resetWelcomeConfigForTesting();
      expect(isWelcomeCompleted()).toBe(false);
    });

    it('reopen via resetAndReopen shows the dialog after a suppressed startup', () => {
      isolateWelcomeConfig();
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: true,
          agent,
          suppressStartup: true,
        }),
      );
      expect(result.current.showWelcome).toBe(false);
      act(() => {
        result.current.actions.resetAndReopen();
      });
      expect(result.current.showWelcome).toBe(true);
    });
  });

  describe('useWelcomeOnboarding skip and save persistence', () => {
    it('persists skipped true to the config file when the user skips then dismisses', () => {
      const configPath = isolateWelcomeConfig();
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: true,
          agent,
        }),
      );
      act(() => {
        result.current.actions.skipSetup();
      });
      act(() => {
        result.current.actions.dismiss();
      });
      const onDisk = readWelcomeConfig(configPath);
      expect(result.current.showWelcome).toBe(false);
      expect(onDisk.welcomeCompleted).toBe(true);
      expect(onDisk.skipped).toBe(true);
      resetWelcomeConfigForTesting();
      expect(isWelcomeCompleted()).toBe(true);
    });

    it('persists skipped false when dismissing from the completion step', async () => {
      const configPath = isolateWelcomeConfig();
      currentRuntime = {
        ...defaultRuntime,
        listAvailableModels: async () => [
          { id: 'model-id', name: 'model-name' },
        ],
        setActiveModel: async () => {},
      };
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: true,
          agent,
        }),
      );
      act(() => {
        result.current.actions.startSetup();
      });
      act(() => {
        result.current.actions.selectProvider('provider-id');
      });
      act(() => {
        result.current.actions.selectAuthMethod('api_key');
      });
      await act(async () => {
        await result.current.actions.onAuthComplete();
      });
      await act(async () => {
        await result.current.actions.selectModel('model-id');
      });
      expect(result.current.state.step).toBe('completion');
      act(() => {
        result.current.actions.dismiss();
      });
      const onDisk = readWelcomeConfig(configPath);
      expect(onDisk.welcomeCompleted).toBe(true);
      expect(onDisk.skipped).toBe(false);
    });

    it('saveProfile leaves the new profile saved, defaulted, and loaded', async () => {
      isolateWelcomeConfig();
      // A stateful fake profile store rather than a call recorder: defaulting or
      // loading a profile that was never saved is rejected by the store itself,
      // so the ordering the hook depends on is enforced by the fake's invariants
      // and the assertions below are about the resulting state.
      const store = createFakeProfileStore(['other']);
      currentRuntime = { ...defaultRuntime, ...store.runtime };
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: true,
          agent,
        }),
      );
      await act(async () => {
        await result.current.actions.saveProfile('newprof');
      });
      expect(store.savedProfiles()).toContain('newprof');
      expect(store.defaultProfileName()).toBe('newprof');
      expect(store.loadedProfiles()).toStrictEqual(['newprof']);
    });

    it('saveProfile rejects a duplicate name and leaves the store untouched', async () => {
      isolateWelcomeConfig();
      const store = createFakeProfileStore(['dupe']);
      currentRuntime = { ...defaultRuntime, ...store.runtime };
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: true,
          agent,
        }),
      );
      let caught: unknown;
      await act(async () => {
        try {
          await result.current.actions.saveProfile('dupe');
        } catch (error) {
          caught = error;
        }
      });
      if (!(caught instanceof Error)) {
        throw new TypeError('expected saveProfile to reject with an Error');
      }
      expect(caught.message).toContain('dupe');
      expect(caught.message).toContain('already exists');
      // The pre-existing profile must not have been overwritten, defaulted, or
      // loaded: rejecting has to leave the store exactly as it was.
      expect(store.savedProfiles()).toStrictEqual(['dupe']);
      expect(store.overwriteAttempts()).toBe(0);
      expect(store.defaultProfileName()).toBeUndefined();
      expect(store.loadedProfiles()).toStrictEqual([]);
    });

    it('selectModel advances to completion when the runtime accepts the model', async () => {
      isolateWelcomeConfig();
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: true,
          agent,
        }),
      );
      await act(async () => {
        await result.current.actions.selectModel('model-id');
      });
      expect(result.current.state.step).toBe('completion');
      expect(result.current.state.selectedModel).toBe('model-id');
    });

    it('selectModel keeps the welcome step and records the error when the runtime rejects', async () => {
      isolateWelcomeConfig();
      currentRuntime = {
        ...defaultRuntime,
        setActiveModel: async () => {
          throw new Error('boom');
        },
      };
      const { result } = renderHook(() =>
        useWelcomeOnboarding({
          settings: createMockSettings({}),
          isFolderTrustComplete: true,
          agent,
        }),
      );
      await act(async () => {
        await result.current.actions.selectModel('model-id');
      });
      expect(result.current.state.step).toBe('welcome');
      expect(result.current.state.selectedModel).toBeUndefined();
      expect(result.current.state.error).toContain('boom');
    });
  });
});
