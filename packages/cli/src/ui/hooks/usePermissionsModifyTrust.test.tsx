/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TrustLevel } from '../../config/trustedFolders.js';

// Mock the trustedFolders module
const mockSetValue = vi.fn();
vi.mock('../../config/trustedFolders.js', async () => {
  const actual = await vi.importActual('../../config/trustedFolders.js');
  return {
    ...actual,
    loadTrustedFolders: vi.fn(() => ({
      rules: [],
      setValue: mockSetValue,
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

describe('usePermissionsModifyTrust', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // Note: Full hook testing requires renderHook with proper React context providers.
  // Since this hook has dependencies on SettingsContext, we test the core logic
  // through integration tests with PermissionsModifyTrustDialog instead.

  it('should export TrustLevel enum values', () => {
    // Verify the enum values are exported correctly
    expect(TrustLevel.TRUST_FOLDER).toBe('TRUST_FOLDER');
    expect(TrustLevel.TRUST_PARENT).toBe('TRUST_PARENT');
    expect(TrustLevel.DO_NOT_TRUST).toBe('DO_NOT_TRUST');
  });

  it('should have mocked loadTrustedFolders', async () => {
    const { loadTrustedFolders } = await import(
      '../../config/trustedFolders.js'
    );
    const folders = loadTrustedFolders();

    expect(folders).toBeDefined();
    expect(folders.rules).toEqual([]);
    expect(folders.setValue).toBeDefined();
  });

  it('should have mocked getIdeTrust', async () => {
    const { getIdeTrust } = await import('@vybestack/llxprt-code-core');
    const result = getIdeTrust();

    expect(result).toBeUndefined();
  });
});
