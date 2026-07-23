/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  MemoryTool,
  DEFAULT_CONTEXT_FILENAME,
} from '@vybestack/llxprt-code-tools';
import { loadGlobalMemory } from './memoryDiscovery.js';
import { coreStorageServiceAdapter } from '../tools-adapters/CoreStorageServiceAdapter.js';

/**
 * Cross-component regression: a memory saved through the production
 * MemoryTool (using the shared CoreStorageServiceAdapter) must be visible to
 * loadGlobalMemory on the next read. This is the exact regression from P5 —
 * "a memory saved through the production tool can be absent from the next
 * session" — caused by the writer and reader disagreeing on the directory.
 *
 * This test exercises the actual production factory/adapter path resolution:
 * it constructs a real MemoryTool wired with the shared
 * CoreStorageServiceAdapter (the same instance toolRegistryFactory injects)
 * and drives the tool's own path resolution, rather than manually supplying
 * a path. This proves the writer and reader agree end-to-end.
 */
describe('global memory cross-component round trip (P5 regression)', () => {
  let root = '';
  let configDir = '';
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-mem-rt-'));
    configDir = path.join(root, 'config');
    await fs.mkdir(configDir, { recursive: true });
    for (const key of [
      'LLXPRT_CONFIG_HOME',
      'LLXPRT_DATA_HOME',
      'LLXPRT_CACHE_HOME',
      'LLXPRT_LOG_HOME',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env['LLXPRT_CONFIG_HOME'] = configDir;
    delete process.env['LLXPRT_DATA_HOME'];
    delete process.env['LLXPRT_CACHE_HOME'];
    delete process.env['LLXPRT_LOG_HOME'];
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('a memory saved via the production MemoryTool (global scope) is returned by loadGlobalMemory', async () => {
    // The shared adapter resolves the config-category dir, identical to what
    // production wires into the MemoryTool at toolRegistryFactory.
    expect(coreStorageServiceAdapter.getGlobalMemoryDir()).toBe(
      Storage.getGlobalMemoryDir(),
    );
    expect(coreStorageServiceAdapter.getGlobalMemoryDir()).toBe(configDir);

    // Construct the production MemoryTool with the shared adapter — the same
    // wiring toolRegistryFactory uses — so the tool resolves the global
    // memory path itself rather than the test supplying a path.
    const tool = new MemoryTool({
      storageService: coreStorageServiceAdapter,
      getWorkingDir: () => root,
    });

    // Drive the tool to write a memory entry at its OWN resolved global path.
    const result = await tool.execute({
      fact: 'The user prefers dark mode.',
      scope: 'global',
    });
    expect(result.error).toBeUndefined();

    // The file must land at the path the production tool computes from the
    // adapter, NOT a path the test invented.
    const expectedPath = path.join(configDir, DEFAULT_CONTEXT_FILENAME);
    expect(
      await fs
        .access(expectedPath)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);
    const written = await fs.readFile(expectedPath, 'utf-8');
    expect(written).toContain('The user prefers dark mode.');

    // Now read it back through the production memory loader.
    const loaded = await loadGlobalMemory(false);

    expect(loaded.files).toHaveLength(1);
    expect(loaded.files[0].content).toContain('The user prefers dark mode.');
    // The file must be under the config dir, not data or legacy home.
    expect(loaded.files[0].path).toBe(expectedPath);
  });
});
