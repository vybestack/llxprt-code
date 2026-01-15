/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Credentials } from 'google-auth-library';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { OAuthCredentialStorage } from './oauth-credential-storage.js';
import { HybridTokenStorage } from '../mcp/token-storage/hybrid-token-storage.js';
import type { OAuthCredentials } from '../mcp/token-storage/types.js';
import { Storage } from '../config/storage.js';
import { coreEvents } from '../utils/events.js';

import * as path from 'node:path';
import { promises as fs } from 'node:fs';

const mockHomedir = vi.hoisted(() => vi.fn(() => '/mock/home'));
vi.mock('node:os', () => ({
  homedir: mockHomedir,
}));

// Mock external dependencies
vi.mock('../mcp/token-storage/hybrid-token-storage.js');
vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
    rm: vi.fn(),
  },
}));
vi.mock('../utils/events.js', () => ({
  coreEvents: {
    emitFeedback: vi.fn(),
  },
}));

describe('OAuthCredentialStorage', () => {
  let storage: HybridTokenStorage;
  let oauthStorage: OAuthCredentialStorage;

  const mockCredentials: Credentials = {
    access_token: 'mock_access_token',
    refresh_token: 'mock_refresh_token',
    expiry_date: Date.now() + 3600 * 1000,
    token_type: 'Bearer',
    scope: 'email profile',
  };

  const mockMcpCredentials: OAuthCredentials = {
    serverName: 'main-account',
    token: {
      accessToken: 'mock_access_token',
      refreshToken: 'mock_refresh_token',
      tokenType: 'Bearer',
      scope: 'email profile',
      expiresAt: mockCredentials.expiry_date!,
    },
    updatedAt: expect.any(Number),
  };

  const llxprtFilePath = path.join('/mock/home', '.llxprt', 'oauth_creds.json');
  const geminiFilePath = path.join('/mock/home', '.gemini', 'oauth_creds.json');
  const createEnoentError = () => {
    const error = new Error('File not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    return error;
  };

  beforeEach(() => {
    storage = new HybridTokenStorage('');
    oauthStorage = new OAuthCredentialStorage(storage);

    vi.spyOn(storage, 'getCredentials').mockResolvedValue(null);
    vi.spyOn(storage, 'setCredentials').mockResolvedValue(undefined);
    vi.spyOn(storage, 'deleteCredentials').mockResolvedValue(undefined);

    vi.spyOn(fs, 'readFile').mockRejectedValue(createEnoentError());
    vi.spyOn(fs, 'rm').mockResolvedValue(undefined);

    vi.spyOn(Storage, 'getOAuthCredsPath').mockReturnValue(llxprtFilePath);
    mockHomedir.mockReturnValue('/mock/home');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadCredentials', () => {
    it('should load credentials from HybridTokenStorage if available', async () => {
      vi.spyOn(storage, 'getCredentials').mockResolvedValue(mockMcpCredentials);

      const result = await oauthStorage.loadCredentials();

      expect(storage.getCredentials).toHaveBeenCalledWith('main-account');
      expect(result).toEqual(mockCredentials);
    });

    it('should fallback to migrateFromFileStorage if no credentials in HybridTokenStorage', async () => {
      vi.spyOn(storage, 'getCredentials').mockResolvedValue(null);
      vi.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify(mockCredentials),
      );

      const result = await oauthStorage.loadCredentials();

      expect(storage.getCredentials).toHaveBeenCalledWith('main-account');
      expect(fs.readFile).toHaveBeenCalledWith(llxprtFilePath, 'utf-8');
      expect(storage.setCredentials).toHaveBeenCalled(); // Verify credentials were saved
      expect(fs.rm).toHaveBeenCalledWith(llxprtFilePath, { force: true }); // Verify old file was removed
      expect(result).toEqual(mockCredentials);
    });

    it('should migrate from legacy .gemini path when llxprt file is missing', async () => {
      vi.spyOn(storage, 'getCredentials').mockResolvedValue(null);

      (fs.readFile as unknown as Mock).mockImplementation(
        async (filePath: string) => {
          if (filePath === llxprtFilePath) {
            throw createEnoentError();
          }
          if (filePath === geminiFilePath) {
            return JSON.stringify(mockCredentials);
          }
          throw new Error(`Unexpected path ${filePath}`);
        },
      );

      const result = await oauthStorage.loadCredentials();

      expect(fs.readFile).toHaveBeenCalledWith(llxprtFilePath, 'utf-8');
      expect(fs.readFile).toHaveBeenCalledWith(geminiFilePath, 'utf-8');
      expect(storage.setCredentials).toHaveBeenCalled();
      expect(fs.rm).toHaveBeenCalledWith(geminiFilePath, { force: true });
      expect(result).toEqual(mockCredentials);
    });

    it('should return null if no credentials found and no old file to migrate', async () => {
      vi.spyOn(fs, 'readFile').mockRejectedValue({
        message: 'File not found',
        code: 'ENOENT',
      });

      const result = await oauthStorage.loadCredentials();

      expect(result).toBeNull();
    });

    it('should throw an error if loading fails', async () => {
      const mockError = new Error('HybridTokenStorage error');
      vi.spyOn(storage, 'getCredentials').mockRejectedValue(mockError);

      await expect(oauthStorage.loadCredentials()).rejects.toThrow(
        'HybridTokenStorage error',
      );
      expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
        'error',
        'Failed to load OAuth credentials',
        mockError,
      );
    });

    it('should throw an error if read file fails', async () => {
      const mockError = new Error('Permission denied');
      vi.spyOn(storage, 'getCredentials').mockResolvedValue(null);
      vi.spyOn(fs, 'readFile').mockRejectedValue(mockError);

      await expect(oauthStorage.loadCredentials()).rejects.toThrow(
        'Permission denied',
      );
      expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
        'error',
        'Failed to load OAuth credentials',
        mockError,
      );
    });

    it('should not throw error if migration file removal failed', async () => {
      vi.spyOn(storage, 'getCredentials').mockResolvedValue(null);
      vi.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify(mockCredentials),
      );
      vi.spyOn(oauthStorage, 'saveCredentials').mockResolvedValue(undefined);
      vi.spyOn(fs, 'rm').mockRejectedValue(new Error('Deletion failed'));

      const result = await oauthStorage.loadCredentials();

      expect(result).toEqual(mockCredentials);
    });
  });

  describe('saveCredentials', () => {
    it('should save credentials to HybridTokenStorage', async () => {
      await oauthStorage.saveCredentials(mockCredentials);

      expect(storage.setCredentials).toHaveBeenCalledWith(mockMcpCredentials);
    });

    it('should throw an error if access_token is missing', async () => {
      const invalidCredentials: Credentials = {
        ...mockCredentials,
        access_token: undefined,
      };
      await expect(
        oauthStorage.saveCredentials(invalidCredentials),
      ).rejects.toThrow(
        'Attempted to save credentials without an access token.',
      );
    });
  });

  describe('clearCredentials', () => {
    it('should delete credentials from HybridTokenStorage', async () => {
      await oauthStorage.clearCredentials();

      expect(storage.deleteCredentials).toHaveBeenCalledWith('main-account');
    });

    it('should attempt to remove the old file-based storage', async () => {
      await oauthStorage.clearCredentials();

      expect(fs.rm).toHaveBeenCalledWith(llxprtFilePath, { force: true });
      expect(fs.rm).toHaveBeenCalledWith(geminiFilePath, { force: true });
    });

    it('should not throw an error if deleting old file fails', async () => {
      vi.spyOn(fs, 'rm').mockRejectedValue(new Error('File deletion failed'));

      await expect(oauthStorage.clearCredentials()).resolves.toBeUndefined();
    });

    it('should throw an error if clearing from HybridTokenStorage fails', async () => {
      const mockError = new Error('Deletion error');
      vi.spyOn(storage, 'deleteCredentials').mockRejectedValue(mockError);

      await expect(oauthStorage.clearCredentials()).rejects.toThrow(
        'Deletion error',
      );
      expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
        'error',
        'Failed to clear OAuth credentials',
        mockError,
      );
    });
  });
});
