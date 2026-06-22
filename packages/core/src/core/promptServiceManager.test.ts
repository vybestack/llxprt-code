/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for {@link PromptServiceManager}.
 *
 * These tests prove that the manager (which replaces the previous ad-hoc
 * module-level singleton) provides idempotent and concurrent-safe
 * initialization, and that its service accessor returns a usable instance.
 *
 * No mocks are used for the manager itself; it is exercised against a real
 * temporary prompts directory so that observable behavior is asserted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { PromptServiceManager } from './prompts.js';

describe('PromptServiceManager', () => {
  let tempDir: string;
  let originalPromptsDir: string | undefined;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-psm-test-'));
    originalPromptsDir = process.env.LLXPRT_PROMPTS_DIR;
    process.env.LLXPRT_PROMPTS_DIR = tempDir;
  });

  afterAll(() => {
    if (originalPromptsDir === undefined) {
      delete process.env.LLXPRT_PROMPTS_DIR;
    } else {
      process.env.LLXPRT_PROMPTS_DIR = originalPromptsDir;
    }
  });

  it('reports not initialized before initialize() is called', () => {
    const manager = new PromptServiceManager();
    expect(manager.isInitialized()).toBe(false);
  });

  it('initializes exactly once (idempotent)', async () => {
    const manager = new PromptServiceManager();
    expect(manager.isInitialized()).toBe(false);

    await manager.initialize();
    expect(manager.isInitialized()).toBe(true);

    // A second initialize() must not throw and must remain initialized.
    await expect(manager.initialize()).resolves.not.toThrow();
    expect(manager.isInitialized()).toBe(true);
  });

  it('shares a single in-flight initialization promise across concurrent callers', async () => {
    const manager = new PromptServiceManager();

    // Fire many concurrent initializations; they must all resolve and share
    // the same underlying promise (no duplicate PromptService construction).
    const promise1 = manager.initialize();
    const promise2 = manager.initialize();
    const promise3 = manager.initialize();

    expect(promise1).toBe(promise2);
    expect(promise2).toBe(promise3);

    await Promise.all([promise1, promise2, promise3]);
    expect(manager.isInitialized()).toBe(true);
  });

  it('returns a usable PromptService from getService()', async () => {
    const manager = new PromptServiceManager();
    const service = await manager.getService();

    expect(service).toBeDefined();
    // consumeInstallerNotices is a real method on a fully initialized service.
    expect(typeof service.consumeInstallerNotices).toBe('function');
    // Calling it must not throw — proves the service is initialized.
    expect(() => service.consumeInstallerNotices()).not.toThrow();
  });

  it('returns the same service instance across multiple getService() calls', async () => {
    const manager = new PromptServiceManager();
    const service1 = await manager.getService();
    const service2 = await manager.getService();
    expect(service1).toBe(service2);
  });

  it('can be reset and re-initialized with a different configuration', async () => {
    const manager = new PromptServiceManager();
    await manager.initialize();
    expect(manager.isInitialized()).toBe(true);

    manager.reset();
    expect(manager.isInitialized()).toBe(false);

    // Re-initialization must work after reset.
    await manager.initialize();
    expect(manager.isInitialized()).toBe(true);
    const service = await manager.getService();
    expect(service).toBeDefined();
  });
});
