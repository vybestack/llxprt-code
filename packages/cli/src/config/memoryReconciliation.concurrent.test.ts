/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  reconcileGlobalMemory,
  MEMORY_RECONCILE_MARKER_FILE,
} from './memoryReconciliation.js';
import type { MigrationDestinations } from './migrationTypes.js';

/**
 * Tests for Findings #1 (memory lost-update) and #8 (zero-byte memory source).
 * Extracted from memoryReconciliation.test.ts to stay within the file size
 * limit. Uses the same temp-dir setup/teardown as the main suite.
 */
describe('reconcileGlobalMemory: concurrent and edge cases', () => {
  let root: string;
  let configDir: string;
  let dataDir: string;
  let destinations: MigrationDestinations;

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-memreconcile-cc-'),
    );
    configDir = path.join(root, 'config');
    dataDir = path.join(root, 'data');
    await fs.promises.mkdir(configDir, { recursive: true });
    await fs.promises.mkdir(dataDir, { recursive: true });
    destinations = {
      configDir,
      dataDir,
      cacheDir: path.join(root, 'cache'),
      logDir: path.join(root, 'log'),
    };
  });

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  // ─── Memory lost-update (#1) ────────────────────────────────────────────

  describe('memory lost-update: optimistic revalidation (Finding #1)', () => {
    it('preserves a concurrent MemoryTool write that lands between reconciliation read and publish', async () => {
      // Setup: data has content, config has content. Reconciliation reads
      // config, then the hook writes a NEW fact to config (simulating a
      // concurrent MemoryTool global write), then reconciliation publishes.
      // Without optimistic revalidation, the rename would clobber the
      // concurrent write. With revalidation, both the reconciled data content
      // AND the concurrent write survive.
      await fs.promises.writeFile(
        path.join(configDir, 'LLXPRT.md'),
        'config original',
      );
      await fs.promises.writeFile(
        path.join(dataDir, 'LLXPRT.md'),
        'data to reconcile',
      );

      let hookCallCount = 0;
      const result = reconcileGlobalMemory(destinations, {
        onBeforeConfigPublish: (configPath) => {
          hookCallCount += 1;
          // Simulate a concurrent MemoryTool write: append a new fact to
          // the canonical config AFTER reconciliation read it but BEFORE it
          // publishes. Each invocation appends so multi-file reconciliation
          // paths are covered.
          const current = fs.readFileSync(configPath, 'utf8');
          fs.writeFileSync(
            configPath,
            current + '\n- Concurrent memory fact #' + hookCallCount + '\n',
          );
        },
      });

      expect(result.error).not.toBe(true);
      expect(hookCallCount).toBeGreaterThan(0);
      const finalConfig = await fs.promises.readFile(
        path.join(configDir, 'LLXPRT.md'),
        'utf8',
      );
      // The concurrent write survived.
      expect(finalConfig).toContain('Concurrent memory fact');
      // The reconciled data content also survived.
      expect(finalConfig).toContain('data to reconcile');
      // The original config content survived.
      expect(finalConfig).toContain('config original');
    });

    it('preserves a concurrent write even on the zero-byte reconcile path', async () => {
      // An empty source triggers the zero-byte reconcile path which creates
      // an empty canonical. If a concurrent write lands between the existence
      // check and the publish, it must survive.
      await fs.promises.writeFile(path.join(dataDir, 'LLXPRT.md'), '');

      let hookCalled = false;
      const result = reconcileGlobalMemory(destinations, {
        onBeforeConfigPublish: () => {
          if (!hookCalled) {
            hookCalled = true;
            // Simulate a concurrent MemoryTool write before the empty
            // canonical is created.
            fs.writeFileSync(
              path.join(configDir, 'LLXPRT.md'),
              'concurrent non-empty content\n',
            );
          }
        },
      });

      expect(result.error).not.toBe(true);
      // The concurrent write survived — the zero-byte path detected the
      // canonical already existed (non-empty) and did NOT overwrite it.
      const finalConfig = await fs.promises.readFile(
        path.join(configDir, 'LLXPRT.md'),
        'utf8',
      );
      expect(finalConfig).toContain('concurrent non-empty content');
    });
  });

  // ─── Zero-byte memory source (#8) ───────────────────────────────────────

  describe('zero-byte memory source (Finding #8)', () => {
    it('archives an empty source file and creates an empty canonical when absent, marker converges', async () => {
      // An empty (0-byte) source file under <data> must be reconciled:
      // archived (renamed) and, when the canonical config does not exist,
      // an empty canonical file created so the marker converges.
      const dataFile = path.join(dataDir, 'LLXPRT.md');
      await fs.promises.writeFile(dataFile, '');

      const result = reconcileGlobalMemory(destinations);

      expect(result.error).not.toBe(true);
      // Source was archived (not left in place, not deleted).
      const archive = dataFile + '.migrated-to-config';
      expect(await fs.promises.readFile(archive, 'utf8')).toBe('');
      await expect(fs.promises.access(dataFile)).rejects.toThrow('ENOENT');
      // An empty canonical file was created so the marker converges.
      const configFile = path.join(configDir, 'LLXPRT.md');
      expect(await fs.promises.readFile(configFile, 'utf8')).toBe('');
      // Marker converges: it was written.
      await expect(
        fs.promises.access(path.join(dataDir, MEMORY_RECONCILE_MARKER_FILE)),
      ).resolves.toBeUndefined();
    });

    it('archives an empty source but preserves existing canonical content (no destructive overwrite)', async () => {
      // When the canonical config already has content, an empty source is
      // archived but the existing canonical content is preserved (not
      // overwritten with empty content).
      await fs.promises.writeFile(
        path.join(configDir, 'LLXPRT.md'),
        'existing config content',
      );
      await fs.promises.writeFile(path.join(dataDir, 'LLXPRT.md'), '');

      const result = reconcileGlobalMemory(destinations);

      expect(result.error).not.toBe(true);
      // Existing canonical content preserved.
      expect(
        await fs.promises.readFile(path.join(configDir, 'LLXPRT.md'), 'utf8'),
      ).toBe('existing config content');
      // Source archived.
      const archive = path.join(dataDir, 'LLXPRT.md.migrated-to-config');
      expect(await fs.promises.readFile(archive, 'utf8')).toBe('');
      await expect(
        fs.promises.access(path.join(dataDir, 'LLXPRT.md')),
      ).rejects.toThrow('ENOENT');
    });

    it('empty .LLXPRT_SYSTEM source is also reconciled and archived', async () => {
      await fs.promises.writeFile(path.join(dataDir, '.LLXPRT_SYSTEM'), '');

      const result = reconcileGlobalMemory(destinations);

      expect(result.error).not.toBe(true);
      const archive = path.join(dataDir, '.LLXPRT_SYSTEM.migrated-to-config');
      expect(await fs.promises.readFile(archive, 'utf8')).toBe('');
      await expect(
        fs.promises.access(path.join(dataDir, '.LLXPRT_SYSTEM')),
      ).rejects.toThrow('ENOENT');
      expect(
        await fs.promises.readFile(
          path.join(configDir, '.LLXPRT_SYSTEM'),
          'utf8',
        ),
      ).toBe('');
    });
  });

  // ─── Sustained contention (retry exhaustion must not best-effort overwrite) ─

  describe('sustained contention defers without overwriting (Finding #3)', () => {
    it('preserves source and config when reconciliation encounters contention', async () => {
      // When a concurrent write modifies the config during reconciliation,
      // the optimistic revalidation ensures the concurrent write survives.
      // This test verifies the behavioral contract: the source is either
      // reconciled (archived) OR preserved (on error), but never lost.
      // The concurrent write must also survive in the config.
      const configContent = 'original config';
      const dataContent = 'data to reconcile';
      await fs.promises.writeFile(
        path.join(configDir, 'LLXPRT.md'),
        configContent,
      );
      await fs.promises.writeFile(path.join(dataDir, 'LLXPRT.md'), dataContent);

      let hookCount = 0;
      const result = reconcileGlobalMemory(destinations, {
        onBeforeConfigPublish: (configPath) => {
          hookCount += 1;
          // Write a unique concurrent fact on every invocation.
          const current = fs.readFileSync(configPath, 'utf8');
          fs.writeFileSync(
            configPath,
            current + '\n- Concurrent fact #' + hookCount + '\n',
          );
        },
      });

      // The reconciliation either succeeds (with concurrent write preserved)
      // or defers (on sustained contention). In either case, the concurrent
      // write must survive and the source must not be silently lost.
      expect(hookCount).toBeGreaterThan(0);
      const finalConfig = await fs.promises.readFile(
        path.join(configDir, 'LLXPRT.md'),
        'utf8',
      );
      // The reconciliation succeeded: the concurrent write was preserved
      // (merged with the data content), and the source was archived.
      expect(result.migrated).toBe(true);
      expect(finalConfig).toContain('Concurrent fact #1');
      expect(finalConfig).toContain(dataContent);
      // Source was archived.
      await expect(
        fs.promises.access(path.join(dataDir, 'LLXPRT.md')),
      ).rejects.toThrow('ENOENT');
    });
  });
});
