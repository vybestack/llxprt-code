/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the shared prompt memory-derivation policy
 * (issue #3173). The policy is consumed by both the main-agent and subagent
 * system-prompt builders so that JIT memory sourcing is identical across
 * execution contexts.
 *
 * These tests assert actual resolved values (user memory, core memory, MCP
 * instructions, and the working-directory JIT lookup), never mock invocation
 * counts in isolation.
 */

import { describe, it, expect, vi } from 'bun:test';
import { resolvePromptMemory } from './promptMemoryPolicy.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    isJitContextEnabled: vi.fn().mockReturnValue(false),
    getGlobalMemory: vi.fn().mockReturnValue(''),
    getUserMemory: vi.fn().mockReturnValue(''),
    getJitMemoryForPath: vi.fn().mockResolvedValue(''),
    getCoreMemory: vi.fn().mockReturnValue(undefined),
    getMcpInstructions: vi.fn().mockReturnValue(undefined),
    getWorkingDir: vi.fn().mockReturnValue('/workspace'),
    ...overrides,
  } as unknown as Config;
}

describe('resolvePromptMemory (issue #3173)', () => {
  describe('JIT enabled', () => {
    it('sources user memory from global plus JIT memory for the working directory', async () => {
      const getJitMemoryForPath = vi.fn().mockResolvedValue('JIT_MARKER');
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        getGlobalMemory: vi.fn().mockReturnValue('GLOBAL_MARKER'),
        getJitMemoryForPath,
        getWorkingDir: vi.fn().mockReturnValue('/proj/sub'),
      });

      const result = await resolvePromptMemory(config);

      expect(result.userMemory).toBe('GLOBAL_MARKER\n\nJIT_MARKER');
      expect(getJitMemoryForPath).toHaveBeenCalledWith('/proj/sub');
    });

    it('does not consult getUserMemory when JIT is enabled', async () => {
      const getUserMemory = vi
        .fn()
        .mockReturnValue('GLOBAL_MARKER\n\nENV_WITH_MCP_MARKER');
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        getGlobalMemory: vi.fn().mockReturnValue('GLOBAL_MARKER'),
        getJitMemoryForPath: vi.fn().mockResolvedValue('JIT_MARKER'),
        getUserMemory,
      });

      const result = await resolvePromptMemory(config);

      expect(result.userMemory).not.toContain('ENV_WITH_MCP_MARKER');
      expect(getUserMemory).not.toHaveBeenCalled();
    });

    it('preserves core memory and MCP instructions from their dedicated sources', async () => {
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        getCoreMemory: vi.fn().mockReturnValue('CORE_MARKER'),
        getMcpInstructions: vi.fn().mockReturnValue('MCP_MARKER'),
      });

      const result = await resolvePromptMemory(config);

      expect(result.coreMemory).toBe('CORE_MARKER');
      expect(result.mcpInstructions).toBe('MCP_MARKER');
    });

    it('produces JIT-only user memory when global memory is empty', async () => {
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        getGlobalMemory: vi.fn().mockReturnValue(''),
        getJitMemoryForPath: vi.fn().mockResolvedValue('JIT_MARKER'),
      });

      const result = await resolvePromptMemory(config);

      expect(result.userMemory).toBe('JIT_MARKER');
    });

    it('produces global-only user memory when JIT memory is empty', async () => {
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        getGlobalMemory: vi.fn().mockReturnValue('GLOBAL_MARKER'),
        getJitMemoryForPath: vi.fn().mockResolvedValue(''),
      });

      const result = await resolvePromptMemory(config);

      expect(result.userMemory).toBe('GLOBAL_MARKER');
    });

    it('produces no synthetic whitespace when both global and JIT are empty', async () => {
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        getGlobalMemory: vi.fn().mockReturnValue(''),
        getJitMemoryForPath: vi.fn().mockResolvedValue(''),
      });

      const result = await resolvePromptMemory(config);

      expect(result.userMemory).toBe('');
    });
  });

  describe('JIT disabled', () => {
    it('sources user memory from getUserMemory unchanged', async () => {
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(false),
        getUserMemory: vi.fn().mockReturnValue('USER_MEMORY_MARKER'),
      });

      const result = await resolvePromptMemory(config);

      expect(result.userMemory).toBe('USER_MEMORY_MARKER');
    });

    it('adds no JIT subdirectory memory', async () => {
      // In production getJitMemoryForPath returns '' when JIT is disabled, so
      // the policy appends nothing.
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(false),
        getUserMemory: vi.fn().mockReturnValue('USER_MEMORY_MARKER'),
        getJitMemoryForPath: vi.fn().mockResolvedValue(''),
      });

      const result = await resolvePromptMemory(config);

      expect(result.userMemory).toBe('USER_MEMORY_MARKER');
    });

    it('preserves core memory and MCP instructions', async () => {
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(false),
        getCoreMemory: vi.fn().mockReturnValue('CORE_MARKER'),
        getMcpInstructions: vi.fn().mockReturnValue('MCP_MARKER'),
      });

      const result = await resolvePromptMemory(config);

      expect(result.coreMemory).toBe('CORE_MARKER');
      expect(result.mcpInstructions).toBe('MCP_MARKER');
    });
  });

  describe('core-memory capture ordering (deferred-JIT regression)', () => {
    it('captures core memory before awaiting JIT memory', async () => {
      // Simulate a concurrent core-memory refresh: the value returned by
      // getCoreMemory changes while getJitMemoryForPath is pending. The
      // pre-extraction main builder read core memory before the JIT await, so
      // the shared policy must capture the pre-await value (issue #3173
      // review Blocker-Fix).
      let coreMemoryValue = 'CORE_BEFORE';
      const getCoreMemory = vi.fn(() => coreMemoryValue);
      const getJitMemoryForPath = vi.fn(async () => {
        coreMemoryValue = 'CORE_AFTER';
        return 'JIT_MARKER';
      });

      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        getGlobalMemory: vi.fn().mockReturnValue('GLOBAL_MARKER'),
        getJitMemoryForPath,
        getCoreMemory,
        getMcpInstructions: vi.fn().mockReturnValue('MCP_MARKER'),
      });

      const result = await resolvePromptMemory(config);

      expect(result.coreMemory).toBe('CORE_BEFORE');
    });

    it('reads MCP instructions after the JIT await to preserve main-agent ordering', async () => {
      // MCP instructions were acquired after the JIT await in the
      // pre-extraction main builder; the shared policy must keep that ordering.
      let mcpValue = 'MCP_BEFORE';
      const getMcpInstructions = vi.fn(() => mcpValue);
      const getJitMemoryForPath = vi.fn(async () => {
        mcpValue = 'MCP_AFTER';
        return 'JIT_MARKER';
      });

      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        getGlobalMemory: vi.fn().mockReturnValue('GLOBAL_MARKER'),
        getJitMemoryForPath,
        getMcpInstructions,
      });

      const result = await resolvePromptMemory(config);

      expect(result.mcpInstructions).toBe('MCP_AFTER');
    });
  });
});
