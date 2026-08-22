/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  verifyCompiledLazyMcpCoherence,
  verifySourceLazyMcpCoherence,
} from '../verify-lazy-mcp-build-coherence.ts';

describe('lazy-MCP build coherence', () => {
  it('synchronizes activation against a real deferred source registry', async () => {
    await expect(verifySourceLazyMcpCoherence()).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'terminates and diagnoses a compiled check that exceeds its deadline',
    () => {
      const binDir = mkdtempSync(join(tmpdir(), 'lazy-mcp-node-'));
      const nodePath = join(binDir, 'node');
      writeFileSync(nodePath, '#!/bin/sh\nexec sleep 5\n');
      chmodSync(nodePath, 0o755);
      const originalPath = process.env.PATH;
      process.env.PATH = `${binDir}${delimiter}${originalPath ?? ''}`;

      try {
        expect(() => verifyCompiledLazyMcpCoherence(process.cwd(), 50)).toThrow(
          /timed out after 50 ms.*signal SIGTERM/,
        );
      } finally {
        if (originalPath === undefined) {
          delete process.env.PATH;
        } else {
          process.env.PATH = originalPath;
        }
        rmSync(binDir, { recursive: true, force: true });
      }
    },
  );
});
