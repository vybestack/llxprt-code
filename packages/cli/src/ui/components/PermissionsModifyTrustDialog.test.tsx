/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { renderWithProviders, waitFor } from '../../test-utils/render.js';
import { createDeferred } from '../../test-utils/async.js';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PermissionsModifyTrustDialog } from './PermissionsModifyTrustDialog.js';
import type React from 'react';
import { SettingsContext } from '../contexts/SettingsContext.js';
import { LoadedSettings } from '../../config/settings.js';
import type { PermissionsTrustRuntime } from '../hooks/usePermissionsModifyTrust.js';
import { ideContext } from '@vybestack/llxprt-code-core';
import { TrustLevel } from '../../config/trustedFolders.js';
import { MessageType } from '../types.js';

const mockedExit = vi.hoisted(() => vi.fn());
const mockedCwd = vi.hoisted(() => vi.fn());
const mockedSetValue = vi.hoisted(() => vi.fn());
const mockedDeleteValue = vi.hoisted(() => vi.fn());
const mockedGetValue = vi.hoisted(() => vi.fn());
const mockedSnapshotValue = vi.hoisted(() => vi.fn());
const mockedRestoreSnapshot = vi.hoisted(() => vi.fn());
const mockedResolvePathTrust = vi.hoisted(() => vi.fn());
const mockedTrustedConfig = vi.hoisted<Record<string, TrustLevel>>(() => ({}));

vi.mock('node:process', async () => {
  const actual = await vi.importActual('node:process');
  return {
    ...actual,
    exit: mockedExit,
    cwd: mockedCwd,
  };
});

// Mock the trustedFolders module
vi.mock('../../config/trustedFolders.js', async () => {
  const actual = await vi.importActual('../../config/trustedFolders.js');
  return {
    ...actual,
    loadTrustedFolders: vi.fn(() => ({
      rules: [],
      setValue: mockedSetValue,
      deleteValue: mockedDeleteValue,
      getValue: mockedGetValue,
      snapshotValue: mockedSnapshotValue,
      restoreSnapshot: mockedRestoreSnapshot,
      user: { path: '/mock/path', config: mockedTrustedConfig },
      errors: [],
      isPathTrusted: vi.fn(() => undefined),
      resolvePathTrust: mockedResolvePathTrust,
    })),
  };
});

// Mock getIdeTrust
vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
  return {
    ...actual,
    getIdeTrust: vi.fn(() => undefined),
  };
});

const mockSettings = new LoadedSettings(
  { settings: {}, path: '/mock/system.json' },
  { settings: {}, path: '/mock/system-defaults.json' },
  { settings: { folderTrust: false }, path: '/mock/user.json' },
  { settings: {}, path: '/mock/workspace.json' },
  true,
);

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsContext.Provider value={mockSettings}>
    {children}
  </SettingsContext.Provider>
);

