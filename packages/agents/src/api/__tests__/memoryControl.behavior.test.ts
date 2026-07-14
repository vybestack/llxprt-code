/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P02
 *
 * BEHAVIORAL RED suite for the `agent.memory` sub-controller
 * (AgentMemoryControl). Drives through the PUBLIC ROOT via the buildAgent
 * harness over a real FakeProvider. The REAL Config memory surface is seeded
 * with ZERO mocking.
 *
 * At GREEN: `agent.memory` is wired through the real MemoryControl delegation,
 * so every positive case exercises the bound Config memory surface.
 */

import { describe, it, expect } from 'vitest';
import { buildAgent, internalConfig } from './helpers/agentHarness.js';

describe('agent.memory control @plan:PLAN-20260626-RUNTIMEBOUNDARY.P02', () => {
  it('setMemory handles empty string without throwing @scenario:set-empty @given:an agent built normally @when:agent.memory.setMemory("") @then:agent.memory.getMemory() returns an empty string', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      settings: { jitContextEnabled: false },
    });
    try {
      agent.memory.setMemory('');
      expect(agent.memory.getMemory()).toBe('');
    } finally {
      await cleanup();
    }
  });

  it('getMemory returns a string (the live user memory content) @scenario:get-memory @given:an agent built normally @when:agent.memory.getMemory() @then:the result is a string', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const memory = agent.memory.getMemory();
      expect(typeof memory).toBe('string');
    } finally {
      await cleanup();
    }
  });

  it('setMemory delegates to Config.setUserMemory: after setMemory, internalConfig(agent).getUserMemory() reflects it when JIT context is disabled @scenario:set-memory @given:an agent built normally @when:agent.memory.setMemory("updated-content") @then:internalConfig(agent).getUserMemory() reflects the raw field OR contains the value', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      settings: { jitContextEnabled: false },
    });
    try {
      agent.memory.setMemory('updated-content');
      // The control delegates to Config.setUserMemory; with JIT context disabled,
      // getUserMemory() returns the raw field.
      const controlMemory = agent.memory.getMemory();
      const configMemory = internalConfig(agent).getUserMemory();
      expect(controlMemory).toContain('updated-content');
      expect(configMemory).toContain('updated-content');
    } finally {
      await cleanup();
    }
  });

  it('setMemory does not break JIT-context memory projection @scenario:set-memory-jit @given:an agent with default JIT context behavior @when:agent.memory.setMemory("jit-content") @then:the public memory projection remains a safe merged string', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const before = agent.memory.getMemory();
      agent.memory.setMemory('jit-content');
      expect(agent.memory.getMemory()).toBe(before);
      expect(typeof agent.memory.getMemory()).toBe('string');
    } finally {
      await cleanup();
    }
  });

  it('getFileCount returns a number (zero or more) @scenario:file-count @given:an agent built normally @when:agent.memory.getFileCount() @then:the result is a number >= 0', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const count = agent.memory.getFileCount();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    } finally {
      await cleanup();
    }
  });

  it('getCoreMemory returns undefined or a string @scenario:core-memory @given:an agent built normally @when:agent.memory.getCoreMemory() @then:the result is undefined or a string', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const core = agent.memory.getCoreMemory();
      expect(core === undefined || typeof core === 'string').toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('setCoreMemory delegates without throwing @scenario:core-memory-set @given:an agent built normally @when:agent.memory.setCoreMemory("core-content") @then:the core memory projection remains a safe optional string', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      expect(() => agent.memory.setCoreMemory('core-content')).not.toThrow();
      const core = agent.memory.getCoreMemory();
      expect(core === undefined || typeof core === 'string').toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('refresh resolves without throwing @scenario:refresh @given:an agent built normally @when:agent.memory.refresh() @then:the promise resolves (no throw)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await expect(agent.memory.refresh()).resolves.toMatchObject({
        memoryContent: expect.any(String),
        fileCount: expect.any(Number),
        filePaths: expect.any(Array),
      });
    } finally {
      await cleanup();
    }
  });

  it('onMemoryChanged fires for local memory changes and unsubscribe stops notifications @scenario:subscribe @given:an agent built normally @when:memory changes before and after unsubscribe @then:only subscribed changes notify', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      let called = 0;
      const unsub = agent.memory.onMemoryChanged(() => {
        called += 1;
      });
      expect(typeof unsub).toBe('function');
      agent.memory.setMemory('trigger-change');
      expect(called).toBeGreaterThan(0);
      unsub();
      const before = called;
      agent.memory.setMemory('after-unsub');
      expect(called).toBe(before);
    } finally {
      await cleanup();
    }
  });
});
