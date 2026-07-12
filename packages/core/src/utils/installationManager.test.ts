/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Mock } from 'vitest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InstallationManager } from './installationManager.js';
import * as debugLoggerModule from './debugLogger.js';
import * as fs from 'node:fs';
import * as actualFs from 'node:fs';
import * as os from 'node:os';
import * as actualOs from 'node:os';
import path from 'node:path';
import { randomUUID } from 'crypto';
import * as actualCrypto from 'node:crypto';
import { Storage } from '@vybestack/llxprt-code-settings';

vi.mock('node:fs', () => ({
  ...actualFs,
  readFileSync: vi.fn(actualFs.readFileSync),
  existsSync: vi.fn(actualFs.existsSync),
}));

vi.mock('os', () => ({
  ...actualOs,
  homedir: vi.fn(),
}));

vi.mock('crypto', () => ({
  ...actualCrypto,
  randomUUID: vi.fn(),
}));

describe('InstallationManager', () => {
  let tempHomeDir: string;
  let installationManager: InstallationManager;
  const installationIdFile = () =>
    path.join(tempHomeDir, '.llxprt', 'installation_id');

  beforeEach(() => {
    tempHomeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-code-test-home-'),
    );
    (os.homedir as Mock).mockReturnValue(tempHomeDir);
    vi.spyOn(Storage, 'getInstallationIdPath').mockImplementation(() =>
      installationIdFile(),
    );
    installationManager = new InstallationManager();
  });

  afterEach(() => {
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('getInstallationId', () => {
    it('should create and write a new installation ID if one does not exist', () => {
      const newId = 'new-uuid-123';
      (randomUUID as Mock).mockReturnValue(newId);

      const installationId = installationManager.getInstallationId();

      expect(installationId).toBe(newId);
      expect(fs.existsSync(installationIdFile())).toBe(true);
      expect(fs.readFileSync(installationIdFile(), 'utf-8')).toBe(newId);
    });

    it('should read an existing installation ID from a file', () => {
      const existingId = 'existing-uuid-123';
      fs.mkdirSync(path.dirname(installationIdFile()), { recursive: true });
      fs.writeFileSync(installationIdFile(), existingId);

      const installationId = installationManager.getInstallationId();

      expect(installationId).toBe(existingId);
    });

    it('should return the same ID on subsequent calls', () => {
      const firstId = installationManager.getInstallationId();
      const secondId = installationManager.getInstallationId();
      expect(secondId).toBe(firstId);
    });

    it('should handle read errors and return a fallback ID', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true);
      const readSpy = vi.mocked(fs.readFileSync);
      readSpy.mockImplementationOnce(() => {
        throw new Error('Read error');
      });
      const debugErrorSpy = vi
        .spyOn(debugLoggerModule.debugLogger, 'error')
        .mockImplementation(() => {});

      const id = installationManager.getInstallationId();

      expect(id).toBe('123456789');
      expect(debugErrorSpy).toHaveBeenCalled();
    });
  });
});
