/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P06
 *
 * Public API boundary tests asserting the new surfaces (memory, skills,
 * workspace, lsp, harness config option) are available through the public
 * root and that the Agent interface carries the new readonly controls.
 *
 * These tests verify the public root's exported surface. Type imports come
 * exclusively from @vybestack/llxprt-code-agents. The test helper constructs
 * agents through public createAgent and keeps internal assertions test-only.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  Agent,
  AgentConfig,
  SkillInfo,
  AgentMemoryControl,
  AgentSkillsControl,
  AgentWorkspaceControl,
  AgentLspControl,
} from '@vybestack/llxprt-code-agents';
import { buildAgent } from './helpers/agentHarness.js';

describe('new public surfaces are exported from the public root @plan:PLAN-20260626-RUNTIMEBOUNDARY.P06', () => {
  it('a public-root-created Agent exposes live memory, skills, workspace, and lsp controls @requirement:boundary', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      expect(typeof agent.memory.getMemory).toBe('function');
      expect(typeof agent.memory.setMemory).toBe('function');
      expect(typeof agent.memory.getFileCount).toBe('function');
      expect(typeof agent.memory.getCoreMemory).toBe('function');
      expect(typeof agent.memory.refresh).toBe('function');
      expect(typeof agent.memory.onMemoryChanged).toBe('function');

      expect(typeof agent.skills.list).toBe('function');
      expect(typeof agent.skills.get).toBe('function');
      expect(typeof agent.skills.reload).toBe('function');
      expect(typeof agent.skills.isAdminEnabled).toBe('function');

      expect(typeof agent.workspace.getDirectories).toBe('function');
      expect(typeof agent.workspace.addDirectory).toBe('function');
      expect(typeof agent.workspace.getWorkingDirectory).toBe('function');
      expect(typeof agent.workspace.getProjectRoot).toBe('function');

      expect(typeof agent.lsp.status).toBe('function');
    } finally {
      await cleanup();
    }
  });

  it('Agent interface carries memory, skills, workspace, and lsp readonly controls @requirement:boundary', () => {
    expectTypeOf<Agent['memory']>().toEqualTypeOf<AgentMemoryControl>();
    expectTypeOf<Agent['skills']>().toEqualTypeOf<AgentSkillsControl>();
    expectTypeOf<Agent['workspace']>().toEqualTypeOf<AgentWorkspaceControl>();
    expectTypeOf<Agent['lsp']>().toEqualTypeOf<AgentLspControl>();
    const requiredControls: Record<
      keyof Pick<Agent, 'memory' | 'skills' | 'workspace' | 'lsp'>,
      true
    > = {
      memory: true,
      skills: true,
      workspace: true,
      lsp: true,
    };
    expect(Object.keys(requiredControls).sort()).toStrictEqual([
      'lsp',
      'memory',
      'skills',
      'workspace',
    ]);
  });

  it('Agent public interface does not expose raw Config access @requirement:boundary', async () => {
    expectTypeOf<Agent>().not.toHaveProperty('getConfig');
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      expect(agent).toHaveProperty('memory');
      expect(agent).not.toHaveProperty('getConfig');
      expect(Object.getOwnPropertyNames(agent)).not.toContain('getConfig');
      expect(
        Object.getOwnPropertyNames(Object.getPrototypeOf(agent)),
      ).not.toContain('getConfig');
    } finally {
      await cleanup();
    }
  });

  it('AgentConfig carries the optional harness field @requirement:boundary', () => {
    const config = {
      provider: 'fake',
      model: 'fake-model',
      harness: { forceInteractive: false },
    } satisfies AgentConfig;
    expect(config.harness).toBeDefined();
    expect(config.harness.forceInteractive).toBe(false);
  });

  it('SkillInfo shape omits prompt body from public metadata @requirement:boundary', () => {
    expectTypeOf<SkillInfo>().not.toHaveProperty('body');
    const skill = { name: 'x' } satisfies SkillInfo;
    expect(skill.name).toBe('x');
    expect(skill).not.toHaveProperty('body');
  });
});
