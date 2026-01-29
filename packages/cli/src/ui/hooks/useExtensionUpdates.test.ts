/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ExtensionStorage,
  annotateActiveExtensions,
  loadExtension,
} from '../../config/extension.js';
import { createExtension } from '../../test-utils/createExtension.js';
import { useExtensionUpdates } from './useExtensionUpdates.js';
import {
  GEMINI_DIR,
  type GeminiCLIExtension,
} from '@vybestack/llxprt-code-core';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { MessageType } from '../types.js';
import { ExtensionEnablementManager } from '../../config/extensions/extensionEnablement.js';
import {
  checkForAllExtensionUpdates,
  updateExtension,
} from '../../config/extensions/update.js';
import { ExtensionUpdateState } from '../state/extensions.js';

vi.mock('os', async (importOriginal) => {
  const mockedOs = await importOriginal<typeof os>();
  return {
    ...mockedOs,
    homedir: vi.fn(),
  };
});

vi.mock('../../config/extensions/update.js', () => ({
  checkForAllExtensionUpdates: vi.fn(),
  updateExtension: vi.fn(),
}));

describe('useExtensionUpdates', () => {
  let tempHomeDir: string;
  let userExtensionsDir: string;

  beforeEach(() => {
    tempHomeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-cli-test-home-'),
    );
    vi.mocked(os.homedir).mockReturnValue(tempHomeDir);
    userExtensionsDir = path.join(tempHomeDir, GEMINI_DIR, 'extensions');
    fs.mkdirSync(userExtensionsDir, { recursive: true });
    vi.mocked(checkForAllExtensionUpdates).mockReset();
    vi.mocked(updateExtension).mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
  });

  it('should check for updates and log a message if an update is available', async () => {
    const extensions = [
      {
        name: 'test-extension',
        type: 'git',
        version: '1.0.0',
        path: '/some/path',
        isActive: true,
        installMetadata: {
          type: 'git',
          source: 'https://some/repo',
          autoUpdate: false,
        },
        contextFiles: [],
      },
    ];
    const addItem = vi.fn();
    const cwd = '/test/cwd';

    vi.mocked(checkForAllExtensionUpdates).mockImplementation(
      async (_extensions, dispatch, _cwd) => {
        dispatch({
          type: 'SET_STATE',
          payload: {
            name: 'test-extension',
            state: ExtensionUpdateState.UPDATE_AVAILABLE,
          },
        });
      },
    );

    renderHook(() =>
      useExtensionUpdates(extensions as GeminiCLIExtension[], addItem, cwd),
    );

    await waitFor(() => {
      expect(addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'You have 1 extension with an update available, run "/extensions list" for more information.',
        },
        expect.any(Number),
      );
    });
  });

  it('should check for updates and automatically update if autoUpdate is true', async () => {
    const extensionDir = createExtension({
      extensionsDir: userExtensionsDir,
      name: 'test-extension',
      version: '1.0.0',
      installMetadata: {
        source: 'https://some.git/repo',
        type: 'git',
        autoUpdate: true,
      },
    });
    const extension = annotateActiveExtensions(
      [loadExtension({ extensionDir, workspaceDir: tempHomeDir })!],
      tempHomeDir,
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
    )[0];

    const addItem = vi.fn();

    vi.mocked(checkForAllExtensionUpdates).mockImplementation(
      async (_extensions, dispatch, _cwd) => {
        dispatch({
          type: 'SET_STATE',
          payload: {
            name: 'test-extension',
            state: ExtensionUpdateState.UPDATE_AVAILABLE,
          },
        });
      },
    );

    vi.mocked(updateExtension).mockResolvedValue({
      originalVersion: '1.0.0',
      updatedVersion: '1.1.0',
      name: '',
    });

    renderHook(() => useExtensionUpdates([extension], addItem, tempHomeDir));

    await waitFor(
      () => {
        expect(addItem).toHaveBeenCalledWith(
          {
            type: MessageType.INFO,
            text: 'Extension "test-extension" successfully updated: 1.0.0 → 1.1.0.',
          },
          expect.any(Number),
        );
      },
      { timeout: 4000 },
    );
  });

  it('should batch update notifications for multiple extensions', async () => {
    const extensionDir1 = createExtension({
      extensionsDir: userExtensionsDir,
      name: 'test-extension-1',
      version: '1.0.0',
      installMetadata: {
        source: 'https://some.git/repo1',
        type: 'git',
        autoUpdate: true,
      },
    });
    const extensionDir2 = createExtension({
      extensionsDir: userExtensionsDir,
      name: 'test-extension-2',
      version: '2.0.0',
      installMetadata: {
        source: 'https://some.git/repo2',
        type: 'git',
        autoUpdate: true,
      },
    });

    const extensions = annotateActiveExtensions(
      [
        loadExtension({
          extensionDir: extensionDir1,
          workspaceDir: tempHomeDir,
        })!,
        loadExtension({
          extensionDir: extensionDir2,
          workspaceDir: tempHomeDir,
        })!,
      ],
      tempHomeDir,
      new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
    );

    const addItem = vi.fn();

    vi.mocked(checkForAllExtensionUpdates).mockImplementation(
      async (_extensions, dispatch, _cwd) => {
        dispatch({
          type: 'SET_STATE',
          payload: {
            name: 'test-extension-1',
            state: ExtensionUpdateState.UPDATE_AVAILABLE,
          },
        });
        dispatch({
          type: 'SET_STATE',
          payload: {
            name: 'test-extension-2',
            state: ExtensionUpdateState.UPDATE_AVAILABLE,
          },
        });
      },
    );

    vi.mocked(updateExtension).mockImplementation(async (ext) => ({
      originalVersion: ext.version,
      updatedVersion: `${ext.version}.1`,
      name: ext.name,
    }));

    renderHook(() => useExtensionUpdates(extensions, addItem, tempHomeDir));

    await waitFor(
      () => {
        // Both extensions should have their update notifications
        expect(addItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: MessageType.INFO,
            text: expect.stringContaining('test-extension-1'),
          }),
          expect.any(Number),
        );
        expect(addItem).toHaveBeenCalledWith(
          expect.objectContaining({
            type: MessageType.INFO,
            text: expect.stringContaining('test-extension-2'),
          }),
          expect.any(Number),
        );
      },
      { timeout: 4000 },
    );
  });
});
