/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders, waitFor } from '../../test-utils/render.js';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PermissionsModifyTrustDialog } from './PermissionsModifyTrustDialog.js';
import React from 'react';
import { SettingsContext } from '../contexts/SettingsContext.js';

const mockedExit = vi.hoisted(() => vi.fn());
const mockedCwd = vi.hoisted(() => vi.fn());

vi.mock('process', async () => {
  const actual = await vi.importActual('process');
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
      setValue: vi.fn(),
      user: { path: '/mock/path', config: {} },
      errors: [],
      isPathTrusted: vi.fn(() => undefined),
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

const mockSettings = {
  merged: {
    folderTrust: false,
  },
  user: {
    settings: {},
  },
  workspace: {
    settings: {},
  },
  setValue: vi.fn(),
} as never;

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsContext.Provider value={mockSettings}>
    {children}
  </SettingsContext.Provider>
);

describe('PermissionsModifyTrustDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCwd.mockReturnValue('/test/dir');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should render the dialog with title', () => {
    const onExit = vi.fn();
    const addItem = vi.fn().mockReturnValue(0);

    const { lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog onExit={onExit} addItem={addItem} />
      </Wrapper>,
    );

    expect(lastFrame()).toContain('Modify Trust Settings');
  });

  it('should display trust options', () => {
    const onExit = vi.fn();
    const addItem = vi.fn().mockReturnValue(0);

    const { lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog onExit={onExit} addItem={addItem} />
      </Wrapper>,
    );

    expect(lastFrame()).toContain('Trust this folder');
    expect(lastFrame()).toContain('Trust parent folder');
    expect(lastFrame()).toContain("Don't trust");
  });

  it('should render the labels with folder names', async () => {
    const { lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog onExit={vi.fn()} addItem={vi.fn()} />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Trust this folder (dir)');
      expect(lastFrame()).toContain('Trust parent folder (test)');
    });
  });

  it('should show help text', () => {
    const onExit = vi.fn();
    const addItem = vi.fn().mockReturnValue(0);

    const { lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog onExit={onExit} addItem={addItem} />
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
        <PermissionsModifyTrustDialog onExit={onExit} addItem={addItem} />
      </Wrapper>,
    );

    // Should contain "Folder:" label and the current working directory
    expect(lastFrame()).toContain('Folder:');
    // The actual path will be the real cwd since we can't easily mock it
  });

  it('should display current trust status', () => {
    const onExit = vi.fn();
    const addItem = vi.fn().mockReturnValue(0);

    const { lastFrame } = renderWithProviders(
      <Wrapper>
        <PermissionsModifyTrustDialog onExit={onExit} addItem={addItem} />
      </Wrapper>,
    );

    // Should contain "Current:" label
    expect(lastFrame()).toContain('Current:');
  });
});
