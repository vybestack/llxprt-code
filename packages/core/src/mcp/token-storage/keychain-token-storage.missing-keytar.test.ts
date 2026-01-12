/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KeychainTokenStorage,
  resetKeytarLoader,
  setKeytarLoader,
} from './keychain-token-storage.js';

describe('KeychainTokenStorage when keytar is missing', () => {
  afterEach(() => {
    resetKeytarLoader();
  });

  it('falls back without throwing when keytar cannot be loaded', async () => {
    const error = new Error("Cannot find module 'keytar'");
    (error as NodeJS.ErrnoException).code = 'ERR_MODULE_NOT_FOUND';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    setKeytarLoader(() => Promise.reject(error));

    const storage = new KeychainTokenStorage('service');

    const isAvailable = await storage.checkKeychainAvailability();

    expect(isAvailable).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      '@napi-rs/keyring not available; falling back to encrypted file storage for MCP tokens.',
    );
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('falls back without throwing when native module fails to load (ERR_DLOPEN_FAILED)', async () => {
    const error = new Error('Cannot load native module');
    (error as NodeJS.ErrnoException).code = 'ERR_DLOPEN_FAILED';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    setKeytarLoader(() => Promise.reject(error));

    const storage = new KeychainTokenStorage('service');

    const isAvailable = await storage.checkKeychainAvailability();

    expect(isAvailable).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      '@napi-rs/keyring not available; falling back to encrypted file storage for MCP tokens.',
    );
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