describe('PermissionsModifyTrustDialog', () => {
  let mockConfig: PermissionsTrustRuntime & {
    setTrustedFolderLive: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockedTrustedConfig)) {
      delete mockedTrustedConfig[key];
    }
    mockedSetValue.mockImplementation((folderPath, trustLevel) => {
      mockedTrustedConfig[folderPath] = trustLevel;
    });
    mockedDeleteValue.mockImplementation((folderPath) => {
      delete mockedTrustedConfig[folderPath];
    });
    mockedGetValue.mockImplementation(
      (folderPath) => mockedTrustedConfig[folderPath],
    );
    mockedSnapshotValue.mockImplementation((folderPath) => ({
      canonicalPath: folderPath,
      entries: Object.entries(mockedTrustedConfig),
    }));
    mockedRestoreSnapshot.mockImplementation((snapshot) => {
      for (const key of Object.keys(mockedTrustedConfig)) {
        delete mockedTrustedConfig[key];
      }
      for (const [folderPath, trustLevel] of snapshot.entries) {
        mockedTrustedConfig[folderPath] = trustLevel;
      }
    });
    ideContext.clearIdeContext();
    mockedResolvePathTrust.mockReturnValue(undefined);
    mockedCwd.mockReturnValue('/test/dir');
    mockConfig = {
      setTrustedFolderLive: vi.fn(),
      getWorkingDir: () => '/test/dir',
      getFolderTrust: () => true,
      getIdeClient: () => undefined,
      isTrustedFolder: () => false,
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render the dialog with title', () => {
    const onExit = vi.fn();
    const addItem = vi.fn().mockReturnValue(0);

    const { lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={onExit}
          addItem={addItem}
          config={mockConfig}
        />
      </Wrapper>,
    );

    expect(lastFrame()).toContain('Modify Trust Settings');
  });

  it('should display trust options', () => {
    const onExit = vi.fn();
    const addItem = vi.fn().mockReturnValue(0);

    const { lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={onExit}
          addItem={addItem}
          config={mockConfig}
        />
      </Wrapper>,
    );

    expect(lastFrame()).toContain('Trust folder');
    expect(lastFrame()).toContain('Trust parent folder');
    expect(lastFrame()).toContain("Don't trust");
  });

  it('should render the labels with folder names', async () => {
    const { lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={vi.fn()}
          addItem={vi.fn()}
          config={mockConfig}
        />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Trust folder (dir)');
      expect(lastFrame()).toContain('Trust parent folder (test)');
    });
  });

  it('should show help text', () => {
    const onExit = vi.fn();
    const addItem = vi.fn().mockReturnValue(0);

    const { lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={onExit}
          addItem={addItem}
          config={mockConfig}
        />
      </Wrapper>,
    );

    expect(lastFrame()).toContain('Enter to select');
    expect(lastFrame()).toContain('Escape to cancel');
  });

  it('should display folder path', () => {
    const onExit = vi.fn();
    const addItem = vi.fn().mockReturnValue(0);

    const { lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={onExit}
          addItem={addItem}
          config={mockConfig}
        />
      </Wrapper>,
    );

    // Should contain "Folder:" label and the current working directory
    expect(lastFrame()).toContain('Folder:');
    // The actual path will be the real cwd since we can't easily mock it
  });
  it('reports persistence failure and keeps the form usable without changing live Config', async () => {
    const addItem = vi.fn();
    mockedSetValue.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const { stdin, lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={vi.fn()}
          addItem={addItem}
          config={mockConfig}
        />
      </Wrapper>,
    );

    stdin.write('\r');
    await waitFor(() => {
      expect(addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: expect.stringContaining('disk full'),
        }),
        expect.any(Number),
      );
    });

    expect(lastFrame()).toContain('Modify Trust Settings');
    expect(mockConfig.setTrustedFolderLive).not.toHaveBeenCalled();
  });

  it('restores an absent saved rule when live application throws', async () => {
    const addItem = vi.fn();
    mockConfig.setTrustedFolderLive.mockImplementation(() => {
      throw new Error('live update failed');
    });
    const { stdin, lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={vi.fn()}
          addItem={addItem}
          config={mockConfig}
        />
      </Wrapper>,
    );

    stdin.write('\r');
    await waitFor(() => {
      expect(addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: expect.stringMatching(/rollback was incomplete/i),
        }),
        expect.any(Number),
      );
    });

    expect(mockedSetValue).toHaveBeenCalledWith(
      '/test/dir',
      TrustLevel.TRUST_FOLDER,
    );
    expect(mockedTrustedConfig['/test/dir']).toBeUndefined();
    expect(lastFrame()).toContain('Modify Trust Settings');

    stdin.write('\u001B[B');
    stdin.write('\r');
    await waitFor(() => {
      expect(mockedSetValue).toHaveBeenCalledTimes(2);
    });
  });

  it('restores the exact saved rule when live application throws', async () => {
    mockedTrustedConfig['/test/dir'] = TrustLevel.DO_NOT_TRUST;
    mockConfig.setTrustedFolderLive.mockImplementation(() => {
      throw new Error('live update failed');
    });
    const { stdin } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={vi.fn()}
          addItem={vi.fn()}
          config={mockConfig}
        />
      </Wrapper>,
    );

    stdin.write('\r');
    await waitFor(() => {
      expect(mockedSetValue).toHaveBeenLastCalledWith(
        '/test/dir',
        TrustLevel.DO_NOT_TRUST,
      );
    });

    expect(mockedTrustedConfig['/test/dir']).toBe(TrustLevel.DO_NOT_TRUST);
    expect(mockedDeleteValue).not.toHaveBeenCalled();
  });

  it('saves an exact cwd rule when selecting the same level as inherited trust', async () => {
    mockedResolvePathTrust.mockReturnValue({
      rule: { path: '/test', trustLevel: TrustLevel.TRUST_FOLDER },
      effectivePath: '/test',
      trusted: true,
      provenance: 'inherited',
    });
    const { stdin, lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={vi.fn()}
          addItem={vi.fn()}
          config={mockConfig}
        />
      </Wrapper>,
    );

    expect(lastFrame()).toContain('Current: Trusted (via parent folder)');
    stdin.write('\r');
    await waitFor(() => {
      expect(mockedSetValue).toHaveBeenCalledWith(
        '/test/dir',
        TrustLevel.TRUST_FOLDER,
      );
    });
    expect(lastFrame()).toContain('Trust level updated');
  });

  it('should display current trust status', () => {
    const { lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={vi.fn()}
          addItem={vi.fn()}
          config={mockConfig}
        />
      </Wrapper>,
    );

    expect(lastFrame()).toContain('Current:');
  });

  it('applies the selected trust level live and requires Enter to close the confirmation', async () => {
    const onExit = vi.fn();
    const { stdin, lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={onExit}
          addItem={vi.fn()}
          config={mockConfig}
        />
      </Wrapper>,
    );

    stdin.write('\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Trust level updated');
    });
    expect(mockedSetValue).toHaveBeenCalledWith(
      '/test/dir',
      TrustLevel.TRUST_FOLDER,
    );
    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(false);

    stdin.write('x');
    await waitFor(() => {
      expect(lastFrame()).toContain('Trust level updated');
      expect(onExit).not.toHaveBeenCalled();
    });

    stdin.write('\r');
    await waitFor(() => {
      expect(onExit).toHaveBeenCalledTimes(1);
    });
  });

  it('serializes an async commit and ignores repeat Enter and Escape until it settles', async () => {
    const transition = createDeferred<void>();
    mockConfig.setTrustedFolderLive.mockReturnValueOnce(transition.promise);
    const onExit = vi.fn();
    const { stdin, lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={onExit}
          addItem={vi.fn()}
          config={mockConfig}
        />
      </Wrapper>,
    );

    stdin.write('\r');
    stdin.write('\r');
    stdin.write('\u001B');
    await waitFor(() => expect(mockedSetValue).toHaveBeenCalledOnce());
    expect(onExit).not.toHaveBeenCalled();

    transition.resolve();
    await waitFor(() => {
      expect(lastFrame()).toContain('Trust level updated');
    });
    expect(mockedSetValue).toHaveBeenCalledOnce();
  });

  it('changes the selection before applying it', async () => {
    const { stdin } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={vi.fn()}
          addItem={vi.fn()}
          config={mockConfig}
        />
      </Wrapper>,
    );

    stdin.write('\u001B[B');
    stdin.write('\r');
    await waitFor(() => {
      expect(mockedSetValue).toHaveBeenCalledWith(
        '/test/dir',
        TrustLevel.TRUST_PARENT,
      );
    });
    expect(mockConfig.setTrustedFolderLive).toHaveBeenCalledWith(false);
  });

  it('exits without applying changes on Escape', async () => {
    const onExit = vi.fn();
    const { stdin } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={onExit}
          addItem={vi.fn()}
          config={mockConfig}
        />
      </Wrapper>,
    );

    stdin.write('\u001B');
    await waitFor(() => {
      expect(onExit).toHaveBeenCalledTimes(1);
    });
    expect(mockedSetValue).not.toHaveBeenCalled();
  });

  it('shows an IDE false override and distinguishes saved fallback from effective trust', async () => {
    ideContext.setIdeContext({ workspaceState: { isTrusted: false } });
    const { stdin, lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={vi.fn()}
          addItem={vi.fn()}
          config={mockConfig}
        />
      </Wrapper>,
    );

    expect(lastFrame()).toContain('Current: Not trusted (via IDE)');

    stdin.write('\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Saved local fallback: Trusted');
    });
    expect(lastFrame()).toContain('Effective now: Not trusted (via IDE)');
  });

  it('selects an inherited DO_NOT_TRUST rule when the form opens', async () => {
    mockedResolvePathTrust.mockReturnValue({
      rule: { path: '/test', trustLevel: TrustLevel.DO_NOT_TRUST },
      effectivePath: '/test',
      trusted: false,
      provenance: 'inherited',
    });

    const { lastFrame, stdin } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog
          onExit={vi.fn()}
          addItem={vi.fn()}
          config={mockConfig}
        />
      </Wrapper>,
    );

    expect(lastFrame()).toContain('Current: Not trusted (via parent folder)');
    expect(lastFrame()).toContain(
      'This folder is not trusted because a local rule overrides the trusted parent folder.',
    );
    stdin.write('\r');
    await waitFor(() => {
      expect(mockedSetValue).toHaveBeenCalledWith(
        '/test/dir',
        TrustLevel.DO_NOT_TRUST,
      );
    });
  });
});
