/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { ACTIVATE_SKILL_TOOL_NAME } from '@vybestack/llxprt-code-tools';
import {
  SimpleExtensionLoader,
  type LlxprtExtension,
} from '@vybestack/llxprt-code-core';
import {
  buildCliStyleConfig,
  buildFactoryLessConfig,
} from './helpers/buildCliStyleConfig.js';
import { buildAgent, internalConfig } from './helpers/agentHarness.js';
import { createFakeMcpRegistry } from './helpers/fakeMcpServer.js';

function extensionNamed(name: string): LlxprtExtension {
  return {
    name,
    version: '1.0.0',
    path: `memory://${name}`,
    isActive: true,
    contextFiles: [],
  };
}

class ObservedExtensionLoader extends SimpleExtensionLoader {
  readonly unloaded: string[] = [];
  readonly failures = new Map<string, Error>();

  override async unloadExtension(extension: LlxprtExtension): Promise<void> {
    this.unloaded.push(extension.name);
    await super.unloadExtension(extension);
    const failure = this.failures.get(extension.name);
    if (failure !== undefined) throw failure;
  }
}

describe('Config-owned extension teardown', () => {
  it('unloads only active extensions once across concurrent and repeated owner disposal', async () => {
    const active = extensionNamed('owned-active');
    const inactive = { ...extensionNamed('owned-inactive'), isActive: false };
    const loader = new ObservedExtensionLoader([active, inactive]);
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {},
      { extensionLoader: loader, enableExtensionReloading: true },
    );
    const agent = await fromConfig({ config: built.config });
    try {
      await agent.dispose();
      expect(loader.unloaded).toStrictEqual([]);
      expect(loader.getExtensions()).toContain(active);
      const disposal = built.config.dispose();
      const concurrentDisposal = built.config.dispose();
      expect(concurrentDisposal).toBe(disposal);
      await Promise.all([disposal, concurrentDisposal]);
      const repeatedDisposal = built.config.dispose();
      expect(repeatedDisposal).toBe(disposal);
      await repeatedDisposal;
      expect(loader.unloaded).toStrictEqual([active.name]);
      expect(loader.getExtensions()).toStrictEqual([inactive]);
    } finally {
      await agent.dispose();
      await built.cleanup();
    }
  });

  it('continues unloading after failures and preserves every cleanup error on repeated disposal', async () => {
    const extensions = ['first', 'second', 'last'].map(extensionNamed);
    const loader = new ObservedExtensionLoader(extensions);
    const firstFailure = new Error('first extension unload failed');
    const secondFailure = new Error('second extension unload failed');
    loader.failures.set('first', firstFailure);
    loader.failures.set('second', secondFailure);
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {},
      { extensionLoader: loader, enableExtensionReloading: true },
    );
    const agent = await fromConfig({ config: built.config });
    try {
      await agent.dispose();
      const first = built.config.dispose();
      const concurrent = built.config.dispose();
      const results = await Promise.allSettled([first, concurrent]);
      for (const result of results) {
        if (result.status !== 'rejected')
          throw new Error('Config disposal must report extension failures');
        expect(result.reason).toBeInstanceOf(AggregateError);
        if (!(result.reason instanceof AggregateError))
          throw new Error('Missing aggregate cleanup error');
        expect(result.reason.errors).toStrictEqual([
          firstFailure,
          secondFailure,
        ]);
      }
      expect(loader.unloaded).toStrictEqual(['first', 'second', 'last']);
      expect(loader.getExtensions()).toStrictEqual([]);
      await expect(built.config.dispose()).rejects.toBeInstanceOf(
        AggregateError,
      );
      expect(loader.unloaded).toStrictEqual(['first', 'second', 'last']);
    } finally {
      await agent.dispose();
      await built.cleanup().catch(() => {});
    }
  });

  it('lets an owning Agent release its real Config extensions without unloading twice', async () => {
    const active = extensionNamed('agent-owned');
    const built = await buildAgent('plain-text.jsonl', {
      extensions: [active],
    });
    const config = internalConfig(built.agent);
    try {
      expect(config.getExtensions()).toContainEqual(active);
      await built.agent.dispose();
      expect(config.getExtensions()).not.toContainEqual(active);
      await config.dispose();
      await built.agent.dispose();
      expect(config.getExtensions()).toStrictEqual([]);
    } finally {
      await built.cleanup();
    }
  });
});

