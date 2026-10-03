/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { buildAgent } from './helpers/agentHarness.js';

describe('workspace tool publication', () => {
  it('does not grant tools when a newly created agent starts in an untrusted folder', async () => {
    const built = await buildAgent('plain-text.jsonl', { folderTrust: false });
    try {
      expect(
        built.agent.getToolRegistry().getTool('read_file'),
      ).toBeUndefined();
      expect(
        built.agent.getToolRegistry().getFunctionDeclarations(),
      ).toStrictEqual([]);
      expect(built.agent.tools.list()).toStrictEqual([]);
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('hides source and session tool views on trust revocation and restores them on trust gain', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    let agent: Agent | undefined;
    try {
      agent = await fromConfig({ config: built.config });
      const registry = agent.getToolRegistry();
      expect(registry.getTool('read_file')).toBeDefined();
      await built.config.setTrustedFolderLive(false);
      expect(
        built.config.getToolRegistry().getTool('read_file'),
      ).toBeUndefined();
      expect(registry.getTool('read_file')).toBeUndefined();
      expect(registry.getAllTools()).toStrictEqual([]);
      expect(registry.getFunctionDeclarations()).toStrictEqual([]);
      expect(
        registry.getFunctionDeclarationsFiltered(['read_file']),
      ).toStrictEqual([]);
      await built.config.setTrustedFolderLive(true);
      expect(built.config.getToolRegistry().getTool('read_file')).toBeDefined();
      expect(registry.getTool('read_file')).toBeDefined();
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('keeps a caller-excluded tool blocked across a profile switch and trust changes', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      excludeTools: ['read_file'],
    });
    let agent: Agent | undefined;
    try {
      agent = await fromConfig({ config: built.config });
      expect(agent.getToolRegistry().getTool('read_file')).toBeUndefined();
      await agent.profiles.create('switched', {
        name: 'switched',
        provider: 'fake',
        model: 'fake-model',
        modelParams: {
          temperature: 0.25,
          allowedTools: ['read_file'],
          includeDirectories: ['/outside-workspace'],
        },
      });
      await agent.profiles.apply('switched');
      expect(agent.workspace.getDirectories()).not.toContain(
        '/outside-workspace',
      );
      expect(agent.getToolRegistry().getTool('read_file')).toBeUndefined();
      expect(
        agent.getToolRegistry().getFunctionDeclarationsFiltered(['read_file']),
      ).toStrictEqual([]);
      await built.config.setTrustedFolderLive(false);
      expect(agent.getToolRegistry().getAllToolNames()).toStrictEqual([]);
      await built.config.setTrustedFolderLive(true);
      expect(agent.getToolRegistry().getTool('read_file')).toBeUndefined();
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('does not publish a tool discovered after a caller-owned workspace loses trust', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    let agent: Agent | undefined;
    try {
      agent = await fromConfig({ config: built.config });
      await built.config.setTrustedFolderLive(false);
      const executions: string[] = [];
      const late = new DiscoveredMCPTool(
        {
          tool: async () => ({ functionDeclarations: [] }),
          callTool: async () => {
            executions.push('late');
            return [];
          },
        },
        'late-server',
        'late',
        'late tool',
        { type: 'object' },
      );
      built.config.getToolRegistry().registerTool(late);
      await built.config.refreshDiscoveredMcpMetadata();
      expect(built.config.getToolRegistry().getTool(late.name)).toBeUndefined();
      expect(agent.getToolRegistry().getTool(late.name)).toBeUndefined();
      expect(
        agent
          .getToolRegistry()
          .getFunctionDeclarations()
          .map((tool) => tool.name),
      ).not.toContain(late.name);
      const statuses: string[] = [];
      const scheduler = await agent.scheduler.acquire(
        agent,
        'session',
        {
          getPreferredEditor: () => undefined,
          onEditorClose: () => {},
          onToolCallsUpdate: (calls) => {
            statuses.push(...calls.map((call) => call.status));
          },
        },
        { interactiveMode: true },
        {
          messageBus: agent.getMessageBus(),
          toolRegistry: agent.getToolRegistry(),
        },
      );
      try {
        await scheduler.schedule(
          [
            {
              callId: 'denied-late',
              name: late.name,
              args: {},
              isClientInitiated: false,
              prompt_id: 'denied-workspace',
            },
          ],
          new AbortController().signal,
        );
        expect(statuses).toContain('error');
        expect(executions).toStrictEqual([]);
      } finally {
        agent.scheduler.release(agent, 'session', scheduler);
      }
      await built.config.setTrustedFolderLive(true);
      expect(agent.getToolRegistry().getTool(late.name)).toBeDefined();
    } finally {
      await agent?.dispose();
      await built.cleanup();
    }
  }, 30000);
});
