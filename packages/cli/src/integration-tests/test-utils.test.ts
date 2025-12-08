/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Profile } from '@vybestack/llxprt-code-core';
import {
  createTempDirectory,
  cleanupTempDirectory,
  createTempProfile,
  createTempKeyfile,
  readSettingsFile,
  writeSettingsFile,
  waitForFile,
  createMockApiServer,
} from './test-utils.js';

describe('Test Utilities', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    // Clean up all temp directories created during tests
    for (const dir of tempDirs) {
      await cleanupTempDirectory(dir);
    }
    tempDirs.length = 0;
  });

  describe('createTempDirectory', () => {
    it('should create a temporary directory', async () => {
      const dir = await createTempDirectory();
      tempDirs.push(dir);

      expect(dir).toMatch(/llxprt-test-/);

      const stats = await fs.stat(dir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create unique directories on multiple calls', async () => {
      const dir1 = await createTempDirectory();
      const dir2 = await createTempDirectory();
      tempDirs.push(dir1, dir2);

      expect(dir1).not.toBe(dir2);

      const stats1 = await fs.stat(dir1);
      const stats2 = await fs.stat(dir2);
      expect(stats1.isDirectory()).toBe(true);
      expect(stats2.isDirectory()).toBe(true);
    });
  });

  describe('cleanupTempDirectory', () => {
    it('should remove directory and all contents', async () => {
      const dir = await createTempDirectory();

      // Create some files in the directory
      await fs.writeFile(path.join(dir, 'test.txt'), 'content');
      await fs.mkdir(path.join(dir, 'subdir'));
      await fs.writeFile(path.join(dir, 'subdir', 'nested.txt'), 'nested');

      await cleanupTempDirectory(dir);

      // Directory should no longer exist
      await expect(fs.access(dir)).rejects.toThrow();
    });

    it('should not throw if directory does not exist', async () => {
      await expect(
        cleanupTempDirectory('/non/existent/path'),
      ).resolves.not.toThrow();
    });
  });

  describe('createTempProfile', () => {
    it('should create a profile file in the correct location', async () => {
      const dir = await createTempDirectory();
      tempDirs.push(dir);

      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: { temperature: 0.7 },
        ephemeralSettings: { 'context-limit': 32000 },
      };

      await createTempProfile(dir, 'test-profile', profile);

      const profilePath = path.join(
        dir,
        '.llxprt',
        'profiles',
        'test-profile.json',
      );
      const content = await fs.readFile(profilePath, 'utf8');
      const savedProfile = JSON.parse(content);

      expect(savedProfile).toEqual(profile);
    });
  });

  describe('createTempKeyfile', () => {
    it.skipIf(process.platform === 'win32')(
      'should create a keyfile with correct permissions on Unix',
      async () => {
        const dir = await createTempDirectory();
        tempDirs.push(dir);

        const apiKey = 'test-api-key-12345';
        const keyfilePath = await createTempKeyfile(dir, apiKey);

        expect(keyfilePath).toBe(path.join(dir, '.keys', 'api-key'));

        const content = await fs.readFile(keyfilePath, 'utf8');
        expect(content).toBe(apiKey);

        const stats = await fs.stat(keyfilePath);
        // Check that only owner can read/write (600)
        expect(stats.mode & 0o777).toBe(0o600);
      },
    );

    it.skipIf(process.platform !== 'win32')(
      'should create a keyfile with correct permissions on Windows',
      async () => {
        const dir = await createTempDirectory();
        tempDirs.push(dir);

        const apiKey = 'test-api-key-12345';
        const keyfilePath = await createTempKeyfile(dir, apiKey);

        expect(keyfilePath).toBe(path.join(dir, '.keys', 'api-key'));

        const content = await fs.readFile(keyfilePath, 'utf8');
        expect(content).toBe(apiKey);

        const stats = await fs.stat(keyfilePath);
        // On Windows, permissions work differently
        expect(stats.mode & 0o777).toBe(0o666);
      },
    );
  });

  describe('readSettingsFile', () => {
    it('should read and parse settings file', async () => {
      const dir = await createTempDirectory();
      tempDirs.push(dir);

      const settings = {
        provider: 'openai',
        model: 'gpt-4',
        'context-limit': 32000,
      };

      await writeSettingsFile(dir, settings);

      const readSettings = await readSettingsFile(dir);
      expect(readSettings).toEqual(settings);
    });

    it('should return empty object if settings file does not exist', async () => {
      const dir = await createTempDirectory();
      tempDirs.push(dir);

      const settings = await readSettingsFile(dir);
      expect(settings).toEqual({});
    });
  });

  describe('writeSettingsFile', () => {
    it('should write settings file with proper formatting', async () => {
      const dir = await createTempDirectory();
      tempDirs.push(dir);

      const settings = {
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        modelParams: {
          temperature: 0.5,
          max_tokens: 4096,
        },
      };

      await writeSettingsFile(dir, settings);

      const settingsPath = path.join(dir, '.llxprt', 'settings.json');
      const content = await fs.readFile(settingsPath, 'utf8');
      const parsedSettings = JSON.parse(content);

      expect(parsedSettings).toEqual(settings);
      // Check formatting (2 spaces)
      expect(content).toContain('  "provider"');
    });
  });

  describe('waitForFile', () => {
    it('should resolve immediately if file exists', async () => {
      const dir = await createTempDirectory();
      tempDirs.push(dir);

      const filePath = path.join(dir, 'existing.txt');
      await fs.writeFile(filePath, 'content');

      const start = Date.now();
      await waitForFile(filePath, 1000);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(200); // Should be nearly instant
    });

    it('should wait for file to be created', async () => {
      const dir = await createTempDirectory();
      tempDirs.push(dir);

      const filePath = path.join(dir, 'delayed.txt');

      // Create file after a delay
      setTimeout(() => {
        void fs.writeFile(filePath, 'content');
      }, 200);

      const start = Date.now();
      await waitForFile(filePath, 1000);
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(200);
      expect(duration).toBeLessThan(600);
    });

    it('should timeout if file is not created', async () => {
      const dir = await createTempDirectory();
      tempDirs.push(dir);

      const filePath = path.join(dir, 'missing.txt');

      await expect(waitForFile(filePath, 500)).rejects.toThrow(
        `Timeout waiting for file: ${filePath}`,
      );
    });
  });

  describe('createMockApiServer', () => {
    it('should create HTTP server and log requests', async () => {
      const mockServer = await createMockApiServer();

      try {
        expect(mockServer.port).toBeGreaterThan(0);
        expect(mockServer.requests).toHaveLength(0);

        // Make a test request
        const response = await fetch(
          `http://127.0.0.1:${mockServer.port}/test-endpoint`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer test-token',
            },
            body: JSON.stringify({ test: 'data' }),
          },
        );

        const responseData = await response.json();
        expect(responseData).toMatchObject({
          id: 'mock-chat-completion',
          object: 'chat.completion',
          model: expect.any(String),
        });

        // Check logged request
        expect(mockServer.requests).toHaveLength(1);
        const request = mockServer.requests[0];
        expect(request.method).toBe('POST');
        expect(request.url).toBe('/test-endpoint');
        expect(request.headers['content-type']).toBe('application/json');
        expect(request.headers['authorization']).toBe('Bearer test-token');
        expect(request.body).toBe('{"test":"data"}');
      } finally {
        await mockServer.close();
      }
    });

    it('should handle multiple requests', async () => {
      const mockServer = await createMockApiServer();

      try {
        // Make multiple requests
        await fetch(`http://127.0.0.1:${mockServer.port}/first`);
        await fetch(`http://127.0.0.1:${mockServer.port}/second`, {
          method: 'PUT',
        });
        await fetch(`http://127.0.0.1:${mockServer.port}/third`, {
          method: 'DELETE',
        });

        expect(mockServer.requests).toHaveLength(3);
        expect(mockServer.requests[0].url).toBe('/first');
        expect(mockServer.requests[1].url).toBe('/second');
        expect(mockServer.requests[1].method).toBe('PUT');
        expect(mockServer.requests[2].url).toBe('/third');
        expect(mockServer.requests[2].method).toBe('DELETE');
      } finally {
        await mockServer.close();
      }
    });
  });
});
