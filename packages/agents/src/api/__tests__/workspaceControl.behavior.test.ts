/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P04
 *
 * BEHAVIORAL RED suite for the `agent.workspace` sub-controller
 * (AgentWorkspaceControl). Drives through the PUBLIC ROOT via the buildAgent
 * harness over a real FakeProvider. The REAL WorkspaceContext is reached
 * through Config with ZERO mocking.
 *
 * At GREEN: `agent.workspace` is wired through the real WorkspaceControl
 * delegation, so every positive case exercises the bound WorkspaceContext.
 */

import { describe, it, expect } from 'vitest';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgent } from './helpers/agentHarness.js';

const HARNESS_DIR = fileURLToPath(new URL('./', import.meta.url));
const API_DIR = resolve(HARNESS_DIR, '..');

describe('agent.workspace control @plan:PLAN-20260626-RUNTIMEBOUNDARY.P04', () => {
  it('getDirectories returns an array containing the working directory @scenario:get-directories @given:an agent built with workingDir @when:agent.workspace.getDirectories() @then:the result is a non-empty array', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      workingDir: API_DIR,
    });
    try {
      const dirs = agent.workspace.getDirectories();
      expect(Array.isArray(dirs)).toBe(true);
      expect(dirs.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanup();
    }
  });

  it('getWorkingDirectory returns a string path @scenario:get-working-dir @given:an agent built normally @when:agent.workspace.getWorkingDirectory() @then:the result is a non-empty string', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      workingDir: API_DIR,
    });
    try {
      const cwd = agent.workspace.getWorkingDirectory();
      expect(typeof cwd).toBe('string');
      expect(cwd.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  it('addDirectory adds a distinct realpath-resolved directory to the workspace @scenario:add-directory @given:an agent built with workingDir @when:agent.workspace.addDirectory(extraDir) then getDirectories() @then:getDirectories() contains the realpath of extraDir', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      workingDir: API_DIR,
    });
    try {
      const extraDir = resolve(API_DIR, '..', '..');
      agent.workspace.addDirectory(extraDir);
      const dirs = agent.workspace.getDirectories();
      expect(dirs).toContain(realpathSync(extraDir));
    } finally {
      await cleanup();
    }
  });

  it('adding an invalid directory leaves the workspace directory set unchanged @scenario:add-invalid-directory @given:an agent built with workingDir @when:agent.workspace.addDirectory(missingDir) @then:getDirectories() is unchanged', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      workingDir: API_DIR,
    });
    try {
      const before = agent.workspace.getDirectories();
      expect(() =>
        agent.workspace.addDirectory(
          resolve(API_DIR, 'definitely-missing-dir'),
        ),
      ).not.toThrow();
      expect(agent.workspace.getDirectories()).toStrictEqual(before);
    } finally {
      await cleanup();
    }
  });

  it('adding the working directory again is a no-op @scenario:add-duplicate-directory @given:an agent built with workingDir @when:agent.workspace.addDirectory(API_DIR) @then:getDirectories() length does not increase', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      workingDir: API_DIR,
    });
    try {
      const before = agent.workspace.getDirectories();
      agent.workspace.addDirectory(API_DIR);
      expect(agent.workspace.getDirectories()).toStrictEqual(before);
    } finally {
      await cleanup();
    }
  });

  it('getProjectRoot returns the configured working directory @scenario:get-project-root @given:an agent built with workingDir @when:agent.workspace.getProjectRoot() @then:the result matches workingDir', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      workingDir: API_DIR,
    });
    try {
      expect(agent.workspace.getProjectRoot()).toBe(API_DIR);
    } finally {
      await cleanup();
    }
  });
});
