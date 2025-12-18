/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  Config,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
  SettingsService,
} from '@vybestack/llxprt-code-core';
import { LoadedSettings } from './config/settings.js';

vi.mock('./utils/version.js', () => ({
  getCliVersion: vi.fn(() => Promise.resolve('1.0.0')),
}));

vi.mock('./ui/utils/kittyProtocolDetector.js', () => ({
  detectAndEnableKittyProtocol: vi.fn(() => Promise.resolve()),
}));

vi.mock('./ui/utils/updateCheck.js', () => ({
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('./utils/cleanup.js', () => ({
  registerCleanup: vi.fn(),
}));

vi.mock('./utils/sandbox.js', () => ({
  start_sandbox: vi.fn(() => Promise.resolve(0)),
}));

vi.mock('ink', () => ({
  Box: () => null,
  Text: () => null,
  render: vi.fn().mockReturnValue({
    waitUntilExit: vi.fn(async () => undefined),
    clear: vi.fn(),
    unmount: vi.fn(),
  }),
}));

const createLoadedSettings = () =>
  new LoadedSettings(
    { settings: {}, path: '/dev/null/system.json' },
    { settings: {}, path: '/dev/null/system-defaults.json' },
    { settings: {}, path: '/dev/null/user.json' },
    { settings: {}, path: '/dev/null/workspace.json' },
    true,
  );

describe('startInteractiveUI ink render options', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-render-test-'));
    const settingsService = new SettingsService();
    const runtime = createProviderRuntimeContext({
      settingsService,
      runtimeId: 'gemini-render-test',
      metadata: { source: 'gemini.renderOptions.test.tsx' },
    });
    setActiveProviderRuntimeContext(runtime);
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('passes computed Ink render options to ink.render()', async () => {
    const { render } = await import('ink');
    const renderSpy = vi.mocked(render);

    const { startInteractiveUI } = await import('./gemini.js');
    const config = new Config({
      sessionId: 'test-session',
      targetDir: tempDir,
      cwd: tempDir,
      debugMode: false,
      model: 'gemini-2.5-flash-lite',
      accessibility: { screenReader: false },
    });

    await startInteractiveUI(config, createLoadedSettings(), [], tempDir);

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const [_reactElement, options] = renderSpy.mock.calls[0];
    expect(options).toEqual({
      exitOnCtrlC: false,
      patchConsole: false,
      isScreenReaderEnabled: false,
      alternateBuffer: true,
      incrementalRendering: true,
    });
  });

  it('forces alternate buffer off when screen reader mode is enabled', async () => {
    const { render } = await import('ink');
    const renderSpy = vi.mocked(render);

    const { startInteractiveUI } = await import('./gemini.js');
    const config = new Config({
      sessionId: 'test-session',
      targetDir: tempDir,
      cwd: tempDir,
      debugMode: false,
      model: 'gemini-2.5-flash-lite',
      accessibility: { screenReader: true },
    });

    await startInteractiveUI(config, createLoadedSettings(), [], tempDir);

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const [_reactElement, options] = renderSpy.mock.calls[0];
    expect(options).toEqual({
      exitOnCtrlC: false,
      patchConsole: false,
      isScreenReaderEnabled: true,
      alternateBuffer: false,
      incrementalRendering: false,
    });
  });
});
