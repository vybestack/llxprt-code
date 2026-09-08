/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCredentialSocketRuntime } from './sandbox-credential-runtime.js';

describe('credential proxy sandbox integration', () => {
  it.skipIf(process.platform === 'win32')(
    'uses a separate short private credential runtime for Darwin Podman sessions',
    () => {
      const sessionTmpdir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'proxy-integration-session-'),
      );
      const platformSpy = vi.spyOn(os, 'platform').mockReturnValue('darwin');
      const runtime = createCredentialSocketRuntime(
        { command: 'podman', image: 'test' },
        sessionTmpdir,
      );

      try {
        expect(runtime.path).not.toBe(sessionTmpdir);
        expect(runtime.path.startsWith('/tmp/lx-')).toBe(true);
        expect(fs.statSync(runtime.path).mode & 0o777).toBe(0o700);
      } finally {
        runtime.cleanup();
        platformSpy.mockRestore();
        fs.rmSync(sessionTmpdir, { recursive: true, force: true });
      }
      expect(fs.existsSync(runtime.path)).toBe(false);
    },
  );
});
