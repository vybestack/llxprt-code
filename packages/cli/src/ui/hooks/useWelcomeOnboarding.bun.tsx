/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act } from 'react';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { vi } from '../../test-utils/bunTest.js';
import { createMockSettings, renderHook } from '../../test-utils/render.js';
import { createFakeAgent } from './agentStream/__tests__/helpers/createFakeAgent.js';

const stubRuntime = {
  getCliProviderManager: () => ({ listProviders: () => [] }),
  listAvailableModels: async () => [],
  setActiveModel: async () => {},
};
vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => stubRuntime,
}));

import { useWelcomeOnboarding } from './useWelcomeOnboarding.js';
import {
  isWelcomeCompleted,
  resetWelcomeConfigForTesting,
} from '../../config/welcomeConfig.js';

const agent = createFakeAgent([]);

let tempConfigDir: string | undefined;

function isolateWelcomeConfig(): string {
  tempConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'welcome-suppress-'));
  const configPath = path.join(tempConfigDir, 'welcomeConfig.json');
  process.env.LLXPRT_CODE_WELCOME_CONFIG_PATH = configPath;
  resetWelcomeConfigForTesting();
  return configPath;
}

describe('useWelcomeOnboarding startup suppression', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.LLXPRT_CODE_WELCOME_CONFIG_PATH;
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
