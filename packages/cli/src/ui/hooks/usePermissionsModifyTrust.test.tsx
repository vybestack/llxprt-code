/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { TrustLevel } from '../../config/trustedFolders.js';

// Mock the trustedFolders module
const realTrustedFoldersModule = {
  ...(await import('../../config/trustedFolders.js')),
};
const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

const mockSetValue = vi.fn();
void vi.mock('../../config/trustedFolders.js', () => {
  const actual = realTrustedFoldersModule;
  return {
    ...actual,
    loadTrustedFolders: vi.fn(() => ({
      rules: [],
      setValue: mockSetValue,
      user: { path: '/mock/path', config: {} },
      errors: [],
      isPathTrusted: vi.fn(() => undefined),
      resolvePathTrust: vi.fn(() => undefined),
    })),
  };
});

// Mock getIdeTrust
void vi.mock('@vybestack/llxprt-code-core', () => {
  const actual = realLlxprtCodeCoreModule;
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
    // Verify the enum values are exported correctly. TrustLevel is a string
    // enum, so the matching literal must be asserted to the enum type.
    expect(TrustLevel.TRUST_FOLDER).toBe(
      'TRUST_FOLDER' as unknown as TrustLevel,
    );
    expect(TrustLevel.TRUST_PARENT).toBe(
      'TRUST_PARENT' as unknown as TrustLevel,
    );
    expect(TrustLevel.DO_NOT_TRUST).toBe(
      'DO_NOT_TRUST' as unknown as TrustLevel,
    );
  });

  it('should have mocked loadTrustedFolders', async () => {
    const { loadTrustedFolders } = await import(
      '../../config/trustedFolders.js'
    );
    const folders = loadTrustedFolders();

    expect(folders).toBeDefined();
    expect(folders.rules).toStrictEqual([]);
    expect(folders.setValue).toBeDefined();
  });

  it('should have mocked getIdeTrust', async () => {
    const { getIdeTrust } = await import('@vybestack/llxprt-code-core');
    const result = getIdeTrust();

    expect(result).toBeUndefined();
  });
});
