/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration test proving that a gemini-extension.json manifest with valid
 * hooks is loaded by the extension loader and correctly registered by the
 * core HookRegistry.
 *
 * This test uses real production paths:
 * - The real `loadExtensionFromDir` from the CLI extension loader.
 * - The real `HookRegistry` from core.
 * - A real temp directory with a real gemini-extension.json file.
 *
 * No mocks of the components under test. The only "mock" is a minimal Config
 * object that carries the loaded extension — this is the standard test pattern
 * used by the core hook test utilities.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadExtensionFromDir } from './extensionLoader.js';
import type { LoadExtensionContext } from './variableSchema.js';
import { HookRegistry, HookEventName } from '@vybestack/llxprt-code-core';
import type { Config, LlxprtExtension } from '@vybestack/llxprt-code-core';

const FALLBACK_MANIFEST = 'gemini-extension.json';
const PRIMARY_MANIFEST = 'llxprt-extension.json';
const PRIMARY_METADATA = '.llxprt-extension-install.json';
const FALLBACK_METADATA = '.gemini-extension-install.json';

function makeDeps() {
  return {
    configFileName: PRIMARY_MANIFEST,
    fallbackConfigFileName: FALLBACK_MANIFEST,
    installMetadataFileName: PRIMARY_METADATA,
    fallbackInstallMetadataFileName: FALLBACK_METADATA,
    loadSettings: () => ({ merged: {} }),
    validateName: () => {},
    reportError: (message: string) => globalThis.console.error(message),
    reportWarning: (message: string) => globalThis.console.warn(message),
  };
}

describe('extension hook integration: gemini-extension.json -> HookRegistry', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-hook-int-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('loads a valid hook from gemini-extension.json and HookRegistry registers it', async () => {
    const extDir = path.join(tempRoot, 'hook-ext');
    fs.mkdirSync(extDir, { recursive: true });

    fs.writeFileSync(
      path.join(extDir, FALLBACK_MANIFEST),
      JSON.stringify({
        name: 'hook-extension',
        version: '1.0.0',
        hooks: {
          BeforeTool: [
            {
              matcher: 'edit_file',
              hooks: [
                { type: 'command', command: 'echo lint', name: 'lint-hook' },
              ],
            },
          ],
        },
      }),
    );

    const context: LoadExtensionContext = {
      extensionDir: extDir,
      workspaceDir: extDir,
    };
    const extension = loadExtensionFromDir(context, makeDeps());

    // The extension loader should have loaded the hook
    expect(extension).not.toBeNull();
    expect(extension?.hooks).toBeDefined();
    expect(extension?.hooks?.[HookEventName.BeforeTool]).toBeDefined();

    // Build a minimal Config carrying this extension
    const extensions: LlxprtExtension[] = extension ? [extension] : [];
    const config = {
      getEnableHooks: () => true,
      getHooks: () => undefined,
      getProjectHooks: () => undefined,
      getSessionId: () => 'test-session',
      getWorkingDir: () => tempRoot,
      getTargetDir: () => tempRoot,
      getExtensions: () => extensions,
      getDisabledHooks: () => [],
      getModel: () => 'test-model',
      getSessionRecordingService: () => undefined,
      isTrustedFolder: () => true,
      getSanitizationConfig: () => ({
        enableEnvironmentVariableRedaction: false,
        allowedEnvironmentVariables: [],
        blockedEnvironmentVariables: [],
      }),
      getHookSystem: () => undefined,
    } as unknown as Config;

    // Create and initialize the real HookRegistry
    const registry = new HookRegistry(config);
    await registry.initialize();

    // The hook should be registered for the BeforeTool event
    const hooks = registry.getHooksForEvent(HookEventName.BeforeTool);
    expect(hooks.length).toBeGreaterThan(0);

    const hook = hooks.find((h) => h.config.command === 'echo lint');
    expect(hook).toBeDefined();
    expect(hook?.eventName).toBe(HookEventName.BeforeTool);
    expect(hook?.config.name).toBe('lint-hook');
    expect(hook?.matcher).toBe('edit_file');
  });

  it('loads hooks from llxprt-extension.json and HookRegistry registers them', async () => {
    const extDir = path.join(tempRoot, 'primary-hook-ext');
    fs.mkdirSync(extDir, { recursive: true });

    fs.writeFileSync(
      path.join(extDir, PRIMARY_MANIFEST),
      JSON.stringify({
        name: 'primary-hook-extension',
        version: '2.0.0',
        hooks: {
          AfterModel: [
            {
              hooks: [{ type: 'command', command: 'echo done' }],
            },
          ],
        },
      }),
    );

    const context: LoadExtensionContext = {
      extensionDir: extDir,
      workspaceDir: extDir,
    };
    const extension = loadExtensionFromDir(context, makeDeps());

    expect(extension).not.toBeNull();
    expect(extension?.hooks?.[HookEventName.AfterModel]).toBeDefined();

    const extensions: LlxprtExtension[] = extension ? [extension] : [];
    const config = {
      getEnableHooks: () => true,
      getHooks: () => undefined,
      getProjectHooks: () => undefined,
      getSessionId: () => 'test-session',
      getWorkingDir: () => tempRoot,
      getTargetDir: () => tempRoot,
      getExtensions: () => extensions,
      getDisabledHooks: () => [],
      getModel: () => 'test-model',
      getSessionRecordingService: () => undefined,
      isTrustedFolder: () => true,
      getSanitizationConfig: () => ({
        enableEnvironmentVariableRedaction: false,
        allowedEnvironmentVariables: [],
        blockedEnvironmentVariables: [],
      }),
      getHookSystem: () => undefined,
    } as unknown as Config;

    const registry = new HookRegistry(config);
    await registry.initialize();

    const hooks = registry.getHooksForEvent(HookEventName.AfterModel);
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks[0]?.config.command).toBe('echo done');
  });
});