describe('shared caller-owned Config extension lifecycle', () => {
  it('preserves extension skills and MCP until the shared Config owner disposes', async () => {
    const registry = createFakeMcpRegistry();
    const server = registry.registerServer('extension-server', {
      command: 'fake-extension-server',
    });
    server.setTools([{ name: 'extension-query', enabled: true }]);
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      skillsSupport: true,
      extensions: [
        {
          name: 'shared-extension',
          version: '1.0.0',
          path: 'memory://shared-extension',
          isActive: true,
          contextFiles: [],
          mcpServers: { 'extension-server': server.config },
          skills: [
            {
              name: 'shared-skill',
              description: 'Instructions for the surviving session',
              location: 'memory://shared-extension/SKILL.md',
              body: 'Instructions for the surviving session',
            },
          ],
        },
      ],
    });
    let agentA: Agent | undefined;
    let agentB: Agent | undefined;
    try {
      agentA = await fromConfig({
        config: built.config,
        sessionId: 'same-label',
      });
      agentB = await fromConfig({
        config: built.config,
        sessionId: 'same-label',
      });
      const extension = built.config.getExtensionLoader().getExtensions()[0];
      expect(extension.isActive).toBe(true);
      expect(agentB.skills.list().map((skill) => skill.name)).toContain(
        'shared-skill',
      );

      const mcpToolName = agentB
        .listTools()
        .find((tool) => tool.server === server.name)?.name;
      if (mcpToolName === undefined)
        throw new Error('Extension MCP tool was not discovered');
      const mcpTool = agentB.getToolRegistry().getTool(mcpToolName);
      if (mcpTool === undefined)
        throw new Error('Extension MCP tool was not projected');
      expect(
        (await mcpTool.build({}).execute(new AbortController().signal)).error,
      ).toBeUndefined();

      await agentA.dispose();
      expect(built.config.getExtensionLoader().getExtensions()).toContain(
        extension,
      );
      expect(extension.isActive).toBe(true);
      expect(agentB.skills.list().map((skill) => skill.name)).toContain(
        'shared-skill',
      );
      const tool = agentB.getToolRegistry().getTool(ACTIVATE_SKILL_TOOL_NAME);
      if (tool === undefined) {
        throw new Error('Surviving session has no skill activation tool');
      }
      const result = await tool
        .build({ name: 'shared-skill' })
        .execute(new AbortController().signal);
      expect(result.llmContent).toContain(
        'Instructions for the surviving session',
      );
      expect(agentB.listTools().map((tool) => tool.name)).toContain(
        mcpToolName,
      );
      expect(
        (await mcpTool.build({}).execute(new AbortController().signal)).error,
      ).toBeUndefined();
      built.config.setEphemeralSetting('shared-config-probe', 'usable');
      expect(built.config.getEphemeralSetting('shared-config-probe')).toBe(
        'usable',
      );
      await built.config.refreshSkills(built.messageBus);
      expect(
        built.config
          .getSkillManager()
          .getSkills()
          .map((skill) => skill.name),
      ).toContain('shared-skill');
      const reply = await agentB.chat('Confirm the surviving session works');
      expect(reply.error).toBeUndefined();
      expect(reply.text.length).toBeGreaterThan(0);
      await agentB.dispose();
      expect(built.config.getExtensions()).toContain(extension);
      await built.config.dispose();
      expect(built.config.getExtensions()).not.toContain(extension);
      expect(
        (await mcpTool.build({}).execute(new AbortController().signal)).error,
      ).toBeDefined();
    } finally {
      try {
        await Promise.all([agentA?.dispose(), agentB?.dispose()]);
      } finally {
        try {
          await built.config.dispose();
        } finally {
          await built.cleanup();
        }
      }
    }
  });
});
